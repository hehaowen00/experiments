const { contextBridge, ipcRenderer } = require('electron');

// --- Caching layer ---
// Immutable caches (never change during app lifetime)
let _homeDir = null;
let _platform = null;

// Invalidate-on-write caches
let _settings = null;
let _identities = null;

function clearIdentityCache() {
  _identities = null;
}

contextBridge.exposeInMainWorld('api', {
  // Window controls
  platform: () => {
    if (_platform) return _platform;
    _platform = ipcRenderer.invoke('app:platform');
    return _platform;
  },
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),

  // Settings (cached, invalidated on set)
  getSetting: async (key) => {
    if (!_settings) {
      _settings = await ipcRenderer.invoke('settings:getAll');
    }
    return _settings[key] ?? null;
  },
  getAllSettings: async () => {
    if (!_settings) {
      _settings = await ipcRenderer.invoke('settings:getAll');
    }
    return _settings;
  },
  setSetting: async (key, value) => {
    const result = await ipcRenderer.invoke('settings:set', key, value);
    if (_settings) _settings[key] = value;
    return result;
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (fullPath) => ipcRenderer.invoke('shell:showItemInFolder', fullPath),
  homeDir: () => {
    if (_homeDir) return _homeDir;
    _homeDir = ipcRenderer.invoke('app:homeDir');
    return _homeDir;
  },

  // Git identities (cached, invalidated on mutations)
  identityList: async () => {
    if (_identities) return _identities;
    _identities = await ipcRenderer.invoke('identity:list');
    return _identities;
  },
  identityCreate: async (data) => {
    const result = await ipcRenderer.invoke('identity:create', data);
    clearIdentityCache();
    return result;
  },
  identityUpdate: async (id, data) => {
    const result = await ipcRenderer.invoke('identity:update', id, data);
    clearIdentityCache();
    return result;
  },
  identityDelete: async (id) => {
    const result = await ipcRenderer.invoke('identity:delete', id);
    clearIdentityCache();
    return result;
  },
  identityGetForRepo: (repoId) => ipcRenderer.invoke('identity:getForRepo', repoId),
  identitySetForRepo: (repoId, identityId, repoPath) => ipcRenderer.invoke('identity:setForRepo', repoId, identityId, repoPath),
  gitGetLocalIdentity: (repoPath) => ipcRenderer.invoke('git:getLocalIdentity', repoPath),
  gitGetGlobalIdentity: () => ipcRenderer.invoke('git:getGlobalIdentity'),
  identityImport: async (data) => {
    const result = await ipcRenderer.invoke('identity:import', data);
    clearIdentityCache();
    return result;
  },

  // Git Client - saved repos
  gitRepoList: () => ipcRenderer.invoke('gitRepo:list'),
  gitRepoCreate: (data) => ipcRenderer.invoke('gitRepo:create', data),
  gitRepoUpdate: (id, data) => ipcRenderer.invoke('gitRepo:update', id, data),
  gitRepoDelete: (id) => ipcRenderer.invoke('gitRepo:delete', id),
  gitRepoPin: (id, pinned) => ipcRenderer.invoke('gitRepo:pin', id, pinned),
  gitRepoSetCategory: (id, categoryId) => ipcRenderer.invoke('gitRepo:setCategory', id, categoryId),
  gitRepoReorder: (orderedIds) => ipcRenderer.invoke('gitRepo:reorder', orderedIds),
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
  gitPickCloneFolder: () => ipcRenderer.invoke('git:pickCloneFolder'),
  gitInit: (dirPath) => ipcRenderer.invoke('git:init', dirPath),
  gitClone: (url, parentDir, dirName) => ipcRenderer.invoke('git:clone', url, parentDir, dirName),
  gitStatusBrief: (repoPath) => ipcRenderer.invoke('git:statusBrief', repoPath),
  gitStatus: (repoPath) => ipcRenderer.invoke('git:status', repoPath),
  gitRevParseHead: (repoPath) => ipcRenderer.invoke('git:revParseHead', repoPath),
  gitDiff: (repoPath, filepath, staged) => ipcRenderer.invoke('git:diff', repoPath, filepath, staged),
  gitDiffRaw: (repoPath, filepath, staged) => ipcRenderer.invoke('git:diffRaw', repoPath, filepath, staged),
  gitStageHunk: (repoPath, patchText) => ipcRenderer.invoke('git:stageHunk', repoPath, patchText),
  gitUnstageHunk: (repoPath, patchText) => ipcRenderer.invoke('git:unstageHunk', repoPath, patchText),
  gitDiscardHunk: (repoPath, patchText) => ipcRenderer.invoke('git:discardHunk', repoPath, patchText),
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
  gitResetHardTo: (repoPath, ref) => ipcRenderer.invoke('git:resetHardTo', repoPath, ref),
  gitLog: (repoPath, count, allBranches, branchName, skip, search, topoOrder) => ipcRenderer.invoke('git:log', repoPath, count, allBranches, branchName, skip, search, topoOrder),
  gitPull: (repoPath, strategy, remote) => ipcRenderer.invoke('git:pull', repoPath, strategy, remote),
  gitPush: (repoPath, remote) => ipcRenderer.invoke('git:push', repoPath, remote),
  gitPushForce: (repoPath, remote) => ipcRenderer.invoke('git:pushForce', repoPath, remote),
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
  gitShowFileDiff: (repoPath, hash, filepath, isMerge, oldFilepath) => ipcRenderer.invoke('git:showFileDiff', repoPath, hash, filepath, isMerge, oldFilepath),
  gitLastCommitMessage: (repoPath) => ipcRenderer.invoke('git:lastCommitMessage', repoPath),

  // Tags
  gitTagList: (repoPath) => ipcRenderer.invoke('git:tagList', repoPath),
  gitTagCreate: (repoPath, name, message, target) => ipcRenderer.invoke('git:tagCreate', repoPath, name, message, target),
  gitTagDelete: (repoPath, name) => ipcRenderer.invoke('git:tagDelete', repoPath, name),
  gitTagPush: (repoPath, remote, tagName, isDelete) => ipcRenderer.invoke('git:tagPush', repoPath, remote, tagName, isDelete),

  // Submodules & nested repos
  gitSubmodules: (repoPath) => ipcRenderer.invoke('git:submodules', repoPath),
  gitSubmoduleUpdate: (repoPath, subPath) => ipcRenderer.invoke('git:submoduleUpdate', repoPath, subPath),

  // Stash
  gitStashList: (repoPath) => ipcRenderer.invoke('git:stashList', repoPath),
  gitStashPush: (repoPath, message, includeUntracked) => ipcRenderer.invoke('git:stashPush', repoPath, message, includeUntracked),
  gitStashPushStaged: (repoPath, message) => ipcRenderer.invoke('git:stashPushStaged', repoPath, message),
  gitStashPushUnstaged: (repoPath, message) => ipcRenderer.invoke('git:stashPushUnstaged', repoPath, message),
  gitStashPop: (repoPath, ref) => ipcRenderer.invoke('git:stashPop', repoPath, ref),
  gitStashApply: (repoPath, ref) => ipcRenderer.invoke('git:stashApply', repoPath, ref),
  gitStashDrop: (repoPath, ref) => ipcRenderer.invoke('git:stashDrop', repoPath, ref),
  gitListFiles: (repoPath) => ipcRenderer.invoke('git:listFiles', repoPath),
  gitStashShow: (repoPath, ref) => ipcRenderer.invoke('git:stashShow', repoPath, ref),
  gitStashShowFileDiff: (repoPath, ref, filepath) => ipcRenderer.invoke('git:stashShowFileDiff', repoPath, ref, filepath),

  // Merge & rebase
  gitMerge: (repoPath, branch, opts) => ipcRenderer.invoke('git:merge', repoPath, branch, opts),
  gitMergeAbort: (repoPath) => ipcRenderer.invoke('git:mergeAbort', repoPath),
  gitRebase: (repoPath, branch) => ipcRenderer.invoke('git:rebase', repoPath, branch),
  gitRebaseContinue: (repoPath) => ipcRenderer.invoke('git:rebaseContinue', repoPath),
  gitRebaseAbort: (repoPath) => ipcRenderer.invoke('git:rebaseAbort', repoPath),
  gitInteractiveRebase: (repoPath, baseHash, todoList) => ipcRenderer.invoke('git:interactiveRebase', repoPath, baseHash, todoList),
  gitCherryPick: (repoPath, hash) => ipcRenderer.invoke('git:cherryPick', repoPath, hash),
  gitDropCommit: (repoPath, hash) => ipcRenderer.invoke('git:dropCommit', repoPath, hash),
  gitRevert: (repoPath, hash) => ipcRenderer.invoke('git:revert', repoPath, hash),
  gitBranchDelete: (repoPath, branch, force) => ipcRenderer.invoke('git:branchDelete', repoPath, branch, force),
  gitBranchRename: (repoPath, oldName, newName) => ipcRenderer.invoke('git:branchRename', repoPath, oldName, newName),
  gitOperationState: (repoPath) => ipcRenderer.invoke('git:operationState', repoPath),

  // README
  gitReadme: (repoPath) => ipcRenderer.invoke('git:readme', repoPath),

  // File history
  gitFileLog: (repoPath, filepath, count, skip) => ipcRenderer.invoke('git:fileLog', repoPath, filepath, count, skip),
  gitFileShowAtCommit: (repoPath, hash, filepath) => ipcRenderer.invoke('git:fileShowAtCommit', repoPath, hash, filepath),

  // Bisect
  gitBisectStart: (repoPath, badHash, goodHash) => ipcRenderer.invoke('git:bisectStart', repoPath, badHash, goodHash),
  gitBisectMark: (repoPath, verdict) => ipcRenderer.invoke('git:bisectMark', repoPath, verdict),
  gitBisectReset: (repoPath) => ipcRenderer.invoke('git:bisectReset', repoPath),
  gitBisectLog: (repoPath) => ipcRenderer.invoke('git:bisectLog', repoPath),

  // Conflict resolution
  gitResolveOurs: (repoPath, filepaths) => ipcRenderer.invoke('git:resolveOurs', repoPath, filepaths),
  gitResolveTheirs: (repoPath, filepaths) => ipcRenderer.invoke('git:resolveTheirs', repoPath, filepaths),
  gitDiffConflict: (repoPath, filepath) => ipcRenderer.invoke('git:diffConflict', repoPath, filepath),

  // Patches
  gitExportStagedPatch: (repoPath) => ipcRenderer.invoke('git:exportStagedPatch', repoPath),
  gitApplyPatch: (repoPath) => ipcRenderer.invoke('git:applyPatch', repoPath),

  // Worktrees
  gitPickWorktreeFolder: () => ipcRenderer.invoke('git:pickWorktreeFolder'),
  gitWorktreeList: (repoPath) => ipcRenderer.invoke('git:worktreeList', repoPath),
  gitWorktreeSetName: (wtPath, nickname) => ipcRenderer.invoke('git:worktreeSetName', wtPath, nickname),
  gitSuggestWorktreePath: (desired) => ipcRenderer.invoke('git:suggestWorktreePath', desired),
  gitWorktreeAdd: (repoPath, wtPath, branch, newBranch, opts) => ipcRenderer.invoke('git:worktreeAdd', repoPath, wtPath, branch, newBranch, opts),
  gitWorktreeRemove: (repoPath, wtPath, force) => ipcRenderer.invoke('git:worktreeRemove', repoPath, wtPath, force),
  gitWorktreePrune: (repoPath) => ipcRenderer.invoke('git:worktreePrune', repoPath),

  // Build check
  gitBuildCheck: (repoPath) => ipcRenderer.invoke('git:buildCheck', repoPath),

  // Images
  gitImageBlob: (repoPath, filepath, ref) => ipcRenderer.invoke('git:imageBlob', repoPath, filepath, ref),

  // Filesystem watching
  gitWatchRepo: (repoPath) => ipcRenderer.invoke('git:watchRepo', repoPath),
  gitUnwatchRepo: (repoPath) => ipcRenderer.invoke('git:unwatchRepo', repoPath),
  onFsChanged: (cb) => {
    const handler = (_, repoPath) => cb(repoPath);
    ipcRenderer.on('git:fs-changed', handler);
    return () => ipcRenderer.removeListener('git:fs-changed', handler);
  },
  onGitProgress: (cb) => {
    const handler = (_, line) => cb(line);
    ipcRenderer.on('git:progress', handler);
    return () => ipcRenderer.removeListener('git:progress', handler);
  },

});
