const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: err ? (err.code || 1) : 0 });
    });
  });
}

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:buildCheck', async (_, repoPath) => {
    const hasGoMod = fs.existsSync(path.join(repoPath, 'go.mod'));
    if (!hasGoMod) {
      return { error: 'No go.mod found — cannot detect build system' };
    }

    const head = (await git(repoPath, ['rev-parse', 'HEAD'])).trim();
    if (!head) {
      return { error: 'No commits to check' };
    }

    const worktreeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gitsync-build-check-'),
    );

    try {
      await git(repoPath, ['worktree', 'add', '--detach', worktreeDir, head]);

      const result = await run('go', ['test', '-v', './...'], worktreeDir);
      const ok = result.exitCode === 0;
      const output = (result.stdout + '\n' + result.stderr).trim();
      return { ok, output: output || (ok ? 'Build succeeded' : 'Build failed') };
    } finally {
      try {
        await git(repoPath, ['worktree', 'remove', '--force', worktreeDir]);
      } catch {
        try {
          fs.rmSync(worktreeDir, { recursive: true, force: true });
          await git(repoPath, ['worktree', 'prune']);
        } catch {}
      }
    }
  });
}

module.exports = { register };
