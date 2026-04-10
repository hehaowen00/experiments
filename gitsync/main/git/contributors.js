const { ipcMain } = require('electron');

function parseShortstat(out) {
  let additions = 0;
  let deletions = 0;
  let files = 0;
  for (const line of out.split('\n')) {
    const fm = line.match(/(\d+) files? changed/);
    const am = line.match(/(\d+) insertions?\(\+\)/);
    const dm = line.match(/(\d+) deletions?\(-\)/);
    if (fm) files += parseInt(fm[1]);
    if (am) additions += parseInt(am[1]);
    if (dm) deletions += parseInt(dm[1]);
  }
  return { additions, deletions, files };
}

function register({ mainWindow, git, gitRaw }) {
  // Get contributor summary with line stats
  ipcMain.handle('git:contributors', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['shortlog', '-sne', '--all', 'HEAD']);
      const contributors = out.trim().split('\n').filter(Boolean).map(line => {
        const match = line.trim().match(/^(\d+)\t(.+)\s<(.+)>$/);
        if (!match) return null;
        return {
          commits: parseInt(match[1]),
          name: match[2].trim(),
          email: match[3],
          additions: 0,
          deletions: 0,
          files: 0,
        };
      }).filter(Boolean);

      // Fetch line stats for each contributor in parallel (limit concurrency)
      const batch = contributors.slice(0, 50);
      await Promise.all(batch.map(async (c) => {
        try {
          const stat = await git(repoPath, [
            'log', '--all', `--author=<${c.email}>`, '--no-merges',
            '--shortstat', '--pretty=format:',
          ]);
          const { additions, deletions, files } = parseShortstat(stat);
          c.additions = additions;
          c.deletions = deletions;
          c.files = files;
        } catch {}
      }));

      return { contributors };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Get weekly commit activity for a contributor (last 52 weeks)
  ipcMain.handle('git:contributorActivity', async (_, repoPath, email) => {
    try {
      const since = new Date(Date.now() - 52 * 7 * 24 * 60 * 60 * 1000).toISOString();
      const args = ['log', '--all', `--author=${email}`, `--since=${since}`, '--format=%at'];
      const out = await git(repoPath, args);
      const weeks = new Array(52).fill(0);
      const now = Date.now();
      for (const line of out.trim().split('\n').filter(Boolean)) {
        const ts = parseInt(line) * 1000;
        const weeksAgo = Math.floor((now - ts) / (7 * 24 * 60 * 60 * 1000));
        if (weeksAgo >= 0 && weeksAgo < 52) {
          weeks[51 - weeksAgo]++;
        }
      }
      return { weeks };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Get overall repo activity (last 52 weeks)
  ipcMain.handle('git:repoActivity', async (_, repoPath) => {
    try {
      const since = new Date(Date.now() - 52 * 7 * 24 * 60 * 60 * 1000).toISOString();
      const args = ['log', '--all', `--since=${since}`, '--format=%at'];
      const out = await git(repoPath, args);
      const weeks = new Array(52).fill(0);
      const now = Date.now();
      for (const line of out.trim().split('\n').filter(Boolean)) {
        const ts = parseInt(line) * 1000;
        const weeksAgo = Math.floor((now - ts) / (7 * 24 * 60 * 60 * 1000));
        if (weeksAgo >= 0 && weeksAgo < 52) {
          weeks[51 - weeksAgo]++;
        }
      }
      return { weeks };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
