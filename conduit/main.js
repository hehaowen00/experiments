const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const store = require('./main/store');
const ipcCollections = require('./main/ipc-collections');
const ipcRequests = require('./main/ipc-requests');
const ipcWebsocket = require('./main/ipc-websocket');
const ipcDatabase = require('./main/ipc-database');
const ipcDrop = require('./main/ipc-drop');
const ipcRfc = require('./main/ipc-rfc');

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
  Menu.setApplicationMenu(null);
  store.initDb();
  createWindow();

  ipcCollections.register(mainWindow);
  ipcRequests.register(mainWindow);
  ipcWebsocket.register(mainWindow);
  ipcDatabase.register(mainWindow);
  ipcDrop.register(mainWindow);
  ipcRfc.register(mainWindow);

  ipcMain.handle('app:homeDir', () => require('os').homedir());
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('file:save', async (_, defaultName, content) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [
        { name: 'CSV', extensions: ['csv'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePath) return null;
    require('fs').writeFileSync(filePath, content, 'utf-8');
    return filePath;
  });

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
