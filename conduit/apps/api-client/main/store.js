const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { applyPragmas } = require('@conduit/core');

let db;
const CONFIG_DIR = path.join(require('os').homedir(), '.config', 'conduit-api');
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

  // One-time migration from legacy single-app DB
  if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  }

  db = new Database(DB_PATH);
  applyPragmas(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      status INTEGER,
      status_text TEXT,
      response_headers TEXT,
      response_body TEXT,
      timeline TEXT,
      time_ms INTEGER,
      request_method TEXT,
      request_url TEXT,
      request_headers TEXT,
      request_body TEXT,
      content_type TEXT DEFAULT '',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_responses_request ON responses(request_id);
    CREATE INDEX IF NOT EXISTS idx_responses_collection ON responses(collection_id);

    CREATE TABLE IF NOT EXISTS categories (
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

  const cols = db
    .prepare('PRAGMA table_info(collections)')
    .all()
    .map((c) => c.name);
  if (!cols.includes('last_used')) {
    db.exec("ALTER TABLE collections ADD COLUMN last_used TEXT DEFAULT ''");
    db.exec(
      "UPDATE collections SET last_used = created_at WHERE last_used = ''",
    );
  }
  if (!cols.includes('pinned')) {
    db.exec(
      'ALTER TABLE collections ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
    );
  }
  if (!cols.includes('category_id')) {
    db.exec('ALTER TABLE collections ADD COLUMN category_id TEXT DEFAULT NULL');
  }
  if (!cols.includes('variables')) {
    db.exec(
      "ALTER TABLE collections ADD COLUMN variables TEXT NOT NULL DEFAULT '[]'",
    );
  }

  const resCols = db
    .prepare('PRAGMA table_info(responses)')
    .all()
    .map((c) => c.name);
  if (!resCols.includes('messages')) {
    db.exec("ALTER TABLE responses ADD COLUMN messages TEXT DEFAULT '[]'");
  }

  // Drop RFC tables if inherited from legacy DB — they belong to toolbox now.
  db.exec('DROP TABLE IF EXISTS rfc_content');
  db.exec('DROP TABLE IF EXISTS rfcs');
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function loadCollections() {
  return db
    .prepare(
      'SELECT id, name, last_used, pinned, category_id FROM collections ORDER BY last_used DESC',
    )
    .all();
}

function loadCategories() {
  return db
    .prepare('SELECT * FROM categories ORDER BY sort_order ASC, rowid ASC')
    .all();
}

function saveCategory(cat) {
  const existing = db
    .prepare('SELECT id FROM categories WHERE id = ?')
    .get(cat.id);
  if (existing) {
    db.prepare(
      'UPDATE categories SET name = ?, sort_order = ?, collapsed = ? WHERE id = ?',
    ).run(cat.name, cat.sort_order || 0, cat.collapsed ? 1 : 0, cat.id);
  } else {
    const maxOrder = db
      .prepare('SELECT MAX(sort_order) as m FROM categories')
      .get();
    db.prepare(
      'INSERT INTO categories (id, name, sort_order, collapsed) VALUES (?, ?, ?, ?)',
    ).run(cat.id, cat.name, (maxOrder?.m || 0) + 1, 0);
  }
}

function deleteCategory(id) {
  db.prepare(
    'UPDATE collections SET category_id = NULL WHERE category_id = ?',
  ).run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

function loadCollection(id) {
  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare(
    "UPDATE collections SET last_used = datetime('now') WHERE id = ?",
  ).run(id);
  return {
    id: row.id,
    name: row.name,
    items: JSON.parse(row.items),
    variables: JSON.parse(row.variables || '[]'),
  };
}

function saveCollection(collection) {
  const vars = JSON.stringify(collection.variables || []);
  const existing = db
    .prepare('SELECT id FROM collections WHERE id = ?')
    .get(collection.id);
  if (existing) {
    db.prepare(
      'UPDATE collections SET name = ?, items = ?, variables = ? WHERE id = ?',
    ).run(
      collection.name,
      JSON.stringify(collection.items),
      vars,
      collection.id,
    );
  } else {
    db.prepare(
      "INSERT INTO collections (id, name, items, variables, last_used) VALUES (?, ?, ?, ?, datetime('now'))",
    ).run(
      collection.id,
      collection.name,
      JSON.stringify(collection.items),
      vars,
    );
  }
}

function deleteCollection(id) {
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
}

function saveResponse(data) {
  db.prepare(
    `UPDATE responses SET response_headers = '{}', response_body = NULL, timeline = '[]', messages = '[]'
    WHERE request_id = ?`,
  ).run(data.request_id);
  const result = db
    .prepare(
      `
    INSERT INTO responses (request_id, collection_id, status, status_text,
      response_headers, response_body, timeline, time_ms, request_method,
      request_url, request_headers, request_body, content_type, error, messages)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      data.request_id,
      data.collection_id,
      data.status || null,
      data.status_text || null,
      JSON.stringify(data.response_headers || {}),
      data.response_body || null,
      JSON.stringify(data.timeline || []),
      data.time_ms,
      data.request_method,
      data.request_url,
      JSON.stringify(data.request_headers || []),
      data.request_body || '',
      data.content_type || '',
      data.error || null,
      JSON.stringify(data.messages || []),
    );
  return Number(result.lastInsertRowid);
}

function getLatestResponse(requestId) {
  const row = db
    .prepare(
      'SELECT * FROM responses WHERE request_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(requestId);
  if (!row) return null;
  return formatResponseRow(row);
}

function getResponseHistory(requestId, limit = 50) {
  return db
    .prepare(
      `
    SELECT id, status, status_text, time_ms, request_method, request_url, error, created_at
    FROM responses WHERE request_id = ? ORDER BY created_at DESC LIMIT ?
  `,
    )
    .all(requestId, limit)
    .map((row) => ({
      id: Number(row.id),
      status: Number(row.status),
      status_text: row.status_text,
      time_ms: Number(row.time_ms),
      request_method: row.request_method,
      request_url: row.request_url,
      error: row.error,
      created_at: row.created_at,
    }));
}

function loadResponse(id) {
  const row = db.prepare('SELECT * FROM responses WHERE id = ?').get(id);
  if (!row) return null;
  return formatResponseRow(row);
}

function formatResponseRow(row) {
  return {
    id: Number(row.id),
    request_id: row.request_id,
    status: Number(row.status),
    statusText: row.status_text,
    headers: JSON.parse(row.response_headers || '{}'),
    body: row.response_body,
    timeline: JSON.parse(row.timeline || '[]'),
    time: Number(row.time_ms),
    contentType: row.content_type || '',
    error: row.error,
    requestMethod: row.request_method,
    requestUrl: row.request_url,
    requestHeaders: JSON.parse(row.request_headers || '[]'),
    requestBody: row.request_body,
    messages: JSON.parse(row.messages || '[]'),
    createdAt: row.created_at,
  };
}

module.exports = {
  getDb,
  initDb,
  closeDb,
  loadCollections,
  loadCategories,
  saveCategory,
  deleteCategory,
  loadCollection,
  saveCollection,
  deleteCollection,
  saveResponse,
  getLatestResponse,
  getResponseHistory,
  loadResponse,
};
