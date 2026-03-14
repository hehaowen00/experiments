import { createSignal, For, Show, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import CategoryList from '../components/CategoryList';
import FormModal, { FormField } from '../components/FormModal';
import Icon from '../components/Icon';
import ItemCard from '../components/ItemCard';
import { showAlert, showConfirm, showConfirmTyped, showPrompt } from '../components/Modal';
import Select from '../components/Select';
import { generateId } from '../helpers';

export default function DatabaseClient(props) {
  const [state, setState] = createStore({
    connections: [],
    categories: [],
    searchQuery: '',
    connecting: false,
    // Form modal
    formOpen: false,
    editingId: null,
    form: {
      name: '', type: 'postgres', host: 'localhost', port: '5432',
      user: 'postgres', password: '', showPassword: false, database: '', sqlitePath: '', categoryId: null, error: '',
    },
  });

  let dragConnectionId = null;
  let dragCategoryId = null;

  onMount(loadList);

  async function loadList() {
    const [conns, cats] = await Promise.all([
      window.api.dbConnList(),
      window.api.dbCatList(),
    ]);
    setState({ connections: conns, categories: cats });
  }

  // --- Form ---

  function openNewForm() {
    setState({
      editingId: null,
      form: {
        name: '', type: 'postgres', host: 'localhost', port: '5432',
        user: 'postgres', password: '', showPassword: false, database: '', sqlitePath: '', categoryId: null, error: '',
      },
      formOpen: true,
    });
  }

  function openEditForm(conn) {
    setState({
      editingId: conn.id,
      form: {
        name: conn.name,
        type: conn.type,
        host: conn.type === 'postgres' ? (conn.config.host || 'localhost') : 'localhost',
        port: conn.type === 'postgres' ? String(conn.config.port || 5432) : '5432',
        user: conn.type === 'postgres' ? (conn.config.user || '') : '',
        password: conn.type === 'postgres' ? (conn.config.password || '') : '',
        database: conn.type === 'postgres' ? (conn.config.database || '') : '',
        sqlitePath: conn.type === 'sqlite' ? (conn.config.path || '') : '',
        categoryId: conn.category_id,
        error: '',
      },
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

    const config = f.type === 'postgres'
      ? { host: f.host, port: f.port, user: f.user, password: f.password, database: f.database }
      : { path: f.sqlitePath };

    if (f.type === 'sqlite' && !config.path) { setState('form', 'error', 'File path is required'); return; }

    const data = { name, type: f.type, config, category_id: f.categoryId };

    if (state.editingId) {
      await window.api.dbConnUpdate(state.editingId, data);
    } else {
      await window.api.dbConnCreate(data);
    }
    await loadList();
    setState('formOpen', false);
  }

  async function pickSqliteFile() {
    const path = await window.api.dbPickSqliteFile();
    if (path) setState('form', 'sqlitePath', path);
  }

  // --- Connection actions ---

  async function connectTo(conn) {
    setState('connecting', true);
    const liveId = generateId();
    const config = JSON.parse(JSON.stringify(conn.config));
    const result = await window.api.dbConnect({
      id: liveId,
      type: conn.type,
      config,
    });
    setState('connecting', false);
    if (result.error) {
      showAlert('Connection Failed', result.error);
      return;
    }
    await window.api.dbConnTouchLastUsed(conn.id);
    props.onOpenDb({ liveId, savedId: conn.id, name: conn.name, type: conn.type, config });
  }

  async function deleteConnection(e, id, name) {
    e.stopPropagation();
    if (await showConfirmTyped(`Delete "${name}"?`, name, 'This cannot be undone.')) {
      await window.api.dbConnDelete(id);
      loadList();
    }
  }

  async function togglePin(e, id, pinned) {
    e.stopPropagation();
    await window.api.dbConnPin(id, !pinned);
    loadList();
  }

  // --- Categories ---

  async function addCategory() {
    const name = await showPrompt('New Category', '', '', 'Name');
    if (name && name.trim()) {
      await window.api.dbCatCreate(name.trim());
      loadList();
    }
  }

  async function renameCategory(e, id, oldName) {
    e.stopPropagation();
    const name = await showPrompt('Rename Category', oldName);
    if (name && name.trim()) {
      await window.api.dbCatRename(id, name.trim());
      loadList();
    }
  }

  async function removeCategory(e, id, name) {
    e.stopPropagation();
    if (await showConfirmTyped(`Delete category "${name}"?`, name, 'Connections will be uncategorized.')) {
      await window.api.dbCatDelete(id);
      loadList();
    }
  }

  async function toggleCategoryCollapse(id, collapsed) {
    await window.api.dbCatToggleCollapse(id, !collapsed);
    setState('categories', (c) => c.id === id, 'collapsed', (v) => v ? 0 : 1);
  }

  // Drag and drop (connections into categories)
  function onDragStart(e, connId) {
    dragConnectionId = connId;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
  }
  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragConnectionId = null;
  }
  function onCategoryDragOver(e) {
    if (!dragConnectionId) return;
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
    if (!dragConnectionId) return;
    await window.api.dbConnSetCategory(dragConnectionId, categoryId);
    dragConnectionId = null;
    loadList();
  }

  // Category reorder drag and drop
  const [dropIndicator, setDropIndicator] = createSignal(null);

  function onCategoryDragStart(e, catId) {
    dragCategoryId = catId;
    dragConnectionId = null;
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
    await window.api.dbCatReorder(reordered.map((c) => c.id));
    dragCategoryId = null;
  }

  // Filtering
  function filterBySearch(list) {
    const q = state.searchQuery.toLowerCase().trim();
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }

  function uncategorizedConnections() {
    return filterBySearch(
      state.connections.filter((c) => !c.category_id).sort((a, b) => b.pinned - a.pinned),
    );
  }

  function connectionsInCategory(catId) {
    return filterBySearch(
      state.connections.filter((c) => c.category_id === catId).sort((a, b) => b.pinned - a.pinned),
    );
  }

  let homeDir = '';
  window.api.homeDir().then((d) => { homeDir = d; });

  function shortenPath(p) {
    if (homeDir && p.startsWith(homeDir)) return '~' + p.slice(homeDir.length);
    return p;
  }

  function connSubtitle(conn) {
    if (conn.type === 'postgres') {
      const c = conn.config;
      const db = c.database ? `/${c.database}` : '';
      return `${c.host || 'localhost'}:${c.port || 5432}${db}`;
    }
    return shortenPath(conn.config.path || '');
  }

  const cardActions = [
    { label: 'Pin', onClick: (e, item) => togglePin(e, item.id, item.pinned), labelFn: (item) => item.pinned ? 'Unpin' : 'Pin' },
    { label: 'Edit', onClick: (e, item) => openEditForm(item) },
    { label: 'Delete', danger: true, onClick: (e, item) => deleteConnection(e, item.id, item.name) },
  ];

  function renderConnectionCard(c) {
    return (
      <ItemCard
        item={c}
        name={<><Icon name={c.type === 'postgres' ? 'fa-solid fa-server' : 'fa-solid fa-file'} /> {c.name}</>}
        subtitle={connSubtitle(c)}
        subtitleClass="db-conn-subtitle"
        actions={cardActions.map((a) => ({ ...a, label: a.labelFn ? a.labelFn(c) : a.label }))}
        onOpen={connectTo}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );
  }

  return (
    <div class="db-client" style={props.style}>
      <div class="landing-main" style={{ display: '' }}>
        <div class="landing-toolbar">
          <input
            type="text"
            placeholder="Search"
            value={state.searchQuery}
            onInput={(e) => setState('searchQuery', e.target.value)}
          />
          <button class="btn btn-primary btn-sm" onClick={openNewForm}>
            <Icon name="fa-solid fa-plus" /> New
          </button>
          <button class="btn btn-ghost btn-sm" onClick={addCategory}>
            <Icon name="fa-solid fa-folder-plus" /> Category
          </button>
        </div>

        <CategoryList
          categories={state.categories}
          items={state.connections}
          renderItem={renderConnectionCard}
          getItemsInCategory={connectionsInCategory}
          getUncategorizedItems={uncategorizedConnections}
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
          emptyMessage="No connections yet. Create one to get started."
          dropHint="Drop connections here"
        />
      </div>

      <Show when={state.formOpen}>
        <FormModal
          title={state.editingId ? 'Edit Connection' : 'New Connection'}
          error={state.form.error}
          submitLabel={state.editingId ? 'Save' : 'Create'}
          onClose={closeForm}
          onSubmit={saveForm}
        >
          <FormField label="Name">
            <input type="text" value={state.form.name} onInput={(e) => setState('form', 'name', e.target.value)} placeholder="My Database" />
          </FormField>

          <FormField label="Type">
            <Select
              class="select-full"
              value={state.form.type}
              options={[
                { value: 'postgres', label: 'PostgreSQL' },
                { value: 'sqlite', label: 'SQLite' },
              ]}
              onChange={(value) => setState('form', 'type', value)}
            />
          </FormField>

          <Show when={state.form.type === 'postgres'}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <FormField label="Host" style={{ flex: 1 }}>
                <input type="text" value={state.form.host} onInput={(e) => setState('form', 'host', e.target.value)} />
              </FormField>
              <FormField label="Port" style={{ width: '80px' }}>
                <input type="text" value={state.form.port} onInput={(e) => setState('form', 'port', e.target.value)} />
              </FormField>
            </div>
            <FormField label="User">
              <input type="text" value={state.form.user} onInput={(e) => setState('form', 'user', e.target.value)} />
            </FormField>
            <FormField label="Password">
              <input type={state.form.showPassword ? 'text' : 'password'} value={state.form.password} onInput={(e) => setState('form', 'password', e.target.value)} />
              <label style={{ display: 'flex', 'align-items': 'center', gap: '4px', 'margin-top': '4px', cursor: 'pointer', 'font-weight': 'normal' }}>
                <input type="checkbox" checked={state.form.showPassword} onChange={(e) => setState('form', 'showPassword', e.target.checked)} />
                Show password
              </label>
            </FormField>
            <FormField label="Database">
              <input type="text" value={state.form.database} onInput={(e) => setState('form', 'database', e.target.value)} placeholder="optional" />
            </FormField>
          </Show>

          <Show when={state.form.type === 'sqlite'}>
            <FormField label="File">
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="text" value={state.form.sqlitePath} onInput={(e) => setState('form', 'sqlitePath', e.target.value)} placeholder="Path to .db file" style={{ flex: 1 }} />
                <button class="btn btn-ghost btn-sm" onClick={pickSqliteFile}>Browse</button>
              </div>
            </FormField>
          </Show>

        </FormModal>
      </Show>
    </div>
  );
}
