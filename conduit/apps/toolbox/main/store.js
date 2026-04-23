const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { applyPragmas } = require('@conduit/core');

let db;
let rfcDb;
const CONFIG_DIR = path.join(
  require('os').homedir(),
  '.config',
  'conduit-toolbox',
);
const DB_PATH = path.join(CONFIG_DIR, 'app.db');
const RFC_DB_PATH = path.join(CONFIG_DIR, 'rfc.db');
const LEGACY_MAIN_DB = path.join(
  require('os').homedir(),
  '.config',
  'api-client',
  'api-client.db',
);
const LEGACY_RFC_DB = path.join(
  require('os').homedir(),
  '.config',
  'api-client',
  'rfc.db',
);

function getDb() {
  return db;
}

function getRfcDb() {
  return rfcDb;
}

function initDb() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Migrate legacy rfc.db if present
  if (!fs.existsSync(RFC_DB_PATH) && fs.existsSync(LEGACY_RFC_DB)) {
    fs.copyFileSync(LEGACY_RFC_DB, RFC_DB_PATH);
  }

  db = new Database(DB_PATH);
  applyPragmas(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // One-time import of settings from legacy main db
  const migrated = db
    .prepare("SELECT value FROM settings WHERE key = 'legacy_settings_migrated'")
    .get();
  if (!migrated && fs.existsSync(LEGACY_MAIN_DB)) {
    try {
      const legacy = new Database(LEGACY_MAIN_DB, { readonly: true });
      const hasSettings = legacy
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
        )
        .get();
      if (hasSettings) {
        const rows = legacy.prepare('SELECT key, value FROM settings').all();
        const insert = db.prepare(
          'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
        );
        const tx = db.transaction(() => {
          for (const r of rows) insert.run(r.key, r.value);
        });
        tx();
      }
      legacy.close();
    } catch {}
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_settings_migrated', '1')",
    ).run();
  }

  rfcDb = new Database(RFC_DB_PATH);
  applyPragmas(rfcDb);

  rfcDb.exec(`
    CREATE TABLE IF NOT EXISTS rfcs (
      number INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      authors TEXT NOT NULL DEFAULT '',
      date_month TEXT NOT NULL DEFAULT '',
      date_year TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      keywords TEXT NOT NULL DEFAULT '',
      abstract TEXT NOT NULL DEFAULT '',
      is_also TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      obsoleted_by TEXT NOT NULL DEFAULT '',
      obsoletes TEXT NOT NULL DEFAULT '',
      updates TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS rfc_content (
      number INTEGER PRIMARY KEY,
      content TEXT NOT NULL,
      FOREIGN KEY (number) REFERENCES rfcs(number)
    );

    CREATE TABLE IF NOT EXISTS rfc_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate rfc.db that had old 'references' column
  const rfcCols = rfcDb
    .prepare('PRAGMA table_info(rfcs)')
    .all()
    .map((c) => c.name);
  if (rfcCols.includes('references')) {
    rfcDb.exec('DROP TABLE IF EXISTS rfc_content');
    rfcDb.exec('DROP TABLE IF EXISTS rfcs');
    rfcDb.exec(`
      CREATE TABLE rfcs (
        number INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        authors TEXT NOT NULL DEFAULT '',
        date_month TEXT NOT NULL DEFAULT '',
        date_year TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        keywords TEXT NOT NULL DEFAULT '',
        abstract TEXT NOT NULL DEFAULT '',
        is_also TEXT NOT NULL DEFAULT '',
        updated_by TEXT NOT NULL DEFAULT '',
        obsoleted_by TEXT NOT NULL DEFAULT '',
        obsoletes TEXT NOT NULL DEFAULT '',
        updates TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE rfc_content (
        number INTEGER PRIMARY KEY,
        content TEXT NOT NULL,
        FOREIGN KEY (number) REFERENCES rfcs(number)
      );
    `);
  }

  // Migrate RFC data that was left in the legacy main db
  if (fs.existsSync(LEGACY_MAIN_DB)) {
    try {
      const legacy = new Database(LEGACY_MAIN_DB, { readonly: true });
      const hasRfcs = legacy
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='rfcs'",
        )
        .get();
      if (hasRfcs) {
        const cols = legacy
          .prepare('PRAGMA table_info(rfcs)')
          .all()
          .map((c) => c.name);
        const hasIsAlso = cols.includes('is_also');
        const rfcCount = rfcDb
          .prepare('SELECT COUNT(*) as c FROM rfcs')
          .get().c;
        if (rfcCount === 0 && hasIsAlso) {
          const rows = legacy.prepare('SELECT * FROM rfcs').all();
          if (rows.length > 0) {
            const insert = rfcDb.prepare(`
              INSERT OR IGNORE INTO rfcs
                (number, title, authors, date_month, date_year, status, keywords,
                 abstract, is_also, updated_by, obsoleted_by, obsoletes, updates)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const tx = rfcDb.transaction(() => {
              for (const r of rows) {
                insert.run(
                  r.number, r.title, r.authors, r.date_month, r.date_year,
                  r.status, r.keywords, r.abstract, r.is_also,
                  r.updated_by, r.obsoleted_by, r.obsoletes, r.updates,
                );
              }
            });
            tx();
          }
          const hasContent = legacy
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='rfc_content'",
            )
            .get();
          if (hasContent) {
            const contentRows = legacy.prepare('SELECT * FROM rfc_content').all();
            if (contentRows.length > 0) {
              const insertContent = rfcDb.prepare(
                'INSERT OR IGNORE INTO rfc_content (number, content) VALUES (?, ?)',
              );
              const txContent = rfcDb.transaction(() => {
                for (const r of contentRows) {
                  insertContent.run(r.number, r.content);
                }
              });
              txContent();
            }
          }
          const syncSetting = legacy
            .prepare("SELECT value FROM settings WHERE key = 'rfc_last_sync'")
            .get();
          if (syncSetting) {
            rfcDb
              .prepare(
                "INSERT OR IGNORE INTO rfc_meta (key, value) VALUES ('last_sync', ?)",
              )
              .run(syncSetting.value);
          }
        }
      }
      legacy.close();
    } catch {}
  }
}

function closeDb() {
  if (rfcDb) {
    rfcDb.close();
    rfcDb = null;
  }
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, getRfcDb, initDb, closeDb };
