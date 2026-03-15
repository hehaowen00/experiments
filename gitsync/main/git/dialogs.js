const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Git Repository',
    });
    if (result.canceled || !result.filePaths.length) return null;
    const dir = result.filePaths[0];
    try {
      await git(dir, ['rev-parse', '--git-dir']);
      return { path: dir, isGit: true };
    } catch {
      return { path: dir, isGit: false };
    }
  });

  ipcMain.handle('git:init', async (_, dirPath) => {
    try {
      await git(dirPath, ['init']);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:clone', async (_, url, parentDir, dirName) => {
    try {
      const args = ['clone', url];
      if (dirName) args.push(dirName);
      await git(parentDir, args, { timeout: 5 * 60 * 1000 });
      const clonedName = dirName || url.replace(/\.git$/, '').split('/').pop();
      const clonedPath = path.join(parentDir, clonedName);
      return { ok: true, path: clonedPath, name: clonedName };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:pickCloneFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Clone Destination',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('git:readme', async (_, repoPath) => {
    const names = ['README.md', 'readme.md', 'Readme.md', 'README.MD', 'README', 'README.txt', 'README.rst'];
    for (const name of names) {
      const filePath = path.join(repoPath, name);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        return { content, filename: name };
      } catch { /* not found, try next */ }
    }
    return { content: null, filename: null };
  });
}

module.exports = { register };
