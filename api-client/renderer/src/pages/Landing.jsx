import { createSignal, For, onMount, Show } from 'solid-js';
import Modal, { showConfirm, showPrompt } from '../components/Modal';
import { formatLastUsed } from '../helpers';

export default function Landing(props) {
  const [collections, setCollections] = createSignal([]);
  const [categories, setCategories] = createSignal([]);
  const [newName, setNewName] = createSignal('');

  let dragCollectionId = null;
  let nameInputRef;

  async function load() {
    const [cols, cats] = await Promise.all([
      window.api.listCollections(),
      window.api.listCategories(),
    ]);
    setCollections(cols);
    setCategories(cats);
  }

  onMount(load);

  async function create() {
    const name = newName().trim();
    if (!name) {
      nameInputRef?.classList.remove('shake');
      void nameInputRef?.offsetWidth;
      nameInputRef?.classList.add('shake');
      nameInputRef?.focus();
      return;
    }
    await window.api.createCollection(name);
    setNewName('');
    load();
  }

  async function rename(id, oldName) {
    const name = await showPrompt('Rename collection:', oldName);
    if (name && name.trim()) {
      await window.api.renameCollection(id, name.trim());
      load();
    }
  }

  async function remove(id, name) {
    if (await showConfirm(`Delete "${name}"? This cannot be undone.`)) {
      await window.api.deleteCollection(id);
      load();
    }
  }

  async function togglePin(e, id, currentPinned) {
    e.stopPropagation();
    await window.api.pinCollection(id, !currentPinned);
    load();
  }

  // Category management
  async function addCategory() {
    const name = await showPrompt('Category name:', 'New Category');
    if (name && name.trim()) {
      await window.api.createCategory(name.trim());
      load();
    }
  }

  async function renameCategory(e, id, oldName) {
    e.stopPropagation();
    const name = await showPrompt('Rename category:', oldName);
    if (name && name.trim()) {
      await window.api.renameCategory(id, name.trim());
      load();
    }
  }

  async function removeCategory(e, id, name) {
    e.stopPropagation();
    let future = await showConfirm(`Delete category "${name}"?`, `Collections will be uncategorized.`)
    if (future) {
      await window.api.deleteCategory(id);
      load();
    }
  }

  async function toggleCategoryCollapse(id, collapsed) {
    await window.api.toggleCategoryCollapse(id, !collapsed);
    setCategories(prev => prev.map(c => c.id === id ? { ...c, collapsed: c.collapsed ? 0 : 1 } : c));
  }

  // Drag and drop
  function onDragStart(e, collectionId) {
    dragCollectionId = collectionId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', collectionId);
    e.currentTarget.classList.add('dragging');
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragCollectionId = null;
  }

  function onCategoryDragOver(e) {
    if (!dragCollectionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over-category');
  }

  function onCategoryDragLeave(e) {
    e.currentTarget.classList.remove('drag-over-category');
  }

  async function onCategoryDrop(e, categoryId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over-category');
    if (!dragCollectionId) return;
    await window.api.setCollectionCategory(dragCollectionId, categoryId);
    dragCollectionId = null;
    load();
  }

  function uncategorizedCollections() {
    return collections().filter(c => !c.category_id).sort((a, b) => b.pinned - a.pinned);
  }

  function collectionsInCategory(catId) {
    return collections().filter(c => c.category_id === catId).sort((a, b) => b.pinned - a.pinned);
  }

  function CollectionCard(props) {
    return (
      <div
        class={`collection-item ${props.c.pinned ? 'pinned' : ''}`}
        onClick={() => props.onOpen(props.c.id)}
        draggable="true"
        onDragStart={(e) => onDragStart(e, props.c.id)}
        onDragEnd={onDragEnd}
      >
        <span class="name">{props.c.name}</span>
        <span class="last-used">{formatLastUsed(props.c.last_used)}</span>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onClick={(e) => togglePin(e, props.c.id, props.c.pinned)} title={props.c.pinned ? 'Unpin' : 'Pin'}>
            {props.c.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button class="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); rename(props.c.id, props.c.name); }}>Rename</button>
          <button class="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); remove(props.c.id, props.c.name); }}>Delete</button>
        </div>
      </div>
    );
  }

  return (
    <div class="landing">
      <h1>API Client</h1>
      <p class="subtitle">Organize and send HTTP requests</p>
      <div class="toolbar">
        <input
          ref={nameInputRef}
          type="text"
          placeholder="New Collection"
          value={newName()}
          onInput={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
        <button class="btn btn-primary" onClick={create}>Create</button>
        <button class="btn btn-ghost" onClick={addCategory}>+ Category</button>
      </div>

      <div class="landing-content">
        <Show when={collections().length === 0 && categories().length === 0}>
          <div class="empty-state">No collections yet. Create one to get started.</div>
        </Show>

        {/* Category sections */}
        <For each={categories()}>
          {(cat) => (
            <div
              class="landing-section landing-category"
              onDragOver={onCategoryDragOver}
              onDragLeave={onCategoryDragLeave}
              onDrop={(e) => onCategoryDrop(e, cat.id)}
            >
              <div class="landing-section-header category-header" onClick={() => toggleCategoryCollapse(cat.id, cat.collapsed)}>
                <span innerHTML={cat.collapsed ? '&#9654;' : '&#9660;'} />
                <span class="category-name">{cat.name}</span>
                <div class="category-actions">
                  <button class="btn btn-ghost btn-sm" onClick={(e) => renameCategory(e, cat.id, cat.name)}>Rename</button>
                  <button class="btn btn-danger btn-sm" onClick={(e) => removeCategory(e, cat.id, cat.name)}>Delete</button>
                </div>
                <span class="category-count">{collectionsInCategory(cat.id).length}</span>
              </div>
              <Show when={!cat.collapsed}>
                <div class="collection-list">
                  <Show when={collectionsInCategory(cat.id).length === 0}>
                    <div class="empty-category">Drop collections here</div>
                  </Show>
                  <For each={collectionsInCategory(cat.id)}>
                    {(c) => <CollectionCard c={c} onOpen={props.onOpen} />}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>

        {/* Uncategorized section */}
        <Show when={uncategorizedCollections().length > 0}>
          <div
            class="landing-section"
            onDragOver={onCategoryDragOver}
            onDragLeave={onCategoryDragLeave}
            onDrop={(e) => onCategoryDrop(e, null)}
          >
            <Show when={categories().length > 0}>
              <div class="landing-section-header">Uncategorized</div>
            </Show>
            <div class="collection-list">
              <For each={uncategorizedCollections()}>
                {(c) => <CollectionCard c={c} onOpen={props.onOpen} />}
              </For>
            </div>
          </div>
        </Show>
      </div>
      <Modal />
    </div>
  );
}
