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

module.exports = { parseImportData, countRequests };
