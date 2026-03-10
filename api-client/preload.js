const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Collections
  listCollections: () => ipcRenderer.invoke('collections:list'),
  createCollection: (name) => ipcRenderer.invoke('collections:create', name),
  renameCollection: (id, name) =>
    ipcRenderer.invoke('collections:rename', id, name),
  deleteCollection: (id) => ipcRenderer.invoke('collections:delete', id),
  pinCollection: (id, pinned) =>
    ipcRenderer.invoke('collections:pin', id, pinned),
  setCollectionCategory: (id, categoryId) =>
    ipcRenderer.invoke('collections:setCategory', id, categoryId),
  listCategories: () => ipcRenderer.invoke('categories:list'),
  createCategory: (name) => ipcRenderer.invoke('categories:create', name),
  renameCategory: (id, name) =>
    ipcRenderer.invoke('categories:rename', id, name),
  deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),
  toggleCategoryCollapse: (id, collapsed) =>
    ipcRenderer.invoke('categories:toggleCollapse', id, collapsed),
  reorderCategories: (orderedIds) =>
    ipcRenderer.invoke('categories:reorder', orderedIds),
  loadCollection: (id) => ipcRenderer.invoke('collection:load', id),
  saveCollection: (collection) =>
    ipcRenderer.invoke('collection:save', collection),
  sendRequest: (opts) => ipcRenderer.invoke('request:send', opts),
  saveResponse: (data) => ipcRenderer.invoke('response:save', data),
  getLatestResponse: (requestId) =>
    ipcRenderer.invoke('response:latest', requestId),
  getResponseHistory: (requestId) =>
    ipcRenderer.invoke('response:history', requestId),
  loadResponse: (id) => ipcRenderer.invoke('response:load', id),
  pickFile: () => ipcRenderer.invoke('file:pick'),
  importCollection: () => ipcRenderer.invoke('import:pick'),
  importRequests: () => ipcRenderer.invoke('import:requests'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // SSE
  sseDisconnect: (id) => ipcRenderer.invoke('sse:disconnect', id),
  onSseOpen: (cb) => ipcRenderer.on('sse:open', (_, d) => cb(d)),
  onSseEvent: (cb) => ipcRenderer.on('sse:event', (_, d) => cb(d)),
  onSseError: (cb) => ipcRenderer.on('sse:error', (_, d) => cb(d)),
  onSseClose: (cb) => ipcRenderer.on('sse:close', (_, d) => cb(d)),

  // WebSocket
  wsConnect: (opts) => ipcRenderer.invoke('ws:connect', opts),
  wsSend: (opts) => ipcRenderer.invoke('ws:send', opts),
  wsDisconnect: (id) => ipcRenderer.invoke('ws:disconnect', id),
  onWsOpen: (cb) => ipcRenderer.on('ws:open', (_, d) => cb(d)),
  onWsMessage: (cb) => ipcRenderer.on('ws:message', (_, d) => cb(d)),
  onWsError: (cb) => ipcRenderer.on('ws:error', (_, d) => cb(d)),
  onWsClose: (cb) => ipcRenderer.on('ws:close', (_, d) => cb(d)),
  onWsPing: (cb) => ipcRenderer.on('ws:ping', (_, d) => cb(d)),
  onWsPong: (cb) => ipcRenderer.on('ws:pong', (_, d) => cb(d)),

  // Database Client - saved connections
  dbConnList: () => ipcRenderer.invoke('dbConn:list'),
  dbConnCreate: (data) => ipcRenderer.invoke('dbConn:create', data),
  dbConnUpdate: (id, data) => ipcRenderer.invoke('dbConn:update', id, data),
  dbConnDelete: (id) => ipcRenderer.invoke('dbConn:delete', id),
  dbConnPin: (id, pinned) => ipcRenderer.invoke('dbConn:pin', id, pinned),
  dbConnSetCategory: (id, categoryId) => ipcRenderer.invoke('dbConn:setCategory', id, categoryId),
  dbConnTouchLastUsed: (id) => ipcRenderer.invoke('dbConn:touchLastUsed', id),

  // Database Client - categories
  dbCatList: () => ipcRenderer.invoke('dbCat:list'),
  dbCatCreate: (name) => ipcRenderer.invoke('dbCat:create', name),
  dbCatRename: (id, name) => ipcRenderer.invoke('dbCat:rename', id, name),
  dbCatDelete: (id) => ipcRenderer.invoke('dbCat:delete', id),
  dbCatToggleCollapse: (id, collapsed) => ipcRenderer.invoke('dbCat:toggleCollapse', id, collapsed),
  dbCatReorder: (orderedIds) => ipcRenderer.invoke('dbCat:reorder', orderedIds),

  // Database Client - active connections
  dbConnect: (opts) => ipcRenderer.invoke('db:connect', opts),
  dbSwitchDatabase: (id, database) => ipcRenderer.invoke('db:switchDatabase', id, database),
  dbDisconnect: (id) => ipcRenderer.invoke('db:disconnect', id),
  dbListDatabases: (id) => ipcRenderer.invoke('db:listDatabases', id),
  dbListTables: (id) => ipcRenderer.invoke('db:listTables', id),
  dbGetColumns: (id, schema, table) => ipcRenderer.invoke('db:getColumns', id, schema, table),
  dbGetIndexes: (id, schema, table) => ipcRenderer.invoke('db:getIndexes', id, schema, table),
  dbGetTableData: (id, schema, table, limit, offset) =>
    ipcRenderer.invoke('db:getTableData', id, schema, table, limit, offset),
  dbGetCellValue: (id, schema, table, column, rowOffset) =>
    ipcRenderer.invoke('db:getCellValue', id, schema, table, column, rowOffset),
  dbQuery: (id, sql) => ipcRenderer.invoke('db:query', id, sql),
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
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  homeDir: () => ipcRenderer.invoke('app:homeDir'),

  // Git Client - saved repos
  gitRepoList: () => ipcRenderer.invoke('gitRepo:list'),
  gitRepoCreate: (data) => ipcRenderer.invoke('gitRepo:create', data),
  gitRepoUpdate: (id, data) => ipcRenderer.invoke('gitRepo:update', id, data),
  gitRepoDelete: (id) => ipcRenderer.invoke('gitRepo:delete', id),
  gitRepoPin: (id, pinned) => ipcRenderer.invoke('gitRepo:pin', id, pinned),
  gitRepoSetCategory: (id, categoryId) => ipcRenderer.invoke('gitRepo:setCategory', id, categoryId),
  gitRepoTouchLastUsed: (id) => ipcRenderer.invoke('gitRepo:touchLastUsed', id),

  // Git Client - categories
  gitCatList: () => ipcRenderer.invoke('gitCat:list'),
  gitCatCreate: (name) => ipcRenderer.invoke('gitCat:create', name),
  gitCatRename: (id, name) => ipcRenderer.invoke('gitCat:rename', id, name),
  gitCatDelete: (id) => ipcRenderer.invoke('gitCat:delete', id),
  gitCatToggleCollapse: (id, collapsed) => ipcRenderer.invoke('gitCat:toggleCollapse', id, collapsed),
  gitCatReorder: (orderedIds) => ipcRenderer.invoke('gitCat:reorder', orderedIds),

  // Git Client - operations
  gitPickFolder: () => ipcRenderer.invoke('git:pickFolder'),
  gitInit: (dirPath) => ipcRenderer.invoke('git:init', dirPath),
  gitStatus: (repoPath) => ipcRenderer.invoke('git:status', repoPath),
  gitDiff: (repoPath, filepath, staged) => ipcRenderer.invoke('git:diff', repoPath, filepath, staged),
  gitDiffUntracked: (repoPath, filepath) => ipcRenderer.invoke('git:diffUntracked', repoPath, filepath),
  gitStage: (repoPath, filepaths) => ipcRenderer.invoke('git:stage', repoPath, filepaths),
  gitUnstage: (repoPath, filepaths) => ipcRenderer.invoke('git:unstage', repoPath, filepaths),
  gitStageAll: (repoPath) => ipcRenderer.invoke('git:stageAll', repoPath),
  gitUnstageAll: (repoPath) => ipcRenderer.invoke('git:unstageAll', repoPath),
  gitDiscard: (repoPath, filepaths) => ipcRenderer.invoke('git:discard', repoPath, filepaths),
  gitCommit: (repoPath, message) => ipcRenderer.invoke('git:commit', repoPath, message),
  gitCommitAmend: (repoPath, message) => ipcRenderer.invoke('git:commitAmend', repoPath, message),
  gitLog: (repoPath, count, allBranches, branchName, skip) => ipcRenderer.invoke('git:log', repoPath, count, allBranches, branchName, skip),
  gitPull: (repoPath) => ipcRenderer.invoke('git:pull', repoPath),
  gitPush: (repoPath) => ipcRenderer.invoke('git:push', repoPath),
  gitPushSetUpstream: (repoPath, remote, branch) => ipcRenderer.invoke('git:pushSetUpstream', repoPath, remote, branch),
  gitFetch: (repoPath) => ipcRenderer.invoke('git:fetch', repoPath),
  gitRemoteList: (repoPath) => ipcRenderer.invoke('git:remoteList', repoPath),
  gitRemoteAdd: (repoPath, name, url) => ipcRenderer.invoke('git:remoteAdd', repoPath, name, url),
  gitRemoteRemove: (repoPath, name) => ipcRenderer.invoke('git:remoteRemove', repoPath, name),
  gitRemoteSetUrl: (repoPath, name, url) => ipcRenderer.invoke('git:remoteSetUrl', repoPath, name, url),
  gitBranchList: (repoPath) => ipcRenderer.invoke('git:branchList', repoPath),
  gitCheckout: (repoPath, branch) => ipcRenderer.invoke('git:checkout', repoPath, branch),
  gitCheckoutRemote: (repoPath, localName, remoteBranch) => ipcRenderer.invoke('git:checkoutRemote', repoPath, localName, remoteBranch),
  gitCheckoutNewBranch: (repoPath, branch) => ipcRenderer.invoke('git:checkoutNewBranch', repoPath, branch),
  gitShow: (repoPath, hash) => ipcRenderer.invoke('git:show', repoPath, hash),
  gitLastCommitMessage: (repoPath) => ipcRenderer.invoke('git:lastCommitMessage', repoPath),
});
