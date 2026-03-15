const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:stashList', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['stash', 'list', '--pretty=format:%gd%x00%s%x00%ai']);
      if (!out.trim()) return { stashes: [] };
      const stashes = out.trim().split('\n').map(line => {
        const [ref, message, date] = line.split('\x00');
        return { ref, message, date };
      });
      return { stashes };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashPush', async (_, repoPath, message, includeUntracked) => {
    try {
      const args = ['stash', 'push'];
      if (includeUntracked) args.push('--include-untracked');
      if (message) args.push('-m', message);
      const out = await git(repoPath, args);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashPop', async (_, repoPath, ref) => {
    try {
      const out = await git(repoPath, ['stash', 'pop', ref || 'stash@{0}']);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashApply', async (_, repoPath, ref) => {
    try {
      const out = await git(repoPath, ['stash', 'apply', ref || 'stash@{0}']);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashDrop', async (_, repoPath, ref) => {
    try {
      const out = await git(repoPath, ['stash', 'drop', ref || 'stash@{0}']);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:listFiles', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['ls-files', '--others', '--exclude-standard']);
      const files = out.split('\n').filter(Boolean);
      return { files };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashShow', async (_, repoPath, ref) => {
    try {
      const out = await git(repoPath, ['stash', 'show', '-p', '-u', '--no-color', ref || 'stash@{0}']);
      return { diff: out };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
