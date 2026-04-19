const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function register({ mainWindow, git, gitRaw }) {
  const watched = new Set();
  const active = new Map();
  let paused = false;

  function startOne(repoPath) {
    if (active.has(repoPath)) return;
    const gitDir = path.join(repoPath, '.git');
    let timeout;
    try {
      const watcher = fs.watch(
        gitDir,
        { recursive: true },
        (_, filename) => {
          if (!filename) return;
          if (filename.endsWith('.lock')) return;
          if (filename.startsWith('objects' + path.sep)) return;
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            if (!mainWindow.isDestroyed()) {
              mainWindow.webContents.send('git:fs-changed', repoPath);
            }
          }, 300);
        },
      );
      active.set(repoPath, watcher);
    } catch (e) {
      // ignore watch errors
    }
  }

  function stopOne(repoPath) {
    const w = active.get(repoPath);
    if (w) {
      w.close();
      active.delete(repoPath);
    }
  }

  function pauseAll() {
    if (paused) return;
    paused = true;
    for (const repoPath of [...active.keys()]) stopOne(repoPath);
  }

  function resumeAll() {
    if (!paused) return;
    paused = false;
    for (const repoPath of watched) {
      startOne(repoPath);
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:fs-changed', repoPath);
      }
    }
  }

  ipcMain.handle('git:watchRepo', (_, repoPath) => {
    watched.add(repoPath);
    if (!paused) startOne(repoPath);
  });

  ipcMain.handle('git:unwatchRepo', (_, repoPath) => {
    watched.delete(repoPath);
    stopOne(repoPath);
  });

  mainWindow.on('blur', pauseAll);
  mainWindow.on('focus', resumeAll);
  mainWindow.on('minimize', pauseAll);
  mainWindow.on('restore', resumeAll);
  mainWindow.on('hide', pauseAll);
  mainWindow.on('show', resumeAll);
}

module.exports = { register };
