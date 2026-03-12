const { ipcMain, dialog, app } = require('electron');
const { execFile, execFileSync, spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const net = require('net');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const { generateKSUID } = require('./ksuid');

let mainWindow = null;
let mdnsBrowser = null;
let httpServer = null;
let gitSshProcess = null;
let sshPort = 0;

// Path to the Go SSH binary.
// In dev: built locally at main/git-server/gitsync-ssh
// In production: packaged as extraResources outside the asar
const gitSshBin = app.isPackaged
  ? path.join(process.resourcesPath, 'gitsync-ssh')
  : path.join(__dirname, 'git-server', 'gitsync-ssh');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'gitsync');
const HOST_KEY_PATH = path.join(CONFIG_DIR, 'ssh_host_key');

// Track online peers (peerId -> { host, httpPort, sshPort, lastSeen })
const onlinePeers = new Map();

// --- Settings helpers ---

function getOrCreatePeerId() {
  const db = store.getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('p2p:peerId');
  if (row) return row.value;
  const id = generateKSUID();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'p2p:peerId',
    id,
  );
  return id;
}

function getDisplayName() {
  const db = store.getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('p2p:displayName');
  return row ? row.value : os.hostname();
}

function getHttpPort() {
  const db = store.getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('p2p:httpPort');
  return row ? parseInt(row.value) : 0;
}

function isEnabled() {
  const db = store.getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('p2p:enabled');
  return row ? row.value === 'true' : false;
}

function setSetting(key, value) {
  store
    .getDb()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, String(value));
}

function notifyPeersChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('p2p:peers-changed');
  }
}

function notifyFriendRequest(peerName, peerId) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('p2p:friend-request', {
      name: peerName,
      peerId,
    });
  }
}

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
    gitSshProcess = proc;

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
          sshPort = parseInt(match[1]);
          resolve(sshPort);
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
      gitSshProcess = null;
      console.error('gitsync-ssh failed to start:', err.message);
      resolve(0);
    });
    proc.on('exit', (code) => {
      gitSshProcess = null;
      if (code) console.error('gitsync-ssh exited with code', code);
    });
  });
}

function stopGitSshServer() {
  if (gitSshProcess) {
    gitSshProcess.kill();
    gitSshProcess = null;
    sshPort = 0;
  }
}

// --- Discovery (UDP multicast) ---

function startBrowsing(myPeerId) {
  if (mdnsBrowser) return;

  try {
    const dgram = require('dgram');

    const MULTICAST_ADDR = '224.0.0.251';
    const DISCOVERY_PORT = 5354;

    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    sock.on('error', (err) => {
      console.error('Discovery socket error:', err);
    });

    sock.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type !== 'gitsync' || data.peerId === myPeerId) return;

        const prev = onlinePeers.get(data.peerId);
        const newHost = rinfo.address;
        const newSshPort = data.sshPort || 0;

        onlinePeers.set(data.peerId, {
          host: newHost,
          httpPort: data.httpPort,
          sshPort: newSshPort,
          name: data.name,
          lastSeen: new Date().toISOString(),
        });

        // Update git remote URLs if host or SSH port changed
        if (
          prev &&
          (prev.host !== newHost || prev.sshPort !== newSshPort) &&
          newSshPort
        ) {
          updatePeerRemoteUrls(data.peerId, newHost, newSshPort);
        }

        const db = store.getDb();
        const existing = db
          .prepare('SELECT id, status FROM p2p_peers WHERE peer_id = ?')
          .get(data.peerId);
        if (existing) {
          // Also update remotes on first discovery (prev was undefined)
          if (!prev && newSshPort) {
            updatePeerRemoteUrls(data.peerId, newHost, newSshPort);
          }
          db.prepare(
            "UPDATE p2p_peers SET name = ?, host = ?, http_port = ?, ssh_port = ?, last_seen = datetime('now') WHERE peer_id = ?",
          ).run(
            data.name,
            newHost,
            data.httpPort,
            newSshPort,
            data.peerId,
          );
        } else {
          db.prepare(
            "INSERT INTO p2p_peers (id, peer_id, name, host, http_port, ssh_port, status, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
          ).run(
            generateKSUID(),
            data.peerId,
            data.name,
            rinfo.address,
            data.httpPort,
            data.sshPort || 0,
            'discovered',
          );
        }

        notifyPeersChanged();
      } catch {
        // ignore malformed
      }
    });

    sock.bind(DISCOVERY_PORT, () => {
      try {
        sock.addMembership(MULTICAST_ADDR);
        sock.setMulticastTTL(255);
      } catch (err) {
        console.error('Multicast membership error:', err);
      }
    });

    const announce = () => {
      const httpPort = httpServer ? httpServer.address().port : getHttpPort();
      const msg = JSON.stringify({
        type: 'gitsync',
        peerId: myPeerId,
        name: getDisplayName(),
        httpPort,
        sshPort,
        platform: 'desktop',
        version: 1,
      });
      try {
        sock.send(msg, DISCOVERY_PORT, MULTICAST_ADDR);
      } catch {}
    };

    announce();
    const interval = setInterval(announce, 10000);

    const expireInterval = setInterval(() => {
      const now = Date.now();
      for (const [peerId, info] of onlinePeers) {
        if (now - new Date(info.lastSeen).getTime() > 30000) {
          onlinePeers.delete(peerId);
          notifyPeersChanged();
        }
      }
    }, 15000);

    mdnsBrowser = { sock, interval, expireInterval };
  } catch (err) {
    console.error('Discovery error:', err);
  }
}

