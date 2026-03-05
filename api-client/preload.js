const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listCollections: () => ipcRenderer.invoke('collections:list'),
  createCollection: (name) => ipcRenderer.invoke('collections:create', name),
  renameCollection: (id, name) => ipcRenderer.invoke('collections:rename', id, name),
  deleteCollection: (id) => ipcRenderer.invoke('collections:delete', id),
  loadCollection: (id) => ipcRenderer.invoke('collection:load', id),
  saveCollection: (collection) => ipcRenderer.invoke('collection:save', collection),
  sendRequest: (opts) => ipcRenderer.invoke('request:send', opts),
  saveResponse: (data) => ipcRenderer.invoke('response:save', data),
  getLatestResponse: (requestId) => ipcRenderer.invoke('response:latest', requestId),
  getResponseHistory: (requestId) => ipcRenderer.invoke('response:history', requestId),
  loadResponse: (id) => ipcRenderer.invoke('response:load', id),
  pickFile: () => ipcRenderer.invoke('file:pick'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),

  // SSE
  sseDisconnect: (id) => ipcRenderer.invoke('sse:disconnect', id),
  onSseOpen: (cb) => ipcRenderer.on('sse:open', (_, d) => cb(d)),
  onSseEvent: (cb) => ipcRenderer.on('sse:event', (_, d) => cb(d)),
  onSseError: (cb) => ipcRenderer.on('sse:error', (_, d) => cb(d)),
  onSseClose: (cb) => ipcRenderer.on('sse:close', (_, d) => cb(d)),

  // WebSocket
  wsConnect: (opts) => ipcRenderer.invoke('ws:connect', opts),
  wsSend: (opts) => ipcRenderer.invoke('ws:send', opts),
  wsDisconnect: (id) => ipcRenderer.invoke('ws:disconnect', id),
  onWsOpen: (cb) => ipcRenderer.on('ws:open', (_, d) => cb(d)),
  onWsMessage: (cb) => ipcRenderer.on('ws:message', (_, d) => cb(d)),
  onWsError: (cb) => ipcRenderer.on('ws:error', (_, d) => cb(d)),
  onWsClose: (cb) => ipcRenderer.on('ws:close', (_, d) => cb(d)),
});
