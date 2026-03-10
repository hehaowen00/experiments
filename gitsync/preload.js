const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  homeDir: () => ipcRenderer.invoke('app:homeDir'),

  // Git identities
  identityList: () => ipcRenderer.invoke('identity:list'),
  identityCreate: (data) => ipcRenderer.invoke('identity:create', data),
  identityUpdate: (id, data) => ipcRenderer.invoke('identity:update', id, data),
  identityDelete: (id) => ipcRenderer.invoke('identity:delete', id),
  identityGetForRepo: (repoId) => ipcRenderer.invoke('identity:getForRepo', repoId),
  identitySetForRepo: (repoId, identityId, repoPath) => ipcRenderer.invoke('identity:setForRepo', repoId, identityId, repoPath),
  gitGetLocalIdentity: (repoPath) => ipcRenderer.invoke('git:getLocalIdentity', repoPath),
  gitGetGlobalIdentity: () => ipcRenderer.invoke('git:getGlobalIdentity'),
  identityImport: (data) => ipcRenderer.invoke('identity:import', data),

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
  gitDeleteUntracked: (repoPath, filepaths) => ipcRenderer.invoke('git:deleteUntracked', repoPath, filepaths),
  gitCommit: (repoPath, message) => ipcRenderer.invoke('git:commit', repoPath, message),
  gitCommitAmend: (repoPath, message) => ipcRenderer.invoke('git:commitAmend', repoPath, message),
  gitResetSoftHead: (repoPath) => ipcRenderer.invoke('git:resetSoftHead', repoPath),
  gitResetSoftTo: (repoPath, hash) => ipcRenderer.invoke('git:resetSoftTo', repoPath, hash),
  gitLog: (repoPath, count, allBranches, branchName, skip, search) => ipcRenderer.invoke('git:log', repoPath, count, allBranches, branchName, skip, search),
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

  // Submodules & nested repos
  gitSubmodules: (repoPath) => ipcRenderer.invoke('git:submodules', repoPath),
  gitSubmoduleUpdate: (repoPath, subPath) => ipcRenderer.invoke('git:submoduleUpdate', repoPath, subPath),

  // Stash
  gitStashList: (repoPath) => ipcRenderer.invoke('git:stashList', repoPath),
  gitStashPush: (repoPath, message, includeUntracked) => ipcRenderer.invoke('git:stashPush', repoPath, message, includeUntracked),
  gitStashPop: (repoPath, ref) => ipcRenderer.invoke('git:stashPop', repoPath, ref),
  gitStashApply: (repoPath, ref) => ipcRenderer.invoke('git:stashApply', repoPath, ref),
  gitStashDrop: (repoPath, ref) => ipcRenderer.invoke('git:stashDrop', repoPath, ref),
  gitStashShow: (repoPath, ref) => ipcRenderer.invoke('git:stashShow', repoPath, ref),

  // Merge & rebase
  gitMerge: (repoPath, branch) => ipcRenderer.invoke('git:merge', repoPath, branch),
  gitMergeAbort: (repoPath) => ipcRenderer.invoke('git:mergeAbort', repoPath),
  gitRebase: (repoPath, branch) => ipcRenderer.invoke('git:rebase', repoPath, branch),
  gitRebaseContinue: (repoPath) => ipcRenderer.invoke('git:rebaseContinue', repoPath),
  gitRebaseAbort: (repoPath) => ipcRenderer.invoke('git:rebaseAbort', repoPath),
  gitOperationState: (repoPath) => ipcRenderer.invoke('git:operationState', repoPath),
});
