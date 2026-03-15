const http = require('http');
const store = require('../store');
const { generateKSUID } = require('../ksuid');
const state = require('./state');
const {
  getOrCreatePeerId,
  getDisplayName,
  getHttpPort,
  setSetting,
  notifyPeersChanged,
  notifyFriendRequest,
} = require('./settings');
const { resolveSharedRepo } = require('./ssh-server');
const {
  setRemoteSshCommand,
  unsetGlobalSshCommand,
} = require('./remote-utils');

// --- HTTP Signaling Server (friend requests + repo list only) ---

function startHttpServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'GET' && url.pathname === '/ping') {
        res.end(
          JSON.stringify({
            peerId: getOrCreatePeerId(),
            name: getDisplayName(),
          }),
        );
        return;
      }

      if (req.method === 'POST' && url.pathname === '/friend-request') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            handleFriendRequest(JSON.parse(body), res);
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/friend-response') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            handleFriendResponse(JSON.parse(body), res);
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/repos') {
        handleGetRepos(req.headers['x-peer-id'], res);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/clone-notify') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            handleCloneNotify(JSON.parse(body), res);
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    const desiredPort = getHttpPort();
    server.listen(desiredPort, () => {
      const port = server.address().port;
      setSetting('p2p:httpPort', port);
      state.setHttpServer(server);
      resolve(port);
    });

    server.on('error', () => {
      server.listen(0, () => {
        const port = server.address().port;
        setSetting('p2p:httpPort', port);
        state.setHttpServer(server);
        resolve(port);
      });
    });
  });
}

function handleFriendRequest(data, res) {
  const { peerId, name } = data;
  if (!peerId || !name) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing peerId or name' }));
    return;
  }

  if (peerId === getOrCreatePeerId()) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Cannot friend yourself' }));
    return;
  }

  const db = store.getDb();
  const existing = db
    .prepare('SELECT id, status FROM p2p_peers WHERE peer_id = ?')
    .get(peerId);

  if (existing) {
    if (existing.status === 'blocked') {
      res.end(JSON.stringify({ status: 'blocked' }));
      return;
    }
    if (existing.status === 'accepted') {
      res.end(JSON.stringify({ status: 'already_accepted' }));
      return;
    }
    db.prepare(
      'UPDATE p2p_peers SET status = ?, name = ? WHERE peer_id = ?',
    ).run('request_received', name, peerId);
  } else {
    db.prepare(
      'INSERT INTO p2p_peers (id, peer_id, name, status) VALUES (?, ?, ?, ?)',
    ).run(generateKSUID(), peerId, name, 'request_received');
  }

  notifyFriendRequest(name, peerId);
  notifyPeersChanged();
  res.end(JSON.stringify({ status: 'pending' }));
}

function handleFriendResponse(data, res) {
  const { peerId, name, accepted } = data;
  if (!peerId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing peerId' }));
    return;
  }

  const db = store.getDb();
  const existing = db
    .prepare('SELECT id, status FROM p2p_peers WHERE peer_id = ?')
    .get(peerId);

  if (!existing) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Unknown peer' }));
    return;
  }

  if (accepted) {
    db.prepare(
      'UPDATE p2p_peers SET status = ?, name = COALESCE(?, name) WHERE peer_id = ?',
    ).run('accepted', name, peerId);
  } else {
    db.prepare('UPDATE p2p_peers SET status = ? WHERE peer_id = ?').run(
      'rejected',
      peerId,
    );
  }

  notifyPeersChanged();
  res.end(JSON.stringify({ status: 'ok' }));
}

function handleGetRepos(remotePeerId, res) {
  if (!remotePeerId) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Missing X-Peer-Id header' }));
    return;
  }

  const db = store.getDb();
  const peer = db
    .prepare('SELECT status FROM p2p_peers WHERE peer_id = ?')
    .get(remotePeerId);

  if (!peer || peer.status !== 'accepted') {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'Not an accepted peer' }));
    return;
  }

  const repos = db
    .prepare(
      `SELECT r.name, r.path FROM git_repos r
       INNER JOIN p2p_shared_repos s ON s.repo_id = r.id`,
    )
    .all();

  // Include origin URL so cloners can set up the same upstream
  const repoData = repos.map((r) => {
    let originUrl = null;
    try {
      const out = require('child_process').execFileSync(
        'git', ['remote', 'get-url', 'origin'],
        { cwd: r.path, encoding: 'utf8', timeout: 5000 },
      ).trim();
      if (out) originUrl = out;
    } catch {}
    return {
      name: r.name,
      exportName: r.name.replace(/[^a-zA-Z0-9._-]/g, '_'),
      originUrl,
    };
  });

  res.end(JSON.stringify({ repos: repoData }));
}

