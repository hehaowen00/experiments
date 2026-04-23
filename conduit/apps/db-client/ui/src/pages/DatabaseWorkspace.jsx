import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { FormField, FormModal, Icon, Modal, showAlert, showConfirm, showPrompt } from '@conduit/ui-shared';
import CodeEditor from '../components/CodeEditor';
import ResultsTable from '../components/ResultsTable';
import SqlEditor from '../components/SqlEditor';
import {
  autoDetectColumnFormats,
  detectFormat,
  formatCellValue,
  parsePgArray,
  prettifyJson,
  serializePgArray,
} from '../db';

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
  const [queryPage, setQueryPage] = createSignal(0);
  const QUERY_PAGE_SIZE = 100;

  // Sort state for data tab
  const [dataSortCols, setDataSortCols] = createSignal([]);

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

  // Connection lost / reconnect state
  const [disconnected, setDisconnected] = createSignal(false);
  const [reconnecting, setReconnecting] = createSignal(false);

  // Sequence counter for selectTable race guard
  let selectSeq = 0;

  async function reconnect() {
    setReconnecting(true);
    const result = await window.api.dbConnect({
      id: connData.liveId,
      type: connData.type,
      config: connData.config,
    });
    setReconnecting(false);
    if (result.ok) {
      setDisconnected(false);
      await loadSidebarData();
    } else {
      showAlert('Reconnect Failed', result.error || 'Could not reconnect to the database.');
    }
  }

  // Pane sizing (keep as signals - simple independent values)
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [sidebarWidth, setSidebarWidth] = createSignal(260);
  const [editorHeight, setEditorHeight] = createSignal(200);
  const [cellPanelWidth, setCellPanelWidth] = createSignal(320);

  // Tab management
  let tabCounter = 0;
  const [tabs, setTabs] = createSignal([]);
  const [activeTabId, setActiveTabId] = createSignal(null);
  const tabStateCache = {};

  function saveTabState(tabId) {
    tabStateCache[tabId] = {
      selectedTable: sidebar.selectedTable ? { database: sidebar.selectedTable.database, schema: sidebar.selectedTable.schema, table: sidebar.selectedTable.table } : null,
      activeDatabase: sidebar.activeDatabase,
      table: {
        columns: JSON.parse(JSON.stringify(table.columns)),
        indexes: JSON.parse(JSON.stringify(table.indexes)),
        data: table.data ? JSON.parse(JSON.stringify(table.data)) : null,
        dataPage: table.dataPage,
        dataTotal: table.dataTotal,
        tab: table.tab,
        columnFormats: JSON.parse(JSON.stringify(table.columnFormats)),
      },
      query: { text: query.text, result: query.result ? JSON.parse(JSON.stringify(query.result)) : null },
      pending: { edits: JSON.parse(JSON.stringify(pending.edits)), deletes: JSON.parse(JSON.stringify(pending.deletes)) },
    };
  }

  function restoreTabState(tabId) {
    const c = tabStateCache[tabId];
    if (!c) {
      resetTabState();
      return;
    }
    setSidebar('selectedTable', c.selectedTable);
    if (c.activeDatabase) setSidebar('activeDatabase', c.activeDatabase);
    setTable(c.table);
    setQuery({ text: c.query.text, result: c.query.result, running: false });
    setCell({ open: false, panel: null, editValue: '', dirty: false, saving: false });
    setPending(c.pending);
  }

  function resetTabState() {
    setSidebar('selectedTable', null);
    setTable({ columns: [], indexes: [], data: null, dataPage: 0, dataTotal: 0, tab: 'data', columnFormats: {} });
    setQuery({ text: '', result: null, running: false });
    setCell({ open: false, panel: null, editValue: '', dirty: false, saving: false });
    setPending({ edits: {}, deletes: {} });
  }

  function tabLabel(tableName) {
    if (!tableName) return 'Query';
    if (connData.type === 'sqlite') return tableName;
    return `${sidebar.activeDatabase} - ${tableName}`;
  }

  function addTab() {
    const currentId = activeTabId();
    if (currentId) saveTabState(currentId);
    tabCounter++;
    const newId = tabCounter;
    setTabs(prev => [...prev, { id: newId, label: tabLabel(null) }]);
    setActiveTabId(newId);
    resetTabState();
    schedulePersist();
  }

  function switchToTab(tabId) {
    const currentId = activeTabId();
    if (currentId === tabId) return;
    if (currentId) saveTabState(currentId);
    setActiveTabId(tabId);
    restoreTabState(tabId);
  }

  function closeTab(tabId) {
    const tabsList = tabs();
    const idx = tabsList.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    delete tabStateCache[tabId];
    const newTabs = tabsList.filter(t => t.id !== tabId);
    setTabs(newTabs);
    if (activeTabId() === tabId) {
      if (newTabs.length > 0) {
        const newIdx = Math.min(idx, newTabs.length - 1);
        const newActive = newTabs[newIdx].id;
        setActiveTabId(newActive);
        restoreTabState(newActive);
      } else {
        setActiveTabId(null);
        resetTabState();
      }
    }
    schedulePersist();
  }

  let persistTimer = null;
  let hydrated = false;

  function persistQueries() {
    const activeId = activeTabId();
    if (activeId) saveTabState(activeId);
    const payload = tabs().map((t) => ({
      id: t.id,
      text: tabStateCache[t.id]?.query?.text ?? '',
    }));
    window.api.dbConnSaveQueries(connData.id, payload);
  }

  function schedulePersist() {
    if (!hydrated) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistQueries();
    }, 400);
  }

  createEffect(() => {
    query.text;
    schedulePersist();
  });

  onMount(async () => {
    const saved = await window.api.dbConnGetQueries(connData.id);
    if (Array.isArray(saved) && saved.length > 0) {
      const hydratedTabs = saved.map((entry, i) => {
        tabCounter++;
        const id = tabCounter;
        tabStateCache[id] = {
          selectedTable: null,
          activeDatabase: sidebar.activeDatabase,
          table: { columns: [], indexes: [], data: null, dataPage: 0, dataTotal: 0, tab: 'data', columnFormats: {} },
          query: { text: entry.text || '', result: null },
          pending: { edits: {}, deletes: {} },
        };
        return { id, label: tabLabel(null) };
      });
      setTabs(hydratedTabs);
      setActiveTabId(hydratedTabs[0].id);
      restoreTabState(hydratedTabs[0].id);
    } else {
      addTab();
    }
    hydrated = true;
    await loadSidebarData();
  });

  onCleanup(() => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
      persistQueries();
    }
    window.api.dbDisconnect(connData.liveId);
    window.api.onDbConnectionLost(null);
    window.api.onDbDownloadProgress(null);
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

  async function selectTable(database, schema, tableName) {
    const seq = ++selectSeq;
    setSidebar('selectedTable', { database, schema, table: tableName });
    setTable({ tab: 'data', dataPage: 0, columnFormats: {} });
    setDataSortCols([]);
    setPending({ edits: {}, deletes: {} });
    const qualified = connData.type === 'sqlite'
      ? `"${tableName}"`
      : `"${schema}"."${tableName}"`;
    setQuery('text', `SELECT * FROM ${qualified};`);
    const id = activeTabId();
    if (id) setTabs(prev => prev.map(t => t.id === id ? { ...t, label: tabLabel(tableName) } : t));
    const [colResult, idxResult] = await Promise.all([
      window.api.dbGetColumns(connData.liveId, schema, tableName),
      window.api.dbGetIndexes(connData.liveId, schema, tableName),
    ]);
    if (seq !== selectSeq) return;
    if (colResult.columns) setTable('columns', colResult.columns);
    if (idxResult.indexes) setTable('indexes', idxResult.indexes);
    await loadTableData(0);
  }

  async function loadTableData(page, sortOverride) {
    const t = sidebar.selectedTable;
    if (!t) return;
    setTable('dataPage', page);
    const sort = sortOverride !== undefined ? sortOverride : dataSortCols();
    const result = await window.api.dbGetTableData(connData.liveId, t.schema, t.table, PAGE_SIZE, page * PAGE_SIZE, sort.length > 0 ? sort : undefined);
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
    setQueryPage(0);
    const result = await window.api.dbQuery(connData.liveId, sql);
    setQuery({ running: false, result });
  }

  async function loadQueryPage(page) {
    setQueryPage(page);
    const result = await window.api.dbQuery(
      connData.liveId,
      null,
      QUERY_PAGE_SIZE,
      page * QUERY_PAGE_SIZE,
    );
    if (!result.error) {
      setQuery('result', 'rows', result.rows);
    }
  }

  function queryTotalPages() {
    const count = query.result?.rowCount || 0;
    return Math.max(1, Math.ceil(count / QUERY_PAGE_SIZE));
  }

  // Download / export state
  const [exportOpen, setExportOpen] = createSignal(false);
  const [exportCols, setExportCols] = createSignal({});
  const [download, setDownload] = createStore({
    active: false,
    written: 0,
    total: 0,
    error: null,
    filePath: null,
  });

  function openExportMenu() {
    const cols = table.data?.columns || [];
    const sel = {};
    for (const c of cols) sel[c] = true;
    setExportCols(sel);
    setExportOpen(true);
  }

  function toggleExportCol(col) {
    setExportCols((prev) => ({ ...prev, [col]: !prev[col] }));
  }

  function toggleAllExportCols() {
    const cols = exportCols();
    const allSelected = Object.values(cols).every(Boolean);
    const next = {};
    for (const c of Object.keys(cols)) next[c] = !allSelected;
    setExportCols(next);
  }

  onMount(() => {
    window.api.onDbConnectionLost((data) => {
      if (data.id === connData.liveId) setDisconnected(true);
    });
    window.api.onDbDownloadProgress((data) => {
      if (data.stage === 'start') {
        setDownload({ active: true, written: 0, total: data.total, error: null, filePath: data.filePath });
      } else if (data.stage === 'progress') {
        setDownload({ written: data.written, total: data.total });
      } else if (data.stage === 'done') {
        setDownload({ active: false, written: data.written, total: data.total, filePath: data.filePath });
      } else if (data.stage === 'error') {
        setDownload({ active: false, error: data.error });
      }
    });
  });

  async function startDownload(mode, format) {
    const selected = Object.entries(exportCols())
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (mode === 'table' && selected.length === 0) return;
    setExportOpen(false);
    const t = sidebar.selectedTable;
    const result = await window.api.dbDownload({
      connId: connData.liveId,
      mode,
      format,
      schema: t?.schema,
      table: t?.table,
      columns: mode === 'table' ? selected : undefined,
    });
    if (result?.error) {
      showAlert('Download Failed', result.error);
    }
  }

  function activeTab() {
    if (table.tab === 'query' && !query.text.trim() && sidebar.selectedTable) return 'data';
    return table.tab;
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
  let cellEditorRef = null;

  function focusCellEditor() {
    requestAnimationFrame(() => {
      if (!cellEditorRef) return;
      if (typeof cellEditorRef.focusEnd === 'function') {
        cellEditorRef.focusEnd();
      } else if (typeof cellEditorRef.focus === 'function') {
        cellEditorRef.focus();
        cellEditorRef.selectionStart = cellEditorRef.selectionEnd = cellEditorRef.value.length;
      }
    });
  }

  async function fetchCellInline(col, rowIndex) {
    const src = tableSource();
    if (!src.liveId || !src.schema || !src.table) return;
    const rowOffset = (src.pageOffset || 0) + rowIndex;
    const result = await window.api.dbGetCellValue(
      src.liveId, src.schema, src.table, col, rowOffset,
    );
    if (!result.error && result.value !== undefined) {
      setTable('data', 'rows', rowIndex, (prev) => ({ ...prev, [col]: result.value }));
    }
  }

  async function fetchQueryCellInline(col, rowIndex) {
    const rowOffset = queryPage() * QUERY_PAGE_SIZE + rowIndex;
    const result = await window.api.dbQueryCellValue(
      connData.liveId, col, rowOffset,
    );
    if (!result.error && result.value !== undefined) {
      setQuery('result', 'rows', rowIndex, (prev) => ({ ...prev, [col]: result.value }));
    }
  }

  async function onCellDblClick(col, rowIndex, currentVal, source) {
    const isLarge = typeof currentVal === 'string' && currentVal.startsWith('[Payload:');
    setCell('dirty', false);
    if (isLarge && source?.liveId && source?.schema && source?.table) {
      setCell({ panel: { column: col, rowIndex, value: null, loading: true, source }, open: true });
      const result = await window.api.dbGetCellValue(
        source.liveId, source.schema, source.table, col, (source.pageOffset || 0) + rowIndex,
      );
      const val = result.error ? `Error: ${result.error}` : result.value;
      const editVal = detectFormat(val) === 'json' ? prettifyJson(val) : val;
      setCell({ panel: { column: col, rowIndex, value: val, loading: false, source }, editValue: editVal ?? '' });
      focusCellEditor();
    } else if (isLarge && !source) {
      // Query results: fetch via last-query subquery
      setCell({ panel: { column: col, rowIndex, value: null, loading: true, source: null }, open: true });
      const rowOffset = queryPage() * QUERY_PAGE_SIZE + rowIndex;
      const result = await window.api.dbQueryCellValue(connData.liveId, col, rowOffset);
      const val = result.error ? `Error: ${result.error}` : result.value;
      const editVal = detectFormat(val) === 'json' ? prettifyJson(val) : val;
      setCell({ panel: { column: col, rowIndex, value: val, loading: false, source: null }, editValue: editVal ?? '' });
      focusCellEditor();
    } else {
      const isNull = currentVal === null || currentVal === undefined;
      const val = isNull ? null : String(currentVal);
      const editVal = detectFormat(val) === 'json' ? prettifyJson(val) : val;
      setCell({ panel: { column: col, rowIndex, value: val, loading: false, source }, editValue: editVal ?? '', open: true });
      focusCellEditor();
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
    const key = `${p.rowIndex}\0${p.column}`;
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
      const trimmed = newName.trim();
      setSidebar('selectedTable', { database: sidebar.selectedTable.database, schema, table: trimmed });
      const id = activeTabId();
      if (id) setTabs(prev => prev.map(t => t.id === id ? { ...t, label: tabLabel(trimmed) } : t));
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

    try {
      // Apply deletes first (in reverse order so offsets stay valid)
      const deleteIndices = Object.keys(pending.deletes).map(Number).sort((a, b) => b - a);
      for (const ri of deleteIndices) {
        const absOffset = pageOffset + ri;
        const result = await window.api.dbDeleteRow(connData.liveId, t.schema, t.table, absOffset);
        if (result.error) { showAlert('Save Failed', `Delete row ${ri + 1}: ${result.error}`); return; }
      }

      // Apply edits (skip edits on deleted rows)
      const editEntries = Object.values(pending.edits).filter((e) => !pending.deletes[e.rowIndex]);
      for (const e of editEntries) {
        const absOffset = pageOffset + e.rowIndex;
        const result = await window.api.dbUpdateCell(connData.liveId, t.schema, t.table, e.col, absOffset, e.value);
        if (result.error) { showAlert('Save Failed', `Edit ${e.col} row ${e.rowIndex + 1}: ${result.error}`); return; }
      }

      setPending({ edits: {}, deletes: {} });
      await loadTableData(table.dataPage);
    } catch (e) {
      showAlert('Save Failed', e.message || 'An unexpected error occurred while saving changes.');
    }
  }

  // Refresh tables in sidebar
  async function refreshTables() {
    const dbName = sidebar.activeDatabase || '_default';
    const tableResult = await window.api.dbListTables(connData.liveId);
    if (tableResult.tables) setSidebar('tablesByDb', dbName, tableResult.tables);
  }

  // Resize handlers
  function startResize(e, onDrag) {
    e.preventDefault();
    function onMove(ev) {
      try { onDrag(ev); } catch {}
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onSidebarResizeStart(e) {
    const startX = e.clientX;
    const startWidth = sidebarWidth();
    startResize(e, (ev) => setSidebarWidth(Math.max(180, Math.min(500, startWidth + ev.clientX - startX))));
  }

  function onEditorResizeStart(e) {
    const startY = e.clientY;
    const startHeight = editorHeight();
    startResize(e, (ev) => setEditorHeight(Math.max(80, Math.min(600, startHeight + ev.clientY - startY))));
  }

  function onCellPanelResizeStart(e) {
    const startX = e.clientX;
    const startWidth = cellPanelWidth();
    startResize(e, (ev) => setCellPanelWidth(Math.max(200, Math.min(600, startWidth - (ev.clientX - startX)))));
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
    const { database, schema, table: t } = treeProps;
    const key = `${schema}.${t.table_name}`;
    const isSelected = () =>
      sidebar.selectedTable?.database === database && sidebar.selectedTable?.schema === schema && sidebar.selectedTable?.table === t.table_name;
    const isExpanded = () => sidebar.expandedTables.has(key);
    return (
      <div>
        <div
          class={`db-tree-item ${isSelected() ? 'active' : ''}`}
          onClick={() => selectTable(database, schema, t.table_name)}
        >
          <button
            class="db-tree-expand"
            onClick={(e) => {
              e.stopPropagation();
              toggleTableExpand(key);
              if (!isSelected()) selectTable(database, schema, t.table_name);
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
    <div class="db-workspace-page" style={props.style}>
      <Show when={disconnected()}>
        <div class="db-reconnect-overlay">
          <div class="db-reconnect-modal">
            <Icon name="fa-solid fa-plug-circle-xmark" />
            <h3>Connection Lost</h3>
            <p>The database connection was terminated unexpectedly.</p>
            <div class="db-reconnect-actions">
              <button class="btn btn-ghost btn-sm" onClick={props.onBack}>Back</button>
              <button class="btn btn-primary btn-sm" onClick={reconnect} disabled={reconnecting()}>
                <Show when={reconnecting()} fallback={<>
                  <Icon name="fa-solid fa-rotate-right" /> Reconnect
                </>}>
                  <Icon name="fa-solid fa-spinner fa-spin" /> Reconnecting...
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>
      <div class="db-workspace">
        {/* Left sidebar: tables */}
        <Show when={sidebarOpen()}>
          <div class="db-sidebar" style={{ width: sidebarWidth() + 'px' }}>
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
                                    {(t) => <TableTreeItem database={dbName} schema={schema} table={t} />}
                                  </For>
                                </>
                              )}
                            </For>
                            <Show when={Object.keys(schemas()).length === 0 && !isLoading()}>
                              <div class="db-empty" style={{ padding: '4px 12px 4px 32px', 'font-size': 'var(--ui-font-size-sm)' }}>No tables</div>
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
                        {(t) => <TableTreeItem database="_default" schema={schema} table={t} />}
                      </For>
                    </>
                  )}
                </For>
                <Show when={(sidebar.tablesByDb['_default'] || []).length === 0}>
                  <div class="db-empty" style={{ padding: '12px', 'font-size': 'var(--ui-font-size-sm)' }}>No tables found</div>
                </Show>
              </Show>

              {/* Postgres with no databases listed */}
              <Show when={connData.type === 'postgres' && sidebar.databases.length === 0}>
                <div class="db-empty" style={{ padding: '12px', 'font-size': 'var(--ui-font-size-sm)' }}>No databases found</div>
              </Show>
            </div>
          </div>

          <div class="db-resize-handle-v" onMouseDown={onSidebarResizeStart} />
        </Show>

        {/* Center: editor + results */}
        <div class="db-main">
          <div class="db-tab-bar">
            <Show when={!sidebarOpen()}>
              <button class="btn btn-ghost btn-sm db-tab-bar-menu" onClick={() => setSidebarOpen(true)} title="Open sidebar">
                <Icon name="fa-solid fa-bars" />
              </button>
            </Show>
            <For each={tabs()}>
              {(tab) => (
                <div
                  class={`db-tab-item ${activeTabId() === tab.id ? 'active' : ''}`}
                  onClick={() => switchToTab(tab.id)}
                  onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } }}
                >
                  <span class="db-tab-item-label">{tab.label}</span>
                  <button
                    class="db-tab-item-close"
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  >
                    <Icon name="fa-solid fa-xmark" />
                  </button>
                </div>
              )}
            </For>
            <button class="btn btn-ghost btn-sm db-tab-bar-add" onClick={addTab} title="New tab">
              <Icon name="fa-solid fa-plus" />
            </button>
          </div>
          <div class="db-editor-pane" style={{ height: editorHeight() + 'px' }}>
            <div class="db-editor-toolbar">
              <span class="db-editor-title">Query</span>
              <span class="db-editor-hint">Ctrl+Enter to run</span>
              <button
                class="btn btn-primary btn-sm"
                onClick={runQuery}
                disabled={query.running}
              >
                <Icon name="fa-solid fa-play" />
                {query.running ? 'Running...' : 'Run'}
              </button>
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
                <button class={`db-tab ${activeTab() === 'data' ? 'active' : ''}`} onClick={() => setTable('tab', 'data')}>Data</button>
                <button class={`db-tab ${activeTab() === 'columns' ? 'active' : ''}`} onClick={() => setTable('tab', 'columns')}>Columns</button>
                <button class={`db-tab ${activeTab() === 'indexes' ? 'active' : ''}`} onClick={() => setTable('tab', 'indexes')}>Indexes</button>
                <button class={`db-tab ${activeTab() === 'query' ? 'active' : ''}`} onClick={() => setTable('tab', 'query')}>Query Results</button>
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
            <Show when={activeTab() === 'data' && table.data}>
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
                  <div class="db-export-wrap">
                    <button class="btn btn-ghost btn-sm" onClick={openExportMenu} title="Export table data">
                      <Icon name="fa-solid fa-download" /> Export
                    </button>
                    <Show when={exportOpen()}>
                      <div class="db-ctx-backdrop" onClick={() => setExportOpen(false)} onContextMenu={(e) => { e.preventDefault(); setExportOpen(false); }} />
                      <div class="db-export-popover">
                        <div class="db-export-popover-header">Export Columns</div>
                        <div class="db-export-col-toggle-all">
                          <label>
                            <input
                              type="checkbox"
                              checked={Object.values(exportCols()).every(Boolean)}
                              ref={(el) => {
                                createEffect(() => {
                                  const vals = Object.values(exportCols());
                                  el.indeterminate = !vals.every(Boolean) && vals.some(Boolean);
                                });
                              }}
                              onChange={toggleAllExportCols}
                            />
                            Select All
                          </label>
                        </div>
                        <div class="db-export-col-list">
                          <For each={Object.keys(exportCols())}>
                            {(col) => (
                              <label class="db-export-col-item">
                                <input
                                  type="checkbox"
                                  checked={exportCols()[col]}
                                  onChange={() => toggleExportCol(col)}
                                />
                                {col}
                              </label>
                            )}
                          </For>
                        </div>
                        <div class="db-export-actions">
                          <button
                            class="btn btn-ghost btn-sm"
                            onClick={() => startDownload('table', 'csv')}
                            disabled={download.active || !Object.values(exportCols()).some(Boolean)}
                          >
                            <Icon name="fa-solid fa-file-csv" /> CSV
                          </button>
                          <button
                            class="btn btn-ghost btn-sm"
                            onClick={() => startDownload('table', 'json')}
                            disabled={download.active || !Object.values(exportCols()).some(Boolean)}
                          >
                            <Icon name="fa-solid fa-file-code" /> JSON
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
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
                  onFetchCell={fetchCellInline}
                  cellPanel={cell.panel}
                  pkColumns={new Set(table.columns.filter(c => c.pk).map(c => c.column_name))}
                  onDeleteRow={deleteRow}
                  columnFormats={table.columnFormats}
                  onSetColumnFormat={(col, fmt) => setTable('columnFormats', col, fmt)}
                  deletedRows={pending.deletes}
                  editedCells={pending.edits}
                  sortCols={dataSortCols()}
                  onSort={(cols) => { setDataSortCols(cols); setPending({ edits: {}, deletes: {} }); loadTableData(0, cols); }}
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
            <Show when={activeTab() === 'columns'}>
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
            <Show when={activeTab() === 'indexes'}>
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
            <Show when={activeTab() === 'query' || !sidebar.selectedTable}>
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
                    <Show when={query.result.columns}>
                      <button class="btn btn-ghost btn-sm" onClick={() => startDownload('query', 'csv')} title="Download as CSV" disabled={download.active}>
                        <Icon name="fa-solid fa-file-csv" />
                      </button>
                      <button class="btn btn-ghost btn-sm" onClick={() => startDownload('query', 'json')} title="Download as JSON" disabled={download.active}>
                        <Icon name="fa-solid fa-file-code" />
                      </button>
                    </Show>
                    <Show when={query.result.columns && queryTotalPages() > 1}>
                      <div class="db-pagination">
                        <button class="btn btn-ghost btn-sm" disabled={queryPage() === 0} onClick={() => loadQueryPage(queryPage() - 1)}>
                          <Icon name="fa-solid fa-chevron-left" />
                        </button>
                        <span>{queryPage() + 1} / {queryTotalPages()}</span>
                        <button class="btn btn-ghost btn-sm" disabled={queryPage() >= queryTotalPages() - 1} onClick={() => loadQueryPage(queryPage() + 1)}>
                          <Icon name="fa-solid fa-chevron-right" />
                        </button>
                      </div>
                    </Show>
                  </div>
                  <Show when={query.result.columns}>
                    <ResultsTable
                      columns={query.result.columns}
                      rows={query.result.rows}
                      onCellDblClick={(col, ri, val) => onCellDblClick(col, ri, val, null)}
                      onFetchCell={fetchQueryCellInline}
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
                      const fmt = () => detectFormat(cell.editValue);

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
                            <Show when={fmt() === 'json' || fmt() === 'xml'}>
                              <CodeEditor
                                value={cell.editValue}
                                format={fmt()}
                                onInput={onCellEditInput}
                                ref={(v) => { cellEditorRef = v; }}
                              />
                            </Show>
                            <Show when={fmt() !== 'json' && fmt() !== 'xml'}>
                              <textarea
                                class="db-cell-textarea"
                                value={cell.editValue}
                                onInput={(e) => onCellEditInput(e.target.value)}
                                ref={(el) => { cellEditorRef = el; }}
                                spellcheck={false}
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
            <Show when={cell.dirty}>
              <div class="db-cell-panel-footer">
                <button class="btn btn-ghost btn-sm" onClick={discardCellEdit} title="Discard changes">
                  Discard
                </button>
                <button class="btn btn-primary btn-sm" onClick={saveCellEdit} disabled={cell.saving} title="Save changes">
                  {cell.saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* Create Table Dialog */}
      <Show when={dialog.createTable}>
        <FormModal
          title="Create Table"
          size="modal-lg"
          error={dialog.createTableError}
          submitLabel="Create"
          onClose={() => setDialog('createTable', false)}
          onSubmit={submitCreateTable}
        >
          <FormField label="Table Name">
            <input type="text" value={dialog.newTableName} onInput={(e) => setDialog('newTableName', e.target.value)} placeholder="table_name" autofocus />
          </FormField>
          <FormField label="Columns">
            <table class="modal-col-table">
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
          </FormField>
        </FormModal>
      </Show>

      {/* Insert Row Dialog */}
      <Show when={dialog.insertRow}>
        <FormModal
          title={`Insert Row into ${sidebar.selectedTable?.table}`}
          size="modal-lg"
          error={dialog.insertRowError}
          submitLabel="Insert"
          onClose={() => setDialog('insertRow', false)}
          onSubmit={submitInsertRow}
        >
          <For each={table.columns}>
            {(col) => (
              <FormField class="modal-field-row">
                <label>
                  {col.column_name}
                  <span class="modal-field-type">{col.data_type}</span>
                  <Show when={col.pk}><span class="db-col-pk">PK</span></Show>
                </label>
                <input
                  type="text"
                  value={dialog.insertRowValues[col.column_name] || ''}
                  onInput={(e) => updateInsertValue(col.column_name, e.target.value)}
                  placeholder={col.column_default ? `Default: ${col.column_default}` : ''}
                />
              </FormField>
            )}
          </For>
        </FormModal>
      </Show>

      {/* Add Column Dialog */}
      <Show when={dialog.addColumn}>
        <FormModal
          title={`Add Column to ${sidebar.selectedTable?.table}`}
          error={dialog.addColumnError}
          submitLabel="Add"
          onClose={() => setDialog('addColumn', false)}
          onSubmit={submitAddColumn}
        >
          <FormField label="Name">
            <input type="text" value={dialog.newColDef.name} onInput={(e) => setDialog('newColDef', 'name', e.target.value)} placeholder="column_name" autofocus />
          </FormField>
          <FormField label="Type">
            <input type="text" value={dialog.newColDef.type} onInput={(e) => setDialog('newColDef', 'type', e.target.value)} placeholder="TEXT" />
          </FormField>
          <FormField inline>
            <label>
              <input type="checkbox" checked={dialog.newColDef.nullable} onChange={(e) => setDialog('newColDef', 'nullable', e.target.checked)} />
              Nullable
            </label>
          </FormField>
          <FormField label="Default">
            <input type="text" value={dialog.newColDef.defaultValue} onInput={(e) => setDialog('newColDef', 'defaultValue', e.target.value)} placeholder="" />
          </FormField>
        </FormModal>
      </Show>

      <Show when={download.active}>
        <div class="db-download-overlay">
          <div class="db-download-dialog">
            <div class="db-download-title">
              <Icon name="fa-solid fa-download" /> Downloading...
            </div>
            <div class="db-download-progress-bar">
              <div
                class="db-download-progress-fill"
                style={{ width: (download.total > 0 ? (download.written / download.total) * 100 : 0) + '%' }}
              />
            </div>
            <div class="db-download-stats">
              {download.written.toLocaleString()} / {download.total.toLocaleString()} rows
            </div>
            <button class="btn btn-ghost btn-sm" onClick={() => window.api.dbCancelDownload(connData.liveId)}>
              Cancel
            </button>
          </div>
        </div>
      </Show>

      <Modal />
    </div>
  );
}

