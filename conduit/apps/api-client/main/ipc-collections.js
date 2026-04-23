const fs = require('fs');
const { ipcMain, dialog } = require('electron');
const { generateKSUID } = require('@conduit/core');
const { parseImportData, countRequests, importFromSqliteDb } = require('./import');
const store = require('./store');

function register(mainWindow) {
  ipcMain.handle('collections:list', () => store.loadCollections());

  ipcMain.handle('collections:create', (_, name) => {
    const defaultRequest = {
      id: generateKSUID(),
      type: 'request',
      name: 'New Request',
      method: 'GET',
      url: '',
      headers: [],
      body: '',
      bodyType: 'text',
    };
    const collection = { id: generateKSUID(), name, items: [defaultRequest] };
    store.saveCollection(collection);
    return collection;
  });

  ipcMain.handle('collections:rename', (_, id, name) => {
    const c = store.loadCollection(id);
    if (!c) return null;
    c.name = name;
    store.saveCollection(c);
    return c;
  });

  ipcMain.handle('collections:delete', (_, id) => {
    store.deleteCollection(id);
    return true;
  });

  ipcMain.handle('collections:pin', (_, id, pinned) => {
    store.getDb().prepare('UPDATE collections SET pinned = ? WHERE id = ?').run(
      pinned ? 1 : 0,
      id,
    );
    return true;
  });

  ipcMain.handle('collections:setCategory', (_, id, categoryId) => {
    store.getDb().prepare('UPDATE collections SET category_id = ? WHERE id = ?').run(
      categoryId || null,
      id,
    );
    return true;
  });

  ipcMain.handle('categories:list', () => store.loadCategories());

  ipcMain.handle('categories:create', (_, name) => {
    const id = generateKSUID();
    store.saveCategory({ id, name });
    return { id, name, sort_order: 0, collapsed: 0 };
  });

  ipcMain.handle('categories:rename', (_, id, name) => {
    store.getDb().prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
    return true;
  });

  ipcMain.handle('categories:delete', (_, id) => {
    store.deleteCategory(id);
    return true;
  });

  ipcMain.handle('categories:toggleCollapse', (_, id, collapsed) => {
    store.getDb().prepare('UPDATE categories SET collapsed = ? WHERE id = ?').run(
      collapsed ? 1 : 0,
      id,
    );
    return true;
  });

  ipcMain.handle('categories:reorder', (_, orderedIds) => {
    const db = store.getDb();
    const stmt = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
    const tx = db.transaction(() => {
      orderedIds.forEach((id, i) => stmt.run(i, id));
    });
    tx();
    return true;
  });

  // --- Settings ---

  ipcMain.handle('settings:get', (_, key) => {
    const row = store.getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  });

  ipcMain.handle('settings:getAll', () => {
    const rows = store.getDb().prepare('SELECT key, value FROM settings').all();
    const result = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  });

  ipcMain.handle('settings:set', (_, key, value) => {
    store.getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      key,
      value,
    );
    return true;
  });

  ipcMain.handle('collection:load', (_, id) => store.loadCollection(id));

  ipcMain.handle('collection:save', (_, collection) => {
    store.saveCollection(collection);
    return true;
  });

  // --- Responses ---

  ipcMain.handle('response:save', (_, data) => {
    return store.saveResponse(data);
  });

  ipcMain.handle('response:latest', (_, requestId) => {
    return store.getLatestResponse(requestId);
  });

  ipcMain.handle('response:history', (_, requestId) => {
    return store.getResponseHistory(requestId);
  });

  ipcMain.handle('response:load', (_, id) => {
    return store.loadResponse(id);
  });

  // --- File picker ---

  ipcMain.handle('file:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const stats = fs.statSync(filePath);
    const path = require('path');
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
        store.saveCollection(collection);
        created.push({ id, name: col.name, count: countRequests(col.items) });
      }
      return { collections: created };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('import:db', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    try {
      const { collections, responses } = importFromSqliteDb(result.filePaths[0]);
      if (collections.length === 0) return { error: 'No collections found in database' };

      const db = store.getDb();
      const created = [];

      // Import collections (use the ID already assigned during import)
      for (const col of collections) {
        const collection = {
          id: col.id,
          name: col.name,
          items: col.items,
          variables: col.variables || [],
        };
        store.saveCollection(collection);
        created.push({ id: col.id, name: col.name, count: countRequests(col.items) });
      }

      // Import responses
      if (responses.length > 0) {
        const insertRes = db.prepare(`
          INSERT INTO responses (request_id, collection_id, status, status_text,
            response_headers, response_body, timeline, time_ms, request_method,
            request_url, request_headers, request_body, content_type, error, messages)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = db.transaction(() => {
          for (const r of responses) {
            insertRes.run(
              r.request_id, r.collection_id, r.status, r.status_text,
              r.response_headers, r.response_body, r.timeline, r.time_ms,
              r.request_method, r.request_url, r.request_headers, r.request_body,
              r.content_type, r.error, r.messages,
            );
          }
        });
        tx();
      }

      return { collections: created, responseCount: responses.length };
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
}

module.exports = { register };
