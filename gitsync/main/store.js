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
  `);

  // Add identity_id column to git_repos if missing
  const cols = db.pragma('table_info(git_repos)').map(c => c.name);
  if (!cols.includes('identity_id')) {
    db.exec('ALTER TABLE git_repos ADD COLUMN identity_id TEXT DEFAULT NULL');
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initDb, closeDb };
