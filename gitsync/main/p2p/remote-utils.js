const { execFile, execFileSync } = require('child_process');
const store = require('../store');
const state = require('./state');

// --- Peer remote validation ---

function hasPeerSshRemote(repoPath, remoteName) {
  try {
    const url = execFileSync(
      'git', ['remote', 'get-url', remoteName],
      { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
    ).trim();
    // Gitsync peer remotes use ssh://peerId@host:port/path
    return url.startsWith('ssh://') && url.length > 6;
  } catch {
    return false;
  }
}

// --- Dynamic remote URL updates ---
// When a peer's IP or SSH port changes, rewrite all git remotes pointing to them.

function updatePeerRemoteUrls(peerId, newHost, newSshPort) {
  if (!newHost || !newSshPort) return;
  const db = store.getDb();
  // Lazy-require settings to avoid circular dependency
  const { getOrCreatePeerId } = require('./settings');
  const myPeerId = getOrCreatePeerId();

  // Find all local repos linked to this peer
  const rows = db
    .prepare(
      `SELECT r.path, pr.remote_name, pr.remote_path
       FROM p2p_peer_repos pr
       INNER JOIN p2p_peers p ON p.id = pr.peer_id
       INNER JOIN git_repos r ON r.id = pr.local_repo_id
       WHERE p.peer_id = ? AND pr.local_repo_id IS NOT NULL`,
    )
    .all(peerId);

  for (const row of rows) {
    const remoteName = row.remote_name || 'origin';
    const newUrl = `ssh://${myPeerId}@${newHost}:${newSshPort}/${row.remote_path}`;
    execFile(
      'git',
      ['remote', 'set-url', remoteName, newUrl],
      { cwd: row.path },
      () => {},
    );
  }
}

// --- Per-remote SSH config ---
// Only peer remotes use the Go SSH binary. Normal remotes (GitHub, etc.) use
// the system SSH so authentication (keys, agent) works as expected.

function setRemoteSshCommand(repoPath, remoteName) {
  const gitSshBin = state.getGitSshBin();
  const cmd = `"${gitSshBin}" connect`;
  try {
    execFileSync(
      'git', ['config', '--local', `remote.${remoteName}.sshCommand`, cmd],
      { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
    );
  } catch (err) {
    console.error(`Failed to set sshCommand for remote ${remoteName}:`, err.message);
  }
}

function unsetGlobalSshCommand(repoPath) {
  // Remove old repo-wide core.sshCommand if present so normal remotes work
  try {
    execFileSync(
      'git', ['config', '--local', '--unset', 'core.sshCommand'],
      { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
    );
  } catch {}
  try {
    execFileSync(
      'git', ['config', '--local', '--unset', 'ssh.variant'],
      { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
    );
  } catch {}
}

// --- Migrate: move from global core.sshCommand to per-remote sshCommand ---

function migrateSshCommand() {
  const db = store.getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT r.path, pr.remote_name
       FROM git_repos r
       INNER JOIN p2p_peer_repos pr ON pr.local_repo_id = r.id
       WHERE pr.remote_name IS NOT NULL`,
    )
    .all();

  for (const { path: repoPath, remote_name } of rows) {
    try {
      // Set per-remote SSH command
      setRemoteSshCommand(repoPath, remote_name);
      // Remove old global config
      unsetGlobalSshCommand(repoPath);
    } catch {
      // repo may have been deleted from disk
    }
  }
}

module.exports = {
  hasPeerSshRemote,
  updatePeerRemoteUrls,
  setRemoteSshCommand,
  unsetGlobalSshCommand,
  migrateSshCommand,
};
