import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import CategoryList from '../components/CategoryList';
import Icon from '../components/Icon';
import ItemCard from '../components/ItemCard';
import {
  showConfirm,
  showConfirmTyped,
  showPrompt,
} from '../components/Modal';
import { formatLastUsed } from '../helpers';
import t from '../locale';
import DatabaseClient from '../pages/DatabaseClient';
import DateTimeTool from '../pages/DateTimeTool';
import Drop from '../pages/Drop';

export default function Landing(props) {
  const activeNav = props.activeNav;

  let searchRef;

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      searchRef?.focus();
    }
  }

  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
  });

  onCleanup(() => {
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
      await showConfirmTyped(
        t.landing.deleteCollectionModal.title(name),
        name,
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

  async function importFromDb() {
    const result = await window.api.importFromDb();
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
    let future = await showConfirmTyped(
      t.landing.deleteCategoryModal.title(name),
      name,
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

  const cardActions = [
    { label: 'Pin', onClick: (e, item) => togglePin(e, item.id, item.pinned), labelFn: (item) => item.pinned ? t.landing.unpinButton : t.landing.pinButton },
    { label: 'Rename', onClick: (e, item) => rename(item.id, item.name) },
    { label: 'Delete', danger: true, onClick: (e, item) => remove(item.id, item.name) },
  ];

  function renderCollectionCard(c) {
    return (
      <ItemCard
        item={c}
        name={c.name}
        subtitle={formatLastUsed(c.last_used)}
        actions={cardActions.map((a) => ({ ...a, label: a.labelFn ? a.labelFn(c) : a.label }))}
        onOpen={(item) => props.onOpen(item.id)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );
  }

  return (
    <div class="landing" style={props.style}>
      <div
        class="landing-main"
        style={{ display: activeNav() === 'api' ? '' : 'none' }}
      >
        <div class="landing-toolbar">
          <input
            ref={searchRef}
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
          <button class="btn btn-ghost btn-sm" onClick={importFromDb}>
            <Icon name="fa-solid fa-database" /> {t.landing.importDbButton}
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

        <CategoryList
          categories={categories()}
          items={collections()}
          renderItem={renderCollectionCard}
          getItemsInCategory={collectionsInCategory}
          getUncategorizedItems={uncategorizedCollections}
          onToggleCollapse={toggleCategoryCollapse}
          onRenameCategory={renameCategory}
          onRemoveCategory={removeCategory}
          onCategoryDragOver={(e, cat) => {
            onCategoryDragOver(e);
            if (cat) onCategorySectionDragOver(e);
          }}
          onCategoryDragLeave={(e) => onCategoryDragLeave(e)}
          onCategoryDrop={(e, catId) => {
            onCategoryDrop(e, catId);
            if (catId !== null) onCategorySectionDrop(e, catId);
          }}
          categoryClassList={(cat) => ({
            'cat-drop-above':
              dropIndicator()?.catId === String(cat.id) &&
              dropIndicator()?.position === 'above',
            'cat-drop-below':
              dropIndicator()?.catId === String(cat.id) &&
              dropIndicator()?.position === 'below',
          })}
          categoryExtras={(cat) => (
            <span
              class="category-drag-handle"
              draggable="true"
              onDragStart={(e) => onCategoryDragStart(e, cat.id)}
              onDragEnd={onCategoryDragEnd}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="fa-solid fa-grip-vertical" />
            </span>
          )}
          emptyMessage={t.landing.emptyState}
          dropHint={t.landing.dropHint}
        />
      </div>
      <DateTimeTool
        style={{ display: activeNav() === 'datetime' ? '' : 'none' }}
      />
      <DatabaseClient
        style={{ display: activeNav() === 'database' ? '' : 'none' }}
        onOpenDb={props.onOpenDb}
      />
      <Drop
        style={{ display: activeNav() === 'drop' ? '' : 'none' }}
      />
    </div>
  );
}
