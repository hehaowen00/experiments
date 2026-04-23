const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: () => ipcRenderer.invoke('app:platform'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
  homeDir: () => ipcRenderer.invoke('app:homeDir'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  saveFile: (defaultName, content) => ipcRenderer.invoke('file:save', defaultName, content),
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // Saved connections
  dbConnList: () => ipcRenderer.invoke('dbConn:list'),
  dbConnCreate: (data) => ipcRenderer.invoke('dbConn:create', data),
  dbConnUpdate: (id, data) => ipcRenderer.invoke('dbConn:update', id, data),
  dbConnDelete: (id) => ipcRenderer.invoke('dbConn:delete', id),
  dbConnPin: (id, pinned) => ipcRenderer.invoke('dbConn:pin', id, pinned),
  dbConnSetCategory: (id, categoryId) => ipcRenderer.invoke('dbConn:setCategory', id, categoryId),
  dbConnTouchLastUsed: (id) => ipcRenderer.invoke('dbConn:touchLastUsed', id),
  dbConnGetQueries: (id) => ipcRenderer.invoke('dbConn:getQueries', id),
  dbConnSaveQueries: (id, queries) => ipcRenderer.invoke('dbConn:saveQueries', id, queries),

  // Categories
  dbCatList: () => ipcRenderer.invoke('dbCat:list'),
  dbCatCreate: (name) => ipcRenderer.invoke('dbCat:create', name),
  dbCatRename: (id, name) => ipcRenderer.invoke('dbCat:rename', id, name),
  dbCatDelete: (id) => ipcRenderer.invoke('dbCat:delete', id),
  dbCatToggleCollapse: (id, collapsed) =>
    ipcRenderer.invoke('dbCat:toggleCollapse', id, collapsed),
  dbCatReorder: (orderedIds) => ipcRenderer.invoke('dbCat:reorder', orderedIds),

  // Active connections / queries
  dbConnect: (opts) => ipcRenderer.invoke('db:connect', opts),
  dbSwitchDatabase: (id, database) => ipcRenderer.invoke('db:switchDatabase', id, database),
  dbDisconnect: (id) => ipcRenderer.invoke('db:disconnect', id),
  dbListDatabases: (id) => ipcRenderer.invoke('db:listDatabases', id),
  dbListTables: (id) => ipcRenderer.invoke('db:listTables', id),
  dbGetColumns: (id, schema, table) => ipcRenderer.invoke('db:getColumns', id, schema, table),
  dbGetIndexes: (id, schema, table) => ipcRenderer.invoke('db:getIndexes', id, schema, table),
  dbGetTableData: (id, schema, table, limit, offset, orderBy) =>
    ipcRenderer.invoke('db:getTableData', id, schema, table, limit, offset, orderBy),
  dbGetCellValue: (id, schema, table, column, rowOffset) =>
    ipcRenderer.invoke('db:getCellValue', id, schema, table, column, rowOffset),
  dbQuery: (id, sql, limit, offset) => ipcRenderer.invoke('db:query', id, sql, limit, offset),
  dbQueryExport: (id) => ipcRenderer.invoke('db:queryExport', id),
  dbUpdateCell: (id, schema, table, column, rowOffset, value) =>
    ipcRenderer.invoke('db:updateCell', id, schema, table, column, rowOffset, value),
  dbCreateDatabase: (id, name) => ipcRenderer.invoke('db:createDatabase', id, name),
  dbDropDatabase: (id, name) => ipcRenderer.invoke('db:dropDatabase', id, name),
  dbCreateTable: (id, schema, tableName, columns) =>
    ipcRenderer.invoke('db:createTable', id, schema, tableName, columns),
  dbDropTable: (id, schema, tableName) =>
    ipcRenderer.invoke('db:dropTable', id, schema, tableName),
  dbRenameTable: (id, schema, oldName, newName) =>
    ipcRenderer.invoke('db:renameTable', id, schema, oldName, newName),
  dbAddColumn: (id, schema, tableName, column) =>
    ipcRenderer.invoke('db:addColumn', id, schema, tableName, column),
  dbDropColumn: (id, schema, tableName, columnName) =>
    ipcRenderer.invoke('db:dropColumn', id, schema, tableName, columnName),
  dbInsertRow: (id, schema, tableName, values) =>
    ipcRenderer.invoke('db:insertRow', id, schema, tableName, values),
  dbDeleteRow: (id, schema, tableName, rowOffset) =>
    ipcRenderer.invoke('db:deleteRow', id, schema, tableName, rowOffset),
  dbPickSqliteFile: () => ipcRenderer.invoke('db:pickSqliteFile'),
  dbExportTableData: (id, schema, table, columns) =>
    ipcRenderer.invoke('db:exportTableData', id, schema, table, columns),
  dbQueryCellValue: (id, column, rowOffset) =>
    ipcRenderer.invoke('db:queryCellValue', id, column, rowOffset),
  dbDownload: (opts) => ipcRenderer.invoke('db:download', opts),
  dbCancelDownload: (connId) => ipcRenderer.invoke('db:cancelDownload', connId),
  onDbDownloadProgress: (cb) => {
    ipcRenderer.removeAllListeners('db:downloadProgress');
    if (cb) ipcRenderer.on('db:downloadProgress', (_, d) => cb(d));
  },
  onDbConnectionLost: (cb) => {
    ipcRenderer.removeAllListeners('db:connectionLost');
    if (cb) ipcRenderer.on('db:connectionLost', (_, d) => cb(d));
  },
});
