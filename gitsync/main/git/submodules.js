const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:submodules', async (_, repoPath) => {
    const results = [];
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
}

module.exports = { register };
