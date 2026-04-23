const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: () => ipcRenderer.invoke('app:platform'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
  homeDir: () => ipcRenderer.invoke('app:homeDir'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  saveFile: (defaultName, content) => ipcRenderer.invoke('file:save', defaultName, content),
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // Collections
  listCollections: () => ipcRenderer.invoke('collections:list'),
  createCollection: (name) => ipcRenderer.invoke('collections:create', name),
  renameCollection: (id, name) => ipcRenderer.invoke('collections:rename', id, name),
  deleteCollection: (id) => ipcRenderer.invoke('collections:delete', id),
  pinCollection: (id, pinned) => ipcRenderer.invoke('collections:pin', id, pinned),
  setCollectionCategory: (id, categoryId) =>
    ipcRenderer.invoke('collections:setCategory', id, categoryId),
  listCategories: () => ipcRenderer.invoke('categories:list'),
  createCategory: (name) => ipcRenderer.invoke('categories:create', name),
  renameCategory: (id, name) => ipcRenderer.invoke('categories:rename', id, name),
  deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),
  toggleCategoryCollapse: (id, collapsed) =>
    ipcRenderer.invoke('categories:toggleCollapse', id, collapsed),
  reorderCategories: (orderedIds) => ipcRenderer.invoke('categories:reorder', orderedIds),
  loadCollection: (id) => ipcRenderer.invoke('collection:load', id),
  saveCollection: (collection) => ipcRenderer.invoke('collection:save', collection),

  // Requests
  sendRequest: (opts) => ipcRenderer.invoke('request:send', opts),
  saveResponse: (data) => ipcRenderer.invoke('response:save', data),
  getLatestResponse: (requestId) => ipcRenderer.invoke('response:latest', requestId),
  getResponseHistory: (requestId) => ipcRenderer.invoke('response:history', requestId),
  loadResponse: (id) => ipcRenderer.invoke('response:load', id),
  pickFile: () => ipcRenderer.invoke('file:pick'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  importCollection: () => ipcRenderer.invoke('import:pick'),
  importFromDb: () => ipcRenderer.invoke('import:db'),
  importRequests: () => ipcRenderer.invoke('import:requests'),

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
  onWsPing: (cb) => ipcRenderer.on('ws:ping', (_, d) => cb(d)),
  onWsPong: (cb) => ipcRenderer.on('ws:pong', (_, d) => cb(d)),
});
