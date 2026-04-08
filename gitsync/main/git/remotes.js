const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:remoteList', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['remote', '-v']);
      const remotes = {};
      out.trim().split('\n').filter(Boolean).forEach(line => {
        const match = line.match(/^(\S+)\s+(.+)\s+\((\w+)\)$/);
        if (match) {
          const [, name, url, type] = match;
          if (!remotes[name]) remotes[name] = { name, fetch: '', push: '' };
          remotes[name][type] = url;
        } else {
          const name = line.trim();
          if (name && !remotes[name]) remotes[name] = { name, fetch: '', push: '' };
        }
      });
      return { remotes: Object.values(remotes) };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:remoteAdd', async (_, repoPath, name, url) => {
    try {
      await git(repoPath, ['remote', 'add', name, url]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:remoteRemove', async (_, repoPath, name) => {
    try {
      await git(repoPath, ['remote', 'remove', name]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:remoteSetUrl', async (_, repoPath, name, url) => {
    try {
      await git(repoPath, ['remote', 'set-url', name, url]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
