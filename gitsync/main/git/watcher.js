const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function register({ mainWindow, git, gitRaw }) {
  const watched = new Set();
  // commonDir -> { watcher, timeout, repos: Set<repoPath> }
  const groups = new Map();
  // repoPath -> commonDir
  const repoToCommon = new Map();
  let paused = false;

  async function resolveCommonDir(repoPath) {
    try {
      const out = await git(repoPath, ['rev-parse', '--git-common-dir']);
      return path.resolve(repoPath, out.trim());
    } catch {
      return path.join(repoPath, '.git');
    }
  }

  async function startOne(repoPath) {
    if (repoToCommon.has(repoPath)) return;
    const commonDir = await resolveCommonDir(repoPath);
    // Bail if the registration was cancelled while we awaited git.
    if (!watched.has(repoPath) || paused) return;
    repoToCommon.set(repoPath, commonDir);

    let group = groups.get(commonDir);
    if (!group) {
      group = { watcher: null, timeout: null, repos: new Set() };
      groups.set(commonDir, group);
      try {
        group.watcher = fs.watch(
          commonDir,
          { recursive: true },
          (_, filename) => {
            if (!filename) return;
            if (filename.endsWith('.lock')) return;
            if (filename.startsWith('objects' + path.sep)) return;
            clearTimeout(group.timeout);
            group.timeout = setTimeout(() => {
              if (mainWindow.isDestroyed()) return;
              for (const r of group.repos) {
                mainWindow.webContents.send('git:fs-changed', r);
              }
            }, 300);
          },
        );
      } catch {
        // ignore watch errors; group remains so we don't retry every event
      }
    }
    group.repos.add(repoPath);
  }

  function stopOne(repoPath) {
    const commonDir = repoToCommon.get(repoPath);
    if (!commonDir) return;
    repoToCommon.delete(repoPath);
    const group = groups.get(commonDir);
    if (!group) return;
    group.repos.delete(repoPath);
    if (group.repos.size === 0) {
      if (group.watcher) group.watcher.close();
      if (group.timeout) clearTimeout(group.timeout);
      groups.delete(commonDir);
    }
  }

  function pauseAll() {
    if (paused) return;
    paused = true;
    for (const repoPath of [...repoToCommon.keys()]) stopOne(repoPath);
  }

  function resumeAll() {
    if (!paused) return;
    paused = false;
    for (const repoPath of watched) {
      startOne(repoPath).then(() => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('git:fs-changed', repoPath);
        }
      });
    }
  }

  ipcMain.handle('git:watchRepo', async (_, repoPath) => {
    watched.add(repoPath);
    if (!paused) await startOne(repoPath);
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
