const os = require('os');
const store = require('../store');
const { generateKSUID } = require('../ksuid');
const state = require('./state');

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
  const mainWindow = state.getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('p2p:peers-changed');
  }
}

function notifyFriendRequest(peerName, peerId) {
  const mainWindow = state.getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('p2p:friend-request', {
      name: peerName,
      peerId,
    });
  }
}

module.exports = {
  getOrCreatePeerId,
  getDisplayName,
  getHttpPort,
  isEnabled,
  setSetting,
  notifyPeersChanged,
  notifyFriendRequest,
};
