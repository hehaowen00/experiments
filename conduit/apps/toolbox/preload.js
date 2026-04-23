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

  // RFC Viewer
  rfcSyncIndex: () => ipcRenderer.invoke('rfc:syncIndex'),
  rfcSearch: (query, limit) => ipcRenderer.invoke('rfc:search', query, limit),
  rfcGet: (number) => ipcRenderer.invoke('rfc:get', number),
  rfcGetContent: (number) => ipcRenderer.invoke('rfc:getContent', number),
  rfcGetSyncStatus: () => ipcRenderer.invoke('rfc:getSyncStatus'),
  rfcBrowse: (offset, limit) => ipcRenderer.invoke('rfc:browse', offset, limit),
  rfcGetTitles: (numbers) => ipcRenderer.invoke('rfc:getTitles', numbers),
  onRfcSyncProgress: (cb) => ipcRenderer.on('rfc:syncProgress', (_, d) => cb(d)),

  // Drop
  dropStart: (opts) => ipcRenderer.invoke('drop:start', opts),
  dropStop: (id) => ipcRenderer.invoke('drop:stop', id),
  dropAccept: (fileId) => ipcRenderer.invoke('drop:accept', fileId),
  dropReject: (fileId) => ipcRenderer.invoke('drop:reject', fileId),
  dropListFiles: (id) => ipcRenderer.invoke('drop:listFiles', id),
  dropPickFolder: () => ipcRenderer.invoke('drop:pickFolder'),
  dropShareFiles: (serverId) => ipcRenderer.invoke('drop:shareFiles', serverId),
  dropUnshareFile: (fileId) => ipcRenderer.invoke('drop:unshareFile', fileId),
  onDropStarted: (cb) => ipcRenderer.on('drop:started', (_, d) => cb(d)),
  onDropStopped: (cb) => ipcRenderer.on('drop:stopped', (_, d) => cb(d)),
  onDropPending: (cb) => ipcRenderer.on('drop:pending', (_, d) => cb(d)),
  onDropAccepted: (cb) => ipcRenderer.on('drop:accepted', (_, d) => cb(d)),
  onDropRejected: (cb) => ipcRenderer.on('drop:rejected', (_, d) => cb(d)),
  onDropError: (cb) => ipcRenderer.on('drop:error', (_, d) => cb(d)),
});
