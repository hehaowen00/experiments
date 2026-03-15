const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:tagList', async (_, repoPath) => {
    try {
      const out = await git(repoPath, [
        'tag', '-l', '--sort=-creatordate',
        '--format=%(refname:short)\t%(objecttype)\t%(creatordate:iso)\t%(subject)',
      ]);
      if (!out.trim()) return { tags: [] };
      const tags = out.trim().split('\n').map(line => {
        const [name, type, date, message] = line.split('\t');
        return { name, type: type || 'commit', date: date || '', message: message || '' };
      });
      return { tags };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:tagCreate', async (_, repoPath, name, message, target) => {
    try {
      const args = ['tag'];
      if (message) {
        args.push('-a', name, '-m', message);
      } else {
        args.push(name);
      }
      if (target) args.push(target);
      await git(repoPath, args);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:tagDelete', async (_, repoPath, name) => {
    try {
      await git(repoPath, ['tag', '-d', name]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:tagPush', async (_, repoPath, remote, tagName, isDelete) => {
    try {
      const args = ['push', remote];
      if (isDelete) {
        args.push('--delete', `refs/tags/${tagName}`);
      } else {
        args.push(`refs/tags/${tagName}`);
      }
      await git(repoPath, args);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
