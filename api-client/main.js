const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

let db;
const DB_PATH = path.join(app.getPath('userData'), 'api-client.db');

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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

  migrateJsonFiles();
}

function migrateJsonFiles() {
  const oldDir = path.join(app.getPath('userData'), 'collections');
  if (!fs.existsSync(oldDir)) return;
  const files = fs.readdirSync(oldDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return;

  const insert = db.prepare('INSERT OR IGNORE INTO collections (id, name, items) VALUES (?, ?, ?)');
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
  return db.prepare('SELECT id, name FROM collections ORDER BY name').all();
}

function loadCollection(id) {
  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, name: row.name, items: JSON.parse(row.items) };
}

function saveCollection(collection) {
  db.prepare('INSERT OR REPLACE INTO collections (id, name, items) VALUES (?, ?, ?)')
    .run(collection.id, collection.name, JSON.stringify(collection.items));
}

function deleteCollection(id) {
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
}

// --- Response CRUD ---

function saveResponse(data) {
  const result = db.prepare(`
    INSERT INTO responses (request_id, collection_id, status, status_text,
      response_headers, response_body, timeline, time_ms, request_method,
      request_url, request_headers, request_body, content_type, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.request_id, data.collection_id, data.status || null, data.status_text || null,
    JSON.stringify(data.response_headers || {}), data.response_body || null,
    JSON.stringify(data.timeline || []), data.time_ms, data.request_method,
    data.request_url, JSON.stringify(data.request_headers || []),
    data.request_body || '', data.content_type || '', data.error || null
  );
  return result.lastInsertRowid;
}

function getLatestResponse(requestId) {
  const row = db.prepare('SELECT * FROM responses WHERE request_id = ? ORDER BY created_at DESC LIMIT 1').get(requestId);
  if (!row) return null;
  return {
    id: row.id,
    request_id: row.request_id,
    status: row.status,
    statusText: row.status_text,
    headers: JSON.parse(row.response_headers || '{}'),
    body: row.response_body,
    timeline: JSON.parse(row.timeline || '[]'),
    time: row.time_ms,
    contentType: row.content_type || '',
    error: row.error,
    requestMethod: row.request_method,
    requestUrl: row.request_url,
    requestHeaders: JSON.parse(row.request_headers || '[]'),
    requestBody: row.request_body,
    createdAt: row.created_at,
  };
}

function getResponseHistory(requestId, limit = 50) {
  return db.prepare(`
    SELECT id, status, status_text, time_ms, request_method, request_url, error, created_at
    FROM responses WHERE request_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(requestId, limit);
}

function loadResponse(id) {
  const row = db.prepare('SELECT * FROM responses WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    request_id: row.request_id,
    status: row.status,
    statusText: row.status_text,
    headers: JSON.parse(row.response_headers || '{}'),
    body: row.response_body,
    timeline: JSON.parse(row.timeline || '[]'),
    time: row.time_ms,
    contentType: row.content_type || '',
    error: row.error,
    requestMethod: row.request_method,
    requestUrl: row.request_url,
    requestHeaders: JSON.parse(row.request_headers || '[]'),
    requestBody: row.request_body,
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
  mainWindow.loadFile('renderer/index.html');
}

app.whenReady().then(() => {
  initDb();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// --- IPC: Collections ---

ipcMain.handle('collections:list', () => loadCollections());

ipcMain.handle('collections:create', (_, name) => {
  const collection = { id: uuidv4(), name, items: [] };
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
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const stats = fs.statSync(filePath);
  return { path: filePath, name: path.basename(filePath), size: stats.size };
});

ipcMain.handle('file:read', (_, filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath).toString('base64');
});

// --- IPC: Send request ---

function buildMultipartBody(fields) {
  const boundary = '----FormBoundary' + uuidv4().replace(/-/g, '').slice(0, 16);
  const parts = [];
  for (const f of fields) {
    if (f.type === 'file' && f.filePath) {
      if (!fs.existsSync(f.filePath)) continue;
      const fileData = fs.readFileSync(f.filePath);
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"; filename="${f.fileName}"\r\nContent-Type: ${f.fileMimeType || 'application/octet-stream'}\r\n\r\n`
      ));
      parts.push(fileData);
      parts.push(Buffer.from('\r\n'));
    } else {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value || ''}\r\n`
      ));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

ipcMain.handle('request:send', async (_, opts) => {
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');

  const { method, url, headers, bodyType, body, filePath, formFields } = opts;
  const h = {};
  if (headers) {
    for (const { key, value, enabled } of headers) {
      if (enabled && key) h[key] = value;
    }
  }

  // Build request body
  let reqBody = null;
  if (method !== 'GET' && method !== 'HEAD') {
    if (bodyType === 'file' && filePath) {
      if (fs.existsSync(filePath)) {
        reqBody = fs.readFileSync(filePath);
        if (!h['Content-Type'] && !h['content-type']) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeMap = { '.json': 'application/json', '.xml': 'application/xml', '.html': 'text/html',
            '.txt': 'text/plain', '.csv': 'text/csv', '.png': 'image/png', '.jpg': 'image/jpeg',
            '.gif': 'image/gif', '.pdf': 'application/pdf', '.zip': 'application/zip' };
          h['Content-Type'] = mimeMap[ext] || 'application/octet-stream';
        }
      }
    } else if (bodyType === 'form' && formFields && formFields.length) {
      const mp = buildMultipartBody(formFields);
      reqBody = mp.body;
      h['Content-Type'] = mp.contentType;
    } else if (body) {
      reqBody = Buffer.from(body);
    }
  }

  const timeline = [];
  const start = Date.now();
  const ts = () => Date.now() - start;

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      resolve({ error: e.message, time: 0, contentType: '', timeline: [{ t: 0, type: 'error', text: `Invalid URL: ${e.message}` }] });
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    timeline.push({ t: ts(), type: 'info', text: `Preparing ${method} request to ${parsed.hostname}` });
    timeline.push({ t: ts(), type: 'req-header', text: `${method} ${parsed.pathname}${parsed.search} HTTP/1.1` });
    timeline.push({ t: ts(), type: 'req-header', text: `Host: ${parsed.host}` });
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
      timeline.push({ t: elapsed, type: 'info', text: `Received response` });
      timeline.push({ t: elapsed, type: 'res-status', text: `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}` });
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        timeline.push({ t: elapsed, type: 'res-header', text: `${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}` });
      }

      const respHeaders = {};
      res.headers && Object.entries(res.headers).forEach(([k, v]) => { respHeaders[k] = v; });

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const totalTime = ts();
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        const ct = res.headers['content-type'] || '';
        let responseBody = rawBody;
        if (ct.includes('json')) {
          try { responseBody = JSON.stringify(JSON.parse(rawBody), null, 2); } catch {}
        }
        timeline.push({ t: totalTime, type: 'info', text: `Response body received (${Buffer.concat(chunks).length} bytes)` });
        timeline.push({ t: totalTime, type: 'info', text: `Request completed in ${totalTime}ms` });
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: respHeaders,
          body: responseBody,
          time: totalTime,
          contentType: ct,
          timeline,
        });
      });
    });

    req.on('socket', (socket) => {
      if (socket.connecting) {
        timeline.push({ t: ts(), type: 'info', text: `Connecting to ${parsed.hostname}:${reqOpts.port}...` });
        socket.on('connect', () => {
          timeline.push({ t: ts(), type: 'info', text: `TCP connection established` });
        });
      }
      if (isHttps) {
        socket.on('secureConnect', () => {
          const cert = socket.getPeerCertificate();
          const cipher = socket.getCipher();
          const proto = socket.getProtocol();
          timeline.push({ t: ts(), type: 'tls', text: `TLS handshake complete` });
          if (proto) timeline.push({ t: ts(), type: 'tls', text: `Protocol: ${proto}` });
          if (cipher) timeline.push({ t: ts(), type: 'tls', text: `Cipher: ${cipher.name}` });
          if (cert && cert.subject) {
            timeline.push({ t: ts(), type: 'tls', text: `Subject: ${cert.subject.CN || JSON.stringify(cert.subject)}` });
            timeline.push({ t: ts(), type: 'tls', text: `Issuer: ${cert.issuer?.CN || cert.issuer?.O || ''}` });
            timeline.push({ t: ts(), type: 'tls', text: `Valid: ${cert.valid_from} - ${cert.valid_to}` });
          }
        });
      }
    });

    req.on('error', (err) => {
      const totalTime = ts();
      timeline.push({ t: totalTime, type: 'error', text: `${err.code || 'Error'}: ${err.message}` });
      if (err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || err.code === 'CERT_HAS_EXPIRED' ||
          err.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
          err.code === 'SELF_SIGNED_CERT_IN_CHAIN') {
        timeline.push({ t: totalTime, type: 'error', text: `SSL certificate verification failed` });
      }
      if (err.code === 'ECONNREFUSED') {
        timeline.push({ t: totalTime, type: 'error', text: `Connection refused by ${parsed.hostname}:${reqOpts.port}` });
      }
      if (err.code === 'ENOTFOUND') {
        timeline.push({ t: totalTime, type: 'error', text: `DNS lookup failed for ${parsed.hostname}` });
      }
      resolve({ error: err.message, time: totalTime, contentType: '', timeline });
    });

    if (reqBody) {
      timeline.push({ t: ts(), type: 'info', text: `Sending request body (${reqBody.length} bytes)` });
      req.write(reqBody);
    }
    req.end();
  });
});
