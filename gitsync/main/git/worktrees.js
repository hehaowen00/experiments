const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('../store');

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

      // Attach user-assigned nicknames keyed by worktree path (shared across tabs).
      const paths = worktrees.map((wt) => wt.path);
      if (paths.length > 0) {
        const placeholders = paths.map(() => '?').join(',');
        const rows = store.getDb()
          .prepare(`SELECT wt_path, nickname FROM git_worktree_names WHERE wt_path IN (${placeholders})`)
          .all(...paths);
        const byPath = new Map(rows.map((r) => [r.wt_path, r.nickname]));
        for (const wt of worktrees) {
          if (byPath.has(wt.path)) wt.nickname = byPath.get(wt.path);
        }
      }

      return { ok: true, worktrees };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('git:worktreeSetName', (_, wtPath, nickname) => {
    try {
      const db = store.getDb();
      const trimmed = (nickname || '').trim();
      if (trimmed) {
        db.prepare(
          'INSERT INTO git_worktree_names (wt_path, nickname) VALUES (?, ?) ' +
          'ON CONFLICT(wt_path) DO UPDATE SET nickname = excluded.nickname',
        ).run(wtPath, trimmed);
      } else {
        db.prepare('DELETE FROM git_worktree_names WHERE wt_path = ?').run(wtPath);
      }
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });

  // Return a non-colliding path. If `desired` exists, append -2, -3, ... until free.
  ipcMain.handle('git:suggestWorktreePath', (_, desired) => {
    try {
      if (!desired) return { path: '' };
      if (!fs.existsSync(desired)) return { path: desired };
      const parent = path.dirname(desired);
      const base = path.basename(desired);
      for (let n = 2; n < 1000; n++) {
        const candidate = path.join(parent, `${base}-${n}`);
        if (!fs.existsSync(candidate)) return { path: candidate };
      }
      return { path: desired };
    } catch (e) {
      return { path: desired };
    }
  });

  ipcMain.handle('git:pickWorktreeFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Worktree Directory',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('git:worktreeAdd', async (_, repoPath, wtPath, branch, newBranch, opts) => {
    try {
      const { detach = false, force = false } = opts || {};
      const args = ['worktree', 'add'];
      // Pass --force twice: single --force overrides the "already-checked-out"
      // safeguard in newer git but not the "branch is checked out in another
      // worktree" check in some versions; doubling is idempotent.
      if (force) args.push('--force', '--force');
      if (detach) {
        args.push('--detach', wtPath);
        if (branch) args.push(branch);
      } else if (newBranch) {
        args.push('-b', newBranch, wtPath);
      } else if (branch) {
        args.push(wtPath, branch);
      } else {
        args.push(wtPath);
      }
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
      try {
        store.getDb().prepare('DELETE FROM git_worktree_names WHERE wt_path = ?').run(wtPath);
      } catch {}
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
