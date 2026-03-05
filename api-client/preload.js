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
});
