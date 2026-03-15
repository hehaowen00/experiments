const { ipcMain, dialog } = require('electron');
const fs = require('fs');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:exportStagedPatch', async (_, repoPath) => {
    try {
      const diff = await git(repoPath, ['diff', '--cached', '--no-color']);
      if (!diff.trim()) return { error: 'No staged changes to export' };
      const branch = (await git(repoPath, ['branch', '--show-current'])).trim();
      const defaultName = `${branch || 'patch'}.patch`;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Patch File',
        defaultPath: defaultName,
        filters: [{ name: 'Patch Files', extensions: ['patch', 'diff'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      fs.writeFileSync(result.filePath, diff, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('git:applyPatch', async (_, repoPath) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Patch File',
        filters: [
          { name: 'Patch Files', extensions: ['patch', 'diff'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths.length) return { canceled: true };
      const patchPath = result.filePaths[0];
      const out = await git(repoPath, ['apply', patchPath]);
      return { ok: true, output: out || 'Patch applied successfully' };
    } catch (e) { return { error: e.message }; }
  });
}

module.exports = { register };
