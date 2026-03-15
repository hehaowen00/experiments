const { ipcMain } = require('electron');
const store = require('../store');
const { generateKSUID } = require('../ksuid');

function register({ mainWindow, git, gitRaw }) {
  ipcMain.handle('gitRepo:list', () => {
    return store.getDb()
      .prepare('SELECT id, name, path, pinned, category_id, last_used FROM git_repos ORDER BY last_used DESC')
      .all();
  });

  ipcMain.handle('gitRepo:create', async (_, data) => {
    const id = generateKSUID();

    // Auto-assign global git identity if one matches
    let identityId = null;
    try {
      const os = require('os');
      const name = (await git(os.homedir(), ['config', '--global', 'user.name'])).trim();
      const email = (await git(os.homedir(), ['config', '--global', 'user.email'])).trim();
      if (name && email) {
        // Import if not already saved
        let row = store.getDb().prepare(
          'SELECT id FROM git_identities WHERE name = ? AND email = ?',
        ).get(name, email);
        if (!row) {
          const iid = generateKSUID();
          store.getDb().prepare(
            'INSERT INTO git_identities (id, name, email) VALUES (?, ?, ?)',
          ).run(iid, name, email);
          row = { id: iid };
        }
        identityId = row.id;
      }
    } catch {}

    store.getDb().prepare(
      "INSERT INTO git_repos (id, name, path, category_id, identity_id, last_used) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    ).run(id, data.name, data.path, data.category_id || null, identityId);
    return { id, name: data.name, path: data.path, category_id: data.category_id || null, identity_id: identityId, pinned: 0 };
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
}

module.exports = { register };
