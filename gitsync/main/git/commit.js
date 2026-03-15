const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:commit', async (_, repoPath, message) => {
    try {
      const out = await git(repoPath, ['commit', '-m', message]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:commitAmend', async (_, repoPath, message) => {
    try {
      const args = ['commit', '--amend'];
      if (message !== null && message !== undefined) {
        args.push('-m', message);
      } else {
        args.push('--no-edit');
      }
      const out = await git(repoPath, args);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:resetSoftHead', async (_, repoPath) => {
    try {
      // Store the current HEAD hash so we can restore it
      const hash = (await git(repoPath, ['rev-parse', 'HEAD'])).trim();
      await git(repoPath, ['reset', '--soft', 'HEAD~1']);
      return { ok: true, hash };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:resetSoftTo', async (_, repoPath, hash) => {
    try {
      await git(repoPath, ['reset', '--soft', hash]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:show', async (_, repoPath, hash) => {
    try {
      // Use a unique end marker to separate format output from diff
      const END = '<<GIT_FORMAT_END>>';
      const fmt = `%H%x00%B%x00%an%x00%ae%x00%at%x00%P%x00${END}`;
      const out = await git(repoPath, ['show', `--format=${fmt}`, '--patch', '--no-color', hash]);
      const endIdx = out.indexOf(END);
      const formatPart = out.substring(0, endIdx);
      const diffPart = out.substring(endIdx + END.length).replace(/^\n+/, '');
      const parts = formatPart.split('\x00');
      return {
        hash: parts[0],
        body: (parts[1] || '').trim(),
        author: parts[2] || '',
        email: parts[3] || '',
        date: new Date(parseInt(parts[4]) * 1000).toISOString(),
        parents: parts[5] ? parts[5].trim().split(' ').filter(Boolean) : [],
        diff: diffPart,
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:lastCommitMessage', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['log', '-1', '--pretty=format:%B']);
      return { message: out.trim() };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
