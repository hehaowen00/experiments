const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:branchList', async (_, repoPath) => {
    try {
      const fmt = '%(HEAD) %(refname) %(refname:short) %(upstream:short) %(upstream:track)';
      const out = await git(repoPath, [
        'for-each-ref', `--format=${fmt}`, 'refs/heads/', 'refs/remotes/',
      ]);
      const branches = out.trim().split('\n').filter(Boolean).map(line => {
        const current = line.startsWith('* ');
        const rest = line.replace(/^\*?\s+/, '');
        const parts = rest.match(/^(\S+)\s+(\S+)\s*(\S*)\s*(.*)$/);
        const fullRef = parts ? parts[1] : '';
        const name = parts ? parts[2] : rest.trim();
        const remote = fullRef.startsWith('refs/remotes/');
        const displayName = remote ? `remotes/${name}` : name;
        const upstream = parts ? parts[3] : '';
        const trackInfo = parts ? parts[4] : '';
        let ahead = 0, behind = 0;
        const aheadMatch = trackInfo.match(/ahead (\d+)/);
        const behindMatch = trackInfo.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1]);
        if (behindMatch) behind = parseInt(behindMatch[1]);
        return { name: displayName, current, upstream, ahead, behind };
      });
      return { branches };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:checkout', async (_, repoPath, branch) => {
    try {
      const out = await git(repoPath, ['checkout', branch]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:checkoutRemote', async (_, repoPath, localName, remoteBranch) => {
    try {
      const out = await git(repoPath, ['checkout', '-b', localName, '--track', remoteBranch]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:checkoutNewBranch', async (_, repoPath, branch) => {
    try {
      const out = await git(repoPath, ['checkout', '-b', branch]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:branchDelete', async (_, repoPath, branch, force) => {
    try {
      const flag = force ? '-D' : '-d';
      const out = await git(repoPath, ['branch', flag, branch]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:branchRename', async (_, repoPath, oldName, newName) => {
    try {
      const out = await git(repoPath, ['branch', '-m', oldName, newName]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
