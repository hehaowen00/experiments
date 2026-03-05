const collectionsEl = document.getElementById('collections');
const newNameInput = document.getElementById('new-name');
const createBtn = document.getElementById('create-btn');

// --- Custom modals ---

function showPrompt(title, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const input = document.getElementById('modal-input');
    const titleEl = document.getElementById('modal-title');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');

    titleEl.textContent = title;
    input.value = defaultValue || '';
    overlay.classList.add('visible');
    input.focus();
    input.select();

    function cleanup() {
      overlay.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }
    function onOk() { cleanup(); resolve(input.value); }
    function onCancel() { cleanup(); resolve(null); }
    function onKey(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function showConfirm(title) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay');
    const titleEl = document.getElementById('confirm-title');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    titleEl.textContent = title;
    overlay.classList.add('visible');
    okBtn.focus();

    function cleanup() {
      overlay.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('keydown', onKey);
    }
    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }
    function onKey(e) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('keydown', onKey);
  });
}

// --- Render ---

async function render() {
  const collections = await window.api.listCollections();
  if (collections.length === 0) {
    collectionsEl.innerHTML = '<div class="empty-state">No collections yet. Create one to get started.</div>';
    return;
  }
  collectionsEl.innerHTML = collections.map(c => `
    <div class="collection-item" data-id="${c.id}">
      <span class="name">${escapeHtml(c.name)}</span>
      <div class="actions">
        <button class="btn btn-ghost btn-sm rename-btn" data-id="${c.id}" data-name="${escapeAttr(c.name)}">Rename</button>
        <button class="btn btn-danger btn-sm delete-btn" data-id="${c.id}" data-name="${escapeAttr(c.name)}">Delete</button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

createBtn.addEventListener('click', async () => {
  const name = newNameInput.value.trim();
  if (!name) return;
  await window.api.createCollection(name);
  newNameInput.value = '';
  render();
});

newNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createBtn.click();
});

collectionsEl.addEventListener('click', async (e) => {
  const renameBtn = e.target.closest('.rename-btn');
  if (renameBtn) {
    e.stopPropagation();
    const id = renameBtn.dataset.id;
    const oldName = renameBtn.dataset.name;
    const newName = await showPrompt('Rename collection:', oldName);
    if (newName && newName.trim()) {
      await window.api.renameCollection(id, newName.trim());
      render();
    }
    return;
  }

  const deleteBtn = e.target.closest('.delete-btn');
  if (deleteBtn) {
    e.stopPropagation();
    const id = deleteBtn.dataset.id;
    const name = deleteBtn.dataset.name;
    if (await showConfirm(`Delete "${name}"? This cannot be undone.`)) {
      await window.api.deleteCollection(id);
      render();
    }
    return;
  }

  const item = e.target.closest('.collection-item');
  if (item) {
    window.location.href = `collection.html?id=${item.dataset.id}`;
  }
});

render();
