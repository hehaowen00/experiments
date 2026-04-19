const { ipcMain } = require('electron');
const { execFile } = require('child_process');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:stageHunk', async (_, repoPath, patchText) => {
    try {
      await new Promise((resolve, reject) => {
        const proc = execFile('git', ['apply', '--cached', '--unidiff-zero', '-'], {
          cwd: repoPath, maxBuffer: 10 * 1024 * 1024,
        }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
        proc.stdin.write(patchText);
        proc.stdin.end();
      });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:unstageHunk', async (_, repoPath, patchText) => {
    try {
      await new Promise((resolve, reject) => {
        const proc = execFile('git', ['apply', '--cached', '--unidiff-zero', '--reverse', '-'], {
          cwd: repoPath, maxBuffer: 10 * 1024 * 1024,
        }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
        proc.stdin.write(patchText);
        proc.stdin.end();
      });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:discardHunk', async (_, repoPath, patchText) => {
    try {
      await new Promise((resolve, reject) => {
        const proc = execFile('git', ['apply', '--reverse', '--unidiff-zero', '-'], {
          cwd: repoPath, maxBuffer: 10 * 1024 * 1024,
        }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        });
        proc.stdin.write(patchText);
        proc.stdin.end();
      });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stage', async (_, repoPath, filepaths) => {
    try {
      await git(repoPath, ['add', '-f', '--', ...filepaths]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:unstage', async (_, repoPath, filepaths) => {
    try {
      await git(repoPath, ['reset', 'HEAD', '--', ...filepaths]);
      return { ok: true };
    } catch (e) {
      // No commits yet — HEAD doesn't exist, use rm --cached instead
      try {
        await git(repoPath, ['rm', '--cached', '--', ...filepaths]);
        return { ok: true };
      } catch (e2) {
        return { error: e2.message };
      }
    }
  });

  ipcMain.handle('git:stageAll', async (_, repoPath) => {
    try {
      await git(repoPath, ['add', '-A']);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:unstageAll', async (_, repoPath) => {
    try {
      await git(repoPath, ['reset', 'HEAD']);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:discard', async (_, repoPath, filepaths) => {
    try {
      await git(repoPath, ['checkout', '--', ...filepaths]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:deleteUntracked', async (_, repoPath, filepaths) => {
    try {
      // -d so directory pathspecs recurse and drop untracked subdirs.
      await git(repoPath, ['clean', '-f', '-d', '--', ...filepaths]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
