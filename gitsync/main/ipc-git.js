const { execFile, spawn } = require('child_process');

function git(repoPath, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

function gitWithProgress(mainWindow, repoPath, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: repoPath, ...opts });
    let stdout = '';
    let stderr = '';

    function sendProgress(line) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:progress', line);
      }
    }

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      // Send the last meaningful line as progress
      const lines = text.split(/[\r\n]+/).filter(Boolean);
      if (lines.length > 0) {
        sendProgress(lines[lines.length - 1].trim());
      }
    });

    proc.on('close', (code) => {
      // Clear progress when done
      sendProgress('');
      if (code !== 0) {
        reject(new Error(stderr || `git exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err) => {
      sendProgress('');
      reject(err);
    });
  });
}

// Like git() but returns stdout even on non-zero exit
function gitRaw(repoPath, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: err ? err.code : 0,
        });
      },
    );
  });
}

function register(mainWindow) {
  const gitProgress = (repoPath, args, opts) =>
    gitWithProgress(mainWindow, repoPath, args, opts);
  const ctx = { mainWindow, git, gitRaw, gitProgress };
  require('./git/repos').register(ctx);
  require('./git/categories').register(ctx);
  require('./git/identities').register(ctx);
  require('./git/dialogs').register(ctx);
  require('./git/status').register(ctx);
  require('./git/staging').register(ctx);
  require('./git/commit').register(ctx);
  require('./git/log').register(ctx);
  require('./git/sync').register(ctx);
  require('./git/remotes').register(ctx);
  require('./git/branches').register(ctx);
  require('./git/merge-rebase').register(ctx);
  require('./git/tags').register(ctx);
  require('./git/stash').register(ctx);
  require('./git/submodules').register(ctx);
  require('./git/worktrees').register(ctx);
  require('./git/patches').register(ctx);
  require('./git/conflicts').register(ctx);
  require('./git/bisect').register(ctx);
  require('./git/watcher').register(ctx);
}

module.exports = { register };
