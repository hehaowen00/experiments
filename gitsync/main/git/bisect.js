const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:bisectStart', async (_, repoPath, badHash, goodHash) => {
    try {
      await git(repoPath, ['bisect', 'start']);
      await git(repoPath, ['bisect', 'bad', badHash]);
      const out = await git(repoPath, ['bisect', 'good', goodHash]);
      return { ok: true, output: out };
    } catch (e) {
      try { await git(repoPath, ['bisect', 'reset']); } catch {}
      return { error: e.message };
    }
  });

  ipcMain.handle('git:bisectMark', async (_, repoPath, verdict) => {
    try {
      const out = await git(repoPath, ['bisect', verdict]);
      const done = out.includes('is the first bad commit');
      return { ok: true, output: out, done };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('git:bisectReset', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['bisect', 'reset']);
      return { ok: true, output: out };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('git:bisectLog', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['bisect', 'log']);
      return { log: out };
    } catch (e) { return { error: e.message }; }
  });
}

module.exports = { register };
