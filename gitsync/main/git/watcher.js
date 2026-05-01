const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const ignore = require('ignore');

const GIT_PREFIX = '.git' + path.sep;

function register({ mainWindow, git, gitRaw }) {
  const watched = new Set();
  // commonDir -> { watcher, timeout, repos: Set<repoPath> }
  const groups = new Map();
  // repoPath -> commonDir
  const repoToCommon = new Map();
  // repoPath -> { watcher, timeout, ig, gitignoreMtime }
  const treeWatchers = new Map();
  let paused = false;

  async function resolveCommonDir(repoPath) {
    try {
      const out = await git(repoPath, ['rev-parse', '--git-common-dir']);
      return path.resolve(repoPath, out.trim());
    } catch {
      return path.join(repoPath, '.git');
    }
  }

  function loadIgnore(repoPath) {
    const ig = ignore();
    try {
      const gi = fs.readFileSync(path.join(repoPath, '.gitignore'), 'utf8');
      ig.add(gi);
    } catch {}
    try {
      const ex = fs.readFileSync(
        path.join(repoPath, '.git', 'info', 'exclude'),
        'utf8',
      );
      ig.add(ex);
    } catch {}
    return ig;
  }

  function emitChange(repoPath) {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('git:fs-changed', repoPath);
  }

  async function startGitWatcher(repoPath) {
    const commonDir = await resolveCommonDir(repoPath);
    if (!watched.has(repoPath) || paused) return;
    repoToCommon.set(repoPath, commonDir);

    let group = groups.get(commonDir);
    if (group) {
      group.repos.add(repoPath);
      return;
    }
    group = { watcher: null, timeout: null, repos: new Set([repoPath]) };
    groups.set(commonDir, group);
    try {
      group.watcher = fs.watch(
        commonDir,
        { recursive: true },
        (_, filename) => {
          if (!filename) return;
          if (filename.endsWith('.lock')) return;
          if (filename.startsWith('objects' + path.sep)) return;
          clearTimeout(group.timeout);
          group.timeout = setTimeout(() => {
            for (const r of group.repos) emitChange(r);
          }, 300);
        },
      );
    } catch {
      // ignore watch errors; group remains so we don't retry every event
    }
  }

  function startTreeWatcher(repoPath) {
    if (treeWatchers.has(repoPath)) return;
    const state = {
      watcher: null,
      timeout: null,
      ig: loadIgnore(repoPath),
    };
    treeWatchers.set(repoPath, state);
    try {
      state.watcher = fs.watch(
        repoPath,
        { recursive: true },
        (_, filename) => {
          if (!filename) return;
          // Fast path: skip .git directory entirely (handled by git watcher)
          if (filename === '.git' || filename.startsWith(GIT_PREFIX)) return;
          // Refresh matcher when ignore rules change
          if (
            filename === '.gitignore' ||
            filename.endsWith(path.sep + '.gitignore')
          ) {
            state.ig = loadIgnore(repoPath);
            // .gitignore itself is tracked, fall through to emit
          }
          const rel =
            path.sep === '/' ? filename : filename.split(path.sep).join('/');
          // ignore package requires non-empty relative paths
          if (rel && state.ig.ignores(rel)) return;
          clearTimeout(state.timeout);
          state.timeout = setTimeout(() => emitChange(repoPath), 300);
        },
      );
    } catch {
      // ignore watch errors (ENOSPC on Linux, permission, etc.)
    }
  }

  async function startOne(repoPath) {
    if (repoToCommon.has(repoPath)) return;
    await startGitWatcher(repoPath);
    if (!watched.has(repoPath) || paused) return;
    startTreeWatcher(repoPath);
  }

  function stopTreeWatcher(repoPath) {
    const state = treeWatchers.get(repoPath);
    if (!state) return;
    if (state.watcher) state.watcher.close();
    if (state.timeout) clearTimeout(state.timeout);
    treeWatchers.delete(repoPath);
  }

  function stopOne(repoPath) {
    stopTreeWatcher(repoPath);
    const commonDir = repoToCommon.get(repoPath);
    if (!commonDir) return;
    repoToCommon.delete(repoPath);
    const group = groups.get(commonDir);
    if (!group) return;
    group.repos.delete(repoPath);
    if (group.repos.size === 0) {
      if (group.watcher) group.watcher.close();
      if (group.timeout) clearTimeout(group.timeout);
      groups.delete(commonDir);
    }
  }

  function pauseAll() {
    if (paused) return;
    paused = true;
    for (const repoPath of [...repoToCommon.keys()]) stopOne(repoPath);
    // Also stop any tree watchers that exist without a git watcher entry
    for (const repoPath of [...treeWatchers.keys()]) stopTreeWatcher(repoPath);
  }

  function resumeAll() {
    if (!paused) return;
    paused = false;
    for (const repoPath of watched) {
      startOne(repoPath).then(() => {
        if (!mainWindow.isDestroyed()) emitChange(repoPath);
      });
    }
  }

  ipcMain.handle('git:watchRepo', async (_, repoPath) => {
    watched.add(repoPath);
    if (!paused) await startOne(repoPath);
  });

  ipcMain.handle('git:unwatchRepo', (_, repoPath) => {
    watched.delete(repoPath);
    stopOne(repoPath);
  });

  mainWindow.on('blur', pauseAll);
  mainWindow.on('focus', resumeAll);
  mainWindow.on('minimize', pauseAll);
  mainWindow.on('restore', resumeAll);
  mainWindow.on('hide', pauseAll);
  mainWindow.on('show', resumeAll);
}

module.exports = { register };
