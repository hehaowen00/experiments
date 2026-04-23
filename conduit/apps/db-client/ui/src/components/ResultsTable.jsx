import { createSignal, For, Show } from 'solid-js';
import { Icon } from '@conduit/ui-shared';
import { COLUMN_FORMATS, formatCellValue, parsePgArray } from '../db';

export default function ResultsTable(props) {
  const [ctxMenu, setCtxMenu] = createSignal(null);
  const [cellCtxMenu, setCellCtxMenu] = createSignal(null);
  const [rowCtxMenu, setRowCtxMenu] = createSignal(null);
  const [colWidths, setColWidths] = createSignal({});
  const [expandedArrays, setExpandedArrays] = createSignal({});
  let tableRef;
  const [localSortCols, setLocalSortCols] = createSignal([]);

  const effectiveSortCols = () => props.onSort ? (props.sortCols || []) : localSortCols();

  function computeNextSort(prev, col) {
    const idx = prev.findIndex((s) => s.col === col);
    if (idx >= 0) {
      if (prev[idx].dir === 'asc') {
        const next = [...prev];
        next[idx] = { col, dir: 'desc' };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    }
    return [...prev, { col, dir: 'asc' }];
  }

  function onHeaderClick(col) {
    if (props.onSort) {
      const next = computeNextSort(props.sortCols || [], col);
      props.onSort(next);
    } else {
      setLocalSortCols((prev) => computeNextSort(prev, col));
    }
    setExpandedArrays({});
  }

  function clearSort() {
    if (props.onSort) {
      props.onSort([]);
    } else {
      setLocalSortCols([]);
    }
    setExpandedArrays({});
  }

  function getSortInfo(col) {
    const cols = effectiveSortCols();
    const idx = cols.findIndex((s) => s.col === col);
    if (idx < 0) return null;
    return { dir: cols[idx].dir, order: cols.length > 1 ? idx + 1 : null };
  }

  function sortedRows() {
    // When onSort is provided, sorting is done server-side
    if (props.onSort) return props.rows;
    const cols = localSortCols();
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

    if (Object.keys(colWidths()).length === 0 && tableRef) {
      const ths = tableRef.querySelectorAll('thead th');
      const snapshot = {};
      const cols = props.columns;
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
            <th class={`db-row-num ${effectiveSortCols().length ? 'db-row-num-clear' : ''}`}
              onClick={clearSort}
              title={effectiveSortCols().length ? 'Clear sort' : ''}
            >
              <Show when={effectiveSortCols().length}>
                <Icon name="fa-solid fa-xmark" />
              </Show>
              <Show when={!effectiveSortCols().length}>#</Show>
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
                        const isLarge = typeof val === 'string' && val.startsWith('[Payload:');
                        const isNull = val === null || val === undefined;
                        const isActive = () => {
                          const p = props.cellPanel;
                          return p && p.column === col && p.rowIndex === i();
                        };
                        const isEdited = () => !!props.editedCells?.[`${i()}:${col}`];
                        const CELL_MAX = 200;
                        const fmt = () => props.columnFormats?.[col];
                        const formatted = () => isNull ? null : formatCellValue(val, fmt());
                        const display = () => {
                          const text = formatted() ?? String(val);
                          return text.length > CELL_MAX ? text.slice(0, CELL_MAX) + '\u2026' : text;
                        };
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

                        function onCellClick() {
                          if (isLarge && props.onFetchCell) {
                            props.onFetchCell(col, i());
                          }
                        }

                        return (
                          <td
                            class={`${isLarge ? 'db-cell-large' : ''} ${isNull ? 'db-cell-null' : ''} ${isActive() ? 'db-cell-active' : ''} ${formatted() !== null ? 'db-cell-formatted' : ''} ${isEdited() ? 'db-cell-edited' : ''}`}
                            title={formatted() !== null && !isArray() ? `Raw: ${val}` : (isLarge ? val : undefined)}
                            onClick={onCellClick}
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
                                  : display()}
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
