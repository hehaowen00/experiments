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
      const fmt = '%H%x00%B%x00%an%x00%ae%x00%at%x00%P';
      const metaOut = await git(repoPath, ['show', `--format=${fmt}`, '--no-patch', hash]);
      const parts = metaOut.split('\x00');
      const parents = (parts[5] || '').trim();
      const parentList = parents ? parents.split(' ').filter(Boolean) : [];
      const isMerge = parentList.length > 1;

      // For merge commits, diff against first parent to show meaningful changes
      const numstatOut = isMerge
        ? await git(repoPath, ['diff', '--numstat', '--no-color', `${hash}^1`, hash])
        : await git(repoPath, ['show', '--format=', '--numstat', '--no-color', hash]);

      // Parse --numstat: each line is "adds\tdels\tfilename" or "-\t-\tfilename" for binary
      const files = [];
      if (numstatOut.trim()) {
        for (const line of numstatOut.trim().split('\n')) {
          const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
          if (m) {
            const binary = m[1] === '-';
            files.push({
              filename: m[3],
              additions: binary ? 0 : parseInt(m[1]),
              deletions: binary ? 0 : parseInt(m[2]),
              binary,
            });
          }
        }
      }

      return {
        hash: parts[0],
        body: (parts[1] || '').trim(),
        author: parts[2] || '',
        email: parts[3] || '',
        date: new Date(parseInt(parts[4]) * 1000).toISOString(),
        parents: parentList,
        files,
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle(
    'git:showFileDiff',
    async (_, repoPath, hash, filepath, isMerge) => {
      try {
        // For merge commits, diff against first parent to show meaningful changes
        const diff = isMerge
          ? await git(repoPath, ['diff', '--no-color', `${hash}^1`, hash, '--', filepath])
          : await git(repoPath, ['show', '--format=', '--patch', '--no-color', hash, '--', filepath]);
        return { diff };
      } catch (e) {
        return { error: e.message };
      }
    },
  );

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
