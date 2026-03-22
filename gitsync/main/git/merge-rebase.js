const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

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
      const out = await git(repoPath, ['rebase', '--autostash', branch]);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('could not apply')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:rebaseContinue', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['rebase', '--continue']);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('could not apply')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:rebaseAbort', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['rebase', '--abort']);
      return { ok: true, output: out };
    } catch (e) {
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
      fs.writeFileSync(tmpFile, todoContent);
      const editorCmd = `cp "${tmpFile}"`;
      const out = await new Promise((resolve, reject) => {
        execFile('git', ['rebase', '-i', '--autostash', baseHash], {
          cwd: repoPath,
          env: { ...process.env, GIT_SEQUENCE_EDITOR: editorCmd },
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60000,
        }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout + stderr);
        });
      });
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('could not apply')) {
        return { ok: false, conflict: true, output: e.message };
      }
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
      const out = await git(repoPath, [
        'rebase', '--autostash', '--onto', `${hash}^`, hash,
      ]);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('could not apply')) {
        return { ok: false, conflict: true, output: e.message };
      }
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
    const gitDir = path.join(repoPath, '.git');
    try {
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