// When a peer clones our repo, they notify us so we can add them as a remote.
function handleCloneNotify(data, res) {
  const { peerId, exportName } = data;
  if (!peerId || !exportName) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing peerId or exportName' }));
    return;
  }

  const db = store.getDb();
  const peer = db
    .prepare('SELECT * FROM p2p_peers WHERE peer_id = ?')
    .get(peerId);

  if (!peer || peer.status !== 'accepted') {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'Not an accepted peer' }));
    return;
  }

  // Find the local shared repo that was cloned
  const repoPath = resolveSharedRepo(exportName);
  if (!repoPath) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Repository not found' }));
    return;
  }

  const onlinePeers = state.getOnlinePeers();
  const info = onlinePeers.get(peerId);
  const host = info?.host || peer.host;
  const peerSshPort = info?.sshPort || peer.ssh_port;
  if (!host || !peerSshPort) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'Peer SSH not reachable' }));
    return;
  }

  // Add the cloner as a remote on our shared repo
  const myPeerId = getOrCreatePeerId();
  const remoteName = (peer.name || peerId).replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
  const sshUrl = `ssh://${myPeerId}@${host}:${peerSshPort}/${exportName}`;

  console.log(`[clone-notify] Adding remote "${remoteName}" -> ${sshUrl} on ${repoPath}`);

  // Add or update the remote
  try {
    require('child_process').execFileSync(
      'git', ['remote', 'add', remoteName, sshUrl],
      { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
    );
  } catch (addErr) {
    if (addErr.message && addErr.message.includes('already exists')) {
      try {
        require('child_process').execFileSync(
          'git', ['remote', 'set-url', remoteName, sshUrl],
          { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
        );
      } catch (setErr) {
        console.error('[clone-notify] Failed to set-url:', setErr.message);
      }
    } else {
      console.error('[clone-notify] Failed to add remote:', addErr.message);
    }
  }

  // Configure SSH only for this peer remote (not repo-wide)
  setRemoteSshCommand(repoPath, remoteName);
  unsetGlobalSshCommand(repoPath);

  // Also set receive.denyCurrentBranch so the peer can push to us
  try {
    require('child_process').execFileSync(
      'git', ['config', '--local', 'receive.denyCurrentBranch', 'updateInstead'],
      { cwd: repoPath, encoding: 'utf8', timeout: 5000 },
    );
  } catch {}

  // Link in p2p_peer_repos for dynamic URL updates
  const localRepo = db
    .prepare('SELECT id FROM git_repos WHERE path = ?')
    .get(repoPath);
  if (localRepo) {
    const existingLink = db
      .prepare(
        'SELECT id FROM p2p_peer_repos WHERE peer_id = ? AND remote_path = ?',
      )
      .get(peer.id, exportName);
    if (existingLink) {
      db.prepare(
        'UPDATE p2p_peer_repos SET local_repo_id = ?, remote_name = ? WHERE id = ?',
      ).run(localRepo.id, remoteName, existingLink.id);
    } else {
      db.prepare(
        'INSERT INTO p2p_peer_repos (id, peer_id, name, remote_path, local_repo_id, remote_name) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(generateKSUID(), peer.id, exportName, exportName, localRepo.id, remoteName);
    }
  } else {
    console.error(`[clone-notify] Repo not found in git_repos for path: ${repoPath}`);
  }

  console.log(`[clone-notify] Done. Remote "${remoteName}" added to ${repoPath}`);
  notifyPeersChanged();
  res.end(JSON.stringify({ status: 'ok' }));
}

function stopHttpServer() {
  const httpServer = state.getHttpServer();
  if (httpServer) {
    httpServer.close();
    state.setHttpServer(null);
  }
}

module.exports = {
  startHttpServer,
  stopHttpServer,
};
