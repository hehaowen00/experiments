const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:log', async (_, repoPath, count, allBranches, branchName, skip, search, topoOrder) => {
    const fmt = '--pretty=format:%H%x00%h%x00%P%x00%an%x00%at%x00%s%x00%D';
    const parseCommits = (out) => {
      if (!out.trim()) return [];
      return out.trim().split('\n').map(line => {
        const [hash, short, parents, author, timestamp, subject, refs] = line.split('\x00');
        return {
          hash, short,
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          author,
          date: parseInt(timestamp) * 1000,
          subject, refs: refs || undefined,
        };
      });
    };

    try {
      const args = ['log', `--max-count=${count || 50}`, topoOrder ? '--topo-order' : '--date-order', fmt];
      if (skip) args.push(`--skip=${skip}`);
      if (allBranches) {
        // One lane per branch: include all local branches + tags, plus
        // remote-tracking refs only when they have no local counterpart.
        // Collapses local/remote pairs (e.g. main + origin/main) into a
        // single tip even when they've diverged.
        args.push('--branches', '--tags');
        try {
          const localOut = await git(repoPath, [
            'for-each-ref', '--format=%(refname:short)', 'refs/heads/',
          ]);
          const localNames = new Set(
            localOut.trim().split('\n').filter(Boolean),
          );
          const remoteOut = await git(repoPath, [
            'for-each-ref', '--format=%(refname:short)', 'refs/remotes/',
          ]);
          for (const ref of remoteOut.trim().split('\n').filter(Boolean)) {
            if (ref.endsWith('/HEAD')) continue;
            const slash = ref.indexOf('/');
            const branchPart = slash >= 0 ? ref.slice(slash + 1) : ref;
            if (!localNames.has(branchPart)) {
              args.push(ref);
            }
          }
        } catch {}
      } else if (branchName) {
        args.push(branchName);
      }
      if (search && search.trim()) {
        const q = search.trim();
        const isHash = /^[0-9a-f]{4,40}$/i.test(q);
        // Single git process: match message OR author
        const searchArgs = [...args, `--grep=${q}`, `--author=${q}`, '--or', '-i'];
        const searches = [git(repoPath, searchArgs).catch(() => '')];
        if (isHash) {
          searches.push(git(repoPath, ['log', '--max-count=1', fmt, q]).catch(() => ''));
        }
        const results = await Promise.all(searches);
        const seen = new Set();
        const merged = [];
        for (const out of results) {
          for (const c of parseCommits(out)) {
            if (!seen.has(c.hash)) {
              seen.add(c.hash);
              merged.push(c);
            }
          }
        }
        if (isHash) merged.sort((a, b) => b.date - a.date);
        return { commits: merged };
      }
      const out = await git(repoPath, args);
      const commits = parseCommits(out);

      // Include stashes only on the first page when showing all branches.
      // Stashes are fetched explicitly so we can strip their internal helper
      // parents (index / untracked) that would otherwise create phantom lanes
      // in the graph.
      if (allBranches && !skip) {
        try {
          const stashListOut = await git(repoPath, [
            'stash', 'list', '--pretty=format:%H%x00%gd',
          ]);
          const stashEntries = stashListOut
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [hash, ref] = line.split('\x00');
              return { hash, ref };
            });
          if (stashEntries.length > 0) {
            const refByHash = new Map(stashEntries.map((s) => [s.hash, s.ref]));
            const stashOut = await git(repoPath, [
              'log', '--no-walk', fmt, ...stashEntries.map((s) => s.hash),
            ]);
            for (const c of parseCommits(stashOut)) {
              c.parents = c.parents.slice(0, 1);
              c.isStash = true;
              const label = refByHash.get(c.hash);
              const existing = c.refs ? c.refs.split(',').map((r) => r.trim()) : [];
              if (label && !existing.some((r) => r === label || r === 'refs/stash')) {
                existing.unshift(label);
              }
              c.refs = existing.join(', ') || undefined;
              commits.push(c);
            }
            commits.sort((a, b) => b.date - a.date);
          }
        } catch {}
      }

      return { commits };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:fileLog', async (_, repoPath, filepath, count, skip) => {
    const fmt = '--pretty=format:%H%x00%h%x00%P%x00%an%x00%at%x00%s%x00%D';
    try {
      const args = ['log', `--max-count=${count || 50}`, '--follow', fmt];
      if (skip) args.push(`--skip=${skip}`);
      args.push('--', filepath);
      const out = await git(repoPath, args);
      if (!out.trim()) return { commits: [] };
      const commits = out.trim().split('\n').map(line => {
        const [hash, short, parents, author, timestamp, subject, refs] = line.split('\x00');
        return {
          hash, short,
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          author,
          date: parseInt(timestamp) * 1000,
          subject, refs: refs || undefined,
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
