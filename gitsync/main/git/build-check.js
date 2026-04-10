const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
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
    // Detect project type
    const hasGoMod = fs.existsSync(path.join(repoPath, 'go.mod'));

    if (!hasGoMod) {
      return { error: 'No go.mod found — cannot detect build system' };
    }

    // Check if there are staged changes
    const staged = await git(repoPath, ['diff', '--cached', '--name-only']);
    if (!staged.trim()) {
      return { error: 'No staged changes to check' };
    }

    // Stash unstaged/untracked changes, keeping index intact
    let stashed = false;
    try {
      const stashOut = await git(repoPath, ['stash', 'push', '--keep-index', '-m', 'gitsync-build-check']);
      stashed = !stashOut.includes('No local changes');
    } catch (e) {
      // If stash fails (e.g. nothing to stash), continue anyway
    }

    try {
      const result = await run('go', ['test', '-v', './...'], repoPath);

      const ok = result.exitCode === 0;
      const output = (result.stdout + '\n' + result.stderr).trim();
      return { ok, output: output || (ok ? 'Build succeeded' : 'Build failed') };
    } finally {
      if (stashed) {
        try {
          await git(repoPath, ['stash', 'pop']);
        } catch {
          // If pop fails (e.g. conflicts), leave it for the user
        }
      }
    }
  });
}

module.exports = { register };
