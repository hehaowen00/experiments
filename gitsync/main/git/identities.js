const { ipcMain } = require('electron');
const store = require('../store');
const { generateKSUID } = require('../ksuid');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('identity:list', () => {
    return store.getDb()
      .prepare('SELECT id, name, email FROM git_identities ORDER BY rowid ASC')
      .all();
  });

  ipcMain.handle('identity:create', (_, data) => {
    const id = generateKSUID();
    store.getDb().prepare(
      'INSERT INTO git_identities (id, name, email) VALUES (?, ?, ?)',
    ).run(id, data.name, data.email);
    return { id, name: data.name, email: data.email };
  });

  ipcMain.handle('identity:update', (_, id, data) => {
    store.getDb().prepare(
      'UPDATE git_identities SET name = ?, email = ? WHERE id = ?',
    ).run(data.name, data.email, id);
    return true;
  });

  ipcMain.handle('identity:delete', (_, id) => {
    store.getDb().prepare('UPDATE git_repos SET identity_id = NULL WHERE identity_id = ?').run(id);
    store.getDb().prepare('DELETE FROM git_identities WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('identity:getForRepo', (_, repoId) => {
    const repo = store.getDb().prepare('SELECT identity_id FROM git_repos WHERE id = ?').get(repoId);
    if (!repo || !repo.identity_id) return null;
    return store.getDb().prepare('SELECT id, name, email FROM git_identities WHERE id = ?').get(repo.identity_id) || null;
  });

  ipcMain.handle('identity:setForRepo', async (_, repoId, identityId, repoPath) => {
    store.getDb().prepare('UPDATE git_repos SET identity_id = ? WHERE id = ?').run(identityId || null, repoId);
    // Apply to local git config
    if (identityId) {
      const identity = store.getDb().prepare('SELECT name, email FROM git_identities WHERE id = ?').get(identityId);
      if (identity) {
        await git(repoPath, ['config', 'user.name', identity.name]);
        await git(repoPath, ['config', 'user.email', identity.email]);
      }
    } else {
      // Unset local config
      try { await git(repoPath, ['config', '--unset', 'user.name']); } catch {}
      try { await git(repoPath, ['config', '--unset', 'user.email']); } catch {}
    }
    return true;
  });

  ipcMain.handle('git:getLocalIdentity', async (_, repoPath) => {
    try {
      const name = (await git(repoPath, ['config', '--local', 'user.name'])).trim();
      const email = (await git(repoPath, ['config', '--local', 'user.email'])).trim();
      return { name, email };
    } catch {
      return { name: '', email: '' };
    }
  });

  ipcMain.handle('git:getGlobalIdentity', async () => {
    const os = require('os');
    const homeDir = os.homedir();
    try {
      const name = (await git(homeDir, ['config', '--global', 'user.name'])).trim();
      const email = (await git(homeDir, ['config', '--global', 'user.email'])).trim();
      return { name, email };
    } catch {
      return { name: '', email: '' };
    }
  });

  ipcMain.handle('identity:import', (_, data) => {
    if (!data.name || !data.email) return null;
    const existing = store.getDb().prepare(
      'SELECT id FROM git_identities WHERE name = ? AND email = ?',
    ).get(data.name, data.email);
    if (existing) return existing;
    const id = generateKSUID();
    store.getDb().prepare(
      'INSERT INTO git_identities (id, name, email) VALUES (?, ?, ?)',
    ).run(id, data.name, data.email);
    return { id, name: data.name, email: data.email };
  });
}

module.exports = { register };
