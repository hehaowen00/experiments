const { ipcMain, dialog } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const store = require('./store');
const { generateKSUID } = require('./ksuid');

const state = require('./p2p/state');
const settings = require('./p2p/settings');
const sshServer = require('./p2p/ssh-server');
const discovery = require('./p2p/discovery');
const httpServerMod = require('./p2p/http-server');
const { httpPost, httpGet } = require('./p2p/http-client');
const remoteUtils = require('./p2p/remote-utils');

// --- Start / Stop ---

async function startP2p() {
  if (state.getHttpServer()) return;
  settings.getOrCreatePeerId();
  remoteUtils.migrateSshCommand();
  await httpServerMod.startHttpServer();
  await sshServer.startGitSshServer();
  discovery.startBrowsing(settings.getOrCreatePeerId());
}

async function stopP2p() {
  discovery.stopBrowsing();
  sshServer.stopGitSshServer();
  httpServerMod.stopHttpServer();
}

// --- IPC Registration ---

function register(win) {
  state.setMainWindow(win);

  ipcMain.handle('p2p:getIdentity', () => ({
    peerId: settings.getOrCreatePeerId(),
    displayName: settings.getDisplayName(),
    httpPort: settings.getHttpPort(),
    enabled: settings.isEnabled(),
  }));

  ipcMain.handle('p2p:setDisplayName', (_, name) => {
    settings.setSetting('p2p:displayName', name);
    return true;
  });

  ipcMain.handle('p2p:setEnabled', async (_, enabled) => {
    settings.setSetting('p2p:enabled', enabled ? 'true' : 'false');
    if (enabled) {
      await startP2p();
    } else {
      await stopP2p();
    }
    return true;
  });

  ipcMain.handle('p2p:peerList', () => {
    const db = store.getDb();
    const onlinePeers = state.getOnlinePeers();
    return db
      .prepare('SELECT * FROM p2p_peers ORDER BY created_at DESC')
      .all()
      .map((p) => ({ ...p, online: onlinePeers.has(p.peer_id) }));
  });

  ipcMain.handle('p2p:sendFriendRequest', async (_, peerId) => {
    const db = store.getDb();
    const onlinePeers = state.getOnlinePeers();
    const peer = db
      .prepare('SELECT * FROM p2p_peers WHERE peer_id = ?')
      .get(peerId);
    if (!peer) return { error: 'Peer not found' };

    const info = onlinePeers.get(peerId);
    const host = info?.host || peer.host;
    const port = info?.httpPort || peer.http_port;
    if (!host || !port) return { error: 'Peer is not reachable' };

    try {
      const result = await httpPost(host, port, '/friend-request', {
        peerId: settings.getOrCreatePeerId(),
        name: settings.getDisplayName(),
      });

      const newStatus =
        result.status === 'already_accepted' ? 'accepted' : 'request_sent';
      db.prepare(
        'UPDATE p2p_peers SET status = ? WHERE peer_id = ?',
      ).run(newStatus, peerId);
      settings.notifyPeersChanged();
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('p2p:respondFriendRequest', async (_, peerId, accepted) => {
    const db = store.getDb();
    const onlinePeers = state.getOnlinePeers();
    const peer = db
      .prepare('SELECT * FROM p2p_peers WHERE peer_id = ?')
      .get(peerId);
    if (!peer) return { error: 'Peer not found' };

    db.prepare('UPDATE p2p_peers SET status = ? WHERE peer_id = ?').run(
      accepted ? 'accepted' : 'rejected',
      peerId,
    );

    const info = onlinePeers.get(peerId);
    const host = info?.host || peer.host;
    const port = info?.httpPort || peer.http_port;
    if (host && port) {
      try {
        await httpPost(host, port, '/friend-response', {
          peerId: settings.getOrCreatePeerId(),
          name: settings.getDisplayName(),
          accepted,
        });
      } catch {
        // peer may be offline
      }
    }

    settings.notifyPeersChanged();
    return { status: accepted ? 'accepted' : 'rejected' };
  });

  ipcMain.handle('p2p:blockPeer', (_, peerId) => {
    store
      .getDb()
      .prepare('UPDATE p2p_peers SET status = ? WHERE peer_id = ?')
      .run('blocked', peerId);
    settings.notifyPeersChanged();
    return true;
  });

  ipcMain.handle('p2p:unblockPeer', (_, peerId) => {
    store
      .getDb()
      .prepare('UPDATE p2p_peers SET status = ? WHERE peer_id = ?')
      .run('discovered', peerId);
    settings.notifyPeersChanged();
    return true;
  });

  ipcMain.handle('p2p:removePeer', (_, peerId) => {
    store
      .getDb()
      .prepare('DELETE FROM p2p_peers WHERE peer_id = ?')
      .run(peerId);
    settings.notifyPeersChanged();
    return true;
  });

  ipcMain.handle('p2p:getAllPeerRepos', () => {
    const db = store.getDb();
    return db
      .prepare(
        `SELECT pr.remote_path as "exportName", pr.name, pr.local_repo_id,
                pr.remote_name, p.peer_id as "peerId", p.name as "peerName",
                r.path as local_path
         FROM p2p_peer_repos pr
         INNER JOIN p2p_peers p ON p.id = pr.peer_id AND p.status = 'accepted'
         LEFT JOIN git_repos r ON r.id = pr.local_repo_id
         ORDER BY p.name, pr.name`,
      )
      .all()
      .filter(row => {
        // Exclude repos linked locally but without a working gitsync peer remote
        if (row.local_repo_id && row.local_path) {
          if (!remoteUtils.hasPeerSshRemote(row.local_path, row.remote_name)) return false;
        }
        return true;
      });
  });

  ipcMain.handle('p2p:getSharedRepos', () =>
    store
      .getDb()
      .prepare(
        `SELECT r.id, r.name, r.path,
                CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END as shared
         FROM git_repos r
         LEFT JOIN p2p_shared_repos s ON s.repo_id = r.id
         ORDER BY r.name`,
      )
      .all(),
  );

  ipcMain.handle('p2p:setRepoShared', (_, repoId, shared) => {
    const db = store.getDb();
    if (shared) {
      db.prepare(
        'INSERT OR IGNORE INTO p2p_shared_repos (id, repo_id) VALUES (?, ?)',
      ).run(generateKSUID(), repoId);

      // Allow pushing to checked-out branches by updating the working tree
      const repo = db
        .prepare('SELECT path FROM git_repos WHERE id = ?')
        .get(repoId);
      if (repo) {
        execFile(
          'git',
          ['config', '--local', 'receive.denyCurrentBranch', 'updateInstead'],
          { cwd: repo.path },
          () => {},
        );
      }
    } else {
      db.prepare('DELETE FROM p2p_shared_repos WHERE repo_id = ?').run(repoId);

      // Remove the config when unsharing
      const repo = db
        .prepare('SELECT path FROM git_repos WHERE id = ?')
        .get(repoId);
      if (repo) {
        execFile(
          'git',
          ['config', '--local', '--unset', 'receive.denyCurrentBranch'],
          { cwd: repo.path },
          () => {},
        );
      }
    }
    return true;
  });

  ipcMain.handle('p2p:fetchPeerRepos', async (_, peerId) => {
    const db = store.getDb();
    const onlinePeers = state.getOnlinePeers();
    const peer = db
      .prepare('SELECT * FROM p2p_peers WHERE peer_id = ?')
      .get(peerId);
    if (!peer) return { error: 'Peer not found' };
    if (peer.status !== 'accepted') return { error: 'Peer not accepted' };

    const info = onlinePeers.get(peerId);
    const host = info?.host || peer.host;
    const port = info?.httpPort || peer.http_port;
    if (!host || !port) return { error: 'Peer is not reachable' };

    try {
      const result = await httpGet(host, port, '/repos', {
        'X-Peer-Id': settings.getOrCreatePeerId(),
      });
      if (result.error) return { error: result.error };

      const peerRow = db
        .prepare('SELECT id FROM p2p_peers WHERE peer_id = ?')
        .get(peerId);

      // Upsert peer repos, preserving local_repo_id and remote_name links
      const existing = db
        .prepare('SELECT * FROM p2p_peer_repos WHERE peer_id = ?')
        .all(peerRow.id);
      const existingByPath = new Map(existing.map((r) => [r.remote_path, r]));
      const seenPaths = new Set();

      const ins = db.prepare(
        'INSERT INTO p2p_peer_repos (id, peer_id, name, remote_path) VALUES (?, ?, ?, ?)',
      );
      const upd = db.prepare(
        'UPDATE p2p_peer_repos SET name = ? WHERE id = ?',
      );
      for (const repo of result.repos || []) {
        seenPaths.add(repo.exportName);
        const ex = existingByPath.get(repo.exportName);
        if (ex) {
          upd.run(repo.name, ex.id);
        } else {
          ins.run(generateKSUID(), peerRow.id, repo.name, repo.exportName);
        }
      }

      // Remove repos the peer no longer shares (but only unlinked ones)
      for (const ex of existing) {
        if (!seenPaths.has(ex.remote_path) && !ex.local_repo_id) {
          db.prepare('DELETE FROM p2p_peer_repos WHERE id = ?').run(ex.id);
        }
      }

      // Return repos with local clone info and origin URLs
      const updatedRows = db
        .prepare(
          `SELECT pr.remote_path as "exportName", pr.name, pr.local_repo_id,
                  pr.remote_name, r.path as local_path
           FROM p2p_peer_repos pr
           LEFT JOIN git_repos r ON r.id = pr.local_repo_id
           WHERE pr.peer_id = ?`,
        )
        .all(peerRow.id);

      // Only include repos that are still shared by the peer
      const peerSharedNames = new Set((result.repos || []).map(r => r.exportName));

      // Attach origin URLs from the peer's response
      const originMap = new Map((result.repos || []).map(r => [r.exportName, r.originUrl]));

      const filtered = updatedRows.filter(row => {
        // Exclude repos no longer shared by the peer
        if (!peerSharedNames.has(row.exportName)) return false;
        // Exclude repos linked locally but without a working gitsync peer remote
        if (row.local_repo_id && row.local_path) {
          if (!remoteUtils.hasPeerSshRemote(row.local_path, row.remote_name)) return false;
        }
        return true;
      });

      for (const row of filtered) {
        row.originUrl = originMap.get(row.exportName) || null;
      }

      return { repos: filtered };
    } catch (err) {
      return { error: err.message };
    }
  });

  function makeGitSshEnv() {
    return {
      ...process.env,
      GIT_SSH_COMMAND: `"${state.getGitSshBin()}" connect`,
      GIT_SSH_VARIANT: 'ssh',
    };
  }

  // Clone from peer over the embedded SSH server.
  ipcMain.handle(
    'p2p:cloneFromPeer',
    async (_, peerId, exportName, repoName, originUrl) => {
      const db = store.getDb();
      const onlinePeers = state.getOnlinePeers();
      const mainWindow = state.getMainWindow();
      const peer = db
        .prepare('SELECT * FROM p2p_peers WHERE peer_id = ?')
        .get(peerId);
      if (!peer) return { error: 'Peer not found' };

      const info = onlinePeers.get(peerId);
      const host = info?.host || peer.host;
      const peerSshPort = info?.sshPort || peer.ssh_port;
      if (!host || !peerSshPort) {
        return { error: "Peer's SSH server is not reachable" };
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose clone destination',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths.length) {
        return { canceled: true };
      }

      const destDir = path.join(result.filePaths[0], repoName);
      const myPeerId = settings.getOrCreatePeerId();
      const sshUrl = `ssh://${myPeerId}@${host}:${peerSshPort}/${exportName}`;

      // Use peer's display name as remote name instead of 'origin'
      const peerRemoteName = (peer.name || peerId).replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();

      try {
        await new Promise((resolve, reject) => {
          const proc = spawn(
            'git',
            ['clone', '--progress', '--origin', peerRemoteName, sshUrl, destDir],
            { env: makeGitSshEnv() },
          );
          let stderrBuf = '';
          let lastProgressSend = 0;
          proc.stderr.on('data', (chunk) => {
            stderrBuf += chunk.toString();
            // Parse git clone progress from stderr (throttle to ~4 updates/sec)
            const now = Date.now();
            if (now - lastProgressSend < 250) return;
            const lines = chunk.toString().split(/\r|\n/);
            for (const line of lines) {
              const match = line.match(/(\w[\w\s]+):\s+(\d+)%\s*(?:\((\d+)\/(\d+)\))?/);
              if (match && mainWindow && !mainWindow.isDestroyed()) {
                lastProgressSend = now;
                mainWindow.webContents.send('p2p:clone-progress', {
                  phase: match[1].trim(),
                  percent: parseInt(match[2]),
                  current: match[3] ? parseInt(match[3]) : 0,
                  total: match[4] ? parseInt(match[4]) : 0,
                });
                break;
              }
            }
          });
          proc.on('close', (code) => {
            if (code !== 0) reject(new Error(stderrBuf || `git clone exited with code ${code}`));
            else resolve();
          });
          proc.on('error', (err) => reject(err));
        });

        // Configure SSH only for the peer remote (not repo-wide, so GitHub etc. work normally)
        remoteUtils.setRemoteSshCommand(destDir, peerRemoteName);

        const repoId = generateKSUID();
        db.prepare(
          'INSERT INTO git_repos (id, name, path) VALUES (?, ?, ?)',
        ).run(repoId, repoName, destDir);

        const peerRow = db
          .prepare('SELECT id FROM p2p_peers WHERE peer_id = ?')
          .get(peerId);
        db.prepare(
          'UPDATE p2p_peer_repos SET local_repo_id = ?, remote_name = ? WHERE peer_id = ? AND remote_path = ?',
        ).run(repoId, peerRemoteName, peerRow.id, exportName);

        // Set up origin pointing to the same upstream (e.g. GitHub)
        if (originUrl) {
          await new Promise((resolve) => {
            execFile(
              'git',
              ['remote', 'add', 'origin', originUrl],
              { cwd: destDir },
              () => resolve(),
            );
          });
        }

        // Auto-share the cloned repo so the peer can pull from us too
        db.prepare(
          'INSERT OR IGNORE INTO p2p_shared_repos (id, repo_id) VALUES (?, ?)',
        ).run(generateKSUID(), repoId);

        // Allow pushing to checked-out branches
        await new Promise((resolve) => {
          execFile(
            'git',
            ['config', '--local', 'receive.denyCurrentBranch', 'updateInstead'],
            { cwd: destDir },
            () => resolve(),
          );
        });

        // Notify the peer so they add us as a remote
        const info = onlinePeers.get(peerId);
        const peerHttpPort = info?.httpPort || peer.http_port;
        if (host && peerHttpPort) {
          try {
            await httpPost(host, peerHttpPort, '/clone-notify', {
              peerId: myPeerId,
              exportName,
            });
          } catch {
            // peer may be temporarily unreachable, not critical
          }
        }

        return { repoId, path: destDir };
      } catch (err) {
        const msg = err.message || 'Unknown error';
        // Provide actionable context
        let detail = msg;
        if (msg.includes('Connection refused') || msg.includes('connect to host')) {
          detail = `Could not connect to peer's SSH server at ${host}:${peerSshPort}.\n\n${msg}`;
        } else if (msg.includes('Permission denied') || msg.includes('authentication')) {
          detail = `Authentication failed. Make sure the peer has accepted your friend request.\n\n${msg}`;
        } else if (msg.includes('not found') || msg.includes('does not appear to be a git repository')) {
          detail = `Repository "${exportName}" was not found on the peer. It may have been unshared.\n\n${msg}`;
        } else if (msg.includes('already exists')) {
          detail = `Destination directory "${destDir}" already exists.\n\n${msg}`;
        } else if (msg.includes('timeout') || msg.includes('Timeout')) {
          detail = `Clone timed out. The repository may be very large or the connection is slow.\n\n${msg}`;
        }
        return { error: detail };
      }
    },
  );

  ipcMain.handle(
    'p2p:addPeerRemote',
    async (_, repoPath, peerId, exportName, remoteName) => {
      const db = store.getDb();
      const onlinePeers = state.getOnlinePeers();
      const peer = db
        .prepare('SELECT * FROM p2p_peers WHERE peer_id = ?')
        .get(peerId);
      if (!peer) return { error: 'Peer not found' };

      const info = onlinePeers.get(peerId);
      const host = info?.host || peer.host;
      const peerSshPort = info?.sshPort || peer.ssh_port;
      if (!host || !peerSshPort) {
        return { error: "Peer's SSH server is not reachable" };
      }

      const myPeerId = settings.getOrCreatePeerId();
      const sshUrl = `ssh://${myPeerId}@${host}:${peerSshPort}/${exportName}`;

      try {
        await new Promise((resolve, reject) => {
          execFile(
            'git',
            ['remote', 'add', remoteName || 'peer', sshUrl],
            { cwd: repoPath },
            (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message));
              else resolve(stdout);
            },
          );
        });

        // Configure SSH only for this peer remote (not repo-wide)
        remoteUtils.setRemoteSshCommand(repoPath, remoteName || 'peer');

        // Link this repo to the peer so remote URLs can be updated dynamically
        const actualRemote = remoteName || 'peer';
        const peerRow = db
          .prepare('SELECT id FROM p2p_peers WHERE peer_id = ?')
          .get(peerId);
        const localRepo = db
          .prepare('SELECT id FROM git_repos WHERE path = ?')
          .get(repoPath);
        if (peerRow && localRepo) {
          const existingLink = db
            .prepare(
              'SELECT id FROM p2p_peer_repos WHERE peer_id = ? AND remote_path = ?',
            )
            .get(peerRow.id, exportName);
          if (existingLink) {
            db.prepare(
              'UPDATE p2p_peer_repos SET local_repo_id = ?, remote_name = ? WHERE id = ?',
            ).run(localRepo.id, actualRemote, existingLink.id);
          } else {
            db.prepare(
              'INSERT INTO p2p_peer_repos (id, peer_id, name, remote_path, local_repo_id, remote_name) VALUES (?, ?, ?, ?, ?, ?)',
            ).run(
              generateKSUID(),
              peerRow.id,
              exportName,
              exportName,
              localRepo.id,
              actualRemote,
            );
          }
        }

        return { ok: true };
      } catch (err) {
        return { error: err.message };
      }
    },
  );

  // Always disable P2P on startup — user must opt in each session
  settings.setSetting('p2p:enabled', 'false');
}

function shutdown() {
  stopP2p();
}

module.exports = { register, shutdown };
