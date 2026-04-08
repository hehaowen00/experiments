const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function register({ mainWindow, git, gitRaw }) {
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
        let filepath = line.substring(3);
        let origPath = null;
        if (filepath.startsWith('"') && filepath.endsWith('"')) {
          filepath = filepath.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        if ((xy[0] === 'R' || xy[0] === 'C') && filepath.includes(' -> ')) {
          const parts = filepath.split(' -> ');
          origPath = parts[0];
          filepath = parts[1];
          if (filepath.startsWith('"') && filepath.endsWith('"')) {
            filepath = filepath.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }
          if (origPath.startsWith('"') && origPath.endsWith('"')) {
            origPath = origPath.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }
        }
        const fullPath = path.join(repoPath, filepath);
        const isGitRepo = fs.existsSync(path.join(fullPath, '.git'));
        return { index: xy[0], working: xy[1], path: filepath, origPath, isGitRepo };
      });

      return { branch, upstream, ahead, behind, files };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:revParseHead', async (_, repoPath) => {
    try {
      return { hash: (await git(repoPath, ['rev-parse', 'HEAD'])).trim() };
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

  ipcMain.handle('git:diffRaw', async (_, repoPath, filepath, staged) => {
    try {
      const args = ['diff', '--no-color'];
      if (staged) args.push('--cached');
      if (filepath) args.push('--', filepath);
      const out = await git(repoPath, args);
      const lines = out.split('\n');
      const headerLines = [];
      for (const line of lines) {
        if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('old mode') || line.startsWith('new mode') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity') || line.startsWith('rename')) {
          headerLines.push(line);
        } else if (line.startsWith('@@')) {
          break;
        }
      }
      return { diff: out, header: headerLines.join('\n') };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:diffUntracked', async (_, repoPath, filepath) => {
    const result = await gitRaw(repoPath, ['diff', '--no-color', '--no-index', '--', '/dev/null', filepath]);
    if (result.stdout) {
      return { diff: result.stdout };
    }
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return { error: result.stderr || 'Failed to diff untracked file' };
    }
    return { diff: result.stdout || '(empty file)' };
  });

  ipcMain.handle('git:diffConflict', async (_, repoPath, filepath) => {
    try {
      const out = await git(repoPath, ['diff', '--no-color', '--', filepath]);
      return { diff: out };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('git:imageBlob', async (_, repoPath, filepath, ref) => {
    try {
      const ext = filepath.split('.').pop().toLowerCase();
      const mimeMap = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
        bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
      };
      const mime = mimeMap[ext];
      if (!mime) return { error: 'Not an image' };

      if (ref) {
        const { execFile } = require('child_process');
        const buf = await new Promise((resolve, reject) => {
          execFile('git', ['-C', repoPath, 'show', `${ref}:${filepath}`],
            { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 },
            (err, stdout) => err ? reject(err) : resolve(stdout));
        });
        return { data: `data:${mime};base64,${buf.toString('base64')}` };
      } else {
        const fullPath = path.join(repoPath, filepath);
        const buf = fs.readFileSync(fullPath);
        return { data: `data:${mime};base64,${buf.toString('base64')}` };
      }
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { register };
