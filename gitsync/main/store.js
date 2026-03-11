const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let db;
const CONFIG_DIR = path.join(require('os').homedir(), '.config', 'gitsync');
const DB_PATH = path.join(CONFIG_DIR, 'gitsync.db');

function getDb() {
  return db;
}

function initDb() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS git_repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      category_id TEXT DEFAULT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS git_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      collapsed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS git_identities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS git_actions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      script TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS p2p_peers (
      id TEXT PRIMARY KEY,
      peer_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      host TEXT DEFAULT NULL,
      http_port INTEGER DEFAULT NULL,
      ssh_port INTEGER DEFAULT 22,
      status TEXT NOT NULL DEFAULT 'discovered',
      last_seen TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS p2p_shared_repos (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES git_repos(id) ON DELETE CASCADE,
      UNIQUE(repo_id)
    );

    CREATE TABLE IF NOT EXISTS p2p_peer_repos (
      id TEXT PRIMARY KEY,
      peer_id TEXT NOT NULL REFERENCES p2p_peers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      remote_path TEXT NOT NULL,
      local_repo_id TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS p2p_pull_requests (
      id TEXT PRIMARY KEY,
      from_peer_id TEXT NOT NULL,
      from_peer_name TEXT NOT NULL,
      repo_export_name TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      target_branch TEXT NOT NULL DEFAULT 'main',
      title TEXT NOT NULL,
      message TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add identity_id column to git_repos if missing
  const cols = db.pragma('table_info(git_repos)').map(c => c.name);
  if (!cols.includes('identity_id')) {
    db.exec('ALTER TABLE git_repos ADD COLUMN identity_id TEXT DEFAULT NULL');
  }

  // Add ssh_user column to p2p_peers if missing
  const peerCols = db.pragma('table_info(p2p_peers)').map(c => c.name);
  if (!peerCols.includes('ssh_user')) {
    db.exec('ALTER TABLE p2p_peers ADD COLUMN ssh_user TEXT DEFAULT NULL');
  }

  // Add remote_name column to p2p_peer_repos if missing
  const peerRepoCols = db.pragma('table_info(p2p_peer_repos)').map(c => c.name);
  if (!peerRepoCols.includes('remote_name')) {
    db.exec("ALTER TABLE p2p_peer_repos ADD COLUMN remote_name TEXT DEFAULT 'origin'");
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initDb, closeDb };
