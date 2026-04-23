const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { applyPragmas } = require('@conduit/core');

let db;
const CONFIG_DIR = path.join(require('os').homedir(), '.config', 'conduit-db');
const DB_PATH = path.join(CONFIG_DIR, 'app.db');
const LEGACY_DB_PATH = path.join(
  require('os').homedir(),
  '.config',
  'api-client',
  'api-client.db',
);

function getDb() {
  return db;
}

function initDb() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // One-time migration: copy legacy DB so db_connections / db_categories are preserved.
  if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  }

  db = new Database(DB_PATH);
  applyPragmas(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS db_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      category_id TEXT DEFAULT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS db_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      collapsed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const connCols = db
    .prepare('PRAGMA table_info(db_connections)')
    .all()
    .map((c) => c.name);
  if (!connCols.includes('queries')) {
    db.exec(
      "ALTER TABLE db_connections ADD COLUMN queries TEXT NOT NULL DEFAULT '[]'",
    );
  }

  // Drop tables not owned by this app (inherited from legacy copy).
  db.exec('DROP TABLE IF EXISTS collections');
  db.exec('DROP TABLE IF EXISTS categories');
  db.exec('DROP TABLE IF EXISTS responses');
  db.exec('DROP TABLE IF EXISTS rfcs');
  db.exec('DROP TABLE IF EXISTS rfc_content');
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initDb, closeDb };
