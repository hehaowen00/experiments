const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const store = require('./main/store');
const ipcCollections = require('./main/ipc-collections');
const ipcRequests = require('./main/ipc-requests');
const ipcWebsocket = require('./main/ipc-websocket');
const ipcDatabase = require('./main/ipc-database');
const ipcDrop = require('./main/ipc-drop');

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
  mainWindow.loadFile('ui/dist/index-solid.html');
}

app.whenReady().then(() => {
  store.initDb();
  createWindow();

  ipcCollections.register(mainWindow);
  ipcRequests.register(mainWindow);
  ipcWebsocket.register(mainWindow);
  ipcDatabase.register(mainWindow);
  ipcDrop.register(mainWindow);

  ipcMain.handle('app:homeDir', () => require('os').homedir());
  ipcMain.handle('shell:openExternal', async (_, url) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('will-quit', () => {
  store.closeDb();
});
