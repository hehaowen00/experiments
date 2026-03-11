const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const store = require('./main/store');
const ipcGit = require('./main/ipc-git');
const ipcP2p = require('./main/ipc-p2p');

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

function checkGit() {
  return new Promise((resolve) => {
    execFile('git', ['--version'], (err) => {
      resolve(!err);
    });
  });
}

app.whenReady().then(async () => {
  const gitFound = await checkGit();
  if (!gitFound) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Git Not Found',
      message: 'Git is not installed or not in your PATH.',
      detail: 'GitSync requires Git to function. Please install Git and restart the application.',
      buttons: ['Open git-scm.com', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      shell.openExternal('https://git-scm.com/downloads');
    }
    app.quit();
    return;
  }

  store.initDb();
  createWindow();

  ipcGit.register(mainWindow);
  ipcP2p.register(mainWindow);

  ipcMain.handle('app:homeDir', () => require('os').homedir());
  ipcMain.handle('settings:get', (_, key) => {
    const row = store.getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  });
  ipcMain.handle('settings:getAll', () => {
    const rows = store.getDb().prepare('SELECT key, value FROM settings').all();
    const result = {};
    for (const r of rows) result[r.key] = r.value;
    return result;
  });
  ipcMain.handle('settings:set', (_, key, value) => {
    store.getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    return true;
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
  ipcP2p.shutdown();
  store.closeDb();
});
