const { execFile } = require('child_process');

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
  const ctx = { mainWindow, git, gitRaw };
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
