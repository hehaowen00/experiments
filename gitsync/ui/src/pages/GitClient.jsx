import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import CategoryList from '../components/CategoryList';
import FormModal, { FormField } from '../components/FormModal';
import Icon from '../components/Icon';
import ItemCard from '../components/ItemCard';
import { showAlert, showConfirm, showConfirmTyped, showPrompt, showSettings } from '../components/Modal';
import { initHomeDir, shortenPath } from '../utils/path';

export default function GitClient(props) {
  const [state, setState] = createStore({
    repos: [],
    categories: [],
    searchQuery: '',
    formOpen: false,
    editingId: null,
    form: { name: '', path: '', categoryId: null, error: '' },
  });

  const [repoStatus, setRepoStatus] = createStore({});

  let dragRepoId = null;
  let dragCategoryId = null;
  const [dropIndicator, setDropIndicator] = createSignal(null);
  let searchRef;

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      searchRef?.focus();
    }
  }

  onMount(() => {
    loadList();
    document.addEventListener('keydown', onKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown);
  });

  async function loadList() {
    const [repos, cats] = await Promise.all([
      window.api.gitRepoList(),
      window.api.gitCatList(),
    ]);
    setState({ repos, categories: cats });
    loadRepoStatuses(repos);
  }

  async function loadRepoStatuses(repos) {
    for (const repo of repos) {
      window.api.gitStatus(repo.path).then((result) => {
        if (!result.error) {
          setRepoStatus(repo.id, {
            branch: result.branch,
            ahead: result.ahead,
            behind: result.behind,
          });
        }
      });
    }
  }

  function openNewForm() {
    setState({
      editingId: null,
      form: { name: '', path: '', categoryId: null, error: '' },
      formOpen: true,
    });
  }

  function openEditForm(repo) {
    setState({
      editingId: repo.id,
      form: { name: repo.name, path: repo.path, categoryId: repo.category_id, error: '' },
      formOpen: true,
    });
  }

  function closeForm() {
    setState('formOpen', false);
  }

  async function saveForm() {
    const f = state.form;
    const name = f.name.trim();
    if (!name) { setState('form', 'error', 'Name is required'); return; }
    if (!f.path) { setState('form', 'error', 'Repository path is required'); return; }

    const data = { name, path: f.path, category_id: f.categoryId };

    if (state.editingId) {
      await window.api.gitRepoUpdate(state.editingId, data);
    } else {
      await window.api.gitRepoCreate(data);
    }
    await loadList();
    setState('formOpen', false);
  }

  async function pickFolder() {
    const result = await window.api.gitPickFolder();
    if (!result) return;
    if (!result.isGit) {
      const init = await showConfirm(
        `"${result.path.split('/').pop()}" is not a git repository`,
        'Would you like to initialize it with git init?',
        { confirmLabel: 'Initialize', confirmStyle: 'primary' },
      );
      if (!init) return;
      const initResult = await window.api.gitInit(result.path);
      if (initResult.error) { setState('form', 'error', initResult.error); return; }
    }
    setState('form', 'path', result.path);
    if (!state.form.name) {
      const parts = result.path.split('/');
      setState('form', 'name', parts[parts.length - 1] || '');
    }
  }

  async function openRepo(repo) {
    await window.api.gitRepoTouchLastUsed(repo.id);
    props.onOpenGit({ savedId: repo.id, name: repo.name, path: repo.path, category_id: repo.category_id });
  }

  async function deleteRepo(e, id, name) {
    e.stopPropagation();
    if (await showConfirmTyped(`Delete "${name}"?`, name, 'This only removes it from the list.')) {
      await window.api.gitRepoDelete(id);
      loadList();
    }
  }

  async function togglePin(e, id, pinned) {
    e.stopPropagation();
    await window.api.gitRepoPin(id, !pinned);
    loadList();
  }

  // Categories
  async function addCategory() {
    const name = await showPrompt('New Category', '', '', 'Name');
    if (name && name.trim()) {
      await window.api.gitCatCreate(name.trim());
      loadList();
    }
  }

  async function renameCategory(e, id, oldName) {
    e.stopPropagation();
    const name = await showPrompt('Rename Category', oldName);
    if (name && name.trim()) {
      await window.api.gitCatRename(id, name.trim());
      loadList();
    }
  }

  async function removeCategory(e, id, name) {
    e.stopPropagation();
    if (await showConfirmTyped(`Delete category "${name}"?`, name, 'Repos will be uncategorized.')) {
      await window.api.gitCatDelete(id);
      loadList();
    }
  }

  async function toggleCategoryCollapse(id, collapsed) {
    await window.api.gitCatToggleCollapse(id, !collapsed);
    setState('categories', (c) => c.id === id, 'collapsed', (v) => v ? 0 : 1);
  }

  // Drag and drop - repos into categories
  function onDragStart(e, repoId) {
    dragRepoId = repoId;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
  }
  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragRepoId = null;
  }
  function onCategoryDragOver(e) {
    if (!dragRepoId) return;
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
    if (!dragRepoId) return;
    await window.api.gitRepoSetCategory(dragRepoId, categoryId);
    dragRepoId = null;
    loadList();
  }

  // Drag and drop - category reordering
  function onCategoryDragStart(e, catId) {
    dragCategoryId = catId;
    dragRepoId = null;
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

    if (!dragCategoryId || dragCategoryId === targetCatId) return;

    const cats = state.categories;
    const fromIdx = cats.findIndex((c) => c.id === dragCategoryId);
    let toIdx = cats.findIndex((c) => c.id === targetCatId);
    if (fromIdx === -1 || toIdx === -1) return;

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

    setState('categories', reordered);
    await window.api.gitCatReorder(reordered.map((c) => c.id));
    dragCategoryId = null;
  }

  function filterBySearch(list) {
    const q = state.searchQuery.toLowerCase().trim();
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q));
  }

  function uncategorizedRepos() {
    return filterBySearch(
      state.repos.filter((c) => !c.category_id).sort((a, b) => b.pinned - a.pinned),
    );
  }

  function reposInCategory(catId) {
    return filterBySearch(
      state.repos.filter((c) => c.category_id === catId).sort((a, b) => b.pinned - a.pinned),
    );
  }

  initHomeDir();

  const cardActions = [
    { label: 'Pin', onClick: (e, item) => togglePin(e, item.id, item.pinned), labelFn: (item) => item.pinned ? 'Unpin' : 'Pin' },
    { label: 'Edit', onClick: (e, item) => openEditForm(item) },
    { label: 'Delete', danger: true, onClick: (e, item) => deleteRepo(e, item.id, item.name) },
  ];

  function renderRepoCard(c) {
    const st = () => repoStatus[c.id];
    return (
      <ItemCard
        item={c}
        name={<>
          <Icon name="fa-solid fa-code-branch" /> {c.name}
          <Show when={st()}>
            <span class="git-repo-sync">
              <Show when={st().ahead > 0}>
                <span class="git-repo-ahead" title={`${st().ahead} ahead`}>{st().ahead}<Icon name="fa-solid fa-arrow-up" /></span>
              </Show>
              <Show when={st().behind > 0}>
                <span class="git-repo-behind" title={`${st().behind} behind`}>{st().behind}<Icon name="fa-solid fa-arrow-down" /></span>
              </Show>
            </span>
          </Show>
        </>}
        subtitle={shortenPath(c.path)}
        subtitleClass="git-repo-subtitle"
        actions={cardActions.map((a) => ({ ...a, label: a.labelFn ? a.labelFn(c) : a.label }))}
        onOpen={openRepo}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );
  }

  return (
    <div class="git-client" style={props.style}>
      <div class="landing-main" style={{ display: '' }}>
        <div class="landing-toolbar">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search"
            value={state.searchQuery}
            onInput={(e) => setState('searchQuery', e.target.value)}
          />
          <button class="btn btn-primary btn-sm" onClick={openNewForm} title="Add repository">
            <Icon name="fa-solid fa-plus" /> Add
          </button>
          <button class="btn btn-ghost btn-sm" onClick={addCategory} title="Add category">
            <Icon name="fa-solid fa-folder-plus" /> Category
          </button>
          <button class="btn btn-ghost btn-sm" onClick={showSettings} title="Settings">
            <Icon name="fa-solid fa-gear" />
          </button>
        </div>

        <CategoryList
          categories={state.categories}
          items={state.repos}
          renderItem={renderRepoCard}
          getItemsInCategory={reposInCategory}
          getUncategorizedItems={uncategorizedRepos}
          onToggleCollapse={toggleCategoryCollapse}
          onRenameCategory={renameCategory}
          onRemoveCategory={removeCategory}
          onCategoryDragOver={(e) => onCategoryDragOver(e)}
          onCategoryDragLeave={(e) => onCategoryDragLeave(e)}
          onCategoryDrop={(e, catId) => onCategoryDrop(e, catId)}
          onCategorySectionDragOver={onCategorySectionDragOver}
          onCategorySectionDrop={onCategorySectionDrop}
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
          emptyMessage="No repositories yet. Add one to get started."
          dropHint="Drop repos here"
        />
      </div>

      <Show when={state.formOpen}>
        <FormModal
          title={state.editingId ? 'Edit Repository' : 'Add Repository'}
          error={state.form.error}
          submitLabel={state.editingId ? 'Save' : 'Add'}
          onClose={closeForm}
          onSubmit={saveForm}
        >
          <FormField label="Name">
            <input type="text" value={state.form.name} onInput={(e) => setState('form', 'name', e.target.value)} placeholder="My Project" />
          </FormField>

          <FormField label="Path">
            <div style={{ display: 'flex', gap: '6px' }}>
              <input type="text" value={state.form.path} onInput={(e) => setState('form', 'path', e.target.value)} placeholder="Path to git repository" style={{ flex: 1 }} />
              <button class="btn btn-ghost btn-sm" onClick={pickFolder}>Browse</button>
            </div>
          </FormField>

        </FormModal>
      </Show>
    </div>
  );
}
