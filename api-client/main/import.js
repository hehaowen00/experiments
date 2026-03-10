const { generateKSUID } = require('./ksuid');

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

function importFromSqliteDb(dbPath) {
  const Database = require('better-sqlite3');
  let srcDb;
  try {
    srcDb = new Database(dbPath, { readonly: true });
  } catch (e) {
    throw new Error('Could not open database: ' + e.message);
  }

  try {
    // Check which tables exist
    const tables = srcDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);

    if (!tables.includes('collections')) {
      throw new Error('No collections table found in database');
    }

    // Discover available columns
    const cols = srcDb
      .prepare('PRAGMA table_info(collections)')
      .all()
      .map((c) => c.name);

    const selectCols = ['id', 'name', 'items']
      .filter((c) => cols.includes(c));

    if (!selectCols.includes('name') || !selectCols.includes('items')) {
      throw new Error('Database collections table missing required columns (name, items)');
    }

    const hasVariables = cols.includes('variables');
    if (hasVariables) selectCols.push('variables');

    const rows = srcDb
      .prepare(`SELECT ${selectCols.join(', ')} FROM collections`)
      .all();

    // idMap tracks old ID -> new ID for remapping responses
    const idMap = new Map();
    const collectionIdMap = new Map();

    const collections = [];
    for (const row of rows) {
      let items = [];
      try {
        items = JSON.parse(row.items || '[]');
      } catch {
        continue;
      }

      const newCollectionId = generateKSUID();
      if (row.id) {
        collectionIdMap.set(row.id, newCollectionId);
      }

      items = regenIds(items, idMap);

      let variables = [];
      if (hasVariables && row.variables) {
        try {
          variables = JSON.parse(row.variables);
        } catch {}
      }

      collections.push({
        id: newCollectionId,
        name: row.name || 'Imported',
        items,
        variables,
      });
    }

    // Import responses if present
    let responses = [];
    if (tables.includes('responses')) {
      try {
        const resCols = srcDb
          .prepare('PRAGMA table_info(responses)')
          .all()
          .map((c) => c.name);

        // Build SELECT with only columns that exist
        const wantCols = [
          'request_id', 'collection_id', 'status', 'status_text',
          'response_headers', 'response_body', 'timeline', 'time_ms',
          'request_method', 'request_url', 'request_headers', 'request_body',
          'content_type', 'error', 'created_at', 'messages',
        ];
        const availCols = wantCols.filter((c) => resCols.includes(c));

        const resRows = srcDb
          .prepare(`SELECT ${availCols.join(', ')} FROM responses ORDER BY created_at ASC`)
          .all();

        for (const r of resRows) {
          const oldReqId = r.request_id;
          const oldColId = r.collection_id;
          const newReqId = idMap.get(oldReqId);
          const newColId = collectionIdMap.get(oldColId);

          // Skip responses whose parent request/collection wasn't imported
          if (!newReqId || !newColId) continue;

          responses.push({
            request_id: newReqId,
            collection_id: newColId,
            status: r.status || null,
            status_text: r.status_text || null,
            response_headers: r.response_headers || '{}',
            response_body: r.response_body || null,
            timeline: r.timeline || '[]',
            time_ms: r.time_ms || 0,
            request_method: r.request_method || null,
            request_url: r.request_url || null,
            request_headers: r.request_headers || '[]',
            request_body: r.request_body || '',
            content_type: r.content_type || '',
            error: r.error || null,
            messages: r.messages || '[]',
          });
        }
      } catch {}
    }

    return { collections, responses };
  } finally {
    srcDb.close();
  }
}

function regenIds(items, idMap) {
  return items.map((item) => {
    const newId = generateKSUID();
    if (idMap && item.id) {
      idMap.set(item.id, newId);
    }
    const copy = { ...item, id: newId };
    if (copy.children) {
      copy.children = regenIds(copy.children, idMap);
    }
    return copy;
  });
}

module.exports = { parseImportData, countRequests, importFromSqliteDb };
