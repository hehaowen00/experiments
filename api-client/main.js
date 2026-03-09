const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function generateKSUID() {
  const ts = Math.floor(Date.now() / 1000);
  const bytes = Buffer.alloc(20);

  bytes[0] = (ts >> 24) & 0xff;
  bytes[1] = (ts >> 16) & 0xff;
  bytes[2] = (ts >> 8) & 0xff;
  bytes[3] = ts & 0xff;

  crypto.randomFillSync(bytes, 4);

  const digits = [];
  const num = Array.from(bytes);

  while (num.some((b) => b > 0)) {
    let rem = 0;

    for (let i = 0; i < num.length; i++) {
      const val = rem * 256 + num[i];
      num[i] = Math.floor(val / 62);
      rem = val % 62;
    }

    digits.push(BASE62[rem]);
  }

  while (digits.length < 27) {
    digits.push('0');
  }

  return digits.reverse().join('');
}

const Database = require('better-sqlite3');
const WebSocket = require('ws');
const { Client: PgClient } = require('pg');

let db;
const CONFIG_DIR = path.join(require('os').homedir(), '.config', 'api-client');
const DB_PATH = path.join(CONFIG_DIR, 'api-client.db');

function initDb() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Migrate from old location
  const oldDbPath = path.join(app.getPath('userData'), 'api-client.db');
  if (!fs.existsSync(DB_PATH) && fs.existsSync(oldDbPath)) {
    fs.copyFileSync(oldDbPath, DB_PATH);
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456'); // 256MB mmap
  db.pragma('page_size = 4096');
  db.pragma('wal_autocheckpoint = 1000');

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
  `);

  // Migrate: add last_used column
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

  // Migrate: add messages column to responses
  const resCols = db
    .prepare('PRAGMA table_info(responses)')
    .all()
    .map((c) => c.name);
  if (!resCols.includes('messages')) {
    db.exec("ALTER TABLE responses ADD COLUMN messages TEXT DEFAULT '[]'");
  }

  db.exec(`
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
  `);

  migrateJsonFiles();
}

function migrateJsonFiles() {
  const oldDir = path.join(app.getPath('userData'), 'collections');
  if (!fs.existsSync(oldDir)) return;
  const files = fs.readdirSync(oldDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO collections (id, name, items) VALUES (?, ?, ?)',
  );

  const tx = db.transaction(() => {
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(oldDir, f), 'utf-8'));
        insert.run(data.id, data.name, JSON.stringify(data.items || []));
      } catch {}
    }
  });

  tx();
  fs.renameSync(oldDir, oldDir + '.migrated');
}

// --- Collection CRUD ---

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

// --- Response CRUD ---

function saveResponse(data) {
  // Clear response data from previous entries to save space, keep only metadata for history
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
      'SELECT * FROM responses WHERE request_id = ? ORDER BY created_at DESC LIMIT 1',
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

// --- Window ---

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.maximize();
  mainWindow.loadFile('renderer/dist/index-solid.html');
}

app.whenReady().then(() => {
  initDb();
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('will-quit', () => {
  if (db) {
    db.close();
    db = null;
  }
});

// --- IPC: Collections ---

ipcMain.handle('collections:list', () => loadCollections());

ipcMain.handle('collections:create', (_, name) => {
  const collection = { id: generateKSUID(), name, items: [] };
  saveCollection(collection);
  return collection;
});

ipcMain.handle('collections:rename', (_, id, name) => {
  const c = loadCollection(id);
  if (!c) return null;
  c.name = name;
  saveCollection(c);
  return c;
});

ipcMain.handle('collections:delete', (_, id) => {
  deleteCollection(id);
  return true;
});

ipcMain.handle('collections:pin', (_, id, pinned) => {
  db.prepare('UPDATE collections SET pinned = ? WHERE id = ?').run(
    pinned ? 1 : 0,
    id,
  );
  return true;
});

ipcMain.handle('collections:setCategory', (_, id, categoryId) => {
  db.prepare('UPDATE collections SET category_id = ? WHERE id = ?').run(
    categoryId || null,
    id,
  );
  return true;
});

ipcMain.handle('categories:list', () => loadCategories());

ipcMain.handle('categories:create', (_, name) => {
  const id = generateKSUID();
  saveCategory({ id, name });
  return { id, name, sort_order: 0, collapsed: 0 };
});

ipcMain.handle('categories:rename', (_, id, name) => {
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
  return true;
});

ipcMain.handle('categories:delete', (_, id) => {
  deleteCategory(id);
  return true;
});

ipcMain.handle('categories:toggleCollapse', (_, id, collapsed) => {
  db.prepare('UPDATE categories SET collapsed = ? WHERE id = ?').run(
    collapsed ? 1 : 0,
    id,
  );
  return true;
});

ipcMain.handle('categories:reorder', (_, orderedIds) => {
  const stmt = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i, id));
  });
  tx();
  return true;
});

// --- IPC: Settings ---

ipcMain.handle('settings:get', (_, key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
});

ipcMain.handle('settings:getAll', () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
});

ipcMain.handle('settings:set', (_, key, value) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    key,
    value,
  );
  return true;
});

ipcMain.handle('collection:load', (_, id) => loadCollection(id));

ipcMain.handle('collection:save', (_, collection) => {
  saveCollection(collection);
  return true;
});

// --- IPC: Responses ---

ipcMain.handle('response:save', (_, data) => {
  return saveResponse(data);
});

ipcMain.handle('response:latest', (_, requestId) => {
  return getLatestResponse(requestId);
});

ipcMain.handle('response:history', (_, requestId) => {
  return getResponseHistory(requestId);
});

ipcMain.handle('response:load', (_, id) => {
  return loadResponse(id);
});

// --- IPC: File picker ---

ipcMain.handle('file:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const stats = fs.statSync(filePath);
  return { path: filePath, name: path.basename(filePath), size: stats.size };
});

ipcMain.handle('file:read', (_, filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath).toString('base64');
});

ipcMain.handle('import:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const imported = parseImportData(data);
    if (!imported) return { error: 'Unrecognized format' };
    // Create collections
    const created = [];
    for (const col of imported) {
      const id = generateKSUID();
      const collection = {
        id,
        name: col.name,
        items: col.items,
        variables: col.variables || [],
      };
      saveCollection(collection);
      created.push({ id, name: col.name, count: countRequests(col.items) });
    }
    return { collections: created };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('import:requests', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const data = JSON.parse(raw);
    const imported = parseImportData(data);
    if (!imported || imported.length === 0)
      return { error: 'Unrecognized format' };
    // Merge all collections' items into one flat list
    const items = imported.flatMap((c) => c.items);
    return { items };
  } catch (e) {
    return { error: e.message };
  }
});

function countRequests(items) {
  let n = 0;
  for (const item of items) {
    if (item.type === 'request') n++;
    else if (item.children) n += countRequests(item.children);
  }
  return n;
}

function parseImportData(data) {
  // Postman Collection v2.1
  if (
    data.info &&
    data.info.schema &&
    data.info.schema.includes('schema.getpostman.com')
  ) {
    return [parsePostmanCollection(data)];
  }
  // Postman array of collections
  if (Array.isArray(data) && data[0]?.info?.schema) {
    return data.map(parsePostmanCollection);
  }
  // Insomnia v4 export
  if (data._type === 'export' && data.resources) {
    return parseInsomniaExport(data);
  }
  return null;
}

function parsePostmanCollection(col) {
  const name = col.info?.name || 'Imported Collection';
  const variables = (col.variable || []).map((v) => ({
    key: v.key || '',
    value: v.value || '',
    enabled: !v.disabled,
  }));
  const items = (col.item || []).map(parsePostmanItem);
  return { name, items, variables };
}

function parsePostmanItem(item) {
  if (item.item) {
    // Folder
    return {
      id: generateKSUID(),
      type: 'folder',
      name: item.name || 'Folder',
      children: item.item.map(parsePostmanItem),
      collapsed: false,
    };
  }
  // Request
  const req = item.request || {};
  const method = (typeof req === 'string' ? 'GET' : req.method) || 'GET';
  let url = '';
  if (typeof req.url === 'string') url = req.url;
  else if (req.url?.raw) url = req.url.raw;

  const headers = (req.header || []).map((h) => ({
    key: h.key || '',
    value: h.value || '',
    enabled: !h.disabled,
  }));

  let body = '';
  let bodyType = 'text';
  let contentType = 'auto';
  if (req.body) {
    const b = req.body;
    if (b.mode === 'raw') {
      body = b.raw || '';
      const lang = b.options?.raw?.language;
      if (lang === 'json') contentType = 'json';
      else if (lang === 'xml') contentType = 'xml';
      else if (lang === 'html') contentType = 'html';
    } else if (b.mode === 'formdata') {
      bodyType = 'form';
      body = '';
    }
  }

  const params = [];
  if (req.url?.query) {
    for (const q of req.url.query) {
      params.push({
        key: q.key || '',
        value: q.value || '',
        enabled: !q.disabled,
      });
    }
  }

  return {
    id: generateKSUID(),
    type: 'request',
    name: item.name || 'Request',
    method: method.toUpperCase(),
    url,
    headers,
    body,
    bodyType,
    contentType,
    params,
  };
}

function parseInsomniaExport(data) {
  const resources = data.resources || [];
  const workspaces = resources.filter((r) => r._type === 'workspace');
  const folders = resources.filter((r) => r._type === 'request_group');
  const requests = resources.filter((r) => r._type === 'request');
  const envs = resources.filter((r) => r._type === 'environment');

  if (workspaces.length === 0) {
    workspaces.push({ _id: '__WORKSPACE__', name: 'Imported' });
  }

  return workspaces.map((ws) => {
    const variables = [];
    const wsEnv = envs.find((e) => e.parentId === ws._id);
    if (wsEnv?.data) {
      for (const [k, v] of Object.entries(wsEnv.data)) {
        variables.push({ key: k, value: String(v), enabled: true });
      }
    }
    const items = buildInsomniaTree(ws._id, folders, requests);
    return { name: ws.name || 'Imported', items, variables };
  });
}

function buildInsomniaTree(parentId, folders, requests) {
  const items = [];
  for (const f of folders.filter((f) => f.parentId === parentId)) {
    items.push({
      id: generateKSUID(),
      type: 'folder',
      name: f.name || 'Folder',
      children: buildInsomniaTree(f._id, folders, requests),
      collapsed: false,
    });
  }
  for (const r of requests.filter((r) => r.parentId === parentId)) {
    const method = (r.method || 'GET').toUpperCase();
    const headers = (r.headers || []).map((h) => ({
      key: h.name || '',
      value: h.value || '',
      enabled: !h.disabled,
    }));
    let body = '';
    let bodyType = 'text';
    if (r.body) {
      if (r.body.text) body = r.body.text;
      else if (r.body.mimeType === 'multipart/form-data') bodyType = 'form';
    }
    const params = (r.parameters || []).map((p) => ({
      key: p.name || '',
      value: p.value || '',
      enabled: !p.disabled,
    }));
    items.push({
      id: generateKSUID(),
      type: 'request',
      name: r.name || 'Request',
      method,
      url: r.url || '',
      headers,
      body,
      bodyType,
      params,
    });
  }
  return items;
}

// --- IPC: Send request ---

function buildMultipartBody(fields) {
  const boundary =
    '----FormBoundary' + generateKSUID().replace(/-/g, '').slice(0, 16);
  const parts = [];
  for (const f of fields) {
    if (f.type === 'file' && f.filePath) {
      if (!fs.existsSync(f.filePath)) continue;
      const fileData = fs.readFileSync(f.filePath);
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"; filename="${f.fileName}"\r\nContent-Type: ${f.fileMimeType || 'application/octet-stream'}\r\n\r\n`,
        ),
      );
      parts.push(fileData);
      parts.push(Buffer.from('\r\n'));
    } else {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value || ''}\r\n`,
        ),
      );
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

ipcMain.handle('request:send', async (_, opts) => {
  const http = require('http');
  const https = require('https');
  const zlib = require('zlib');
  const { URL } = require('url');

  const { method, url, headers, bodyType, body, filePath, formFields } = opts;
  const h = {};
  if (headers) {
    for (const { key, value, enabled } of headers) {
      if (enabled && key) h[key.toLowerCase()] = value;
    }
  }

  if (!h['accept-encoding']) {
    h['accept-encoding'] = 'gzip, deflate, br';
  }

  // Build request body
  let reqBody = null;
  if (method !== 'GET' && method !== 'HEAD') {
    if (bodyType === 'file' && filePath) {
      if (fs.existsSync(filePath)) {
        reqBody = fs.readFileSync(filePath);
        if (!h['content-type']) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeMap = {
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.html': 'text/html',
            '.txt': 'text/plain',
            '.csv': 'text/csv',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.pdf': 'application/pdf',
            '.zip': 'application/zip',
          };
          h['content-type'] = mimeMap[ext] || 'application/octet-stream';
        }
      }
    } else if (bodyType === 'form' && formFields && formFields.length) {
      const mp = buildMultipartBody(formFields);
      reqBody = mp.body;
      h['content-type'] = mp.contentType;
    } else if (body) {
      reqBody = Buffer.from(body);
    }
  }

  const timeline = [];
  const start = Date.now();
  const ts = () => Date.now() - start;
  const timing = { dns: null, connect: null, tls: null, ttfb: null };

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      resolve({
        error: e.message,
        time: 0,
        contentType: '',
        timeline: [{ t: 0, type: 'error', text: `Invalid URL: ${e.message}` }],
      });
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    timeline.push({
      t: ts(),
      type: 'info',
      text: `Preparing ${method} request to ${parsed.hostname}`,
    });
    timeline.push({
      t: ts(),
      type: 'req-header',
      text: `${method} ${parsed.pathname}${parsed.search} HTTP/1.1`,
    });
    timeline.push({
      t: ts(),
      type: 'req-header',
      text: `Host: ${parsed.host}`,
    });
    for (const [k, v] of Object.entries(h)) {
      timeline.push({ t: ts(), type: 'req-header', text: `${k}: ${v}` });
    }

    const reqOpts = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: h,
      rejectUnauthorized: true,
    };

    const req = lib.request(reqOpts, (res) => {
      const elapsed = ts();
      timing.ttfb = elapsed;
      timeline.push({ t: elapsed, type: 'info', text: `Received response` });
      timeline.push({
        t: elapsed,
        type: 'res-status',
        text: `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}`,
      });
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        timeline.push({
          t: elapsed,
          type: 'res-header',
          text: `${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`,
        });
      }

      const respHeaders = {};
      res.headers &&
        Object.entries(res.headers).forEach(([k, v]) => {
          respHeaders[k] = v;
        });
      const ct = res.headers['content-type'] || '';

      // Decompress response based on content-encoding
      const encoding = (res.headers['content-encoding'] || '')
        .trim()
        .toLowerCase();
      let stream = res;
      if (encoding === 'gzip' || encoding === 'x-gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress());
      }

      if (stream !== res) {
        timeline.push({
          t: ts(),
          type: 'info',
          text: `Decompressing response (${encoding})`,
        });
        stream.on('error', (err) => {
          const totalTime = ts();
          timeline.push({
            t: totalTime,
            type: 'error',
            text: `Decompression error: ${err.message}`,
          });
          resolve({
            error: `Decompression failed: ${err.message}`,
            time: totalTime,
            contentType: ct,
            timeline,
          });
        });
      }

      // SSE: stream events instead of buffering
      if (ct.includes('text/event-stream')) {
        const sseId = opts._requestId || Date.now().toString(36);
        activeSseConnections.set(sseId, req);
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: respHeaders,
          time: ts(),
          contentType: ct,
          timeline,
          sse: true,
          sseId,
        });

        mainWindow.webContents.send('sse:open', {
          id: sseId,
          status: res.statusCode,
          statusText: res.statusMessage,
        });

        let buffer = '';
        stream.on('data', (chunk) => {
          buffer += chunk.toString('utf-8');
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const raw of parts) {
            if (!raw.trim()) continue;
            const event = parseSseEvent(raw);
            mainWindow.webContents.send('sse:event', {
              id: sseId,
              event,
              raw: raw.trim(),
            });
          }
        });

        stream.on('end', () => {
          activeSseConnections.delete(sseId);
          mainWindow.webContents.send('sse:close', { id: sseId });
        });

        return;
      }

      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        const totalTime = ts();
        const buf = Buffer.concat(chunks);
        const isImage = ct.startsWith('image/');
        let responseBody;
        if (isImage) {
          responseBody = buf.toString('base64');
        } else {
          responseBody = buf.toString('utf-8');
          if (ct.includes('json')) {
            try {
              responseBody = JSON.stringify(JSON.parse(responseBody), null, 2);
            } catch {}
          }
        }
        timeline.push({
          t: totalTime,
          type: 'info',
          text: `Response body received (${buf.length} bytes)`,
        });
        timeline.push({
          t: totalTime,
          type: 'info',
          text: `Request completed in ${totalTime}ms`,
        });
        // Timing summary
        const transferTime = totalTime - (timing.ttfb || 0);
        const parts = [];
        if (timing.dns != null) parts.push(`DNS: ${timing.dns}ms`);
        if (timing.connect != null)
          parts.push(`TCP: ${timing.connect - (timing.dns || 0)}ms`);
        if (timing.tls != null)
          parts.push(`TLS: ${timing.tls - (timing.connect || 0)}ms`);
        if (timing.ttfb != null) parts.push(`TTFB: ${timing.ttfb}ms`);
        parts.push(`Transfer: ${transferTime}ms`);
        parts.push(`Total: ${totalTime}ms`);
        timeline.push({
          t: totalTime,
          type: 'timing',
          text: parts.join('  |  '),
        });
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: respHeaders,
          body: responseBody,
          time: totalTime,
          contentType: ct,
          timeline,
          timing,
          isImage,
        });
      });
    });

    req.on('socket', (socket) => {
      if (socket.connecting) {
        timeline.push({
          t: ts(),
          type: 'info',
          text: `Connecting to ${parsed.hostname}:${reqOpts.port}...`,
        });
        socket.on('lookup', (err, address, family) => {
          timing.dns = ts();
          if (err) {
            timeline.push({
              t: timing.dns,
              type: 'error',
              text: `DNS lookup failed: ${err.message}`,
            });
          } else {
            timeline.push({
              t: timing.dns,
              type: 'info',
              text: `DNS resolved: ${address} (IPv${family}) in ${timing.dns}ms`,
            });
          }
        });
        socket.on('connect', () => {
          timing.connect = ts();
          const connectDuration = timing.connect - (timing.dns || 0);
          timeline.push({
            t: timing.connect,
            type: 'info',
            text: `TCP connection established in ${connectDuration}ms`,
          });
        });
      }
      if (isHttps) {
        socket.on('secureConnect', () => {
          timing.tls = ts();
          const tlsDuration = timing.tls - (timing.connect || 0);
          const cert = socket.getPeerCertificate();
          const cipher = socket.getCipher();
          const proto = socket.getProtocol();
          timeline.push({
            t: timing.tls,
            type: 'tls',
            text: `TLS handshake complete in ${tlsDuration}ms`,
          });
          if (proto)
            timeline.push({ t: ts(), type: 'tls', text: `Protocol: ${proto}` });
          if (cipher)
            timeline.push({
              t: ts(),
              type: 'tls',
              text: `Cipher: ${cipher.name}`,
            });
          if (cert && cert.subject) {
            timeline.push({
              t: ts(),
              type: 'tls',
              text: `Subject: ${cert.subject.CN || JSON.stringify(cert.subject)}`,
            });
            if (cert.subjectaltname) {
              timeline.push({
                t: ts(),
                type: 'tls',
                text: `Alt Names: ${cert.subjectaltname}`,
              });
            }
            timeline.push({
              t: ts(),
              type: 'tls',
              text: `Issuer: ${cert.issuer?.CN || cert.issuer?.O || ''}`,
            });
            timeline.push({
              t: ts(),
              type: 'tls',
              text: `Valid: ${cert.valid_from} - ${cert.valid_to}`,
            });
            if (cert.serialNumber) {
              timeline.push({
                t: ts(),
                type: 'tls',
                text: `Serial: ${cert.serialNumber}`,
              });
            }
            if (cert.fingerprint256) {
              timeline.push({
                t: ts(),
                type: 'tls',
                text: `Fingerprint (SHA-256): ${cert.fingerprint256}`,
              });
            }
          }
        });
      }
    });

    req.on('error', (err) => {
      const totalTime = ts();
      timeline.push({
        t: totalTime,
        type: 'error',
        text: `${err.code || 'Error'}: ${err.message}`,
      });
      if (
        err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        err.code === 'CERT_HAS_EXPIRED' ||
        err.code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
        err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        err.code === 'SELF_SIGNED_CERT_IN_CHAIN'
      ) {
        timeline.push({
          t: totalTime,
          type: 'error',
          text: `SSL certificate verification failed`,
        });
      }
      if (err.code === 'ECONNREFUSED') {
        timeline.push({
          t: totalTime,
          type: 'error',
          text: `Connection refused by ${parsed.hostname}:${reqOpts.port}`,
        });
      }
      if (err.code === 'ENOTFOUND') {
        timeline.push({
          t: totalTime,
          type: 'error',
          text: `DNS lookup failed for ${parsed.hostname}`,
        });
      }
      resolve({
        error: err.message,
        time: totalTime,
        contentType: '',
        timeline,
      });
    });

    if (reqBody) {
      timeline.push({
        t: ts(),
        type: 'info',
        text: `Sending request body (${reqBody.length} bytes)`,
      });
      req.write(reqBody);
    }
    req.end();
  });
});

// --- IPC: SSE ---

const activeSseConnections = new Map();

ipcMain.handle('sse:disconnect', (_, id) => {
  const req = activeSseConnections.get(id);
  if (req) {
    req.destroy();
    activeSseConnections.delete(id);
  }
});

function parseSseEvent(raw) {
  const lines = raw.split('\n');
  const event = { type: 'message', data: '', id: '', retry: null };
  for (const line of lines) {
    if (line.startsWith('event:')) event.type = line.slice(6).trim();
    else if (line.startsWith('data:'))
      event.data += (event.data ? '\n' : '') + line.slice(5).trimStart();
    else if (line.startsWith('id:')) event.id = line.slice(3).trim();
    else if (line.startsWith('retry:'))
      event.retry = parseInt(line.slice(6).trim());
  }
  return event;
}

// --- IPC: WebSocket ---

const activeWsConnections = new Map();

ipcMain.handle('ws:connect', (_, opts) => {
  const { id, url, headers, protocols } = opts;
  const h = {};
  if (headers) {
    for (const { key, value, enabled } of headers) {
      if (enabled && key) h[key.toLowerCase()] = value;
    }
  }

  try {
    const ws = new WebSocket(url, protocols || [], {
      headers: h,
      rejectUnauthorized: true,
      perMessageDeflate: true,
    });

    ws.on('upgrade', (res) => {
      const headers = {};
      const raw = res.rawHeaders;
      for (let i = 0; i < raw.length; i += 2) {
        headers[raw[i].toLowerCase()] = raw[i + 1];
      }
      mainWindow.webContents.send('ws:open', { id, headers });
    });

    ws.on('message', (data, isBinary) => {
      const payload = isBinary
        ? `[Binary: ${data.length} bytes]`
        : data.toString('utf-8');
      mainWindow.webContents.send('ws:message', {
        id,
        data: payload,
        isBinary,
        time: Date.now(),
      });
    });

    ws.on('ping', (data) => {
      // ws library auto-replies with pong
      mainWindow.webContents.send('ws:ping', { id, data: data.toString() });
      mainWindow.webContents.send('ws:pong', {
        id,
        data: data.toString(),
        auto: true,
      });
    });

    ws.on('pong', (data) => {
      mainWindow.webContents.send('ws:pong', { id, data: data.toString() });
    });

    ws.on('close', (code, reason) => {
      activeWsConnections.delete(id);
      mainWindow.webContents.send('ws:close', {
        id,
        code,
        reason: reason.toString(),
      });
    });

    ws.on('error', (err) => {
      activeWsConnections.delete(id);
      mainWindow.webContents.send('ws:error', { id, error: err.message });
    });

    activeWsConnections.set(id, ws);
  } catch (e) {
    mainWindow.webContents.send('ws:error', { id, error: e.message });
  }
});

ipcMain.handle('ws:send', (_, opts) => {
  const { id, data, frameType } = opts;
  const ws = activeWsConnections.get(id);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  if (frameType === 'ping') {
    ws.ping(data || '');
  } else if (frameType === 'pong') {
    ws.pong(data || '');
  } else if (frameType === 'binary') {
    ws.send(Buffer.from(data, 'utf-8'));
  } else {
    ws.send(data);
  }
  return true;
});

ipcMain.handle('ws:disconnect', (_, id) => {
  const ws = activeWsConnections.get(id);
  if (ws) {
    ws.close();
    activeWsConnections.delete(id);
  }
});

// --- IPC: Database Client ---

// Saved connections CRUD
ipcMain.handle('dbConn:list', () => {
  return db
    .prepare('SELECT id, name, type, config, category_id, pinned, last_used FROM db_connections ORDER BY last_used DESC')
    .all()
    .map((r) => ({ ...r, config: JSON.parse(r.config) }));
});

ipcMain.handle('dbConn:create', (_, data) => {
  const id = generateKSUID();
  db.prepare(
    "INSERT INTO db_connections (id, name, type, config, category_id, last_used) VALUES (?, ?, ?, ?, ?, datetime('now'))",
  ).run(id, data.name, data.type, JSON.stringify(data.config), data.category_id || null);
  return { id, name: data.name, type: data.type, config: data.config, category_id: data.category_id || null, pinned: 0 };
});

ipcMain.handle('dbConn:update', (_, id, data) => {
  db.prepare(
    'UPDATE db_connections SET name = ?, type = ?, config = ?, category_id = ? WHERE id = ?',
  ).run(data.name, data.type, JSON.stringify(data.config), data.category_id || null, id);
  return true;
});

ipcMain.handle('dbConn:delete', (_, id) => {
  db.prepare('DELETE FROM db_connections WHERE id = ?').run(id);
  return true;
});

ipcMain.handle('dbConn:pin', (_, id, pinned) => {
  db.prepare('UPDATE db_connections SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  return true;
});

ipcMain.handle('dbConn:setCategory', (_, id, categoryId) => {
  db.prepare('UPDATE db_connections SET category_id = ? WHERE id = ?').run(categoryId || null, id);
  return true;
});

ipcMain.handle('dbConn:touchLastUsed', (_, id) => {
  db.prepare("UPDATE db_connections SET last_used = datetime('now') WHERE id = ?").run(id);
  return true;
});

// Database categories
ipcMain.handle('dbCat:list', () => {
  return db.prepare('SELECT * FROM db_categories ORDER BY sort_order ASC, rowid ASC').all();
});

ipcMain.handle('dbCat:create', (_, name) => {
  const id = generateKSUID();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM db_categories').get();
  db.prepare('INSERT INTO db_categories (id, name, sort_order, collapsed) VALUES (?, ?, ?, ?)').run(
    id, name, (maxOrder?.m || 0) + 1, 0,
  );
  return { id, name, sort_order: (maxOrder?.m || 0) + 1, collapsed: 0 };
});

ipcMain.handle('dbCat:rename', (_, id, name) => {
  db.prepare('UPDATE db_categories SET name = ? WHERE id = ?').run(name, id);
  return true;
});

ipcMain.handle('dbCat:delete', (_, id) => {
  db.prepare('UPDATE db_connections SET category_id = NULL WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM db_categories WHERE id = ?').run(id);
  return true;
});

ipcMain.handle('dbCat:toggleCollapse', (_, id, collapsed) => {
  db.prepare('UPDATE db_categories SET collapsed = ? WHERE id = ?').run(collapsed ? 1 : 0, id);
  return true;
});

ipcMain.handle('dbCat:reorder', (_, orderedIds) => {
  const stmt = db.prepare('UPDATE db_categories SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => { orderedIds.forEach((id, i) => stmt.run(i, id)); });
  tx();
  return true;
});

// Active connections
const activeDbConnections = new Map();
const LARGE_VALUE_THRESHOLD = 5120; // 5KB

ipcMain.handle('db:connect', async (_, opts) => {
  const { id, type, config } = opts;
  try {
    if (type === 'postgres') {
      const pgConfig = {
        host: config.host || 'localhost',
        port: parseInt(config.port) || 5432,
        user: config.user || undefined,
        password: config.password || undefined,
      };
      if (config.database) pgConfig.database = config.database;
      const client = new PgClient(pgConfig);
      await client.connect();
      activeDbConnections.set(id, { type: 'postgres', client, config: pgConfig });
      return { ok: true };
    } else if (type === 'sqlite') {
      const sqliteDb = new Database(config.path);
      sqliteDb.pragma('journal_mode = WAL');
      activeDbConnections.set(id, { type: 'sqlite', client: sqliteDb });
      return { ok: true };
    }
    return { error: 'Unknown database type' };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

ipcMain.handle('db:switchDatabase', async (_, id, database) => {
  const conn = activeDbConnections.get(id);
  if (!conn || conn.type !== 'postgres') return { error: 'Not a postgres connection' };
  try {
    await conn.client.end();
    const newConfig = { ...conn.config, database };
    const client = new PgClient(newConfig);
    await client.connect();
    activeDbConnections.set(id, { type: 'postgres', client, config: newConfig });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:disconnect', async (_, id) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return;
  try {
    if (conn.type === 'postgres') await conn.client.end();
    else if (conn.type === 'sqlite') conn.client.close();
  } catch {}
  activeDbConnections.delete(id);
});

ipcMain.handle('db:listDatabases', async (_, id) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const result = await conn.client.query(
        "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
      );
      return { databases: result.rows.map((r) => r.datname) };
    } else if (conn.type === 'sqlite') {
      return { databases: [path.basename(conn.client.name)] };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:listTables', async (_, id) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const result = await conn.client.query(
        `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name`,
      );
      return { tables: result.rows };
    } else if (conn.type === 'sqlite') {
      const rows = conn.client.prepare(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
      ).all();
      return { tables: rows.map((r) => ({ table_name: r.name, table_type: r.type === 'view' ? 'VIEW' : 'BASE TABLE', table_schema: 'main' })) };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:getColumns', async (_, id, schema, table) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const colResult = await conn.client.query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length,
                numeric_precision, ordinal_position
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table],
      );
      const pkResult = await conn.client.query(
        `SELECT a.attname AS column_name
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary`,
        [schema, table],
      );
      const pkSet = new Set(pkResult.rows.map((r) => r.column_name));
      return { columns: colResult.rows.map((r) => ({ ...r, pk: pkSet.has(r.column_name) })) };
    } else if (conn.type === 'sqlite') {
      const rows = conn.client.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all();
      return {
        columns: rows.map((r) => ({
          column_name: r.name,
          data_type: r.type || 'TEXT',
          is_nullable: r.notnull ? 'NO' : 'YES',
          column_default: r.dflt_value,
          ordinal_position: r.cid + 1,
          pk: r.pk,
        })),
      };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:getIndexes', async (_, id, schema, table) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const result = await conn.client.query(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = $1 AND tablename = $2
         ORDER BY indexname`,
        [schema, table],
      );
      return { indexes: result.rows };
    } else if (conn.type === 'sqlite') {
      const indexes = conn.client.prepare(`PRAGMA index_list("${table.replace(/"/g, '""')}")`).all();
      const result = indexes.map((idx) => {
        const cols = conn.client.prepare(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`).all();
        return {
          indexname: idx.name,
          indexdef: `${idx.unique ? 'UNIQUE ' : ''}INDEX ${idx.name} (${cols.map((c) => c.name).join(', ')})`,
        };
      });
      return { indexes: result };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:getTableData', async (_, id, schema, table, limit, offset) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    const safeLimit = Math.min(limit || 100, 1000);
    const safeOffset = offset || 0;
    if (conn.type === 'postgres') {
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      // Get columns first to check for large values
      const colResult = await conn.client.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table],
      );
      const selectCols = colResult.rows.map((c) => {
        const q = `"${c.column_name.replace(/"/g, '""')}"`;
        return `CASE WHEN octet_length(${q}::text) > ${LARGE_VALUE_THRESHOLD} THEN '[Large data: ' || octet_length(${q}::text) || ' bytes]' ELSE ${q}::text END AS ${q}`;
      });
      const countResult = await conn.client.query(`SELECT COUNT(*) as total FROM ${quotedTable}`);
      const total = parseInt(countResult.rows[0].total);
      const result = await conn.client.query(
        `SELECT ${selectCols.join(', ')} FROM ${quotedTable} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      );
      return { rows: result.rows, columns: result.fields.map((f) => f.name), total };
    } else if (conn.type === 'sqlite') {
      const quotedTable = `"${table.replace(/"/g, '""')}"`;
      const colInfo = conn.client.prepare(`PRAGMA table_info(${quotedTable})`).all();
      const selectCols = colInfo.map((c) => {
        const q = `"${c.name.replace(/"/g, '""')}"`;
        return `CASE WHEN length(CAST(${q} AS TEXT)) > ${LARGE_VALUE_THRESHOLD} THEN '[Large data: ' || length(CAST(${q} AS TEXT)) || ' bytes]' ELSE CAST(${q} AS TEXT) END AS ${q}`;
      });
      const countRow = conn.client.prepare(`SELECT COUNT(*) as total FROM ${quotedTable}`).get();
      const rows = conn.client.prepare(
        `SELECT ${selectCols.join(', ')} FROM ${quotedTable} LIMIT ? OFFSET ?`,
      ).all(safeLimit, safeOffset);
      return { rows, columns: colInfo.map((c) => c.name), total: countRow.total };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:getCellValue', async (_, id, schema, table, column, rowOffset) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      const quotedCol = `"${column.replace(/"/g, '""')}"`;
      const result = await conn.client.query(
        `SELECT ${quotedCol}::text AS val FROM ${quotedTable} LIMIT 1 OFFSET ${parseInt(rowOffset) || 0}`,
      );
      return { value: result.rows[0]?.val ?? null };
    } else if (conn.type === 'sqlite') {
      const quotedTable = `"${table.replace(/"/g, '""')}"`;
      const quotedCol = `"${column.replace(/"/g, '""')}"`;
      const row = conn.client.prepare(
        `SELECT CAST(${quotedCol} AS TEXT) AS val FROM ${quotedTable} LIMIT 1 OFFSET ?`,
      ).get(parseInt(rowOffset) || 0);
      return { value: row?.val ?? null };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:updateCell', async (_, id, schema, table, column, rowOffset, value) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      const quotedCol = `"${column.replace(/"/g, '""')}"`;
      // Use ctid to identify the exact row
      const ctidResult = await conn.client.query(
        `SELECT ctid FROM ${quotedTable} LIMIT 1 OFFSET ${parseInt(rowOffset) || 0}`,
      );
      if (!ctidResult.rows.length) return { error: 'Row not found' };
      const ctid = ctidResult.rows[0].ctid;
      await conn.client.query(
        `UPDATE ${quotedTable} SET ${quotedCol} = $1 WHERE ctid = $2`,
        [value, ctid],
      );
      return { ok: true };
    } else if (conn.type === 'sqlite') {
      const quotedTable = `"${table.replace(/"/g, '""')}"`;
      const quotedCol = `"${column.replace(/"/g, '""')}"`;
      // Use rowid to identify the exact row
      const row = conn.client.prepare(
        `SELECT rowid FROM ${quotedTable} LIMIT 1 OFFSET ?`,
      ).get(parseInt(rowOffset) || 0);
      if (!row) return { error: 'Row not found' };
      conn.client.prepare(
        `UPDATE ${quotedTable} SET ${quotedCol} = ? WHERE rowid = ?`,
      ).run(value, row.rowid);
      return { ok: true };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:query', async (_, id, sql) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  const start = Date.now();
  try {
    if (conn.type === 'postgres') {
      const result = await conn.client.query(sql);
      const elapsed = Date.now() - start;
      if (result.fields && result.fields.length > 0) {
        // Process large values
        const rows = result.rows.map((row) => {
          const processed = {};
          for (const key of Object.keys(row)) {
            const val = row[key];
            if (val !== null && typeof val === 'string' && Buffer.byteLength(val) > LARGE_VALUE_THRESHOLD) {
              processed[key] = `[Large data: ${Buffer.byteLength(val)} bytes]`;
            } else {
              processed[key] = val;
            }
          }
          return processed;
        });
        return {
          rows,
          columns: result.fields.map((f) => f.name),
          rowCount: result.rowCount,
          time: elapsed,
        };
      }
      return { rowCount: result.rowCount, time: elapsed, command: result.command };
    } else if (conn.type === 'sqlite') {
      const trimmed = sql.trim().toLowerCase();
      const isSelect = trimmed.startsWith('select') || trimmed.startsWith('pragma') || trimmed.startsWith('explain') || trimmed.startsWith('with');
      if (isSelect) {
        const rows = conn.client.prepare(sql).all();
        const elapsed = Date.now() - start;
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        // Process large values
        const processed = rows.map((row) => {
          const r = {};
          for (const key of columns) {
            const val = row[key];
            if (val !== null && typeof val === 'string' && Buffer.byteLength(val) > LARGE_VALUE_THRESHOLD) {
              r[key] = `[Large data: ${Buffer.byteLength(val)} bytes]`;
            } else {
              r[key] = val;
            }
          }
          return r;
        });
        return { rows: processed, columns, rowCount: rows.length, time: elapsed };
      } else {
        const result = conn.client.prepare(sql).run();
        const elapsed = Date.now() - start;
        return { rowCount: result.changes, time: elapsed, command: 'RUN' };
      }
    }
  } catch (e) {
    return { error: e.message, time: Date.now() - start };
  }
});

