const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const watchers = new Map();

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:watchRepo', (_, repoPath) => {
    if (watchers.has(repoPath)) return;
    let timeout;
    try {
      const watcher = fs.watch(repoPath, { recursive: true }, (_, filename) => {
        if (filename && filename.startsWith('.git' + path.sep)) return;
        if (filename === '.git') return;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('git:fs-changed', repoPath);
          }
        }, 300);
      });
      watchers.set(repoPath, watcher);
    } catch (e) {
      // ignore watch errors
    }
  });

  ipcMain.handle('git:unwatchRepo', (_, repoPath) => {
    const watcher = watchers.get(repoPath);
    if (watcher) { watcher.close(); watchers.delete(repoPath); }
  });
}

module.exports = { register };
