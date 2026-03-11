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
  gitPull: (repoPath, strategy) => ipcRenderer.invoke('git:pull', repoPath, strategy),
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
  gitListFiles: (repoPath) => ipcRenderer.invoke('git:listFiles', repoPath),
  gitStashShow: (repoPath, ref) => ipcRenderer.invoke('git:stashShow', repoPath, ref),

  // Merge & rebase
  gitMerge: (repoPath, branch) => ipcRenderer.invoke('git:merge', repoPath, branch),
  gitMergeAbort: (repoPath) => ipcRenderer.invoke('git:mergeAbort', repoPath),
  gitRebase: (repoPath, branch) => ipcRenderer.invoke('git:rebase', repoPath, branch),
  gitRebaseContinue: (repoPath) => ipcRenderer.invoke('git:rebaseContinue', repoPath),
  gitRebaseAbort: (repoPath) => ipcRenderer.invoke('git:rebaseAbort', repoPath),
  gitCherryPick: (repoPath, hash) => ipcRenderer.invoke('git:cherryPick', repoPath, hash),
  gitDropCommit: (repoPath, hash) => ipcRenderer.invoke('git:dropCommit', repoPath, hash),
  gitRevert: (repoPath, hash) => ipcRenderer.invoke('git:revert', repoPath, hash),
  gitBranchDelete: (repoPath, branch, force) => ipcRenderer.invoke('git:branchDelete', repoPath, branch, force),
  gitBranchRename: (repoPath, oldName, newName) => ipcRenderer.invoke('git:branchRename', repoPath, oldName, newName),
  gitOperationState: (repoPath) => ipcRenderer.invoke('git:operationState', repoPath),

  // Conflict resolution
  gitResolveOurs: (repoPath, filepaths) => ipcRenderer.invoke('git:resolveOurs', repoPath, filepaths),
  gitResolveTheirs: (repoPath, filepaths) => ipcRenderer.invoke('git:resolveTheirs', repoPath, filepaths),
  gitDiffConflict: (repoPath, filepath) => ipcRenderer.invoke('git:diffConflict', repoPath, filepath),

  // Patches
  gitExportStagedPatch: (repoPath) => ipcRenderer.invoke('git:exportStagedPatch', repoPath),
  gitApplyPatch: (repoPath) => ipcRenderer.invoke('git:applyPatch', repoPath),

  // Actions (pre-commit scripts)
  actionsList: () => ipcRenderer.invoke('actions:list'),
  actionsCreate: (data) => ipcRenderer.invoke('actions:create', data),
  actionsUpdate: (id, data) => ipcRenderer.invoke('actions:update', id, data),
  actionsDelete: (id) => ipcRenderer.invoke('actions:delete', id),
  actionsReorder: (orderedIds) => ipcRenderer.invoke('actions:reorder', orderedIds),
  actionsRun: (repoPath, actionId) => ipcRenderer.invoke('actions:run', repoPath, actionId),
  actionsRunPreCommit: (repoPath) => ipcRenderer.invoke('actions:runPreCommit', repoPath),

  // Filesystem watching
  gitWatchRepo: (repoPath) => ipcRenderer.invoke('git:watchRepo', repoPath),
  gitUnwatchRepo: (repoPath) => ipcRenderer.invoke('git:unwatchRepo', repoPath),
  onFsChanged: (cb) => {
    const handler = (_, repoPath) => cb(repoPath);
    ipcRenderer.on('git:fs-changed', handler);
    return () => ipcRenderer.removeListener('git:fs-changed', handler);
  },

  // P2P
  p2pGetIdentity: () => ipcRenderer.invoke('p2p:getIdentity'),
  p2pSetDisplayName: (name) => ipcRenderer.invoke('p2p:setDisplayName', name),
  p2pSetEnabled: (enabled) => ipcRenderer.invoke('p2p:setEnabled', enabled),
  p2pPeerList: () => ipcRenderer.invoke('p2p:peerList'),
  p2pSendFriendRequest: (peerId) => ipcRenderer.invoke('p2p:sendFriendRequest', peerId),
  p2pRespondFriendRequest: (peerId, accepted) => ipcRenderer.invoke('p2p:respondFriendRequest', peerId, accepted),
  p2pBlockPeer: (peerId) => ipcRenderer.invoke('p2p:blockPeer', peerId),
  p2pUnblockPeer: (peerId) => ipcRenderer.invoke('p2p:unblockPeer', peerId),
  p2pRemovePeer: (peerId) => ipcRenderer.invoke('p2p:removePeer', peerId),
  p2pGetSharedRepos: () => ipcRenderer.invoke('p2p:getSharedRepos'),
  p2pSetRepoShared: (repoId, shared) => ipcRenderer.invoke('p2p:setRepoShared', repoId, shared),
  p2pFetchPeerRepos: (peerId) => ipcRenderer.invoke('p2p:fetchPeerRepos', peerId),
  p2pCloneFromPeer: (peerId, remotePath, repoName, originUrl) => ipcRenderer.invoke('p2p:cloneFromPeer', peerId, remotePath, repoName, originUrl),
  p2pAddPeerRemote: (repoPath, peerId, remotePath, remoteName) => ipcRenderer.invoke('p2p:addPeerRemote', repoPath, peerId, remotePath, remoteName),
  onP2pPeersChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('p2p:peers-changed', handler);
    return () => ipcRenderer.removeListener('p2p:peers-changed', handler);
  },
  onP2pFriendRequest: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('p2p:friend-request', handler);
    return () => ipcRenderer.removeListener('p2p:friend-request', handler);
  },
});
