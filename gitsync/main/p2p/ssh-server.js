const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const store = require('../store');
const state = require('./state');

// --- Shared repo resolution ---

function resolveSharedRepo(exportName) {
  const db = store.getDb();
  const rows = db
    .prepare(
      `SELECT r.path, r.name FROM git_repos r
       INNER JOIN p2p_shared_repos s ON s.repo_id = r.id`,
    )
    .all();
  for (const r of rows) {
    const sanitized = r.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (sanitized === exportName) return r.path;
  }
  return null;
}

// --- SSH host key ---

function getOrCreateHostKey() {
  const CONFIG_DIR = state.getConfigDir();
  const HOST_KEY_PATH = state.getHostKeyPath();

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (fs.existsSync(HOST_KEY_PATH)) {
    return fs.readFileSync(HOST_KEY_PATH);
  }
  // Generate an RSA key pair using ssh-keygen
  const result = require('child_process').execFileSync('ssh-keygen', [
    '-t',
    'ed25519',
    '-f',
    HOST_KEY_PATH,
    '-N',
    '',
    '-q',
  ]);
  return fs.readFileSync(HOST_KEY_PATH);
}

// --- Embedded SSH server ---
// Authenticates peers by peerId (sent as username). Only accepted friends
// can connect. Handles git-upload-pack and git-receive-pack exec requests.

function startGitSshServer() {
  return new Promise((resolve, reject) => {
    const CONFIG_DIR = state.getConfigDir();
    const HOST_KEY_PATH = state.getHostKeyPath();
    const gitSshBin = state.getGitSshBin();

    const dbPath = path.join(CONFIG_DIR, 'gitsync.db');
    const hostKeyPath = HOST_KEY_PATH;

    // Ensure host key exists before starting the Go binary
    getOrCreateHostKey();

    const proc = spawn(gitSshBin, [
      'serve',
      '--port',
      '0',
      '--db',
      dbPath,
      '--host-key',
      hostKeyPath,
    ]);
    state.setGitSshProcess(proc);

    // Read first line for PORT=<N>
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        proc.stdout.removeListener('data', onData);
        const match = line.match(/^PORT=(\d+)$/);
        if (match) {
          state.setSshPort(parseInt(match[1]));
          resolve(state.getSshPort());
        } else {
          console.error('Unexpected output from gitsync-ssh:', line);
          resolve(0);
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (chunk) => {
      console.error('gitsync-ssh:', chunk.toString().trim());
    });
    proc.on('error', (err) => {
      state.setGitSshProcess(null);
      console.error('gitsync-ssh failed to start:', err.message);
      resolve(0);
    });
    proc.on('exit', (code) => {
      state.setGitSshProcess(null);
      if (code) console.error('gitsync-ssh exited with code', code);
    });
  });
}

function stopGitSshServer() {
  const gitSshProcess = state.getGitSshProcess();
  if (gitSshProcess) {
    gitSshProcess.kill();
    state.setGitSshProcess(null);
    state.setSshPort(0);
  }
}

module.exports = {
  resolveSharedRepo,
  getOrCreateHostKey,
  startGitSshServer,
  stopGitSshServer,
};
