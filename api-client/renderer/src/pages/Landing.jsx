import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import Icon from '../components/Icon';
import Modal, {
  showConfirm,
  showPrompt,
  showSettings,
} from '../components/Modal';
import { formatLastUsed } from '../helpers';
import t from '../locale';
import DateTimeTool from '../pages/DateTimeTool';

export default function Landing(props) {
  const [activeNav, setActiveNav] = createSignal('api');
  const [sidebarOpen, setSidebarOpen] = createSignal(true);

  const mql = window.matchMedia('(max-aspect-ratio: 1/1)');
  function onLayoutChange(e) {
    if (e.matches) setSidebarOpen(false);
  }
  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      setSidebarOpen(!sidebarOpen());
    }
  }
  onMount(() => {
    mql.addEventListener('change', onLayoutChange);
    document.addEventListener('keydown', onKeyDown);
    if (mql.matches) setSidebarOpen(false);
  });
  onCleanup(() => {
    mql.removeEventListener('change', onLayoutChange);
    document.removeEventListener('keydown', onKeyDown);
  });

  const [collections, setCollections] = createSignal([]);
  const [categories, setCategories] = createSignal([]);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [dropIndicator, setDropIndicator] = createSignal(null); // { catId, position: 'above' | 'below' }

  let dragCollectionId = null;
  let dragCategoryId = null;

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
    const name = await showPrompt(
      t.landing.newCollectionModal.title,
      '',
      '',
      t.landing.newCollectionPlaceholder,
    );
    if (name && name.trim()) {
      await window.api.createCollection(name.trim());
      load();
    }
  }

  async function rename(id, oldName) {
    const name = await showPrompt(
      t.landing.renameCollectionModal.title,
      oldName,
    );
    if (name && name.trim()) {
      await window.api.renameCollection(id, name.trim());
      load();
    }
  }

  async function remove(id, name) {
    if (
      await showConfirm(
        t.landing.deleteCollectionModal.title(name),
        t.landing.deleteCollectionModal.description,
      )
    ) {
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
    const name = await showPrompt(
      t.landing.newCategoryModal.title,
      '',
      '',
      t.landing.newCategoryModal.placeholder,
    );
    if (name && name.trim()) {
      await window.api.createCategory(name.trim());
      load();
    }
  }

  async function importCollection() {
    const result = await window.api.importCollection();
    if (!result) return;
    if (result.error) return alert(result.error);
    load();
  }

  async function renameCategory(e, id, oldName) {
    e.stopPropagation();
    const name = await showPrompt(
      t.landing.renameCategoryModal.title,
      oldName,
      'Name',
    );
    if (name && name.trim()) {
      await window.api.renameCategory(id, name.trim());
      load();
    }
  }

  async function removeCategory(e, id, name) {
    e.stopPropagation();
    let future = await showConfirm(
      t.landing.deleteCategoryModal.title(name),
      t.landing.deleteCategoryModal.description,
    );
    if (future) {
      await window.api.deleteCategory(id);
      load();
    }
  }

  async function toggleCategoryCollapse(id, collapsed) {
    await window.api.toggleCategoryCollapse(id, !collapsed);
    setCategories((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, collapsed: c.collapsed ? 0 : 1 } : c,
      ),
    );
  }

  async function collapseAll() {
    const allCollapsed = categories().every((c) => c.collapsed);
    const value = allCollapsed ? 0 : 1;
    await Promise.all(
      categories().map((c) => window.api.toggleCategoryCollapse(c.id, value)),
    );
    setCategories((prev) => prev.map((c) => ({ ...c, collapsed: value })));
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

  // Category reorder drag and drop
  function onCategoryDragStart(e, catId) {
    dragCategoryId = catId;
    dragCollectionId = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', catId);
    e.currentTarget.closest('.landing-category').classList.add('dragging');
  }

  function onCategoryDragEnd(e) {
    e.currentTarget.closest('.landing-category')?.classList.remove('dragging');
    dragCategoryId = null;
    setDropIndicator(null);
  }

  function onCategorySectionDragOver(e) {
    if (!dragCategoryId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const catId = e.currentTarget.dataset.catId;
    setDropIndicator({ catId, position: e.clientY < mid ? 'above' : 'below' });
  }

  async function onCategorySectionDrop(e, targetCatId) {
    e.preventDefault();
    setDropIndicator(null);

    if (!dragCategoryId || dragCategoryId === targetCatId) {
      return;
    }

    const cats = categories();
    const fromIdx = cats.findIndex((c) => c.id === dragCategoryId);

    let toIdx = cats.findIndex((c) => c.id === targetCatId);
    if (fromIdx === -1 || toIdx === -1) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY >= mid && fromIdx < toIdx) {
      /* already correct */
    } else if (e.clientY >= mid && fromIdx > toIdx) {
      toIdx += 1;
    } else if (e.clientY < mid && fromIdx > toIdx) {
      /* already correct */
    } else if (e.clientY < mid && fromIdx < toIdx) {
      toIdx -= 1;
    }

    const reordered = [...cats];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    setCategories(reordered);
    await window.api.reorderCategories(reordered.map((c) => c.id));
    dragCategoryId = null;
  }

  function filterBySearch(list) {
    const q = searchQuery().toLowerCase().trim();
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }

  function uncategorizedCollections() {
    return filterBySearch(
      collections()
        .filter((c) => !c.category_id)
        .sort((a, b) => b.pinned - a.pinned),
    );
  }

  function collectionsInCategory(catId) {
    return filterBySearch(
      collections()
        .filter((c) => c.category_id === catId)
        .sort((a, b) => b.pinned - a.pinned),
    );
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
          <button
            class="btn btn-ghost btn-sm"
            onClick={(e) => togglePin(e, props.c.id, props.c.pinned)}
            title={props.c.pinned ? t.landing.unpinButton : t.landing.pinButton}
          >
            {props.c.pinned ? t.landing.unpinButton : t.landing.pinButton}
          </button>
          <button
            class="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              rename(props.c.id, props.c.name);
            }}
          >
            {t.landing.renameButton}
          </button>
          <button
            class="btn btn-danger btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              remove(props.c.id, props.c.name);
            }}
          >
            {t.landing.deleteButton}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      class={`landing ${sidebarOpen() ? 'landing-sidebar-open' : 'landing-sidebar-closed'}`}
    >
      {sidebarOpen() && (
        <div class="landing-sidebar">
          <div class="landing-sidebar-header">
            <span class="landing-sidebar-title">{t.app.name}</span>
            <button
              class="btn btn-ghost btn-sm landing-sidebar-close"
              onClick={() => setSidebarOpen(false)}
            >
              <Icon name="fa-solid fa-xmark" />
            </button>
          </div>
          <div class="landing-sidebar-nav">
            <button
              class={`landing-nav-item ${activeNav() === 'api' ? 'active' : ''}`}
              onClick={() => setActiveNav('api')}
            >
              <Icon name="fa-solid fa-paper-plane" />
              <span>{t.landing.nav.apiClient}</span>
            </button>
            <button
              class={`landing-nav-item ${activeNav() === 'datetime' ? 'active' : ''}`}
              onClick={() => setActiveNav('datetime')}
            >
              <Icon name="fa-solid fa-clock" />
              <span>{t.landing.nav.dateTime}</span>
            </button>
            <button class="landing-nav-item" disabled>
              <Icon name="fa-solid fa-key" />
              <span>{t.landing.nav.auth}</span>
            </button>
            <button class="landing-nav-item" disabled>
              <Icon name="fa-solid fa-clock-rotate-left" />
              <span>{t.landing.nav.history}</span>
            </button>
          </div>
          <div class="landing-sidebar-footer">
            <button class="btn btn-ghost btn-sm" onClick={() => showSettings()}>
              <Icon name="fa-solid fa-gear" /> {t.landing.settingsButton}
            </button>
          </div>
        </div>
      )}

      <div
        class="landing-main"
        style={{ display: activeNav() === 'api' ? '' : 'none' }}
      >
        <div class="landing-toolbar">
          <Show when={!sidebarOpen()}>
            <button
              class="btn btn-ghost btn-sm"
              onClick={() => setSidebarOpen(true)}
            >
              <Icon name="fa-solid fa-bars" />
            </button>
          </Show>
          <input
            type="text"
            placeholder={t.landing.searchPlaceholder}
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.target.value)}
          />
          <button class="btn btn-primary btn-sm" onClick={create}>
            <Icon name="fa-solid fa-plus" /> {t.landing.createButton}
          </button>
          <button class="btn btn-ghost btn-sm" onClick={importCollection}>
            <Icon name="fa-solid fa-file-import" /> {t.landing.importButton}
          </button>
          <button class="btn btn-ghost btn-sm" onClick={addCategory}>
            <Icon name="fa-solid fa-folder-plus" />{' '}
            {t.landing.addCategoryButton}
          </button>
          <Show when={categories().length > 0}>
            <button
              class="btn btn-ghost btn-sm btn-collapse-all"
              onClick={collapseAll}
            >
              <Icon
                name={
                  categories().every((c) => c.collapsed)
                    ? 'fa-solid fa-angles-down'
                    : 'fa-solid fa-angles-up'
                }
              />{' '}
              {categories().every((c) => c.collapsed)
                ? t.landing.expandAllButton
                : t.landing.collapseAllButton}
            </button>
          </Show>
        </div>

        <div class="landing-content">
          <Show when={collections().length === 0 && categories().length === 0}>
            <div class="empty-state">{t.landing.emptyState}</div>
          </Show>

          {/* Category sections */}
          <For each={categories()}>
            {(cat) => (
              <div
                class="landing-section landing-category"
                classList={{
                  'cat-drop-above':
                    dropIndicator()?.catId === String(cat.id) &&
                    dropIndicator()?.position === 'above',
                  'cat-drop-below':
                    dropIndicator()?.catId === String(cat.id) &&
                    dropIndicator()?.position === 'below',
                }}
                data-cat-id={cat.id}
                onDragOver={(e) => {
                  onCategoryDragOver(e);
                  onCategorySectionDragOver(e);
                }}
                onDragLeave={(e) => {
                  onCategoryDragLeave(e);
                }}
                onDrop={(e) => {
                  onCategoryDrop(e, cat.id);
                  onCategorySectionDrop(e, cat.id);
                }}
              >
                <div
                  class="landing-section-header category-header"
                  onClick={() => toggleCategoryCollapse(cat.id, cat.collapsed)}
                >
                  <span
                    class="category-drag-handle"
                    draggable="true"
                    onDragStart={(e) => onCategoryDragStart(e, cat.id)}
                    onDragEnd={onCategoryDragEnd}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="fa-solid fa-grip-vertical" />
                  </span>
                  <Icon
                    name={
                      cat.collapsed
                        ? 'fa-solid fa-caret-right'
                        : 'fa-solid fa-caret-down'
                    }
                  />
                  <span class="category-name">{cat.name}</span>
                  <div class="category-actions">
                    <button
                      class="btn btn-ghost btn-sm"
                      onClick={(e) => renameCategory(e, cat.id, cat.name)}
                    >
                      <Icon name="fa-solid fa-pen" /> {t.landing.renameButton}
                    </button>
                    <button
                      class="btn btn-danger btn-sm"
                      onClick={(e) => removeCategory(e, cat.id, cat.name)}
                    >
                      <Icon name="fa-solid fa-trash" /> {t.landing.deleteButton}
                    </button>
                  </div>
                  <span class="category-count">
                    {collectionsInCategory(cat.id).length}
                  </span>
                </div>
                <Show when={!cat.collapsed}>
                  <div class="collection-list">
                    <Show when={collectionsInCategory(cat.id).length === 0}>
                      <div class="empty-category">{t.landing.dropHint}</div>
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
          <Show when={categories().length > 0}>
            <div
              class="landing-section"
              onDragOver={onCategoryDragOver}
              onDragLeave={onCategoryDragLeave}
              onDrop={(e) => onCategoryDrop(e, null)}
            >
              <div class="landing-section-header">
                {t.landing.uncategorized}
              </div>
              <div class="collection-list">
                <Show when={uncategorizedCollections().length === 0}>
                  <div class="empty-category">{t.landing.dropHint}</div>
                </Show>
                <For each={uncategorizedCollections()}>
                  {(c) => <CollectionCard c={c} onOpen={props.onOpen} />}
                </For>
              </div>
            </div>
          </Show>
          <Show when={categories().length === 0}>
            <div class="collection-list">
              <For each={uncategorizedCollections()}>
                {(c) => <CollectionCard c={c} onOpen={props.onOpen} />}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <DateTimeTool
        style={{ display: activeNav() === 'datetime' ? '' : 'none' }}
        sidebarOpen={sidebarOpen()}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen())}
      />
      <Modal />
    </div>
  );
}
