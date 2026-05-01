const { ipcMain } = require('electron');

async function getUnmergedStages(repoPath, git, filepath) {
  const out = await git(repoPath, ['ls-files', '-u', '-z', '--', filepath]);
  const stages = new Set();
  for (const entry of out.split('\0')) {
    if (!entry) continue;
    const match = entry.match(/^\d+\s+[0-9a-fA-F]+\s+([123])\t/);
    if (match) stages.add(Number(match[1]));
  }
  return stages;
}

async function resolveSide(repoPath, git, filepaths, side) {
  if (!Array.isArray(filepaths) || filepaths.length === 0) return;
  const stage = side === 'ours' ? 2 : 3;
  for (const filepath of filepaths) {
    const stages = await getUnmergedStages(repoPath, git, filepath);
    if (stages.size === 0) {
      await git(repoPath, ['add', '--', filepath]);
    } else if (stages.has(stage)) {
      await git(repoPath, ['checkout', `--${side}`, '--', filepath]);
      await git(repoPath, ['add', '--', filepath]);
    } else {
      await git(repoPath, ['rm', '-f', '--ignore-unmatch', '--', filepath]);
    }
  }
}

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('git:resolveOurs', async (_, repoPath, filepaths) => {
    try {
      await resolveSide(repoPath, git, filepaths, 'ours');
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('git:resolveTheirs', async (_, repoPath, filepaths) => {
    try {
      await resolveSide(repoPath, git, filepaths, 'theirs');
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  });
}

module.exports = { register };
