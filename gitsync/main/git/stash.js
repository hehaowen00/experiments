const { ipcMain } = require('electron');

function register({ mainWindow, git, gitRaw }) {
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

  ipcMain.handle('git:listFiles', async (_, repoPath) => {
    try {
      const out = await git(repoPath, ['ls-files', '--others', '--exclude-standard']);
      const files = out.split('\n').filter(Boolean);
      return { files };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:stashShow', async (_, repoPath, ref) => {
    try {
      const stashRef = ref || 'stash@{0}';
      const files = [];

      function parseNumstat(out) {
        if (!out.trim()) return;
        for (const line of out.trim().split('\n')) {
          const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
          if (m) {
            const binary = m[1] === '-';
            files.push({
              filename: m[3],
              additions: binary ? 0 : parseInt(m[1]),
              deletions: binary ? 0 : parseInt(m[2]),
              binary,
            });
          }
        }
      }

      // Tracked file changes (fast plumbing command)
      const tracked = await git(repoPath, [
        'diff-tree',
        '-r',
        '--numstat',
        '--no-commit-id',
        `${stashRef}^`,
        stashRef,
      ]);
      parseNumstat(tracked);

      // Untracked files — stash^3 only exists if stashed with -u or -a
      try {
        const untracked = await git(repoPath, [
          'diff-tree',
          '-r',
          '--numstat',
          '--no-commit-id',
          '--root',
          `${stashRef}^3`,
        ]);
        parseNumstat(untracked);
      } catch {}

      return { files };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle(
    'git:stashShowFileDiff',
    async (_, repoPath, ref, filepath) => {
      try {
        const stashRef = ref || 'stash@{0}';
        // Try tracked diff first (stash^ vs stash)
        const out = await git(repoPath, [
          'diff',
          '--no-color',
          `${stashRef}^`,
          stashRef,
          '--',
          filepath,
        ]);
        if (out.trim()) return { diff: out };

        // File may be untracked (lives under stash^3)
        try {
          const untracked = await git(repoPath, [
            'diff',
            '--no-color',
            '--no-index',
            '/dev/null',
            filepath,
          ]);
          return { diff: untracked };
        } catch {
          // --no-index exits non-zero when files differ, use gitRaw
          const result = await gitRaw(repoPath, [
            'show',
            '--no-color',
            `${stashRef}^3:${filepath}`,
          ]);
          if (result.stdout) {
            // Synthesize a simple diff showing the full file as added
            const lines = result.stdout.split('\n');
            const header = `diff --git a/${filepath} b/${filepath}\nnew file mode 100644\n--- /dev/null\n+++ b/${filepath}\n@@ -0,0 +1,${lines.length} @@\n`;
            return {
              diff: header + lines.map((l) => '+' + l).join('\n'),
            };
          }
        }
        return { diff: out };
      } catch (e) {
        return { error: e.message };
      }
    },
  );
}

module.exports = { register };
