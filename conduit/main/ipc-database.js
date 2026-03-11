const path = require('path');
const { ipcMain, dialog } = require('electron');
const Database = require('better-sqlite3');
const { Client: PgClient } = require('pg');
const { generateKSUID } = require('./ksuid');
const store = require('./store');

const activeDbConnections = new Map();
const LARGE_VALUE_THRESHOLD = 5120; // 5KB

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
    return true;
  });

  ipcMain.handle('dbConn:delete', (_, id) => {
    store.getDb().prepare('DELETE FROM db_connections WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('dbConn:pin', (_, id, pinned) => {
    store.getDb().prepare('UPDATE db_connections SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
    return true;
  });

  ipcMain.handle('dbConn:setCategory', (_, id, categoryId) => {
    store.getDb().prepare('UPDATE db_connections SET category_id = ? WHERE id = ?').run(categoryId || null, id);
    return true;
  });

  ipcMain.handle('dbConn:touchLastUsed', (_, id) => {
    store.getDb().prepare("UPDATE db_connections SET last_used = datetime('now') WHERE id = ?").run(id);
    return true;
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
    return true;
  });

  ipcMain.handle('dbCat:delete', (_, id) => {
    const db = store.getDb();
    db.prepare('UPDATE db_connections SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM db_categories WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('dbCat:toggleCollapse', (_, id, collapsed) => {
    store.getDb().prepare('UPDATE db_categories SET collapsed = ? WHERE id = ?').run(collapsed ? 1 : 0, id);
    return true;
  });

  ipcMain.handle('dbCat:reorder', (_, orderedIds) => {
    const db = store.getDb();
    const stmt = db.prepare('UPDATE db_categories SET sort_order = ? WHERE id = ?');
    const tx = db.transaction(() => { orderedIds.forEach((id, i) => stmt.run(i, id)); });
    tx();
    return true;
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
        activeDbConnections.set(id, { type: 'postgres', client, config: pgConfig });
        return { ok: true };
      } else if (type === 'sqlite') {
        const sqliteDb = new Database(config.path);
        sqliteDb.pragma('journal_mode = WAL');
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
        const total = parseInt(countResult.rows[0].total);
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

  ipcMain.handle('db:query', async (_, id, sql) => {
    const conn = activeDbConnections.get(id);
    if (!conn) return { error: 'Not connected' };
    const start = Date.now();
    try {
      if (conn.type === 'postgres') {
        const result = await conn.client.query(sql);
        const elapsed = Date.now() - start;
        if (result.fields && result.fields.length > 0) {
          const rows = result.rows.map((row) => {
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
          return {
            rows,
            columns: result.fields.map((f) => f.name),
            rowCount: result.rowCount,
            time: elapsed,
          };
        }
        return { rowCount: result.rowCount, time: elapsed, command: result.command };
      } else if (conn.type === 'sqlite') {
        const trimmed = sql.trim().toLowerCase();
        const isSelect = trimmed.startsWith('select') || trimmed.startsWith('pragma') || trimmed.startsWith('explain') || trimmed.startsWith('with');
        if (isSelect) {
          const rows = conn.client.prepare(sql).all();
          const elapsed = Date.now() - start;
          const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
          const processed = rows.map((row) => {
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
          return { rows: processed, columns, rowCount: rows.length, time: elapsed };
        } else {
          const result = conn.client.prepare(sql).run();
          const elapsed = Date.now() - start;
          return { rowCount: result.changes, time: elapsed, command: 'RUN' };
        }
      }
    } catch (e) {
      return { error: e.message, time: Date.now() - start };
    }
  });

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
      if (column.defaultValue) colDef += ` DEFAULT ${column.defaultValue}`;
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
        if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
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