function stopBrowsing() {
  if (mdnsBrowser) {
    clearInterval(mdnsBrowser.interval);
    clearInterval(mdnsBrowser.expireInterval);
    try {
      mdnsBrowser.sock.close();
    } catch {}
    mdnsBrowser = null;
  }
  onlinePeers.clear();
}

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
      httpServer = server;
      resolve(port);
    });

    server.on('error', () => {
      server.listen(0, () => {
        const port = server.address().port;
        setSetting('p2p:httpPort', port);
        httpServer = server;
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
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

// --- HTTP client helpers ---

function httpPost(host, port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: host,
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ raw: body });
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end(data);
  });
}

function httpGet(host, port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: urlPath,
        method: 'GET',
        headers,
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ raw: body });
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
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

// --- Start / Stop ---

async function startP2p() {
  if (httpServer) return;
  getOrCreatePeerId();
  migrateSshCommand();
  await startHttpServer();
  await startGitSshServer();
  startBrowsing(getOrCreatePeerId());
}

async function stopP2p() {
  stopBrowsing();
  stopGitSshServer();
  stopHttpServer();
}

// --- IPC Registration ---

function register(win) {
  mainWindow = win;

  ipcMain.handle('p2p:getIdentity', () => ({
    peerId: getOrCreatePeerId(),
    displayName: getDisplayName(),
    httpPort: getHttpPort(),
    enabled: isEnabled(),
  }));

  ipcMain.handle('p2p:setDisplayName', (_, name) => {
    setSetting('p2p:displayName', name);
    return true;
  });

  ipcMain.handle('p2p:setEnabled', async (_, enabled) => {
    setSetting('p2p:enabled', enabled ? 'true' : 'false');
    if (enabled) {
      await startP2p();
    } else {
      await stopP2p();
    }
    return true;
  });

  ipcMain.handle('p2p:peerList', () => {
    const db = store.getDb();
    return db
      .prepare('SELECT * FROM p2p_peers ORDER BY created_at DESC')
      .all()
      .map((p) => ({ ...p, online: onlinePeers.has(p.peer_id) }));
  });

  ipcMain.handle('p2p:sendFriendRequest', async (_, peerId) => {
    const db = store.getDb();
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
        peerId: getOrCreatePeerId(),
        name: getDisplayName(),
      });

      const newStatus =
        result.status === 'already_accepted' ? 'accepted' : 'request_sent';
      db.prepare(
        'UPDATE p2p_peers SET status = ? WHERE peer_id = ?',
      ).run(newStatus, peerId);
      notifyPeersChanged();
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('p2p:respondFriendRequest', async (_, peerId, accepted) => {
    const db = store.getDb();
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
          peerId: getOrCreatePeerId(),
          name: getDisplayName(),
          accepted,
        });
      } catch {
        // peer may be offline
      }
    }

    notifyPeersChanged();
    return { status: accepted ? 'accepted' : 'rejected' };
  });

  ipcMain.handle('p2p:blockPeer', (_, peerId) => {
    store
      .getDb()
      .prepare('UPDATE p2p_peers SET status = ? WHERE peer_id = ?')
      .run('blocked', peerId);
    notifyPeersChanged();
    return true;
  });

  ipcMain.handle('p2p:unblockPeer', (_, peerId) => {
    store
      .getDb()
      .prepare('UPDATE p2p_peers SET status = ? WHERE peer_id = ?')
      .run('discovered', peerId);
    notifyPeersChanged();
    return true;
  });

  ipcMain.handle('p2p:removePeer', (_, peerId) => {
    store
      .getDb()
      .prepare('DELETE FROM p2p_peers WHERE peer_id = ?')
      .run(peerId);
    notifyPeersChanged();
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
          if (!hasPeerSshRemote(row.local_path, row.remote_name)) return false;
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
        'X-Peer-Id': getOrCreatePeerId(),
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
          if (!hasPeerSshRemote(row.local_path, row.remote_name)) return false;
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
      GIT_SSH_COMMAND: `"${gitSshBin}" connect`,
      GIT_SSH_VARIANT: 'ssh',
    };
  }

  // Clone from peer over the embedded SSH server.
  ipcMain.handle(
    'p2p:cloneFromPeer',
    async (_, peerId, exportName, repoName, originUrl) => {
      const db = store.getDb();
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
      const myPeerId = getOrCreatePeerId();
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
        setRemoteSshCommand(destDir, peerRemoteName);

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

      const myPeerId = getOrCreatePeerId();
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
        setRemoteSshCommand(repoPath, remoteName || 'peer');

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

  // Auto-start if enabled
  if (isEnabled()) {
    startP2p().catch((err) => console.error('P2P auto-start failed:', err));
  }
}

function shutdown() {
  stopP2p();
}

module.exports = { register, shutdown };
