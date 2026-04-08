const path = require('path');
const { ipcMain, dialog } = require('electron');
const Database = require('better-sqlite3');
const { Client: PgClient } = require('pg');
const { generateKSUID } = require('./ksuid');
const store = require('./store');

const activeDbConnections = new Map();
const activeDownloads = new Map();
const LARGE_VALUE_THRESHOLD = 5120; // 5KB

function sanitizeDefaultValue(val) {
  if (!val || !val.trim()) return null;
  const v = val.trim();
  // Allow simple literals: numbers, quoted strings, booleans, NULL, function calls like now()
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (/^'[^']*'$/.test(v)) return v;
  if (/^(true|false|null|current_timestamp|current_date|now\(\))$/i.test(v)) return v;
  // Quote it as a string literal
  return `'${v.replace(/'/g, "''")}'`;
}

function register(mainWindow) {
  // Saved connections CRUD
  ipcMain.handle('dbConn:list', () => {
    return store.getDb()
      .prepare('SELECT id, name, type, config, category_id, pinned, last_used FROM db_connections ORDER BY last_used DESC')
      .all()
      .map((r) => ({ ...r, config: JSON.parse(r.config) }));
  });

  ipcMain.handle('dbConn:create', (_, data) => {
    const id = generateKSUID();
    store.getDb().prepare(
      "INSERT INTO db_connections (id, name, type, config, category_id, last_used) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    ).run(id, data.name, data.type, JSON.stringify(data.config), data.category_id || null);
    return { id, name: data.name, type: data.type, config: data.config, category_id: data.category_id || null, pinned: 0 };
  });

  ipcMain.handle('dbConn:update', (_, id, data) => {
    store.getDb().prepare(
      'UPDATE db_connections SET name = ?, type = ?, config = ?, category_id = ? WHERE id = ?',
    ).run(data.name, data.type, JSON.stringify(data.config), data.category_id || null, id);
    return { ok: true };
  });

  ipcMain.handle('dbConn:delete', (_, id) => {
    store.getDb().prepare('DELETE FROM db_connections WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('dbConn:pin', (_, id, pinned) => {
    store.getDb().prepare('UPDATE db_connections SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
    return { ok: true };
  });

  ipcMain.handle('dbConn:setCategory', (_, id, categoryId) => {
    store.getDb().prepare('UPDATE db_connections SET category_id = ? WHERE id = ?').run(categoryId || null, id);
    return { ok: true };
  });

  ipcMain.handle('dbConn:touchLastUsed', (_, id) => {
    store.getDb().prepare("UPDATE db_connections SET last_used = datetime('now') WHERE id = ?").run(id);
    return { ok: true };
  });

  // Database categories
  ipcMain.handle('dbCat:list', () => {
    return store.getDb().prepare('SELECT * FROM db_categories ORDER BY sort_order ASC, rowid ASC').all();
  });

  ipcMain.handle('dbCat:create', (_, name) => {
    const db = store.getDb();
    const id = generateKSUID();
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM db_categories').get();
    db.prepare('INSERT INTO db_categories (id, name, sort_order, collapsed) VALUES (?, ?, ?, ?)').run(
      id, name, (maxOrder?.m || 0) + 1, 0,
    );
    return { id, name, sort_order: (maxOrder?.m || 0) + 1, collapsed: 0 };
  });

  ipcMain.handle('dbCat:rename', (_, id, name) => {
    store.getDb().prepare('UPDATE db_categories SET name = ? WHERE id = ?').run(name, id);
    return { ok: true };
  });

  ipcMain.handle('dbCat:delete', (_, id) => {
    const db = store.getDb();
    db.prepare('UPDATE db_connections SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM db_categories WHERE id = ?').run(id);
    return { ok: true };
  });

  ipcMain.handle('dbCat:toggleCollapse', (_, id, collapsed) => {
    store.getDb().prepare('UPDATE db_categories SET collapsed = ? WHERE id = ?').run(collapsed ? 1 : 0, id);
    return { ok: true };
  });

  ipcMain.handle('dbCat:reorder', (_, orderedIds) => {
    const db = store.getDb();
    const stmt = db.prepare('UPDATE db_categories SET sort_order = ? WHERE id = ?');
    const tx = db.transaction(() => { orderedIds.forEach((id, i) => stmt.run(i, id)); });
    tx();
    return { ok: true };
  });

  // Active connections
  ipcMain.handle('db:connect', async (_, opts) => {
    const { id, type, config } = opts;
    try {
      if (type === 'postgres') {
        const pgConfig = {
          host: config.host || 'localhost',
          port: parseInt(config.port) || 5432,
          user: config.user || undefined,
          password: config.password || undefined,
        };
        if (config.database) pgConfig.database = config.database;
        const client = new PgClient(pgConfig);
        await client.connect();
        client.on('error', () => {
          activeDbConnections.delete(id);
          mainWindow?.webContents?.send('db:connectionLost', { id });
        });
        activeDbConnections.set(id, { type: 'postgres', client, config: pgConfig });
        return { ok: true };
      } else if (type === 'sqlite') {
        const sqliteDb = new Database(config.path);
        sqliteDb.pragma('journal_mode = WAL');
        sqliteDb.pragma('busy_timeout = 5000');
        activeDbConnections.set(id, { type: 'sqlite', client: sqliteDb });
        return { ok: true };
      }
      return { error: 'Unknown database type' };
    } catch (e) {
      return { error: String(e.message || e) };
    }
  });

  ipcMain.handle('db:switchDatabase', async (_, id, database) => {
    const conn = activeDbConnections.get(id);
    if (!conn || conn.type !== 'postgres') return { error: 'Not a postgres connection' };
    try {
      await conn.client.end();
      const newConfig = { ...conn.config, database };
      const client = new PgClient(newConfig);
      await client.connect();
      client.on('error', () => {
        activeDbConnections.delete(id);
        mainWindow?.webContents?.send('db:connectionLost', { id });
      });
      activeDbConnections.set(id, { type: 'postgres', client, config: newConfig });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:disconnect', async (_, id) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return;
    try {
      if (conn.type === 'postgres') await conn.client.end();
      else if (conn.type === 'sqlite') conn.client.close();
    } catch {}
    activeDbConnections.delete(id);
    lastQuerySql.delete(id);
  });

  ipcMain.handle('db:listDatabases', async (_, id) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const result = await conn.client.query(
          "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
        );
        return { databases: result.rows.map((r) => r.datname) };
      } else if (conn.type === 'sqlite') {
        return { databases: [path.basename(conn.client.name)] };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:listTables', async (_, id) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const result = await conn.client.query(
          `SELECT table_schema, table_name, table_type
           FROM information_schema.tables
           WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
           ORDER BY table_schema, table_name`,
        );
        return { tables: result.rows };
      } else if (conn.type === 'sqlite') {
        const rows = conn.client.prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
        ).all();
        return { tables: rows.map((r) => ({ table_name: r.name, table_type: r.type === 'view' ? 'VIEW' : 'BASE TABLE', table_schema: 'main' })) };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:getColumns', async (_, id, schema, table) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const colResult = await conn.client.query(
          `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length,
                  numeric_precision, ordinal_position
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [schema, table],
        );
        const pkResult = await conn.client.query(
          `SELECT a.attname AS column_name
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
           WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary`,
          [schema, table],
        );
        const pkSet = new Set(pkResult.rows.map((r) => r.column_name));
        return { columns: colResult.rows.map((r) => ({ ...r, pk: pkSet.has(r.column_name) })) };
      } else if (conn.type === 'sqlite') {
        const rows = conn.client.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all();
        return {
          columns: rows.map((r) => ({
            column_name: r.name,
            data_type: r.type || 'TEXT',
            is_nullable: r.notnull ? 'NO' : 'YES',
            column_default: r.dflt_value,
            ordinal_position: r.cid + 1,
            pk: r.pk,
          })),
        };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:getIndexes', async (_, id, schema, table) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const result = await conn.client.query(
          `SELECT indexname, indexdef
           FROM pg_indexes
           WHERE schemaname = $1 AND tablename = $2
           ORDER BY indexname`,
          [schema, table],
        );
        return { indexes: result.rows };
      } else if (conn.type === 'sqlite') {
        const indexes = conn.client.prepare(`PRAGMA index_list("${table.replace(/"/g, '""')}")`).all();
        const result = indexes.map((idx) => {
          const cols = conn.client.prepare(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`).all();
          return {
            indexname: idx.name,
            indexdef: `${idx.unique ? 'UNIQUE ' : ''}INDEX ${idx.name} (${cols.map((c) => c.name).join(', ')})`,
          };
        });
        return { indexes: result };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:getTableData', async (_, id, schema, table, limit, offset, orderBy) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      const safeLimit = Math.min(limit || 100, 1000);
      const safeOffset = offset || 0;

      // Build ORDER BY clause from [{col, dir}] array
      let orderClause = '';
      if (Array.isArray(orderBy) && orderBy.length > 0) {
        const parts = orderBy.map((s) => {
          const q = `"${s.col.replace(/"/g, '""')}"`;
          const dir = s.dir === 'desc' ? 'DESC' : 'ASC';
          return `${q} ${dir}`;
        });
        orderClause = ' ORDER BY ' + parts.join(', ');
      }

      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
        // Get columns first to check for large values
        const colResult = await conn.client.query(
          `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
          [schema, table],
        );
        const selectCols = colResult.rows.map((c) => {
          const q = `"${c.column_name.replace(/"/g, '""')}"`;
          return `CASE WHEN octet_length(${q}::text) > ${LARGE_VALUE_THRESHOLD} THEN '[Payload: ' || ROUND(octet_length(${q}::text) / 1024.0, 1) || ' KB]' ELSE ${q}::text END AS ${q}`;
        });
        const countResult = await conn.client.query(`SELECT COUNT(*) as total FROM ${quotedTable}`);
        const total = parseInt(countResult.rows[0]?.total ?? 0);
        const result = await conn.client.query(
          `SELECT ${selectCols.join(', ')} FROM ${quotedTable}${orderClause} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        );
        return { rows: result.rows, columns: result.fields.map((f) => f.name), total };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${table.replace(/"/g, '""')}"`;
        const colInfo = conn.client.prepare(`PRAGMA table_info(${quotedTable})`).all();
        const selectCols = colInfo.map((c) => {
          const q = `"${c.name.replace(/"/g, '""')}"`;
          return `CASE WHEN length(CAST(${q} AS TEXT)) > ${LARGE_VALUE_THRESHOLD} THEN '[Payload: ' || ROUND(length(CAST(${q} AS TEXT)) / 1024.0, 1) || ' KB]' ELSE CAST(${q} AS TEXT) END AS ${q}`;
        });
        const countRow = conn.client.prepare(`SELECT COUNT(*) as total FROM ${quotedTable}`).get();
        const rows = conn.client.prepare(
          `SELECT ${selectCols.join(', ')} FROM ${quotedTable}${orderClause} LIMIT ? OFFSET ?`,
        ).all(safeLimit, safeOffset);
        return { rows, columns: colInfo.map((c) => c.name), total: countRow.total };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:getCellValue', async (_, id, schema, table, column, rowOffset) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
        const quotedCol = `"${column.replace(/"/g, '""')}"`;
        const result = await conn.client.query(
          `SELECT ${quotedCol}::text AS val FROM ${quotedTable} LIMIT 1 OFFSET ${parseInt(rowOffset) || 0}`,
        );
        return { value: result.rows[0]?.val ?? null };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${table.replace(/"/g, '""')}"`;
        const quotedCol = `"${column.replace(/"/g, '""')}"`;
        const row = conn.client.prepare(
          `SELECT CAST(${quotedCol} AS TEXT) AS val FROM ${quotedTable} LIMIT 1 OFFSET ?`,
        ).get(parseInt(rowOffset) || 0);
        return { value: row?.val ?? null };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:updateCell', async (_, id, schema, table, column, rowOffset, value) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
        const quotedCol = `"${column.replace(/"/g, '""')}"`;
        const ctidResult = await conn.client.query(
          `SELECT ctid FROM ${quotedTable} LIMIT 1 OFFSET ${parseInt(rowOffset) || 0}`,
        );
        if (!ctidResult.rows.length) return { error: 'Row not found' };
        const ctid = ctidResult.rows[0].ctid;
        await conn.client.query(
          `UPDATE ${quotedTable} SET ${quotedCol} = $1 WHERE ctid = $2`,
          [value, ctid],
        );
        return { ok: true };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${table.replace(/"/g, '""')}"`;
        const quotedCol = `"${column.replace(/"/g, '""')}"`;
        const row = conn.client.prepare(
          `SELECT rowid FROM ${quotedTable} LIMIT 1 OFFSET ?`,
        ).get(parseInt(rowOffset) || 0);
        if (!row) return { error: 'Row not found' };
        conn.client.prepare(
          `UPDATE ${quotedTable} SET ${quotedCol} = ? WHERE rowid = ?`,
        ).run(value, row.rowid);
        return { ok: true };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  function processPostgresRows(rows) {
    return rows.map((row) => {
      const processed = {};
      for (const key of Object.keys(row)) {
        let val = row[key];
        if (val !== null && typeof val === 'object') {
          val = JSON.stringify(val);
        }
        if (val !== null && typeof val === 'string' && Buffer.byteLength(val) > LARGE_VALUE_THRESHOLD) {
          processed[key] = `[Payload: ${(Buffer.byteLength(val) / 1024).toFixed(1)} KB]`;
        } else {
          processed[key] = val;
        }
      }
      return processed;
    });
  }

  function processSqliteRows(rows, columns) {
    return rows.map((row) => {
      const r = {};
      for (const key of columns) {
        const val = row[key];
        if (val !== null && typeof val === 'string' && Buffer.byteLength(val) > LARGE_VALUE_THRESHOLD) {
          r[key] = `[Payload: ${(Buffer.byteLength(val) / 1024).toFixed(1)} KB]`;
        } else {
          r[key] = val;
        }
      }
      return r;
    });
  }

  // Store last query SQL per connection for pagination and export
  const lastQuerySql = new Map();

  function isSelectQuery(sql) {
    const trimmed = sql.trim().toLowerCase();
    return trimmed.startsWith('select') || trimmed.startsWith('pragma') || trimmed.startsWith('explain') || trimmed.startsWith('with');
  }

  async function execPagedQuery(conn, sql, limit, offset) {
    const pagedSql = `SELECT * FROM (${sql}) AS _q LIMIT ${limit} OFFSET ${offset}`;
    const countSql = `SELECT COUNT(*) AS total FROM (${sql}) AS _q`;
    if (conn.type === 'postgres') {
      const [pageResult, countResult] = await Promise.all([
        conn.client.query(pagedSql),
        conn.client.query(countSql),
      ]);
      const columns = pageResult.fields.map((f) => f.name);
      const rows = processPostgresRows(pageResult.rows);
      const total = parseInt(countResult.rows[0]?.total ?? 0, 10);
      return { rows, columns, rowCount: total };
    } else {
      const rows = conn.client.prepare(pagedSql).all();
      const countRow = conn.client.prepare(countSql).get();
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { rows: processSqliteRows(rows, columns), columns, rowCount: countRow.total };
    }
  }

  ipcMain.handle('db:query', async (_, id, sql, limit, offset) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    const start = Date.now();
    try {
      // Page request for existing query
      if (sql == null) {
        const cached = lastQuerySql.get(id);
        if (!cached) return { error: 'No query to page' };
        const result = await execPagedQuery(conn, cached, limit, offset);
        return { ...result, time: Date.now() - start };
      }
      // Non-select statements: execute directly
      if (conn.type === 'sqlite' && !isSelectQuery(sql)) {
        const result = conn.client.prepare(sql).run();
        lastQuerySql.delete(id);
        return { rowCount: result.changes, time: Date.now() - start, command: 'RUN' };
      }
      if (conn.type === 'postgres') {
        // Try paged execution; fall back to direct for non-select
        try {
          lastQuerySql.set(id, sql);
          const result = await execPagedQuery(conn, sql, 100, 0);
          return { ...result, time: Date.now() - start };
        } catch {
          // Non-select or unsupported for wrapping — run directly
          const result = await conn.client.query(sql);
          const elapsed = Date.now() - start;
          if (result.fields && result.fields.length > 0) {
            lastQuerySql.set(id, sql);
            return {
              rows: processPostgresRows(result.rows),
              columns: result.fields.map((f) => f.name),
              rowCount: result.rowCount,
              time: elapsed,
            };
          }
          lastQuerySql.delete(id);
          return { rowCount: result.rowCount, time: elapsed, command: result.command };
        }
      }
      // SQLite select
      lastQuerySql.set(id, sql);
      const result = await execPagedQuery(conn, sql, 100, 0);
      return { ...result, time: Date.now() - start };
    } catch (e) {
      return { error: e.message, time: Date.now() - start };
    }
  });

  ipcMain.handle('db:queryExport', async (_, id) => {
    const conn = activeDbConnections.get(id);
    const sql = lastQuerySql.get(id);
    if (!conn || !sql) return { error: 'No query result to export' };
    try {
      if (conn.type === 'postgres') {
        const result = await conn.client.query(sql);
        if (result.fields && result.fields.length > 0) {
          return {
            rows: processPostgresRows(result.rows),
            columns: result.fields.map((f) => f.name),
          };
        }
        return { rows: [], columns: [] };
      } else {
        const rows = conn.client.prepare(sql).all();
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return { rows: processSqliteRows(rows, columns), columns };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:exportTableData', async (_, id, schema, table, columns) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
        const colList = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
        const result = await conn.client.query(`SELECT ${colList} FROM ${quotedTable}`);
        return {
          rows: result.rows.map((row) => {
            const out = {};
            for (const key of Object.keys(row)) {
              let val = row[key];
              if (val !== null && typeof val === 'object') val = JSON.stringify(val);
              out[key] = val;
            }
            return out;
          }),
          columns: result.fields.map((f) => f.name),
        };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${table.replace(/"/g, '""')}"`;
        const colList = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
        const rows = conn.client.prepare(`SELECT ${colList} FROM ${quotedTable}`).all();
        return { rows, columns };
      }
      return { error: 'Unsupported database type' };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:queryCellValue', async (_, id, column, rowOffset) => {
    const conn = activeDbConnections.get(id);
    const sql = lastQuerySql.get(id);
    if (!conn || !sql) return { error: 'No query result' };
    try {
      const quotedCol = `"${column.replace(/"/g, '""')}"`;
      const wrappedSql = `SELECT ${quotedCol} AS val FROM (${sql}) AS _q LIMIT 1 OFFSET ${parseInt(rowOffset) || 0}`;
      if (conn.type === 'postgres') {
        const result = await conn.client.query(wrappedSql);
        let val = result.rows[0]?.val ?? null;
        if (val !== null && typeof val === 'object') val = JSON.stringify(val);
        return { value: val };
      } else {
        const row = conn.client.prepare(wrappedSql).get();
        return { value: row?.val ?? null };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:cancelDownload', (_, connId) => {
    const ctrl = activeDownloads.get(connId);
    if (ctrl) ctrl.aborted = true;
    return { ok: true };
  });

  ipcMain.handle('db:download', async (_, opts) => {
    const { connId, mode, format, schema, table, columns } = opts;
    // mode: 'table' | 'query'
    const conn = activeDbConnections.get(connId);
    if (!conn) return { error: 'Not connected' };

    let sql;
    if (mode === 'table') {
      if (!schema || !table || !columns?.length) return { error: 'Missing table info' };
      const colList = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
      if (conn.type === 'postgres') {
        sql = `SELECT ${colList} FROM "${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      } else {
        sql = `SELECT ${colList} FROM "${table.replace(/"/g, '""')}"`;
      }
    } else {
      sql = lastQuerySql.get(connId);
      if (!sql) return { error: 'No query to export' };
    }

    const ext = format === 'json' ? 'json' : 'csv';
    const defaultName = mode === 'table'
      ? `${table.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`
      : `query_export.${ext}`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [
        { name: ext.toUpperCase(), extensions: [ext] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePath) return { canceled: true };

    const fs = require('fs');
    const CHUNK = 5000;
    const send = (data) => mainWindow.webContents.send('db:downloadProgress', data);

    try {
      // Count total rows
      let total;
      const countSql = `SELECT COUNT(*) AS total FROM (${sql}) AS _cnt`;
      if (conn.type === 'postgres') {
        const cr = await conn.client.query(countSql);
        total = parseInt(cr.rows[0]?.total ?? 0, 10);
      } else {
        const cr = conn.client.prepare(countSql).get();
        total = cr?.total ?? 0;
      }

      send({ stage: 'start', total, filePath });

      const ctrl = { aborted: false };
      activeDownloads.set(connId, ctrl);

      const ws = fs.createWriteStream(filePath, { encoding: 'utf-8' });
      let written = 0;
      let headerWritten = false;

      if (format === 'json') ws.write('[\n');

      for (let offset = 0; offset < total; offset += CHUNK) {
        if (ctrl.aborted) {
          ws.destroy();
          activeDownloads.delete(connId);
          try { fs.unlinkSync(filePath); } catch {}
          send({ stage: 'error', error: 'Download cancelled' });
          return { error: 'Download cancelled' };
        }
        const pageSql = `SELECT * FROM (${sql}) AS _p LIMIT ${CHUNK} OFFSET ${offset}`;
        let rows, cols;
        if (conn.type === 'postgres') {
          const result = await conn.client.query(pageSql);
          cols = result.fields.map((f) => f.name);
          rows = result.rows.map((row) => {
            const out = {};
            for (const key of Object.keys(row)) {
              let val = row[key];
              if (val !== null && typeof val === 'object') val = JSON.stringify(val);
              out[key] = val;
            }
            return out;
          });
        } else {
          rows = conn.client.prepare(pageSql).all();
          cols = rows.length > 0 ? Object.keys(rows[0]) : [];
        }

        if (format === 'json') {
          for (let i = 0; i < rows.length; i++) {
            if (written > 0) ws.write(',\n');
            ws.write(JSON.stringify(rows[i]));
            written++;
          }
        } else {
          if (!headerWritten) {
            ws.write(cols.map(csvEscape).join(',') + '\n');
            headerWritten = true;
          }
          for (const row of rows) {
            ws.write(cols.map((c) => csvEscape(row[c])).join(',') + '\n');
            written++;
          }
        }

        send({ stage: 'progress', written, total });

        // Yield to event loop so progress events can be sent
        await new Promise((r) => setImmediate(r));
      }

      if (format === 'json') ws.write('\n]');
      await new Promise((resolve, reject) => {
        ws.end(() => resolve());
        ws.on('error', reject);
      });

      activeDownloads.delete(connId);
      send({ stage: 'done', written, total, filePath });
      return { ok: true, written, filePath };
    } catch (e) {
      activeDownloads.delete(connId);
      send({ stage: 'error', error: e.message });
      return { error: e.message };
    }
  });

  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  ipcMain.handle('db:createDatabase', async (_, id, name) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const quotedName = `"${name.replace(/"/g, '""')}"`;
        await conn.client.query(`CREATE DATABASE ${quotedName}`);
        return { ok: true };
      }
      return { error: 'Not supported for this database type' };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:dropDatabase', async (_, id, name) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const quotedName = `"${name.replace(/"/g, '""')}"`;
        await conn.client.query(`DROP DATABASE ${quotedName}`);
        return { ok: true };
      }
      return { error: 'Not supported for this database type' };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:dropTable', async (_, id, schema, tableName) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
        await conn.client.query(`DROP TABLE ${quotedTable}`);
        return { ok: true };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
        conn.client.prepare(`DROP TABLE ${quotedTable}`).run();
        return { ok: true };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:deleteRow', async (_, id, schema, tableName, rowOffset) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
        const ctidResult = await conn.client.query(
          `SELECT ctid FROM ${quotedTable} LIMIT 1 OFFSET ${parseInt(rowOffset) || 0}`,
        );
        if (!ctidResult.rows.length) return { error: 'Row not found' };
        await conn.client.query(
          `DELETE FROM ${quotedTable} WHERE ctid = $1`,
          [ctidResult.rows[0].ctid],
        );
        return { ok: true };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
        const row = conn.client.prepare(
          `SELECT rowid FROM ${quotedTable} LIMIT 1 OFFSET ?`,
        ).get(parseInt(rowOffset) || 0);
        if (!row) return { error: 'Row not found' };
        conn.client.prepare(`DELETE FROM ${quotedTable} WHERE rowid = ?`).run(row.rowid);
        return { ok: true };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:renameTable', async (_, id, schema, oldName, newName) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      if (conn.type === 'postgres') {
        const quotedOld = `"${schema.replace(/"/g, '""')}"."${oldName.replace(/"/g, '""')}"`;
        const quotedNew = `"${newName.replace(/"/g, '""')}"`;
        await conn.client.query(`ALTER TABLE ${quotedOld} RENAME TO ${quotedNew}`);
        return { ok: true };
      } else if (conn.type === 'sqlite') {
        const quotedOld = `"${oldName.replace(/"/g, '""')}"`;
        const quotedNew = `"${newName.replace(/"/g, '""')}"`;
        conn.client.prepare(`ALTER TABLE ${quotedOld} RENAME TO ${quotedNew}`).run();
        return { ok: true };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:addColumn', async (_, id, schema, tableName, column) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      const quotedCol = `"${column.name.replace(/"/g, '""')}"`;
      let colDef = `${quotedCol} ${column.type}`;
      if (!column.nullable) colDef += ' NOT NULL';
      const safeDefault = sanitizeDefaultValue(column.defaultValue);
      if (safeDefault) colDef += ` DEFAULT ${safeDefault}`;
      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
        await conn.client.query(`ALTER TABLE ${quotedTable} ADD COLUMN ${colDef}`);
        return { ok: true };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
        conn.client.prepare(`ALTER TABLE ${quotedTable} ADD COLUMN ${colDef}`).run();
        return { ok: true };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:dropColumn', async (_, id, schema, tableName, columnName) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      const quotedCol = `"${columnName.replace(/"/g, '""')}"`;
      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
        await conn.client.query(`ALTER TABLE ${quotedTable} DROP COLUMN ${quotedCol}`);
        return { ok: true };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
        conn.client.prepare(`ALTER TABLE ${quotedTable} DROP COLUMN ${quotedCol}`).run();
        return { ok: true };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:createTable', async (_, id, schema, tableName, columns) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      const colDefs = columns.map((c) => {
        const q = `"${c.name.replace(/"/g, '""')}"`;
        let def = `${q} ${c.type}`;
        if (c.pk) def += ' PRIMARY KEY';
        if (!c.nullable && !c.pk) def += ' NOT NULL';
        const safeDefault = sanitizeDefaultValue(c.defaultValue);
        if (safeDefault) def += ` DEFAULT ${safeDefault}`;
        return def;
      });
      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
        await conn.client.query(`CREATE TABLE ${quotedTable} (${colDefs.join(', ')})`);
        return { ok: true };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
        conn.client.prepare(`CREATE TABLE ${quotedTable} (${colDefs.join(', ')})`).run();
        return { ok: true };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:insertRow', async (_, id, schema, tableName, values) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    try {
      const cols = Object.keys(values).filter((k) => values[k] !== undefined && values[k] !== '');
      if (cols.length === 0) return { error: 'No values provided' };
      const quotedCols = cols.map((c) => `"${c.replace(/"/g, '""')}"`);
      if (conn.type === 'postgres') {
        const quotedTable = `"${schema.replace(/"/g, '""')}"."${tableName.replace(/"/g, '""')}"`;
        const placeholders = cols.map((_, i) => `$${i + 1}`);
        await conn.client.query(
          `INSERT INTO ${quotedTable} (${quotedCols.join(', ')}) VALUES (${placeholders.join(', ')})`,
          cols.map((c) => values[c]),
        );
        return { ok: true };
      } else if (conn.type === 'sqlite') {
        const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
        const placeholders = cols.map(() => '?');
        conn.client.prepare(
          `INSERT INTO ${quotedTable} (${quotedCols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        ).run(...cols.map((c) => values[c]));
        return { ok: true };
      }
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:pickSqliteFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
}

module.exports = { register };
