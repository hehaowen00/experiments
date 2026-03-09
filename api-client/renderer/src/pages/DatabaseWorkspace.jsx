import { createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import Icon from '../components/Icon';
import CodeEditor from '../components/CodeEditor';
import Modal, { showPrompt, showConfirm } from '../components/Modal';
import SqlEditor from '../components/SqlEditor';

function detectFormat(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trimStart();
  if ((trimmed[0] === '{' || trimmed[0] === '[') && trimmed.length > 1) {
    try { JSON.parse(trimmed); return 'json'; } catch {}
  }
  if (trimmed[0] === '<') return 'xml';
  return null;
}

function prettifyJson(val) {
  if (!val || typeof val !== 'string') return val;
  try {
    return JSON.stringify(JSON.parse(val), null, 2);
  } catch {
    return val;
  }
}

const COLUMN_FORMATS = [
  { id: 'raw', label: 'Raw' },
  { id: 'epoch_s', label: 'Epoch (seconds)' },
  { id: 'epoch_ms', label: 'Epoch (milliseconds)' },
  { id: 'url', label: 'URL' },
  { id: 'json', label: 'JSON' },
  { id: 'boolean', label: 'Boolean' },
  { id: 'hex', label: 'Hex' },
  { id: 'filesize', label: 'File Size' },
  { id: 'array', label: 'Array' },
];

function parsePgArray(s) {
  if (typeof s !== 'string') {
    if (Array.isArray(s)) return s.map(String);
    return null;
  }
  const trimmed = s.trim();
  if (trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') {
    const inner = trimmed.slice(1, -1);
    if (inner === '') return [];
    // Simple CSV parse handling quoted strings
    const items = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (inQuote) {
        if (ch === '\\' && i + 1 < inner.length) { current += inner[++i]; continue; }
        if (ch === '"') { inQuote = false; continue; }
        current += ch;
      } else {
        if (ch === '"') { inQuote = true; continue; }
        if (ch === ',') { items.push(current.trim()); current = ''; continue; }
        current += ch;
      }
    }
    items.push(current.trim());
    return items.map((v) => v === 'NULL' ? null : v);
  }
  // Try JSON array
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((v) => v === null ? null : String(v));
  } catch {}
  return null;
}

