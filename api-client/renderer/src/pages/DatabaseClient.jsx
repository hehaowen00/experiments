import { For, Show, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import FormModal, { FormField } from '../components/FormModal';
import Icon from '../components/Icon';
import { showConfirm, showPrompt } from '../components/Modal';
import { generateId } from '../helpers';

export default function DatabaseClient(props) {
  const [state, setState] = createStore({
    connections: [],
    categories: [],
    searchQuery: '',
    connecting: false,
    connectionError: '',
    // Form modal
    formOpen: false,
    editingId: null,
    form: {
      name: '', type: 'postgres', host: 'localhost', port: '5432',
      user: '', password: '', database: '', sqlitePath: '', categoryId: null, error: '',
    },
  });

  let dragConnectionId = null;

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
        user: '', password: '', database: '', sqlitePath: '', categoryId: null, error: '',
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
    setState({ connecting: true, connectionError: '' });
    const liveId = generateId();
    const config = JSON.parse(JSON.stringify(conn.config));
    const result = await window.api.dbConnect({
      id: liveId,
      type: conn.type,
      config,
    });
    setState('connecting', false);
    if (result.error) {
      setState('connectionError', result.error);
      return;
    }
    await window.api.dbConnTouchLastUsed(conn.id);
    props.onOpenDb({ liveId, savedId: conn.id, name: conn.name, type: conn.type, config });
  }

  async function deleteConnection(e, id, name) {
    e.stopPropagation();
    if (await showConfirm(`Delete "${name}"?`, 'This cannot be undone.')) {
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
    if (await showConfirm(`Delete category "${name}"?`, 'Connections will be uncategorized.')) {
      await window.api.dbCatDelete(id);
      loadList();
    }
  }

  async function toggleCategoryCollapse(id, collapsed) {
    await window.api.dbCatToggleCollapse(id, !collapsed);
    setState('categories', (c) => c.id === id, 'collapsed', (v) => v ? 0 : 1);
  }

  // Drag and drop
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

  function connSubtitle(conn) {
    if (conn.type === 'postgres') {
      const c = conn.config;
      const db = c.database ? `/${c.database}` : '';
      return `${c.host || 'localhost'}:${c.port || 5432}${db}`;
    }
    return conn.config.path || '';
  }

  function ConnectionCard(cardProps) {
    const c = cardProps.c;
    return (
      <div
        class={`collection-item ${c.pinned ? 'pinned' : ''}`}
        onClick={() => connectTo(c)}
        draggable="true"
        onDragStart={(e) => onDragStart(e, c.id)}
        onDragEnd={onDragEnd}
      >
        <span class="name">
          <Icon name={c.type === 'postgres' ? 'fa-solid fa-server' : 'fa-solid fa-file'} />
          {' '}{c.name}
        </span>
        <span class="last-used db-conn-subtitle">{connSubtitle(c)}</span>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onClick={(e) => togglePin(e, c.id, c.pinned)}>
            {c.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button class="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openEditForm(c); }}>
            Edit
          </button>
          <button class="btn btn-danger btn-sm" onClick={(e) => deleteConnection(e, c.id, c.name)}>
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="db-client" style={props.style}>
      <div class="landing-main" style={{ display: '' }}>
        <div class="landing-toolbar">
          <Show when={!props.sidebarOpen}>
            <button class="btn btn-ghost btn-sm" onClick={props.onToggleSidebar}>
              <Icon name="fa-solid fa-bars" />
            </button>
          </Show>
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

        <Show when={state.connectionError}>
          <div class="db-error" style={{ margin: '8px 16px' }}>{state.connectionError}</div>
        </Show>

        <div class="landing-content">
          <Show when={state.connections.length === 0 && state.categories.length === 0}>
            <div class="empty-state">No connections yet. Create one to get started.</div>
          </Show>

          <For each={state.categories}>
            {(cat) => (
              <div
                class="landing-section landing-category"
                onDragOver={onCategoryDragOver}
                onDragLeave={onCategoryDragLeave}
                onDrop={(e) => onCategoryDrop(e, cat.id)}
              >
                <div
                  class="landing-section-header category-header"
                  onClick={() => toggleCategoryCollapse(cat.id, cat.collapsed)}
                >
                  <Icon name={cat.collapsed ? 'fa-solid fa-caret-right' : 'fa-solid fa-caret-down'} />
                  <span class="category-name">{cat.name}</span>
                  <div class="category-actions">
                    <button class="btn btn-ghost btn-sm" onClick={(e) => renameCategory(e, cat.id, cat.name)}>
                      <Icon name="fa-solid fa-pen" /> Rename
                    </button>
                    <button class="btn btn-danger btn-sm" onClick={(e) => removeCategory(e, cat.id, cat.name)}>
                      <Icon name="fa-solid fa-trash" /> Delete
                    </button>
                  </div>
                  <span class="category-count">{connectionsInCategory(cat.id).length}</span>
                </div>
                <Show when={!cat.collapsed}>
                  <div class="collection-list">
                    <Show when={connectionsInCategory(cat.id).length === 0}>
                      <div class="empty-category">Drop connections here</div>
                    </Show>
                    <For each={connectionsInCategory(cat.id)}>
                      {(c) => <ConnectionCard c={c} />}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>

          <Show when={state.categories.length > 0}>
            <div
              class="landing-section"
              onDragOver={onCategoryDragOver}
              onDragLeave={onCategoryDragLeave}
              onDrop={(e) => onCategoryDrop(e, null)}
            >
              <div class="landing-section-header">Uncategorized</div>
              <div class="collection-list">
                <Show when={uncategorizedConnections().length === 0}>
                  <div class="empty-category">Drop connections here</div>
                </Show>
                <For each={uncategorizedConnections()}>
                  {(c) => <ConnectionCard c={c} />}
                </For>
              </div>
            </div>
          </Show>
          <Show when={state.categories.length === 0}>
            <div class="collection-list">
              <For each={uncategorizedConnections()}>
                {(c) => <ConnectionCard c={c} />}
              </For>
            </div>
          </Show>
        </div>
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
            <select value={state.form.type} onChange={(e) => setState('form', 'type', e.target.value)} class="body-type-select">
              <option value="postgres">PostgreSQL</option>
              <option value="sqlite">SQLite</option>
            </select>
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
              <input type="password" value={state.form.password} onInput={(e) => setState('form', 'password', e.target.value)} />
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

          <Show when={state.categories.length > 0}>
            <FormField label="Category">
              <select value={state.form.categoryId || ''} onChange={(e) => setState('form', 'categoryId', e.target.value || null)} class="body-type-select">
                <option value="">None</option>
                <For each={state.categories}>{(cat) => <option value={cat.id}>{cat.name}</option>}</For>
              </select>
            </FormField>
          </Show>
        </FormModal>
      </Show>
    </div>
  );
}
