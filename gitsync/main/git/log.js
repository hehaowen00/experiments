const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:log', async (_, repoPath, count, allBranches, branchName, skip, search, topoOrder) => {
    const fmt = '--pretty=format:%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D';
    const parseCommits = (out) => {
      if (!out.trim()) return [];
      return out.trim().split('\n').map(line => {
        const [hash, short, parents, author, email, timestamp, subject, refs] = line.split('\x00');
        return {
          hash, short,
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          author, email,
          date: new Date(parseInt(timestamp) * 1000).toISOString(),
          subject, refs,
        };
      });
    };

    try {
      // If search looks like a commit hash, try exact lookup first
      if (search && /^[0-9a-f]{4,40}$/i.test(search.trim())) {
        try {
          const out = await git(repoPath, ['log', '--max-count=1', fmt, search.trim()]);
          const exact = parseCommits(out);
          if (exact.length) return { commits: exact };
        } catch {}
      }

      const args = ['log', `--max-count=${count || 50}`, topoOrder ? '--topo-order' : '--date-order', fmt];
      if (skip) args.push(`--skip=${skip}`);
      if (allBranches) {
        args.push('--all', '--exclude=refs/stash');
      } else if (branchName) {
        args.push(branchName);
      }
      if (search && search.trim()) {
        const q = search.trim();
        // Run two searches and merge: one by message, one by author
        const baseArgs = args.slice();
        const msgArgs = [...baseArgs, `--grep=${q}`, '-i'];
        const authorArgs = [...baseArgs, `--author=${q}`, '-i'];
        const [msgOut, authorOut] = await Promise.all([
          git(repoPath, msgArgs).catch(() => ''),
          git(repoPath, authorArgs).catch(() => ''),
        ]);
        const seen = new Set();
        const merged = [];
        for (const c of [...parseCommits(msgOut), ...parseCommits(authorOut)]) {
          if (!seen.has(c.hash)) {
            seen.add(c.hash);
            merged.push(c);
          }
        }
        merged.sort((a, b) => new Date(b.date) - new Date(a.date));
        return { commits: merged };
      }
      const out = await git(repoPath, args);
      return { commits: parseCommits(out) };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:fileLog', async (_, repoPath, filepath, count, skip) => {
    const fmt = '--pretty=format:%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D';
    try {
      const args = ['log', `--max-count=${count || 50}`, '--follow', fmt];
      if (skip) args.push(`--skip=${skip}`);
      args.push('--', filepath);
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

  ipcMain.handle('git:fileShowAtCommit', async (_, repoPath, hash, filepath) => {
    try {
      const diff = await git(repoPath, ['show', '--format=', '--patch', hash, '--', filepath]);
      return { diff };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