function serializePgArray(items) {
  const parts = items.map((v) => {
    if (v === null) return 'NULL';
    const s = String(v);
    if (s === '' || s.includes(',') || s.includes('"') || s.includes('\\') || s.includes('{') || s.includes('}') || s.includes(' ') || s.toUpperCase() === 'NULL') {
      return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    return s;
  });
  return '{' + parts.join(',') + '}';
}

function formatCellValue(val, format) {
  if (val === null || val === undefined || !format || format === 'raw') return null;
  const s = String(val);
  try {
    switch (format) {
      case 'epoch_s': {
        const n = Number(s);
        if (isNaN(n)) return null;
        return new Date(n * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
      }
      case 'epoch_ms': {
        const n = Number(s);
        if (isNaN(n)) return null;
        return new Date(n).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
      }
      case 'url':
        return s;
      case 'json':
        return JSON.stringify(JSON.parse(s), null, 2);
      case 'boolean': {
        const lower = s.toLowerCase();
        if (lower === '1' || lower === 'true' || lower === 't' || lower === 'yes') return 'true';
        if (lower === '0' || lower === 'false' || lower === 'f' || lower === 'no' || lower === '') return 'false';
        return s;
      }
      case 'hex': {
        const n = Number(s);
        if (isNaN(n) || !Number.isInteger(n)) return null;
        return '0x' + n.toString(16).toUpperCase();
      }
      case 'filesize': {
        const n = Number(s);
        if (isNaN(n)) return null;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
        return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
      }
      case 'array': {
        const items = parsePgArray(val);
        if (!items) return null;
        return `[${items.length} items]`;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function autoDetectColumnFormats(columns, rows, dbType) {
  const formats = {};
  if (!rows || rows.length === 0) return formats;
  for (const col of columns) {
    const values = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && !(typeof v === 'string' && v.startsWith('[Large data:')));
    if (values.length === 0) continue;
    const sample = values.slice(0, 20);
    // Check postgres array (postgres only)
    if (dbType === 'postgres' && sample.every((v) => parsePgArray(v) !== null)) {
      formats[col] = 'array';
      continue;
    }
    // Check URL
    if (sample.every((v) => /^https?:\/\/.+/i.test(String(v)))) {
      formats[col] = 'url';
      continue;
    }
    // Check JSON
    if (sample.every((v) => { const s = String(v).trimStart(); return (s[0] === '{' || s[0] === '[') && (() => { try { JSON.parse(s); return true; } catch { return false; } })(); })) {
      formats[col] = 'json';
      continue;
    }
    // Check boolean
    const boolVals = new Set(['0', '1', 'true', 'false', 't', 'f', 'yes', 'no']);
    if (sample.every((v) => boolVals.has(String(v).toLowerCase()))) {
      formats[col] = 'boolean';
      continue;
    }
    // Check epoch — heuristic: numbers in plausible timestamp range
    if (sample.every((v) => { const n = Number(v); return !isNaN(n) && Number.isFinite(n); })) {
      const nums = sample.map(Number);
      // Epoch seconds: between 2000-01-01 and 2100-01-01
      if (nums.every((n) => n >= 946684800 && n <= 4102444800 && Number.isInteger(n))) {
        formats[col] = 'epoch_s';
        continue;
      }
      // Epoch milliseconds
      if (nums.every((n) => n >= 946684800000 && n <= 4102444800000 && Number.isInteger(n))) {
        formats[col] = 'epoch_ms';
        continue;
      }
    }
  }
  return formats;
}

export default function DatabaseWorkspace(props) {
  const { connData } = props;
  const PAGE_SIZE = 100;

  // Sidebar / browser state
  const [sidebar, setSidebar] = createStore({
    databases: [],
    activeDatabase: connData.config.database || '',
    expandedDatabases: new Set(),
    tablesByDb: {},
    loadingDb: null,
    selectedTable: null,
    expandedTables: new Set(),
  });

  // Table detail state
  const [table, setTable] = createStore({
    columns: [],
    indexes: [],
    data: null,
    dataPage: 0,
    dataTotal: 0,
    tab: 'data',
    columnFormats: {},
  });

  // Query editor state
  const [query, setQuery] = createStore({
    text: '',
    result: null,
    running: false,
  });

  // Cell panel state
  const [cell, setCell] = createStore({
    open: false,
    panel: null,
    editValue: '',
    dirty: false,
    saving: false,
  });

  // Pending changes for local edit/delete before saving
  const [pending, setPending] = createStore({
    edits: {},    // { "rowIndex:col": { rowIndex, col, value } }
    deletes: {},  // { rowIndex: true }
  });

  function hasPendingChanges() {
    return Object.keys(pending.edits).length > 0 || Object.keys(pending.deletes).length > 0;
  }

  function discardPendingChanges() {
    setPending({ edits: {}, deletes: {} });
    // Also reset any cell panel dirty state
    if (cell.panel) {
      const origRow = table.data?.rows?.[cell.panel.rowIndex];
      const origVal = origRow ? origRow[cell.panel.column] : null;
      const valStr = origVal === null || origVal === undefined ? null : String(origVal);
      const editVal = detectFormat(valStr) === 'json' ? prettifyJson(valStr) : valStr;
      setCell({ panel: { ...cell.panel, value: valStr }, editValue: editVal ?? '', dirty: false });
    }
  }

  function getDisplayRows() {
    const rows = table.data?.rows;
    if (!rows) return [];
    return rows.map((row, i) => {
      const editsForRow = {};
      for (const key of Object.keys(pending.edits)) {
        const e = pending.edits[key];
        if (e.rowIndex === i) editsForRow[e.col] = e.value;
      }
      if (Object.keys(editsForRow).length === 0) return row;
      return { ...row, ...editsForRow };
    });
  }

  // Dialog state
  const [dialog, setDialog] = createStore({
    createTable: false,
    insertRow: false,
    addColumn: false,
    newTableName: '',
    newTableCols: [{ name: 'id', type: connData.type === 'postgres' ? 'SERIAL' : 'INTEGER', pk: true, nullable: false, defaultValue: '' }],
    createTableError: '',
    insertRowValues: {},
    insertRowError: '',
    newColDef: { name: '', type: 'TEXT', nullable: true, defaultValue: '' },
    addColumnError: '',
  });

  // Pane sizing (keep as signals - simple independent values)
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [sidebarWidth, setSidebarWidth] = createSignal(260);
  const [editorHeight, setEditorHeight] = createSignal(200);
  const [cellPanelWidth, setCellPanelWidth] = createSignal(320);

  onMount(async () => {
    document.title = connData.name;
    await loadSidebarData();
  });

  onCleanup(() => {
    window.api.dbDisconnect(connData.liveId);
  });

  async function loadSidebarData() {
    const [dbResult, tableResult] = await Promise.all([
      window.api.dbListDatabases(connData.liveId),
      window.api.dbListTables(connData.liveId),
    ]);
    if (dbResult.databases) setSidebar('databases', dbResult.databases);
    if (tableResult.tables) {
      const dbName = sidebar.activeDatabase || '_default';
      setSidebar('tablesByDb', dbName, tableResult.tables);
      if (connData.type !== 'postgres') {
        setSidebar('expandedDatabases', new Set([dbName]));
      } else {
        setSidebar('expandedDatabases', new Set([sidebar.activeDatabase]));
      }
    }
  }

  async function toggleDatabase(dbName) {
    if (connData.type !== 'postgres') return;
    if (sidebar.expandedDatabases.has(dbName)) {
      const next = new Set(sidebar.expandedDatabases);
      next.delete(dbName);
      setSidebar('expandedDatabases', next);
      return;
    }
    if (!sidebar.tablesByDb[dbName]) {
      setSidebar('loadingDb', dbName);
      const result = await window.api.dbSwitchDatabase(connData.liveId, dbName);
      if (result.error) { setSidebar('loadingDb', null); return; }
      setSidebar('activeDatabase', dbName);
      const tableResult = await window.api.dbListTables(connData.liveId);
      if (tableResult.tables) setSidebar('tablesByDb', dbName, tableResult.tables);
      setSidebar('loadingDb', null);
    } else {
      if (sidebar.activeDatabase !== dbName) {
        const result = await window.api.dbSwitchDatabase(connData.liveId, dbName);
        if (result.error) return;
        setSidebar('activeDatabase', dbName);
      }
    }
    const next = new Set(sidebar.expandedDatabases);
    next.add(dbName);
    setSidebar('expandedDatabases', next);
  }

  async function selectTable(schema, tableName) {
    setSidebar('selectedTable', { schema, table: tableName });
    setTable({ tab: 'data', dataPage: 0, columnFormats: {} });
    setPending({ edits: {}, deletes: {} });
    const [colResult, idxResult] = await Promise.all([
      window.api.dbGetColumns(connData.liveId, schema, tableName),
      window.api.dbGetIndexes(connData.liveId, schema, tableName),
    ]);
    if (colResult.columns) setTable('columns', colResult.columns);
    if (idxResult.indexes) setTable('indexes', idxResult.indexes);
    await loadTableData(0);
  }

  async function loadTableData(page) {
    const t = sidebar.selectedTable;
    if (!t) return;
    setTable('dataPage', page);
    const result = await window.api.dbGetTableData(connData.liveId, t.schema, t.table, PAGE_SIZE, page * PAGE_SIZE);
    if (result.error) {
      setTable('data', { rows: [], columns: [], error: result.error });
    } else {
      setTable({ data: { rows: result.rows, columns: result.columns }, dataTotal: result.total });
      // Auto-detect column formats on first page if none set
      if (page === 0 && Object.keys(table.columnFormats).length === 0) {
        const detected = autoDetectColumnFormats(result.columns, result.rows, connData.type);
        if (Object.keys(detected).length > 0) {
          setTable('columnFormats', detected);
        }
      }
    }
  }

  async function runQuery() {
    const sql = query.text.trim();
    if (!sql) return;
    setQuery({ running: true });
    setTable('tab', 'query');
    const result = await window.api.dbQuery(connData.liveId, sql);
    setQuery({ running: false, result });
  }

  function toggleTableExpand(key) {
    const next = new Set(sidebar.expandedTables);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSidebar('expandedTables', next);
  }

  function handleEditorKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  }

  // Cell panel
  async function onCellDblClick(col, rowIndex, currentVal, source) {
    const isLarge = typeof currentVal === 'string' && currentVal.startsWith('[Large data:');
    setCell('dirty', false);
    if (isLarge && source?.liveId && source?.schema && source?.table) {
      setCell({ panel: { column: col, rowIndex, value: null, loading: true, source }, open: true });
      const result = await window.api.dbGetCellValue(
        source.liveId, source.schema, source.table, col, (source.pageOffset || 0) + rowIndex,
      );
      const val = result.error ? `Error: ${result.error}` : result.value;
      const editVal = detectFormat(val) === 'json' ? prettifyJson(val) : val;
      setCell({ panel: { column: col, rowIndex, value: val, loading: false, source }, editValue: editVal ?? '' });
    } else {
      const isNull = currentVal === null || currentVal === undefined;
      const val = isNull ? null : String(currentVal);
      const editVal = detectFormat(val) === 'json' ? prettifyJson(val) : val;
      setCell({ panel: { column: col, rowIndex, value: val, loading: false, source }, editValue: editVal ?? '', open: true });
    }
  }

  function onCellEditInput(val) {
    setCell('editValue', val);
    const orig = cell.panel?.value ?? '';
    setCell('dirty', val !== orig);
  }

  function discardCellEdit() {
    if (!cell.panel) return;
    setCell({ editValue: cell.panel.value ?? '', dirty: false });
  }

  function saveCellEdit() {
    const p = cell.panel;
    if (!p) return;
    const key = `${p.rowIndex}:${p.column}`;
    setPending('edits', key, { rowIndex: p.rowIndex, col: p.column, value: cell.editValue });
    setCell({ panel: { ...p, value: cell.editValue }, dirty: false });
  }

  function toggleCellPanel() { setCell('open', !cell.open); }
  function closeCellPanel() { setCell({ open: false, dirty: false }); }

  // Create database (postgres only)
  async function createDatabase() {
    const name = await showPrompt('Create Database', '', '', 'Database name');
    if (!name || !name.trim()) return;
    const result = await window.api.dbCreateDatabase(connData.liveId, name.trim());
    if (result.error) return alert(result.error);
    const dbResult = await window.api.dbListDatabases(connData.liveId);
    if (dbResult.databases) setSidebar('databases', dbResult.databases);
  }

  // Create table
  function openCreateTable() {
    setDialog({
      createTable: true,
      newTableName: '',
      newTableCols: [{ name: 'id', type: connData.type === 'postgres' ? 'SERIAL' : 'INTEGER', pk: true, nullable: false, defaultValue: '' }],
      createTableError: '',
    });
  }

  function addTableCol() {
    setDialog('newTableCols', [...dialog.newTableCols, { name: '', type: 'TEXT', pk: false, nullable: true, defaultValue: '' }]);
  }

  function removeTableCol(idx) {
    setDialog('newTableCols', dialog.newTableCols.filter((_, i) => i !== idx));
  }

  function updateTableCol(idx, field, value) {
    setDialog('newTableCols', idx, field, value);
  }

  async function submitCreateTable() {
    const name = dialog.newTableName.trim();
    if (!name) { setDialog('createTableError', 'Table name is required'); return; }
    const cols = dialog.newTableCols.filter((c) => c.name.trim());
    if (cols.length === 0) { setDialog('createTableError', 'At least one column is required'); return; }
    const schema = connData.type === 'postgres' ? 'public' : 'main';
    const result = await window.api.dbCreateTable(connData.liveId, schema, name, cols);
    if (result.error) { setDialog('createTableError', result.error); return; }
    setDialog('createTable', false);
    await refreshTables();
  }

  // Insert row
  function openInsertRow() {
    const vals = {};
    for (const col of table.columns) vals[col.column_name] = '';
    setDialog({ insertRow: true, insertRowValues: vals, insertRowError: '' });
  }

  function updateInsertValue(colName, value) {
    setDialog('insertRowValues', colName, value);
  }

  async function submitInsertRow() {
    const t = sidebar.selectedTable;
    if (!t) return;
    const result = await window.api.dbInsertRow(connData.liveId, t.schema, t.table, dialog.insertRowValues);
    if (result.error) { setDialog('insertRowError', result.error); return; }
    setDialog('insertRow', false);
    await loadTableData(table.dataPage);
  }

  // Drop database
  async function dropDatabase(dbName) {
    if (!await showConfirm(`Drop database "${dbName}"?`, 'This action cannot be undone.')) return;
    const result = await window.api.dbDropDatabase(connData.liveId, dbName);
    if (result.error) return alert(result.error);
    const dbResult = await window.api.dbListDatabases(connData.liveId);
    if (dbResult.databases) setSidebar('databases', dbResult.databases);
    const next = { ...sidebar.tablesByDb };
    delete next[dbName];
    setSidebar('tablesByDb', next);
  }

  // Drop table
  async function dropTable(schema, tableName) {
    if (!await showConfirm(`Drop table "${tableName}"?`, 'This action cannot be undone.')) return;
    const result = await window.api.dbDropTable(connData.liveId, schema, tableName);
    if (result.error) return alert(result.error);
    if (sidebar.selectedTable?.schema === schema && sidebar.selectedTable?.table === tableName) {
      setSidebar('selectedTable', null);
      setTable({ columns: [], data: null });
    }
    await refreshTables();
  }

  // Rename table
  async function renameTable(schema, oldName) {
    const newName = await showPrompt('Rename Table', oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const result = await window.api.dbRenameTable(connData.liveId, schema, oldName, newName.trim());
    if (result.error) return alert(result.error);
    if (sidebar.selectedTable?.schema === schema && sidebar.selectedTable?.table === oldName) {
      setSidebar('selectedTable', { schema, table: newName.trim() });
    }
    await refreshTables();
  }

  // Add column
  function openAddColumn() {
    setDialog({ addColumn: true, newColDef: { name: '', type: 'TEXT', nullable: true, defaultValue: '' }, addColumnError: '' });
  }

  async function submitAddColumn() {
    const t = sidebar.selectedTable;
    if (!t) return;
    const col = dialog.newColDef;
    if (!col.name.trim()) { setDialog('addColumnError', 'Column name is required'); return; }
    const result = await window.api.dbAddColumn(connData.liveId, t.schema, t.table, col);
    if (result.error) { setDialog('addColumnError', result.error); return; }
    setDialog('addColumn', false);
    await selectTable(t.schema, t.table);
  }

  // Drop column
  async function dropColumn(colName) {
    if (!await showConfirm(`Drop column "${colName}"?`, 'This action cannot be undone.')) return;
    const t = sidebar.selectedTable;
    if (!t) return;
    const result = await window.api.dbDropColumn(connData.liveId, t.schema, t.table, colName);
    if (result.error) return alert(result.error);
    await selectTable(t.schema, t.table);
  }

  // Delete row
  function deleteRow(rowIndex) {
    if (pending.deletes[rowIndex]) {
      // Undo delete
      setPending('deletes', rowIndex, undefined);
    } else {
      setPending('deletes', rowIndex, true);
    }
  }

  async function saveAllChanges() {
    const t = sidebar.selectedTable;
    if (!t) return;
    const pageOffset = table.dataPage * PAGE_SIZE;

    // Apply deletes first (in reverse order so offsets stay valid)
    const deleteIndices = Object.keys(pending.deletes).map(Number).sort((a, b) => b - a);
    for (const ri of deleteIndices) {
      const absOffset = pageOffset + ri;
      const result = await window.api.dbDeleteRow(connData.liveId, t.schema, t.table, absOffset);
      if (result.error) { alert(`Delete row ${ri + 1}: ${result.error}`); return; }
    }

    // Apply edits (skip edits on deleted rows)
    const editEntries = Object.values(pending.edits).filter((e) => !pending.deletes[e.rowIndex]);
    for (const e of editEntries) {
      const absOffset = pageOffset + e.rowIndex;
      const result = await window.api.dbUpdateCell(connData.liveId, t.schema, t.table, e.col, absOffset, e.value);
      if (result.error) { alert(`Edit ${e.col} row ${e.rowIndex + 1}: ${result.error}`); return; }
    }

    setPending({ edits: {}, deletes: {} });
    await loadTableData(table.dataPage);
  }

  // Refresh tables in sidebar
  async function refreshTables() {
    const dbName = sidebar.activeDatabase || '_default';
    const tableResult = await window.api.dbListTables(connData.liveId);
    if (tableResult.tables) setSidebar('tablesByDb', dbName, tableResult.tables);
  }

  // Resize handlers
  function onSidebarResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth();
    function onMove(e) { setSidebarWidth(Math.max(180, Math.min(500, startWidth + e.clientX - startX))); }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onEditorResizeStart(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = editorHeight();
    function onMove(e) { setEditorHeight(Math.max(80, Math.min(600, startHeight + e.clientY - startY))); }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onCellPanelResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = cellPanelWidth();
    function onMove(e) { setCellPanelWidth(Math.max(200, Math.min(600, startWidth - (e.clientX - startX)))); }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function tablesBySchemaForDb(dbName) {
    const tables = sidebar.tablesByDb[dbName] || [];
    const groups = {};
    for (const t of tables) {
      const s = t.table_schema || 'main';
      if (!groups[s]) groups[s] = [];
      groups[s].push(t);
    }
    return groups;
  }

  function TableTreeItem(treeProps) {
    const { schema, table: t } = treeProps;
    const key = `${schema}.${t.table_name}`;
    const isSelected = () =>
      sidebar.selectedTable?.schema === schema && sidebar.selectedTable?.table === t.table_name;
    const isExpanded = () => sidebar.expandedTables.has(key);
    return (
      <div>
        <div
          class={`db-tree-item ${isSelected() ? 'active' : ''}`}
          onClick={() => selectTable(schema, t.table_name)}
        >
          <button
            class="db-tree-expand"
            onClick={(e) => {
              e.stopPropagation();
              toggleTableExpand(key);
              if (!isSelected()) selectTable(schema, t.table_name);
            }}
          >
            <Icon name={isExpanded() ? 'fa-solid fa-caret-down' : 'fa-solid fa-caret-right'} />
          </button>
          <Icon name={t.table_type === 'VIEW' ? 'fa-solid fa-eye' : 'fa-solid fa-table'} />
          <span class="db-tree-name">{t.table_name}</span>
          <Show when={t.table_type === 'VIEW'}>
            <span class="db-tree-badge">view</span>
          </Show>
          <div class="db-tree-actions" onClick={(e) => e.stopPropagation()}>
            <button class="btn btn-ghost btn-xs" onClick={() => renameTable(schema, t.table_name)} title="Rename table">
              <Icon name="fa-solid fa-pen" />
            </button>
            <button class="btn btn-ghost btn-xs" onClick={() => dropTable(schema, t.table_name)} title="Drop table">
              <Icon name="fa-solid fa-trash" />
            </button>
          </div>
        </div>
        <Show when={isExpanded() && isSelected()}>
          <div class="db-tree-columns">
            <For each={table.columns}>
              {(col) => (
                <div class="db-tree-column">
                  <Icon name="fa-solid fa-columns" />
                  <span class="db-col-name">{col.column_name}</span>
                  <span class="db-col-type">{col.data_type}</span>
                  <Show when={col.pk}>
                    <span class="db-col-pk">PK</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    );
  }

  const totalPages = () => Math.ceil(table.dataTotal / PAGE_SIZE);

  const tableSource = () => ({
    liveId: connData.liveId,
    schema: sidebar.selectedTable?.schema,
    table: sidebar.selectedTable?.table,
    pageOffset: table.dataPage * PAGE_SIZE,
  });

  return (
    <div class="db-workspace-page">
      <div class="db-workspace">
        {/* Left sidebar: tables */}
        <Show when={sidebarOpen()}>
        <div class="db-sidebar" style={{ width: sidebarWidth() + 'px' }}>
          <div class="sidebar-header">
            <div class="back-row">
              <button class="back-btn" onClick={props.onBack} title="Back to connections">
                <Icon name="fa-solid fa-arrow-left" />
              </button>
              <span class="collection-name" style={{ cursor: 'default' }}>
                {connData.name}
              </span>
              <button class="back-btn sidebar-close-btn" onClick={() => setSidebarOpen(false)} title="Close sidebar">
                <Icon name="fa-solid fa-xmark" />
              </button>
            </div>
          </div>

          <div class="db-sidebar-content">
            {/* PostgreSQL: databases with nested tables */}
            <Show when={connData.type === 'postgres' && sidebar.databases.length > 0}>
              <div class="db-section-label">
                Databases
                <button class="btn btn-ghost btn-xs db-section-action" onClick={createDatabase} title="Create database">
                  <Icon name="fa-solid fa-plus" />
                </button>
              </div>
              <For each={sidebar.databases}>
                {(dbName) => {
                  const isExpanded = () => sidebar.expandedDatabases.has(dbName);
                  const isLoading = () => sidebar.loadingDb === dbName;
                  const schemas = () => tablesBySchemaForDb(dbName);
                  return (
                    <div>
                      <div
                        class={`db-tree-item db-tree-db ${sidebar.activeDatabase === dbName ? 'active' : ''}`}
                        onClick={() => toggleDatabase(dbName)}
                      >
                        <Icon name={isExpanded() ? 'fa-solid fa-caret-down' : 'fa-solid fa-caret-right'} />
                        <Icon name="fa-solid fa-database" />
                        <span>{dbName}</span>
                        <Show when={isLoading()}>
                          <span class="db-tree-badge">loading...</span>
                        </Show>
                        <div class="db-tree-actions" onClick={(e) => e.stopPropagation()}>
                          <button class="btn btn-ghost btn-xs" onClick={() => dropDatabase(dbName)} title="Drop database">
                            <Icon name="fa-solid fa-trash" />
                          </button>
                        </div>
                      </div>
                      <Show when={isExpanded()}>
                        <div class="db-tree-nested">
                          <For each={Object.entries(schemas())}>
                            {([schema, schemaTables]) => (
                              <>
                                <Show when={Object.keys(schemas()).length > 1}>
                                  <div class="db-tree-schema">{schema}</div>
                                </Show>
                                <For each={schemaTables}>
                                  {(t) => <TableTreeItem schema={schema} table={t} />}
                                </For>
                              </>
                            )}
                          </For>
                          <Show when={Object.keys(schemas()).length === 0 && !isLoading()}>
                            <div class="db-empty" style={{ padding: '4px 12px 4px 32px', 'font-size': '11px' }}>No tables</div>
                          </Show>
                          <Show when={sidebar.activeDatabase === dbName}>
                            <div
                              class="db-tree-item db-tree-add"
                              onClick={openCreateTable}
                            >
                              <Icon name="fa-solid fa-plus" />
                              <span>New Table</span>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </Show>

            {/* SQLite: tables directly */}
            <Show when={connData.type === 'sqlite'}>
              <div class="db-section-label">
                Tables
                <button class="btn btn-ghost btn-xs db-section-action" onClick={openCreateTable} title="Create table">
                  <Icon name="fa-solid fa-plus" />
                </button>
              </div>
              <For each={Object.entries(tablesBySchemaForDb('_default'))}>
                {([schema, schemaTables]) => (
                  <>
                    <Show when={Object.keys(tablesBySchemaForDb('_default')).length > 1}>
                      <div class="db-tree-schema">{schema}</div>
                    </Show>
                    <For each={schemaTables}>
                      {(t) => <TableTreeItem schema={schema} table={t} />}
                    </For>
                  </>
                )}
              </For>
              <Show when={(sidebar.tablesByDb['_default'] || []).length === 0}>
                <div class="db-empty" style={{ padding: '12px', 'font-size': '11px' }}>No tables found</div>
              </Show>
            </Show>

            {/* Postgres with no databases listed */}
            <Show when={connData.type === 'postgres' && sidebar.databases.length === 0}>
              <div class="db-empty" style={{ padding: '12px', 'font-size': '11px' }}>No databases found</div>
            </Show>
          </div>
        </div>

        <div class="db-resize-handle-v" onMouseDown={onSidebarResizeStart} />
        </Show>

        {/* Center: editor + results */}
        <div class="db-main">
          <div class="db-editor-pane" style={{ height: editorHeight() + 'px' }}>
            <div class="db-editor-toolbar">
              <Show when={!sidebarOpen()}>
                <button class="btn btn-ghost btn-sm" onClick={() => setSidebarOpen(true)} title="Open sidebar">
                  <Icon name="fa-solid fa-bars" />
                </button>
              </Show>
              <span class="db-editor-title">Query</span>
              <button
                class="btn btn-primary btn-sm"
                onClick={runQuery}
                disabled={query.running}
              >
                <Icon name="fa-solid fa-play" />
                {query.running ? 'Running...' : 'Run'}
              </button>
              <span class="db-editor-hint">Ctrl+Enter to run</span>
            </div>
            <div class="db-editor-area" onKeyDown={handleEditorKeyDown}>
              <SqlEditor
                value={query.text}
                onInput={(v) => setQuery('text', v)}
                placeholder="SELECT * FROM ..."
                dialect={connData.type === 'sqlite' ? 'sqlite' : 'postgres'}
              />
            </div>
          </div>

          <div class="db-resize-handle-h" onMouseDown={onEditorResizeStart} />

          <div class="db-results-pane">
            <Show when={sidebar.selectedTable}>
              <div class="db-tabs">
                <button class={`db-tab ${table.tab === 'data' ? 'active' : ''}`} onClick={() => setTable('tab', 'data')}>Data</button>
                <button class={`db-tab ${table.tab === 'columns' ? 'active' : ''}`} onClick={() => setTable('tab', 'columns')}>Columns</button>
                <button class={`db-tab ${table.tab === 'indexes' ? 'active' : ''}`} onClick={() => setTable('tab', 'indexes')}>Indexes</button>
                <button class={`db-tab ${table.tab === 'query' ? 'active' : ''}`} onClick={() => setTable('tab', 'query')}>Query Results</button>
                <button
                  class={`db-tab db-tab-right ${cell.open ? 'active' : ''}`}
                  onClick={toggleCellPanel}
                  title="Toggle cell viewer"
                >
                  <Icon name="fa-solid fa-table-cells" />
                </button>
              </div>
            </Show>
            <Show when={!sidebar.selectedTable}>
              <div class="db-tabs">
                <button class="db-tab active">Query Results</button>
                <button
                  class={`db-tab db-tab-right ${cell.open ? 'active' : ''}`}
                  onClick={toggleCellPanel}
                  title="Toggle cell viewer"
                >
                  <Icon name="fa-solid fa-table-cells" />
                </button>
              </div>
            </Show>

            {/* Data tab */}
            <Show when={table.tab === 'data' && table.data}>
              <Show when={table.data.error}>
                <div class="db-error">{table.data.error}</div>
              </Show>
              <Show when={!table.data.error}>
                <div class="db-table-info">
                  <span>{sidebar.selectedTable?.table} - {table.dataTotal} rows</span>
                  <button class="btn btn-ghost btn-sm" onClick={() => { setPending({ edits: {}, deletes: {} }); loadTableData(table.dataPage); }} title="Refresh">
                    <Icon name="fa-solid fa-rotate-right" />
                  </button>
                  <button class="btn btn-ghost btn-sm" onClick={openInsertRow} title="Insert row">
                    <Icon name="fa-solid fa-plus" /> Row
                  </button>
                  <Show when={totalPages() > 1}>
                    <div class="db-pagination">
                      <button class="btn btn-ghost btn-sm" disabled={table.dataPage === 0} onClick={() => loadTableData(table.dataPage - 1)}>
                        <Icon name="fa-solid fa-chevron-left" />
                      </button>
                      <span>{table.dataPage + 1} / {totalPages()}</span>
                      <button class="btn btn-ghost btn-sm" disabled={table.dataPage >= totalPages() - 1} onClick={() => loadTableData(table.dataPage + 1)}>
                        <Icon name="fa-solid fa-chevron-right" />
                      </button>
                    </div>
                  </Show>
                </div>
                <ResultsTable
                  columns={table.data.columns}
                  rows={getDisplayRows()}
                  onCellDblClick={(col, ri, val) => onCellDblClick(col, ri, val, tableSource())}
                  cellPanel={cell.panel}
                  pkColumns={new Set(table.columns.filter(c => c.pk).map(c => c.column_name))}
                  onDeleteRow={deleteRow}
                  columnFormats={table.columnFormats}
                  onSetColumnFormat={(col, fmt) => setTable('columnFormats', col, fmt)}
                  deletedRows={pending.deletes}
                  editedCells={pending.edits}
                />
                <Show when={hasPendingChanges()}>
                  <div class="db-pending-bar">
                    <span class="db-pending-summary">
                      {Object.keys(pending.edits).filter(k => !pending.deletes[pending.edits[k].rowIndex]).length} edit(s), {Object.keys(pending.deletes).length} delete(s)
                    </span>
                    <button class="btn btn-ghost btn-sm" onClick={discardPendingChanges}>Discard</button>
                    <button class="btn btn-primary btn-sm" onClick={saveAllChanges}>Save Changes</button>
                  </div>
                </Show>
              </Show>
            </Show>

            {/* Columns tab */}
            <Show when={table.tab === 'columns'}>
              <div class="db-table-info">
                <span>{table.columns.length} columns</span>
                <button class="btn btn-ghost btn-sm" onClick={openAddColumn} title="Add column">
                  <Icon name="fa-solid fa-plus" /> Column
                </button>
              </div>
              <div class="db-detail-table-wrap">
                <table class="db-detail-table">
                  <thead>
                    <tr><th>#</th><th>Name</th><th>Type</th><th>PK</th><th>Nullable</th><th>Default</th><th></th></tr>
                  </thead>
                  <tbody>
                    <For each={table.columns}>
                      {(col) => (
                        <tr>
                          <td>{col.ordinal_position}</td>
                          <td>{col.column_name}</td>
                          <td>{col.data_type}</td>
                          <td>{col.pk ? <i class="fa-solid fa-key db-pk-icon" /> : ''}</td>
                          <td>{col.is_nullable}</td>
                          <td>{col.column_default ?? ''}</td>
                          <td>
                            <button class="btn btn-ghost btn-xs" onClick={() => dropColumn(col.column_name)} title="Drop column">
                              <Icon name="fa-solid fa-trash" />
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>

            {/* Indexes tab */}
            <Show when={table.tab === 'indexes'}>
              <div class="db-detail-table-wrap">
                <Show when={table.indexes.length === 0}>
                  <div class="db-empty">No indexes</div>
                </Show>
                <Show when={table.indexes.length > 0}>
                  <table class="db-detail-table">
                    <thead><tr><th>Name</th><th>Definition</th></tr></thead>
                    <tbody>
                      <For each={table.indexes}>
                        {(idx) => (
                          <tr>
                            <td>{idx.indexname}</td>
                            <td class="db-idx-def">{idx.indexdef}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </div>
            </Show>

            {/* Query results tab */}
            <Show when={table.tab === 'query' || !sidebar.selectedTable}>
              <Show when={query.result}>
                <Show when={query.result.error}>
                  <div class="db-error db-query-error">{query.result.error}</div>
                </Show>
                <Show when={!query.result.error}>
                  <div class="db-table-info">
                    <span>
                      {query.result.columns
                        ? `${query.result.rowCount} rows`
                        : `${query.result.command}: ${query.result.rowCount} rows affected`}
                    </span>
                    <span class="db-query-time">{query.result.time}ms</span>
                  </div>
                  <Show when={query.result.columns}>
                    <ResultsTable
                      columns={query.result.columns}
                      rows={query.result.rows}
                      onCellDblClick={(col, ri, val) => onCellDblClick(col, ri, val, null)}
                      cellPanel={cell.panel}
                    />
                  </Show>
                </Show>
              </Show>
              <Show when={!query.result}>
                <div class="db-empty">Run a query to see results</div>
              </Show>
            </Show>
          </div>
        </div>

        {/* Right sidebar: cell editor (overlay) */}
        <Show when={cell.open}>
          <div class="db-cell-panel-overlay" style={{ width: cellPanelWidth() + 'px' }}>
            <div class="db-cell-panel-resize" onMouseDown={onCellPanelResizeStart} />
            <div class="db-cell-panel-header">
              <Show when={cell.panel}>
                <span class="db-cell-panel-title">
                  <span class="db-cell-panel-col">{cell.panel.column}</span>
                  <span class="db-cell-panel-row">Row {cell.panel.rowIndex + 1}</span>
                </span>
              </Show>
              <Show when={!cell.panel}>
                <span class="db-cell-panel-title">
                  <span class="db-cell-panel-col">Cell Viewer</span>
                </span>
              </Show>
              <div class="db-cell-panel-actions">
                <Show when={cell.dirty}>
                  <button class="btn btn-ghost btn-sm" onClick={discardCellEdit} title="Discard changes">
                    <Icon name="fa-solid fa-rotate-left" />
                    Discard
                  </button>
                  <button class="btn btn-primary btn-sm" onClick={saveCellEdit} disabled={cell.saving} title="Save changes">
                    <Icon name="fa-solid fa-check" />
                    {cell.saving ? 'Saving...' : 'Save'}
                  </button>
                </Show>
                <button class="btn btn-ghost btn-sm" onClick={closeCellPanel}>
                  <Icon name="fa-solid fa-xmark" />
                </button>
              </div>
            </div>
            <Show when={cell.panel && !cell.panel.loading && cell.panel.value !== null}>
              {(() => {
                const colFmt = () => table.columnFormats[cell.panel?.column];
                const formatted = () => colFmt() ? formatCellValue(cell.panel?.value, colFmt()) : null;
                return (
                  <Show when={formatted()}>
                    <div class="db-cell-panel-formatted">
                      <span class="db-cell-panel-formatted-label">{colFmt()}</span>
                      <span class="db-cell-panel-formatted-value">{formatted()}</span>
                    </div>
                  </Show>
                );
              })()}
            </Show>
            <div class="db-cell-panel-body">
              <Show when={!cell.panel}>
                <div class="db-cell-panel-empty">Double-click a cell to view its data</div>
              </Show>
              <Show when={cell.panel}>
                <Show when={cell.panel.loading}>
                  <div class="db-cell-panel-loading">Loading...</div>
                </Show>
                <Show when={!cell.panel.loading}>
                  <Show when={cell.panel.value === null && !cell.dirty}>
                    <span class="db-cell-null" style={{ padding: '12px' }}>NULL</span>
                  </Show>
                  <Show when={cell.panel.value !== null || cell.dirty}>
                    {(() => {
                      const colFmt = () => table.columnFormats[cell.panel?.column];
                      const isArrayCol = () => colFmt() === 'array';
                      const editItems = () => isArrayCol() ? parsePgArray(cell.editValue) : null;
                      const fmt = detectFormat(cell.editValue);

                      function updateArrayItem(idx, value) {
                        const items = editItems();
                        if (!items) return;
                        const next = [...items];
                        next[idx] = value;
                        onCellEditInput(serializePgArray(next));
                      }
                      function toggleArrayNull(idx) {
                        const items = editItems();
                        if (!items) return;
                        const next = [...items];
                        next[idx] = next[idx] === null ? '' : null;
                        onCellEditInput(serializePgArray(next));
                      }
                      function removeArrayItem(idx) {
                        const items = editItems();
                        if (!items) return;
                        const next = items.filter((_, i) => i !== idx);
                        onCellEditInput(serializePgArray(next));
                      }
                      function addArrayItem() {
                        const items = editItems() || [];
                        onCellEditInput(serializePgArray([...items, '']));
                      }
                      function moveArrayItem(idx, dir) {
                        const items = editItems();
                        if (!items) return;
                        const target = idx + dir;
                        if (target < 0 || target >= items.length) return;
                        const next = [...items];
                        [next[idx], next[target]] = [next[target], next[idx]];
                        onCellEditInput(serializePgArray(next));
                      }

                      return (
                        <>
                          <Show when={isArrayCol() && editItems()}>
                            <div class="db-array-editor">
                              <div class="db-array-editor-header">
                                <span class="db-array-editor-count">{editItems().length} items</span>
                                <button class="btn btn-ghost btn-xs" onClick={addArrayItem}>
                                  <Icon name="fa-solid fa-plus" /> Add
                                </button>
                              </div>
                              <div class="db-array-editor-list">
                                <For each={editItems()}>
                                  {(item, idx) => (
                                    <div class="db-array-editor-row">
                                      <span class="db-array-editor-idx">{idx()}</span>
                                      <Show when={item !== null}>
                                        <input
                                          type="text"
                                          class="db-array-editor-input"
                                          value={item}
                                          onInput={(e) => updateArrayItem(idx(), e.target.value)}
                                        />
                                      </Show>
                                      <Show when={item === null}>
                                        <span class="db-array-editor-null">NULL</span>
                                      </Show>
                                      <div class="db-array-editor-actions">
                                        <button class="btn btn-ghost btn-xs" onClick={() => toggleArrayNull(idx())} title={item === null ? 'Set value' : 'Set NULL'}>
                                          <Icon name={item === null ? 'fa-solid fa-pen' : 'fa-solid fa-ban'} />
                                        </button>
                                        <button class="btn btn-ghost btn-xs" disabled={idx() === 0} onClick={() => moveArrayItem(idx(), -1)} title="Move up">
                                          <Icon name="fa-solid fa-arrow-up" />
                                        </button>
                                        <button class="btn btn-ghost btn-xs" disabled={idx() === editItems().length - 1} onClick={() => moveArrayItem(idx(), 1)} title="Move down">
                                          <Icon name="fa-solid fa-arrow-down" />
                                        </button>
                                        <button class="btn btn-ghost btn-xs" onClick={() => removeArrayItem(idx())} title="Remove">
                                          <Icon name="fa-solid fa-trash" />
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </For>
                                <Show when={editItems().length === 0}>
                                  <div class="db-array-editor-empty">Empty array</div>
                                </Show>
                              </div>
                            </div>
                          </Show>
                          <Show when={!isArrayCol() || !editItems()}>
                            <Show when={fmt === 'json' || fmt === 'xml'}>
                              <CodeEditor
                                value={cell.editValue}
                                format={fmt}
                                onInput={onCellEditInput}
                              />
                            </Show>
                            <Show when={fmt !== 'json' && fmt !== 'xml'}>
                              <textarea
                                class="db-cell-textarea"
                                value={cell.editValue}
                                onInput={(e) => onCellEditInput(e.target.value)}
                              />
                            </Show>
                          </Show>
                        </>
                      );
                    })()}
                  </Show>
                </Show>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* Create Table Dialog */}
      <Show when={dialog.createTable}>
        <div class="db-dialog-overlay" onClick={() => setDialog('createTable', false)}>
          <div class="db-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="db-dialog-header">
              <span>Create Table</span>
              <button class="btn btn-ghost btn-sm" onClick={() => setDialog('createTable', false)}>
                <Icon name="fa-solid fa-xmark" />
              </button>
            </div>
            <div class="db-dialog-body">
              <div class="db-dialog-field">
                <label>Table Name</label>
                <input type="text" value={dialog.newTableName} onInput={(e) => setDialog('newTableName', e.target.value)} placeholder="table_name" autofocus />
              </div>
              <div class="db-dialog-field">
                <label>Columns</label>
                <table class="db-dialog-col-table">
                  <thead>
                    <tr><th>Name</th><th>Type</th><th>PK</th><th>Nullable</th><th>Default</th><th></th></tr>
                  </thead>
                  <tbody>
                    <For each={dialog.newTableCols}>
                      {(col, idx) => (
                        <tr>
                          <td><input type="text" value={col.name} onInput={(e) => updateTableCol(idx(), 'name', e.target.value)} placeholder="column_name" /></td>
                          <td><input type="text" value={col.type} onInput={(e) => updateTableCol(idx(), 'type', e.target.value)} placeholder="TEXT" /></td>
                          <td><input type="checkbox" checked={col.pk} onChange={(e) => updateTableCol(idx(), 'pk', e.target.checked)} /></td>
                          <td><input type="checkbox" checked={col.nullable} onChange={(e) => updateTableCol(idx(), 'nullable', e.target.checked)} /></td>
                          <td><input type="text" value={col.defaultValue} onInput={(e) => updateTableCol(idx(), 'defaultValue', e.target.value)} placeholder="" /></td>
                          <td>
                            <button class="btn btn-ghost btn-xs" onClick={() => removeTableCol(idx())} title="Remove column">
                              <Icon name="fa-solid fa-trash" />
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
                <button class="btn btn-ghost btn-sm" onClick={addTableCol} style={{ 'margin-top': '4px' }}>
                  <Icon name="fa-solid fa-plus" /> Add Column
                </button>
              </div>
              <Show when={dialog.createTableError}>
                <div class="db-dialog-error">{dialog.createTableError}</div>
              </Show>
            </div>
            <div class="db-dialog-footer">
              <button class="btn btn-ghost" onClick={() => setDialog('createTable', false)}>Cancel</button>
              <button class="btn btn-primary" onClick={submitCreateTable}>Create</button>
            </div>
          </div>
        </div>
      </Show>

      {/* Insert Row Dialog */}
      <Show when={dialog.insertRow}>
        <div class="db-dialog-overlay" onClick={() => setDialog('insertRow', false)}>
          <div class="db-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="db-dialog-header">
              <span>Insert Row into {sidebar.selectedTable?.table}</span>
              <button class="btn btn-ghost btn-sm" onClick={() => setDialog('insertRow', false)}>
                <Icon name="fa-solid fa-xmark" />
              </button>
            </div>
            <div class="db-dialog-body">
              <For each={table.columns}>
                {(col) => (
                  <div class="db-dialog-field db-dialog-field-row">
                    <label>
                      {col.column_name}
                      <span class="db-dialog-field-type">{col.data_type}</span>
                      <Show when={col.pk}><span class="db-col-pk">PK</span></Show>
                    </label>
                    <input
                      type="text"
                      value={dialog.insertRowValues[col.column_name] || ''}
                      onInput={(e) => updateInsertValue(col.column_name, e.target.value)}
                      placeholder={col.column_default ? `Default: ${col.column_default}` : ''}
                    />
                  </div>
                )}
              </For>
              <Show when={dialog.insertRowError}>
                <div class="db-dialog-error">{dialog.insertRowError}</div>
              </Show>
            </div>
            <div class="db-dialog-footer">
              <button class="btn btn-ghost" onClick={() => setDialog('insertRow', false)}>Cancel</button>
              <button class="btn btn-primary" onClick={submitInsertRow}>Insert</button>
            </div>
          </div>
        </div>
      </Show>

      {/* Add Column Dialog */}
      <Show when={dialog.addColumn}>
        <div class="db-dialog-overlay" onClick={() => setDialog('addColumn', false)}>
          <div class="db-dialog db-dialog-sm" onClick={(e) => e.stopPropagation()}>
            <div class="db-dialog-header">
              <span>Add Column to {sidebar.selectedTable?.table}</span>
              <button class="btn btn-ghost btn-sm" onClick={() => setDialog('addColumn', false)}>
                <Icon name="fa-solid fa-xmark" />
              </button>
            </div>
            <div class="db-dialog-body">
              <div class="db-dialog-field">
                <label>Name</label>
                <input type="text" value={dialog.newColDef.name} onInput={(e) => setDialog('newColDef', 'name', e.target.value)} placeholder="column_name" autofocus />
              </div>
              <div class="db-dialog-field">
                <label>Type</label>
                <input type="text" value={dialog.newColDef.type} onInput={(e) => setDialog('newColDef', 'type', e.target.value)} placeholder="TEXT" />
              </div>
              <div class="db-dialog-field db-dialog-field-inline">
                <label>
                  <input type="checkbox" checked={dialog.newColDef.nullable} onChange={(e) => setDialog('newColDef', 'nullable', e.target.checked)} />
                  Nullable
                </label>
              </div>
              <div class="db-dialog-field">
                <label>Default</label>
                <input type="text" value={dialog.newColDef.defaultValue} onInput={(e) => setDialog('newColDef', 'defaultValue', e.target.value)} placeholder="" />
              </div>
              <Show when={dialog.addColumnError}>
                <div class="db-dialog-error">{dialog.addColumnError}</div>
              </Show>
            </div>
            <div class="db-dialog-footer">
              <button class="btn btn-ghost" onClick={() => setDialog('addColumn', false)}>Cancel</button>
              <button class="btn btn-primary" onClick={submitAddColumn}>Add</button>
            </div>
          </div>
        </div>
      </Show>

      <Modal />
    </div>
  );
}

function ResultsTable(props) {
  const [ctxMenu, setCtxMenu] = createSignal(null); // { col, x, y }
  const [cellCtxMenu, setCellCtxMenu] = createSignal(null); // { col, rowIndex, val, x, y }
  const [rowCtxMenu, setRowCtxMenu] = createSignal(null); // { rowIndex, x, y }
  const [colWidths, setColWidths] = createSignal({});
  const [expandedArrays, setExpandedArrays] = createSignal({}); // { "rowIndex:col": true }
  let tableRef;
  const [sortCols, setSortCols] = createSignal([]); // [{ col, dir: 'asc'|'desc' }, ...]

  function onHeaderClick(col) {
    setSortCols((prev) => {
      const idx = prev.findIndex((s) => s.col === col);
      if (idx >= 0) {
        // asc → desc → remove
        if (prev[idx].dir === 'asc') {
          const next = [...prev];
          next[idx] = { col, dir: 'desc' };
          return next;
        }
        return prev.filter((_, i) => i !== idx);
      }
      // Add to sort chain
      return [...prev, { col, dir: 'asc' }];
    });
    setExpandedArrays({});
  }

  function clearSort() {
    setSortCols([]);
    setExpandedArrays({});
  }

  function getSortInfo(col) {
    const cols = sortCols();
    const idx = cols.findIndex((s) => s.col === col);
    if (idx < 0) return null;
    return { dir: cols[idx].dir, order: cols.length > 1 ? idx + 1 : null };
  }

  function sortedRows() {
    const cols = sortCols();
    if (cols.length === 0) return props.rows;
    return [...props.rows].sort((a, b) => {
      for (const { col, dir } of cols) {
        const m = dir === 'asc' ? 1 : -1;
        const va = a[col];
        const vb = b[col];
        if (va === null || va === undefined) { if (vb !== null && vb !== undefined) return 1; continue; }
        if (vb === null || vb === undefined) return -1;
        const na = Number(va);
        const nb = Number(vb);
        let cmp;
        if (!isNaN(na) && !isNaN(nb)) { cmp = na - nb; }
        else { cmp = String(va).localeCompare(String(vb)); }
        if (cmp !== 0) return cmp * m;
      }
      return 0;
    });
  }

  function onHeaderContext(e, col) {
    if (!props.onSetColumnFormat) return;
    e.preventDefault();
    setCellCtxMenu(null);
    setCtxMenu({ col, x: e.clientX, y: e.clientY });
  }

  function onCellContext(e, col, rowIndex, val) {
    e.preventDefault();
    setCtxMenu(null);
    setRowCtxMenu(null);
    setCellCtxMenu({ col, rowIndex, val, x: e.clientX, y: e.clientY });
  }

  function onRowNumContext(e, rowIndex) {
    e.preventDefault();
    setCtxMenu(null);
    setCellCtxMenu(null);
    setRowCtxMenu({ rowIndex, x: e.clientX, y: e.clientY });
  }

  function rowCtxDelete() {
    const m = rowCtxMenu();
    if (!m) return;
    props.onDeleteRow?.(m.rowIndex);
    setRowCtxMenu(null);
  }

  function cellCtxCopy() {
    const m = cellCtxMenu();
    if (!m) return;
    const text = m.val === null || m.val === undefined ? '' : String(m.val);
    navigator.clipboard.writeText(text);
    setCellCtxMenu(null);
  }

  function cellCtxEdit() {
    const m = cellCtxMenu();
    if (!m) return;
    props.onCellDblClick?.(m.col, m.rowIndex, m.val);
    setCellCtxMenu(null);
  }

  function pickFormat(fmt) {
    const col = ctxMenu()?.col;
    if (!col) return;
    props.onSetColumnFormat(col, fmt === 'raw' ? undefined : fmt);
    setCtxMenu(null);
  }

  function closeMenu() { setCtxMenu(null); setCellCtxMenu(null); setRowCtxMenu(null); }

  function onResizeStart(e, col) {
    e.preventDefault();
    e.stopPropagation();
    const th = e.target.parentElement;
    const startX = e.clientX;
    const startW = th.offsetWidth;
    const handle = e.target;
    handle.classList.add('resizing');

    // Snapshot all column widths on first resize so we can switch to fixed layout
    if (Object.keys(colWidths()).length === 0 && tableRef) {
      const ths = tableRef.querySelectorAll('thead th');
      const snapshot = {};
      const cols = props.columns;
      // skip first th (#) by starting at index 1
      for (let idx = 0; idx < cols.length; idx++) {
        snapshot[cols[idx]] = ths[idx + 1]?.offsetWidth || 100;
      }
      setColWidths(snapshot);
    }

    function onMove(ev) {
      const w = Math.max(40, startW + (ev.clientX - startX));
      setColWidths((prev) => ({ ...prev, [col]: w }));
    }
    function onUp() {
      handle.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div class="db-results-table-wrap" onClick={closeMenu}>
      <Show when={ctxMenu()}>
        <div class="db-ctx-backdrop" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
        <div class="db-ctx-menu" style={{ left: ctxMenu().x + 'px', top: ctxMenu().y + 'px' }}>
          <div class="db-ctx-menu-label">Format: {ctxMenu().col}</div>
          <For each={COLUMN_FORMATS}>
            {(f) => (
              <button
                class="db-ctx-menu-item"
                classList={{ active: (props.columnFormats?.[ctxMenu().col] || 'raw') === f.id }}
                onClick={() => pickFormat(f.id)}
              >
                {f.label}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={cellCtxMenu()}>
        <div class="db-ctx-backdrop" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
        <div class="db-ctx-menu" style={{ left: cellCtxMenu().x + 'px', top: cellCtxMenu().y + 'px' }}>
          <button class="db-ctx-menu-item" onClick={cellCtxCopy}>
            <Icon name="fa-solid fa-copy" /> Copy
          </button>
          <button class="db-ctx-menu-item" onClick={cellCtxEdit}>
            <Icon name="fa-solid fa-pen" /> Edit
          </button>
        </div>
      </Show>
      <Show when={rowCtxMenu()}>
        <div class="db-ctx-backdrop" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
        <div class="db-ctx-menu" style={{ left: rowCtxMenu().x + 'px', top: rowCtxMenu().y + 'px' }}>
          <Show when={props.onDeleteRow}>
            <Show when={props.deletedRows?.[rowCtxMenu()?.rowIndex]}>
              <button class="db-ctx-menu-item" onClick={rowCtxDelete}>
                <Icon name="fa-solid fa-rotate-left" /> Undo Delete
              </button>
            </Show>
            <Show when={!props.deletedRows?.[rowCtxMenu()?.rowIndex]}>
              <button class="db-ctx-menu-item db-ctx-menu-danger" onClick={rowCtxDelete}>
                <Icon name="fa-solid fa-trash" /> Delete Row
              </button>
            </Show>
          </Show>
        </div>
      </Show>
      <table
        class="db-results-table"
        ref={(el) => { tableRef = el; }}
        style={Object.keys(colWidths()).length ? {
          'table-layout': 'fixed',
          'width': (Object.values(colWidths()).reduce((s, w) => s + w, 0) + 40) + 'px',
        } : {}}
      >
        <thead>
          <tr>
            <th class={`db-row-num ${sortCols().length ? 'db-row-num-clear' : ''}`}
              onClick={clearSort}
              title={sortCols().length ? 'Clear sort' : ''}
            >
              <Show when={sortCols().length}>
                <Icon name="fa-solid fa-xmark" />
              </Show>
              <Show when={!sortCols().length}>#</Show>
            </th>
            <For each={props.columns}>{(col) => {
              const isPk = () => props.pkColumns?.has(col);
              const fmt = () => props.columnFormats?.[col];
              const w = () => colWidths()[col];
              const sortInfo = () => getSortInfo(col);
              return (
                <th
                  onClick={() => onHeaderClick(col)}
                  onContextMenu={(e) => onHeaderContext(e, col)}
                  classList={{ 'db-col-has-format': !!fmt(), 'db-col-sorted': !!sortInfo() }}
                  style={w() ? { width: w() + 'px' } : {}}
                >
                  <Show when={isPk()}>
                    <i class="fa-solid fa-key db-pk-icon" />
                  </Show>
                  {col}
                  <Show when={sortInfo()}>
                    <span class="db-sort-indicator">
                      <i class={`fa-solid ${sortInfo().dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} db-sort-icon`} />
                      <Show when={sortInfo().order !== null}>
                        <span class="db-sort-order">{sortInfo().order}</span>
                      </Show>
                    </span>
                  </Show>
                  <Show when={fmt()}>
                    <span class="db-col-format-badge">{fmt()}</span>
                  </Show>
                  <div class="db-col-resize" onMouseDown={(e) => onResizeStart(e, col)} />
                </th>
              );
            }}</For>
          </tr>
        </thead>
        <tbody>
          <For each={sortedRows()}>
            {(row, i) => {
              const isDeleted = () => !!props.deletedRows?.[i()];
              // Collect expanded array columns for this row
              const expandedArrayCols = () => {
                const result = [];
                for (const col of props.columns) {
                  const key = `${i()}:${col}`;
                  if (expandedArrays()[key] && props.columnFormats?.[col] === 'array') {
                    const val = row[col];
                    if (val !== null && val !== undefined) {
                      const items = parsePgArray(val);
                      if (items) result.push({ col, items });
                    }
                  }
                }
                return result;
              };
              // Max array length across expanded columns
              const maxArrayLen = () => {
                const cols = expandedArrayCols();
                if (cols.length === 0) return 0;
                return Math.max(...cols.map((c) => c.items.length));
              };

              return (
                <>
                  <tr classList={{ 'db-row-deleted': isDeleted(), 'db-row-has-expanded': maxArrayLen() > 0 }}>
                    <td class="db-row-num" onContextMenu={(e) => onRowNumContext(e, i())}>{i() + 1}</td>
                    <For each={props.columns}>
                      {(col) => {
                        const val = row[col];
                        const isLarge = typeof val === 'string' && val.startsWith('[Large data:');
                        const isNull = val === null || val === undefined;
                        const isActive = () => {
                          const p = props.cellPanel;
                          return p && p.column === col && p.rowIndex === i();
                        };
                        const isEdited = () => !!props.editedCells?.[`${i()}:${col}`];
                        const fmt = () => props.columnFormats?.[col];
                        const formatted = () => isNull ? null : formatCellValue(val, fmt());
                        const isUrl = () => fmt() === 'url' && !isNull;
                        const isArray = () => fmt() === 'array' && !isNull;
                        const arrayKey = () => `${i()}:${col}`;
                        const isExpanded = () => !!expandedArrays()[arrayKey()];
                        const arrayItems = () => isArray() ? parsePgArray(val) : null;

                        function toggleArray(e) {
                          e.stopPropagation();
                          const key = arrayKey();
                          setExpandedArrays((prev) => ({ ...prev, [key]: !prev[key] }));
                        }

                        return (
                          <td
                            class={`${isLarge ? 'db-cell-large' : ''} ${isNull ? 'db-cell-null' : ''} ${isActive() ? 'db-cell-active' : ''} ${formatted() !== null ? 'db-cell-formatted' : ''} ${isEdited() ? 'db-cell-edited' : ''}`}
                            title={formatted() !== null && !isArray() ? `Raw: ${val}` : (isLarge ? val : undefined)}
                            onDblClick={() => props.onCellDblClick?.(col, i(), val)}
                            onContextMenu={(e) => onCellContext(e, col, i(), val)}
                          >
                            {isNull
                              ? 'NULL'
                              : isArray() && arrayItems()
                                ? <span class="db-array-toggle" onClick={toggleArray}>
                                    <Icon name={isExpanded() ? 'fa-solid fa-caret-down' : 'fa-solid fa-caret-right'} />
                                    {' '}[{arrayItems().length}]
                                  </span>
                                : isUrl()
                                  ? <a class="db-cell-url" href={String(val)} onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.api.openExternal(String(val)); }}>{String(val)}</a>
                                  : (formatted() ?? String(val))}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                  <For each={Array.from({ length: maxArrayLen() }, (_, idx) => idx)}>
                    {(arrIdx) => (
                      <tr class="db-array-row">
                        <td class="db-row-num db-array-row-num">{i() + 1}.{arrIdx}</td>
                        <For each={props.columns}>
                          {(col) => {
                            const expanded = () => expandedArrayCols().find((c) => c.col === col);
                            const item = () => {
                              const e = expanded();
                              if (!e || arrIdx >= e.items.length) return undefined;
                              return e.items[arrIdx];
                            };
                            return (
                              <td class={`db-array-row-cell ${item() === null ? 'db-cell-null' : ''} ${expanded() && item() === undefined ? 'db-array-row-empty' : ''}`}>
                                <Show when={expanded()}>
                                  {item() === null ? 'NULL' : item() === undefined ? '' : item()}
                                </Show>
                              </td>
                            );
                          }}
                        </For>
                      </tr>
                    )}
                  </For>
                </>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}
