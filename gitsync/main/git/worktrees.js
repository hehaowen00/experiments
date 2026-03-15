const { ipcMain, dialog } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:worktreeList', async (_, repoPath) => {
    try {
      const output = await git(repoPath, ['worktree', 'list', '--porcelain']);
      const worktrees = [];
      let current = {};
      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) { current = { path: line.slice(9) }; }
        else if (line === 'bare') { current.bare = true; }
        else if (line.startsWith('HEAD ')) { current.head = line.slice(5); }
        else if (line.startsWith('branch ')) { current.branch = line.slice(7).replace(/^refs\/heads\//, ''); }
        else if (line === 'detached') { current.detached = true; }
        else if (line === 'prunable') { current.prunable = true; }
        else if (line === '') { if (current.path) worktrees.push(current); current = {}; }
      }
      if (current.path) worktrees.push(current);
      return { ok: true, worktrees };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('git:pickWorktreeFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Worktree Directory',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('git:worktreeAdd', async (_, repoPath, wtPath, branch, newBranch) => {
    try {
      const args = ['worktree', 'add'];
      if (newBranch) { args.push('-b', newBranch, wtPath); }
      else if (branch) { args.push(wtPath, branch); }
      else { args.push(wtPath); }
      const output = await git(repoPath, args);
      return { ok: true, output };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('git:worktreeRemove', async (_, repoPath, wtPath, force) => {
    try {
      const args = ['worktree', 'remove'];
      if (force) args.push('--force');
      args.push(wtPath);
      const output = await git(repoPath, args);
      return { ok: true, output };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('git:worktreePrune', async (_, repoPath) => {
    try {
      const output = await git(repoPath, ['worktree', 'prune']);
      return { ok: true, output };
    } catch (e) { return { error: e.message }; }
  });
}

module.exports = { register };
