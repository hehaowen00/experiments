const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:pull', async (_, repoPath, strategy, remote) => {
    try {
      const args = ['pull', '--autostash'];
      if (strategy === 'ff-only') args.push('--ff-only');
      else if (strategy === 'rebase') args.push('--rebase');
      else if (strategy === 'merge') args.push('--no-rebase');
      if (remote) args.push(remote);
      const out = await git(repoPath, args);
      return { ok: true, output: out };
    } catch (e) {
      const msg = e.message || '';
      const divergent =
        msg.includes('divergent') ||
        msg.includes('Need to specify') ||
        msg.includes('not possible to fast-forward') ||
        (msg.includes('rejected') && msg.includes('non-fast-forward'));
      return { error: msg, divergent };
    }
  });

  ipcMain.handle('git:push', async (_, repoPath, remote) => {
    try {
      const args = ['push'];
      if (remote) args.push(remote);
      const out = await git(repoPath, args);
      return { ok: true, output: out };
    } catch (e) {
      const msg = e.message || '';
      const divergent =
        msg.includes('non-fast-forward') ||
        msg.includes('rejected') ||
        msg.includes('fetch first');
      return { error: msg, divergent };
    }
  });

  ipcMain.handle('git:pushForce', async (_, repoPath, remote) => {
    try {
      const args = ['push', '--force-with-lease'];
      if (remote) args.push(remote);
      const out = await git(repoPath, args);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:pushSetUpstream', async (_, repoPath, remote, branch) => {
    try {
      const out = await git(repoPath, ['push', '-u', remote, branch]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:fetch', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['fetch', '--all']);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
