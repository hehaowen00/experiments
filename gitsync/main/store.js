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

    CREATE TABLE IF NOT EXISTS git_worktree_names (
      wt_path TEXT PRIMARY KEY,
      nickname TEXT NOT NULL
    );

  `);

  // Add identity_id column to git_repos if missing
  const cols = db.pragma('table_info(git_repos)').map(c => c.name);
  if (!cols.includes('identity_id')) {
    db.exec('ALTER TABLE git_repos ADD COLUMN identity_id TEXT DEFAULT NULL');
  }

  // Migrate git_worktree_names from (repo_id, wt_path) to (wt_path)
  const wtCols = db.pragma('table_info(git_worktree_names)').map(c => c.name);
  if (wtCols.includes('repo_id')) {
    db.exec(`
      CREATE TABLE git_worktree_names_new (
        wt_path TEXT PRIMARY KEY,
        nickname TEXT NOT NULL
      );
      INSERT OR IGNORE INTO git_worktree_names_new (wt_path, nickname)
        SELECT wt_path, nickname FROM git_worktree_names;
      DROP TABLE git_worktree_names;
      ALTER TABLE git_worktree_names_new RENAME TO git_worktree_names;
    `);
  }

}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initDb, closeDb };
