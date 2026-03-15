const { ipcMain } = require('electron');
const store = require('../store');
const { generateKSUID } = require('../ksuid');

function register({ mainWindow, git, gitRaw }) {
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
}

module.exports = { register };
