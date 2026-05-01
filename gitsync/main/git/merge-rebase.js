const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Resolve the actual gitdir. In a worktree, `<repo>/.git` is a file containing
// a `gitdir:` pointer; the real gitdir lives at `<main>/.git/worktrees/<wt>/`.
// `git rev-parse --absolute-git-dir` returns the right path in both cases.
async function resolveGitDir(repoPath, git) {
  return (await git(repoPath, ['rev-parse', '--absolute-git-dir'])).trim();
}

async function markerPath(repoPath, git) {
  return path.join(await resolveGitDir(repoPath, git), 'gitsync-stashed');
}

async function stashIfDirty(repoPath, git) {
  const status = await git(repoPath, ['status', '--porcelain']);
  if (status.trim().length === 0) return false;
  await git(repoPath, ['stash']);
  fs.writeFileSync(await markerPath(repoPath, git), '');
  return true;
}

async function popStashIfNeeded(repoPath, git) {
  const marker = await markerPath(repoPath, git);
  if (!fs.existsSync(marker)) return;
  try { fs.unlinkSync(marker); } catch {}
  await git(repoPath, ['stash', 'pop']);
}

async function clearMarker(repoPath, git) {
  try { fs.unlinkSync(await markerPath(repoPath, git)); } catch {}
}

function isEmptyRebaseCommitError(message) {
  return message.includes('No changes') ||
    message.includes('previous cherry-pick is now empty') ||
    message.includes('nothing to commit');
}

async function hasUnmergedFiles(repoPath, git) {
  const out = await git(repoPath, ['ls-files', '-u']);
  return out.trim().length > 0;
}

async function hasStagedChanges(repoPath, gitRaw) {
  const result = await gitRaw(repoPath, ['diff', '--cached', '--quiet']);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(result.stderr || 'Failed to inspect staged changes');
  }
  return result.exitCode === 1;
}

async function skipEmptyRebaseCommit(repoPath, git, gitRaw, originalMessage) {
  if (!isEmptyRebaseCommitError(originalMessage)) return null;
  if (await hasUnmergedFiles(repoPath, git)) return null;
  if (await hasStagedChanges(repoPath, gitRaw)) return null;
  const out = await git(repoPath, ['rebase', '--skip']);
  return out || 'Skipped empty rebase commit';
}

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:merge', async (_, repoPath, branch, opts = {}) => {
    try {
      const args = ['merge'];
      if (opts.noFf) args.push('--no-ff');
      args.push(branch);
      const out = await git(repoPath, args);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('Automatic merge failed')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:mergeAbort', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['merge', '--abort']);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:rebase', async (_, repoPath, branch) => {
    try {
      await stashIfDirty(repoPath, git);
      const out = await git(repoPath, ['rebase', branch]);
      await popStashIfNeeded(repoPath, git);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('could not apply')) {
        return { ok: false, conflict: true, output: e.message };
      }
      await clearMarker(repoPath, git);
      return { error: e.message };
    }
  });

  ipcMain.handle('git:rebaseContinue', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['rebase', '--continue'], {
        env: { ...process.env, GIT_EDITOR: 'true' },
      });
      await popStashIfNeeded(repoPath, git);
      return { ok: true, output: out };
    } catch (e) {
      try {
        const skipped = await skipEmptyRebaseCommit(
          repoPath,
          git,
          gitRaw,
          e.message,
        );
        if (skipped !== null) {
          await popStashIfNeeded(repoPath, git);
          return { ok: true, output: skipped };
        }
      } catch (skipError) {
        if (skipError.message.includes('CONFLICT') || skipError.message.includes('could not apply')) {
          return { ok: false, conflict: true, output: skipError.message };
        }
        return { error: skipError.message };
      }
      if (e.message.includes('CONFLICT') || e.message.includes('could not apply')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:rebaseAbort', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['rebase', '--abort']);
      await popStashIfNeeded(repoPath, git);
      return { ok: true, output: out };
    } catch (e) {
      await clearMarker(repoPath, git);
      return { error: e.message };
    }
  });

  ipcMain.handle('git:interactiveRebase', async (_, repoPath, baseHash, todoList) => {
    // todoList: [{ action: 'pick'|'squash'|'fixup'|'reword'|'drop', hash, subject }]
    const os = require('os');
    const todoContent = todoList
      .map(t => `${t.action} ${t.hash} ${t.subject}`)
      .join('\n') + '\n';
    const tmpFile = path.join(os.tmpdir(), `gitsync-rebase-${Date.now()}.txt`);
    try {
      await stashIfDirty(repoPath, git);
      fs.writeFileSync(tmpFile, todoContent);
      const editorCmd = `cp "${tmpFile}"`;
      const out = await new Promise((resolve, reject) => {
        execFile('git', ['rebase', '-i', baseHash], {
          cwd: repoPath,
          env: { ...process.env, GIT_SEQUENCE_EDITOR: editorCmd },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60000,
        }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout + stderr);
        });
      });
      await popStashIfNeeded(repoPath, git);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('could not apply')) {
        return { ok: false, conflict: true, output: e.message };
      }
      await clearMarker(repoPath, git);
      return { error: e.message };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  ipcMain.handle('git:cherryPick', async (_, repoPath, hash) => {
    try {
      const out = await git(repoPath, ['cherry-pick', hash]);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('could not apply')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:dropCommit', async (_, repoPath, hash) => {
    try {
      await stashIfDirty(repoPath, git);
      const out = await git(repoPath, [
        'rebase', '--onto', `${hash}^`, hash,
      ]);
      await popStashIfNeeded(repoPath, git);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('could not apply')) {
        return { ok: false, conflict: true, output: e.message };
      }
      await clearMarker(repoPath, git);
      return { error: e.message };
    }
  });

  ipcMain.handle('git:revert', async (_, repoPath, hash) => {
    try {
      const out = await git(repoPath, ['revert', '--no-edit', hash]);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('could not revert')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:operationState', async (_, repoPath) => {
    try {
      const gitDir = await resolveGitDir(repoPath, git);
      if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
        return { state: 'rebase' };
      }
      if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
        return { state: 'merge' };
      }
      if (fs.existsSync(path.join(gitDir, 'BISECT_LOG'))) {
        return { state: 'bisect' };
      }
      return { state: null };
    } catch {
      return { state: null };
    }
  });
}

module.exports = { register };
