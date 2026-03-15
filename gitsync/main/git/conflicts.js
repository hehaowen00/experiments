const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:resolveOurs', async (_, repoPath, filepaths) => {
    try {
      await git(repoPath, ['checkout', '--ours', '--', ...filepaths]);
      await git(repoPath, ['add', '--', ...filepaths]);
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('git:resolveTheirs', async (_, repoPath, filepaths) => {
    try {
      await git(repoPath, ['checkout', '--theirs', '--', ...filepaths]);
      await git(repoPath, ['add', '--', ...filepaths]);
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });
}

module.exports = { register };