ipcMain.handle('db:createDatabase', async (_, id, name) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const quotedName = `"${name.replace(/"/g, '""')}"`;
      await conn.client.query(`CREATE DATABASE ${quotedName}`);
      return { ok: true };
    }
    return { error: 'Not supported for this database type' };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:dropDatabase', async (_, id, name) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const quotedName = `"${name.replace(/"/g, '""')}"`;
      await conn.client.query(`DROP DATABASE ${quotedName}`);
      return { ok: true };
    }
    return { error: 'Not supported for this database type' };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:dropTable', async (_, id, schema, tableName) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
      await conn.client.query(`DROP TABLE ${quotedTable}`);
      return { ok: true };
    } else if (conn.type === 'sqlite') {
      const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
      conn.client.prepare(`DROP TABLE ${quotedTable}`).run();
      return { ok: true };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:deleteRow', async (_, id, schema, tableName, rowOffset) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
      const ctidResult = await conn.client.query(
        `SELECT ctid FROM ${quotedTable} LIMIT 1 OFFSET ${parseInt(rowOffset) || 0}`,
      );
      if (!ctidResult.rows.length) return { error: 'Row not found' };
      await conn.client.query(
        `DELETE FROM ${quotedTable} WHERE ctid = $1`,
        [ctidResult.rows[0].ctid],
      );
      return { ok: true };
    } else if (conn.type === 'sqlite') {
      const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
      const row = conn.client.prepare(
        `SELECT rowid FROM ${quotedTable} LIMIT 1 OFFSET ?`,
      ).get(parseInt(rowOffset) || 0);
      if (!row) return { error: 'Row not found' };
      conn.client.prepare(`DELETE FROM ${quotedTable} WHERE rowid = ?`).run(row.rowid);
      return { ok: true };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:renameTable', async (_, id, schema, oldName, newName) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    if (conn.type === 'postgres') {
      const quotedOld = `"${schema.replace(/"/g, '""')}"."${oldName.replace(/"/g, '""')}"`;
      const quotedNew = `"${newName.replace(/"/g, '""')}"`;
      await conn.client.query(`ALTER TABLE ${quotedOld} RENAME TO ${quotedNew}`);
      return { ok: true };
    } else if (conn.type === 'sqlite') {
      const quotedOld = `"${oldName.replace(/"/g, '""')}"`;
      const quotedNew = `"${newName.replace(/"/g, '""')}"`;
      conn.client.prepare(`ALTER TABLE ${quotedOld} RENAME TO ${quotedNew}`).run();
      return { ok: true };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:addColumn', async (_, id, schema, tableName, column) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    const quotedCol = `"${column.name.replace(/"/g, '""')}"`;
    let colDef = `${quotedCol} ${column.type}`;
    if (!column.nullable) colDef += ' NOT NULL';
    if (column.defaultValue) colDef += ` DEFAULT ${column.defaultValue}`;
    if (conn.type === 'postgres') {
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
      await conn.client.query(`ALTER TABLE ${quotedTable} ADD COLUMN ${colDef}`);
      return { ok: true };
    } else if (conn.type === 'sqlite') {
      const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
      conn.client.prepare(`ALTER TABLE ${quotedTable} ADD COLUMN ${colDef}`).run();
      return { ok: true };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:dropColumn', async (_, id, schema, tableName, columnName) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    const quotedCol = `"${columnName.replace(/"/g, '""')}"`;
    if (conn.type === 'postgres') {
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
      await conn.client.query(`ALTER TABLE ${quotedTable} DROP COLUMN ${quotedCol}`);
      return { ok: true };
    } else if (conn.type === 'sqlite') {
      const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
      conn.client.prepare(`ALTER TABLE ${quotedTable} DROP COLUMN ${quotedCol}`).run();
      return { ok: true };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:createTable', async (_, id, schema, tableName, columns) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    const colDefs = columns.map((c) => {
      const q = `"${c.name.replace(/"/g, '""')}"`;
      let def = `${q} ${c.type}`;
      if (c.pk) def += ' PRIMARY KEY';
      if (!c.nullable && !c.pk) def += ' NOT NULL';
      if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
      return def;
    });
    if (conn.type === 'postgres') {
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
      await conn.client.query(`CREATE TABLE ${quotedTable} (${colDefs.join(', ')})`);
      return { ok: true };
    } else if (conn.type === 'sqlite') {
      const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
      conn.client.prepare(`CREATE TABLE ${quotedTable} (${colDefs.join(', ')})`).run();
      return { ok: true };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:insertRow', async (_, id, schema, tableName, values) => {
  const conn = activeDbConnections.get(id);
  if (!conn) return { error: 'Not connected' };
  try {
    const cols = Object.keys(values).filter((k) => values[k] !== undefined && values[k] !== '');
    if (cols.length === 0) return { error: 'No values provided' };
    const quotedCols = cols.map((c) => `"${c.replace(/"/g, '""')}"`);
    if (conn.type === 'postgres') {
      const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      await conn.client.query(
        `INSERT INTO ${quotedTable} (${quotedCols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        cols.map((c) => values[c]),
      );
      return { ok: true };
    } else if (conn.type === 'sqlite') {
      const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
      const placeholders = cols.map(() => '?');
      conn.client.prepare(
        `INSERT INTO ${quotedTable} (${quotedCols.join(', ')}) VALUES (${placeholders.join(', ')})`,
      ).run(...cols.map((c) => values[c]));
      return { ok: true };
    }
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db:pickSqliteFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('shell:openExternal', async (_, url) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    await shell.openExternal(url);
  }
});
