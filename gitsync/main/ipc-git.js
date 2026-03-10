const { ipcMain, dialog } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const store = require('./store');
const { generateKSUID } = require('./ksuid');

function git(repoPath, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

// Like git() but returns stdout even on non-zero exit (for diff --no-index which returns 1 on differences)
function gitRaw(repoPath, args, opts = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: err ? err.code : 0 });
    });
  });
}

function register(mainWindow) {
  // --- Saved repos CRUD ---
  ipcMain.handle('gitRepo:list', () => {
    return store.getDb()
      .prepare('SELECT id, name, path, pinned, category_id, last_used FROM git_repos ORDER BY last_used DESC')
      .all();
  });

  ipcMain.handle('gitRepo:create', (_, data) => {
    const id = generateKSUID();
    store.getDb().prepare(
      "INSERT INTO git_repos (id, name, path, category_id, last_used) VALUES (?, ?, ?, ?, datetime('now'))",
    ).run(id, data.name, data.path, data.category_id || null);
    return { id, name: data.name, path: data.path, category_id: data.category_id || null, pinned: 0 };
  });

  ipcMain.handle('gitRepo:update', (_, id, data) => {
    store.getDb().prepare(
      'UPDATE git_repos SET name = ?, path = ?, category_id = ? WHERE id = ?',
    ).run(data.name, data.path, data.category_id || null, id);
    return true;
  });

  ipcMain.handle('gitRepo:delete', (_, id) => {
    store.getDb().prepare('DELETE FROM git_repos WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('gitRepo:pin', (_, id, pinned) => {
    store.getDb().prepare('UPDATE git_repos SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
    return true;
  });

  ipcMain.handle('gitRepo:setCategory', (_, id, categoryId) => {
    store.getDb().prepare('UPDATE git_repos SET category_id = ? WHERE id = ?').run(categoryId || null, id);
    return true;
  });

  ipcMain.handle('gitRepo:touchLastUsed', (_, id) => {
    store.getDb().prepare("UPDATE git_repos SET last_used = datetime('now') WHERE id = ?").run(id);
    return true;
  });

  // --- Git repo categories ---
  ipcMain.handle('gitCat:list', () => {
    return store.getDb()
      .prepare('SELECT * FROM git_categories ORDER BY sort_order ASC, rowid ASC')
      .all();
  });

  ipcMain.handle('gitCat:create', (_, name) => {
    const id = generateKSUID();
    const maxOrder = store.getDb().prepare('SELECT MAX(sort_order) as m FROM git_categories').get();
    store.getDb().prepare(
      'INSERT INTO git_categories (id, name, sort_order) VALUES (?, ?, ?)',
    ).run(id, name, (maxOrder?.m || 0) + 1);
    return { id, name };
  });

  ipcMain.handle('gitCat:rename', (_, id, name) => {
    store.getDb().prepare('UPDATE git_categories SET name = ? WHERE id = ?').run(name, id);
    return true;
  });

  ipcMain.handle('gitCat:delete', (_, id) => {
    store.getDb().prepare('UPDATE git_repos SET category_id = NULL WHERE category_id = ?').run(id);
    store.getDb().prepare('DELETE FROM git_categories WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('gitCat:toggleCollapse', (_, id, collapsed) => {
    store.getDb().prepare('UPDATE git_categories SET collapsed = ? WHERE id = ?').run(collapsed ? 1 : 0, id);
    return true;
  });

  ipcMain.handle('gitCat:reorder', (_, orderedIds) => {
    const stmt = store.getDb().prepare('UPDATE git_categories SET sort_order = ? WHERE id = ?');
    const tx = store.getDb().transaction(() => {
      orderedIds.forEach((id, i) => stmt.run(i, id));
    });
    tx();
    return true;
  });

  ipcMain.handle('git:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Git Repository',
    });
    if (result.canceled || !result.filePaths.length) return null;
    const dir = result.filePaths[0];
    try {
      await git(dir, ['rev-parse', '--git-dir']);
      return { path: dir, isGit: true };
    } catch {
      return { path: dir, isGit: false };
    }
  });

  ipcMain.handle('git:init', async (_, dirPath) => {
    try {
      await git(dirPath, ['init']);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  // --- Git operations ---
  ipcMain.handle('git:status', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['status', '--porcelain=v1', '-uall']);
      const branch = (await git(repoPath, ['branch', '--show-current'])).trim();
      let upstream = '';
      let ahead = 0;
      let behind = 0;
      try {
        upstream = (await git(repoPath, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim();
        const counts = (await git(repoPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).trim();
        const [a, b] = counts.split(/\s+/);
        ahead = parseInt(a) || 0;
        behind = parseInt(b) || 0;
      } catch {}

      const files = out.split('\n').filter(Boolean).map(line => {
        const xy = line.substring(0, 2);
        const filepath = line.substring(3);
        return { index: xy[0], working: xy[1], path: filepath };
      });

      return { branch, upstream, ahead, behind, files };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:diff', async (_, repoPath, filepath, staged) => {
    try {
      const args = ['diff', '--no-color'];
      if (staged) args.push('--cached');
      if (filepath) args.push('--', filepath);
      const out = await git(repoPath, args);
      return { diff: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:diffUntracked', async (_, repoPath, filepath) => {
    // git diff --no-index returns exit code 1 when files differ (expected)
    const result = await gitRaw(repoPath, ['diff', '--no-color', '--no-index', '--', '/dev/null', filepath]);
    if (result.stdout) {
      return { diff: result.stdout };
    }
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return { error: result.stderr || 'Failed to diff untracked file' };
    }
    return { diff: result.stdout || '(empty file)' };
  });

  ipcMain.handle('git:stage', async (_, repoPath, filepaths) => {
    try {
      await git(repoPath, ['add', '--', ...filepaths]);
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
      return { error: e.message };
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
      await git(repoPath, ['clean', '-f', '--', ...filepaths]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:commit', async (_, repoPath, message) => {
    try {
      const out = await git(repoPath, ['commit', '-m', message]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:commitAmend', async (_, repoPath, message) => {
    try {
      const args = ['commit', '--amend'];
      if (message !== null && message !== undefined) {
        args.push('-m', message);
      } else {
        args.push('--no-edit');
      }
      const out = await git(repoPath, args);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:resetSoftHead', async (_, repoPath) => {
    try {
      // Store the current HEAD hash so we can restore it
      const hash = (await git(repoPath, ['rev-parse', 'HEAD'])).trim();
      await git(repoPath, ['reset', '--soft', 'HEAD~1']);
      return { ok: true, hash };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:resetSoftTo', async (_, repoPath, hash) => {
    try {
      await git(repoPath, ['reset', '--soft', hash]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:log', async (_, repoPath, count, allBranches, branchName, skip) => {
    try {
      const args = [
        'log', `--max-count=${count || 50}`,
        '--pretty=format:%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D',
      ];
      if (skip) args.push(`--skip=${skip}`);
      if (allBranches) {
        args.push('--all');
      } else if (branchName) {
        args.push(branchName);
      }
      const out = await git(repoPath, args);
      if (!out.trim()) return { commits: [] };
      const commits = out.trim().split('\n').map(line => {
        const [hash, short, parents, author, email, timestamp, subject, refs] = line.split('\x00');
        return {
          hash, short,
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          author, email,
          date: new Date(parseInt(timestamp) * 1000).toISOString(),
          subject, refs,
        };
      });
      return { commits };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:pull', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['pull']);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:push', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['push']);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:pushSetUpstream', async (_, repoPath, remote, branch) => {
    try {
      const out = await git(repoPath, ['push', '-u', remote, branch]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:fetch', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['fetch', '--all']);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  // --- Remotes ---
  ipcMain.handle('git:remoteList', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['remote', '-v']);
      const remotes = {};
      out.trim().split('\n').filter(Boolean).forEach(line => {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
        if (match) {
          const [, name, url, type] = match;
          if (!remotes[name]) remotes[name] = { name, fetch: '', push: '' };
          remotes[name][type] = url;
        }
      });
      return { remotes: Object.values(remotes) };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:remoteAdd', async (_, repoPath, name, url) => {
    try {
      await git(repoPath, ['remote', 'add', name, url]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:remoteRemove', async (_, repoPath, name) => {
    try {
      await git(repoPath, ['remote', 'remove', name]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:remoteSetUrl', async (_, repoPath, name, url) => {
    try {
      await git(repoPath, ['remote', 'set-url', name, url]);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:branchList', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['branch', '-a', '--no-color']);
      const branches = out.trim().split('\n').filter(Boolean).map(line => {
        const current = line.startsWith('* ');
        const name = line.replace(/^\*?\s+/, '').trim();
        return { name, current };
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

  ipcMain.handle('git:show', async (_, repoPath, hash) => {
    try {
      // Use a unique end marker to separate format output from diff
      const END = '<<GIT_FORMAT_END>>';
      const fmt = `%H%x00%B%x00%an%x00%ae%x00%at%x00%P%x00${END}`;
      const out = await git(repoPath, ['show', `--format=${fmt}`, '--patch', '--no-color', hash]);
      const endIdx = out.indexOf(END);
      const formatPart = out.substring(0, endIdx);
      const diffPart = out.substring(endIdx + END.length).replace(/^\n+/, '');
      const parts = formatPart.split('\x00');
      return {
        hash: parts[0],
        body: (parts[1] || '').trim(),
        author: parts[2] || '',
        email: parts[3] || '',
        date: new Date(parseInt(parts[4]) * 1000).toISOString(),
        parents: parts[5] ? parts[5].trim().split(' ').filter(Boolean) : [],
        diff: diffPart,
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:lastCommitMessage', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['log', '-1', '--pretty=format:%B']);
      return { message: out.trim() };
    } catch (e) {
      return { error: e.message };
    }
  });

  // --- Merge ---
  ipcMain.handle('git:merge', async (_, repoPath, branch) => {
    try {
      const out = await git(repoPath, ['merge', branch]);
      return { ok: true, output: out };
    } catch (e) {
      // Merge conflicts produce a non-zero exit but aren't fatal
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

  // --- Rebase ---
  ipcMain.handle('git:rebase', async (_, repoPath, branch) => {
    try {
      const out = await git(repoPath, ['rebase', branch]);
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

  // --- Operation state (detect in-progress merge/rebase) ---
  ipcMain.handle('git:operationState', async (_, repoPath) => {
    const fs = require('fs');
    const gitDir = path.join(repoPath, '.git');
    try {
      if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
        return { state: 'rebase' };
      }
      if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
        return { state: 'merge' };
      }
      return { state: null };
    } catch {
      return { state: null };
    }
  });

  // --- Submodules & nested repos ---
  ipcMain.handle('git:submodules', async (_, repoPath) => {
    const fs = require('fs');
    const results = [];

    // 1. Parse .gitmodules for registered submodules
    const gitmodulesPath = path.join(repoPath, '.gitmodules');
    if (fs.existsSync(gitmodulesPath)) {
      try {
        const content = fs.readFileSync(gitmodulesPath, 'utf8');
        const entries = content.split(/\[submodule\s+"([^"]+)"\]/g).slice(1);
        for (let i = 0; i < entries.length; i += 2) {
          const name = entries[i];
          const block = entries[i + 1] || '';
          const pathMatch = block.match(/path\s*=\s*(.+)/);
          const urlMatch = block.match(/url\s*=\s*(.+)/);
          if (pathMatch) {
            const subPath = pathMatch[1].trim();
            const url = urlMatch ? urlMatch[1].trim() : '';
            const fullPath = path.join(repoPath, subPath);
            let status = 'unknown';
            let branch = '';
            try {
              if (fs.existsSync(path.join(fullPath, '.git')) || fs.existsSync(path.join(fullPath, '.git', 'HEAD')) ||
                  (fs.existsSync(path.join(fullPath, '.git')) && fs.statSync(path.join(fullPath, '.git')).isFile())) {
                branch = (await git(fullPath, ['branch', '--show-current'])).trim();
                const st = await git(fullPath, ['status', '--porcelain=v1']);
                status = st.trim() ? 'dirty' : 'clean';
              } else {
                status = 'not-initialized';
              }
            } catch {
              status = 'not-initialized';
            }
            results.push({ name, path: subPath, fullPath, url, type: 'submodule', status, branch });
          }
        }
      } catch {}
    }

    // 2. Scan top-level directories for nested git repos (not submodules)
    const submodulePaths = new Set(results.map(r => r.path));
    try {
      const entries = fs.readdirSync(repoPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue;
        if (submodulePaths.has(entry.name)) continue;
        const dirPath = path.join(repoPath, entry.name);
        const nestedGit = path.join(dirPath, '.git');
        if (fs.existsSync(nestedGit)) {
          let status = 'unknown';
          let branch = '';
          try {
            branch = (await git(dirPath, ['branch', '--show-current'])).trim();
            const st = await git(dirPath, ['status', '--porcelain=v1']);
            status = st.trim() ? 'dirty' : 'clean';
          } catch {}
          results.push({ name: entry.name, path: entry.name, fullPath: dirPath, url: '', type: 'nested', status, branch });
        }
      }
    } catch {}

    return { submodules: results };
  });

  ipcMain.handle('git:submoduleUpdate', async (_, repoPath, subPath) => {
    try {
      const out = await git(repoPath, ['submodule', 'update', '--init', '--', subPath]);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  // --- Stash ---
  ipcMain.handle('git:stashList', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['stash', 'list', '--pretty=format:%gd%x00%s%x00%ai']);
      if (!out.trim()) return { stashes: [] };
      const stashes = out.trim().split('\n').map(line => {
        const [ref, message, date] = line.split('\x00');
        return { ref, message, date };
      });
      return { stashes };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashPush', async (_, repoPath, message, includeUntracked) => {
    try {
      const args = ['stash', 'push'];
      if (includeUntracked) args.push('--include-untracked');
      if (message) args.push('-m', message);
      const out = await git(repoPath, args);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashPop', async (_, repoPath, ref) => {
    try {
      const out = await git(repoPath, ['stash', 'pop', ref || 'stash@{0}']);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashApply', async (_, repoPath, ref) => {
    try {
      const out = await git(repoPath, ['stash', 'apply', ref || 'stash@{0}']);
      return { ok: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT')) {
        return { ok: false, conflict: true, output: e.message };
      }
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashDrop', async (_, repoPath, ref) => {
    try {
      const out = await git(repoPath, ['stash', 'drop', ref || 'stash@{0}']);
      return { ok: true, output: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashShow', async (_, repoPath, ref) => {
    try {
      const out = await git(repoPath, ['stash', 'show', '-p', '--no-color', ref || 'stash@{0}']);
      return { diff: out };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
