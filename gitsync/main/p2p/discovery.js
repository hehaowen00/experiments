const store = require('../store');
const { generateKSUID } = require('../ksuid');
const state = require('./state');
const {
  getOrCreatePeerId,
  getDisplayName,
  getHttpPort,
  notifyPeersChanged,
} = require('./settings');
const { updatePeerRemoteUrls } = require('./remote-utils');

// --- Discovery (UDP multicast) ---

function startBrowsing(myPeerId) {
  if (state.getMdnsBrowser()) return;

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

        const onlinePeers = state.getOnlinePeers();
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
      const httpServer = state.getHttpServer();
      const httpPort = httpServer ? httpServer.address().port : getHttpPort();
      const msg = JSON.stringify({
        type: 'gitsync',
        peerId: myPeerId,
        name: getDisplayName(),
        httpPort,
        sshPort: state.getSshPort(),
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
      const onlinePeers = state.getOnlinePeers();
      for (const [peerId, info] of onlinePeers) {
        if (now - new Date(info.lastSeen).getTime() > 30000) {
          onlinePeers.delete(peerId);
          notifyPeersChanged();
        }
      }
    }, 15000);

    state.setMdnsBrowser({ sock, interval, expireInterval });
  } catch (err) {
    console.error('Discovery error:', err);
  }
}

function stopBrowsing() {
  const mdnsBrowser = state.getMdnsBrowser();
  if (mdnsBrowser) {
    clearInterval(mdnsBrowser.interval);
    clearInterval(mdnsBrowser.expireInterval);
    try {
      mdnsBrowser.sock.close();
    } catch {}
    state.setMdnsBrowser(null);
  }
  state.getOnlinePeers().clear();
}

module.exports = {
  startBrowsing,
  stopBrowsing,
};
