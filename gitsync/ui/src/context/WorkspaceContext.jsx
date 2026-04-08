import {
  createContext,
  useContext,
  createSignal,
  onMount,
  onCleanup,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { initHomeDir } from '../utils/path';
import { allFilesInTree } from '../utils/tree';
import { showAlert } from '../components/Modal';

import { createDiffOps } from './ops/diff';
import { createStagingOps } from './ops/staging';
import { createHunkOps } from './ops/hunk';
import { createDiscardOps } from './ops/discard';
import { createConflictOps } from './ops/conflicts';
import { createPatchOps } from './ops/patches';
import { createCommitOps } from './ops/commit';
import { createSyncOps } from './ops/sync';
import { createBranchOps } from './ops/branches';
import { createMergeRebaseOps } from './ops/merge-rebase';
import { createLogOps } from './ops/log';
import { createRemoteOps } from './ops/remotes';
import { createTagOps } from './ops/tags';
import { createStashOps } from './ops/stash';
import { createWorktreeOps } from './ops/worktrees';
import { createFileHistoryOps } from './ops/file-history';
import { createBisectOps } from './ops/bisect';

const WorkspaceContext = createContext();

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

export function WorkspaceProvider(props) {
  const { repoData, onSwitchRepo, onBack } = props;
  const repoPath = repoData.path;

  // --- Stores ---
  const [status, setStatus] = createStore({
    branch: '',
    upstream: '',
    ahead: 0,
    behind: 0,
    files: [],
    loading: false,
    error: null,
  });

  const [diff, setDiff] = createStore({
    content: '',
    filepath: null,
    staged: false,
    header: '',
  });

  const [commit, setCommit] = createStore({
    message: '',
    description: '',
    amend: false,
    running: false,
    originalAmendMsg: '',
    amendHash: null,
  });

  const [log, setLog] = createStore({
    commits: [],
    graph: [],
    maxCols: 0,
    loading: false,
    loadingMore: false,
    hasMore: true,
    lanes: [],
  });

  const [remotes, setRemotes] = createStore({ list: [], loading: false });
  const [branches, setBranches] = createStore({
    list: [],
    loading: false,
  });
  const [stashes, setStashes] = createStore({ list: [], loading: false });
  const [tags, setTags] = createStore({ list: [], loading: false });
  const [worktrees, setWorktrees] = createStore({
    list: [],
    loading: false,
  });
  const [stashDetail, setStashDetail] = createStore({
    ref: null,
    files: [],
  });

  const [commitDetail, setCommitDetail] = createStore({
    hash: null,
    body: '',
    author: '',
    email: '',
    date: '',
    parents: [],
    files: [],
    loading: false,
  });

  // --- Signals ---
  const [tab, setTab] = createSignal('changes');
  const [operating, setOperating] = createSignal('');
  const [progressLine, setProgressLine] = createSignal('');
  const [outputLog, setOutputLog] = createSignal([]);
  const [outputOpen, setOutputOpen] = createSignal(false);
  function setOutput(msg, autoOpen) {
    if (!msg) return;
    setOutputLog((prev) => {
      const next = [{ text: msg, time: new Date() }, ...prev];
      return next.length > 500 ? next.slice(0, 500) : next;
    });
    if (autoOpen) setOutputOpen(true);
  }
  function clearOutputLog() {
    setOutputLog([]);
    setOutputOpen(false);
  }
  function toggleOutputPanel() {
    setOutputOpen((v) => !v);
  }
  const [readme, setReadme] = createSignal({
    content: null,
    filename: null,
  });
  const [expandedDirs, setExpandedDirs] = createSignal(new Set());
  const [collapsedSections, setCollapsedSections] = createSignal(
    new Set(['stashes']),
  );
  const [ctxMenu, setCtxMenu] = createSignal(null);
  const [opState, setOpState] = createSignal(null);
  const [submodules, setSubmodules] = createSignal([]);
  const [expandedDetailFiles, setExpandedDetailFiles] = createSignal({});
  const [logBranch, setLogBranch] = createSignal('__all__');
  const [logBranches, setLogBranches] = createSignal([]);
  const [logSearch, setLogSearch] = createSignal('');
  const [logTopoOrder, setLogTopoOrder] = createSignal(false);
  const [selectedFiles, setSelectedFiles] = createSignal(new Set());
  const [allFiles, setAllFiles] = createSignal([]);

  // --- Identity ---
  const [identities, setIdentities] = createSignal([]);
  const [currentIdentity, setCurrentIdentity] = createSignal(null);

  // --- Switcher ---
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [switcherQuery, setSwitcherQuery] = createSignal('');
  const [switcherRepos, setSwitcherRepos] = createSignal([]);
  const [switcherIndex, setSwitcherIndex] = createSignal(0);

  // --- Core operations ---
  async function loadReadme() {
    const result = await window.api.gitReadme(repoPath);
    setReadme({ content: result.content, filename: result.filename });
  }

  async function reloadRepo() {
    await refresh();
    if (tab() === 'log') logOps.loadLog();
  }

  async function refresh() {
    if (status.files.length === 0 && !status.branch) setStatus('loading', true);
    const [result, opResult, subResult, filesResult] = await Promise.all(
      [
        window.api.gitStatus(repoPath),
        window.api.gitOperationState(repoPath),
        window.api.gitSubmodules(repoPath),
        window.api.gitListFiles(repoPath),
      ],
    );
    if (result.error) {
      setStatus({ loading: false, error: result.error });
    } else {
      setStatus(
        'files',
        reconcile(result.files, { key: 'path', merge: false }),
      );
      setStatus('branch', result.branch);
      setStatus('upstream', result.upstream);
      setStatus('ahead', result.ahead);
      setStatus('behind', result.behind);
      setStatus('loading', false);
      setStatus('error', null);
    }
    if (filesResult.files) {
      const statusPaths = new Set(
        (result.files || []).map((f) => f.path),
      );
      const extra = filesResult.files
        .filter((p) => !statusPaths.has(p))
        .map((p) => ({
          path: p,
          index: '?',
          working: '?',
          isGitRepo: false,
          clean: false,
        }));
      setAllFiles(extra);
    }
    if (subResult.submodules) setSubmodules(subResult.submodules);
    setOpState(opResult.state);
  }

  async function loadBranches() {
    setBranches('loading', true);
    const result = await window.api.gitBranchList(repoPath);
    if (!result.error) {
      const tagged = result.branches.map((b) => ({
        ...b,
        remote: b.name.startsWith('remotes/'),
      }));
      setBranches({ list: tagged, loading: false });
    } else {
      setBranches('loading', false);
    }
  }

  // --- Compose ops modules ---
  const diffOps = createDiffOps({ repoPath, status, setDiff });

  const stagingOps = createStagingOps({
    repoPath,
    diff,
    setDiff,
    selectedFiles,
    setSelectedFiles,
    refresh,
    viewDiff: diffOps.viewDiff,
  });

  const hunkOps = createHunkOps({
    repoPath,
    diff,
    refresh,
    viewDiff: diffOps.viewDiff,
  });

  const discardOps = createDiscardOps({
    repoPath,
    status,
    diff,
    setDiff,
    refresh,
  });

  const conflictOps = createConflictOps({ repoPath, setDiff, refresh });

  const patchOps = createPatchOps({ repoPath, setOutput, refresh });

  const commitKey = `gitsync:commit:${repoPath}`;
  const commitOps = createCommitOps({
    repoPath,
    commit,
    setCommit,
    setDiff,
    setOutput,
    reloadRepo,
    refresh,
    commitKey,
  });

  const syncOps = createSyncOps({
    repoPath,
    status,
    setOperating,
    setOutput,
    reloadRepo,
  });

  const branchOps = createBranchOps({
    repoPath,
    status,
    branches,
    setOperating,
    setOutput,
    reloadRepo,
    loadBranches,
    pickRemote: syncOps.pickRemote,
  });

  const mergeRebaseOps = createMergeRebaseOps({
    repoPath,
    status,
    log,
    setOperating,
    setOutput,
    reloadRepo,
  });

  const logOps = createLogOps({
    repoPath,
    log,
    setLog,
    commitDetail,
    setCommitDetail,
    expandedDetailFiles,
    setExpandedDetailFiles,
    logBranch,
    logSearch,
    logTopoOrder,
    setLogBranches,
  });

  const remoteOps = createRemoteOps({
    repoPath,
    remotes,
    setRemotes,
  });

  const tagOps = createTagOps({
    repoPath,
    tags,
    setTags,
    setOutput,
  });

  const stashOps = createStashOps({
    repoPath,
    stashes,
    setStashes,
    stashDetail,
    setStashDetail,
    collapsedSections,
    setCollapsedSections,
    setOperating,
    setOutput,
    refresh,
  });

  const worktreeOps = createWorktreeOps({
    repoPath,
    repoData,
    worktrees,
    setWorktrees,
    setOperating,
    setOutput,
    onSwitchRepo,
  });

  const fileHistoryOps = createFileHistoryOps({ repoPath });

  const bisectOps = createBisectOps({
    repoPath,
    setOperating,
    setOutput,
    reloadRepo,
  });

  // --- Tab change ---
  function onTabChange(t) {
    setTab(t);
    if (t === 'log') {
      logOps.loadLog();
      logOps.loadLogBranches();
    }
    if (t === 'remotes') {
      remoteOps.loadRemotes();
      loadBranches();
      tagOps.loadTags();
      worktreeOps.loadWorktrees();
    }
    if (t === 'stashes') {
      stashOps.loadStashes();
    }
  }

  // --- Submodules ---
  async function initSubmodule(subPath) {
    setOperating('Initializing submodule...');
    const result = await window.api.gitSubmoduleUpdate(repoPath, subPath);
    setOperating('');
    if (result.error)
      showAlert('Error', result.error);
    else setOutput(result.output || 'Submodule initialized');
    await refresh();
  }

  function openSubmodule(sub) {
    onSwitchRepo({ name: sub.name, path: sub.fullPath });
  }

  // --- Context menu ---
  function onFileContextMenu(e, filepath, section) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      filepath,
      filepaths: [filepath],
      section,
      isFolder: false,
    });
  }

  function onFolderContextMenu(e, dirPath, treeNode, section) {
    e.preventDefault();
    e.stopPropagation();
    const paths = allFilesInTree(treeNode).map((f) => f.path);
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      filepath: dirPath,
      filepaths: paths,
      section,
      isFolder: true,
    });
  }

  function dismissCtxMenu() {
    setCtxMenu(null);
  }

  // --- UI toggles ---
  function toggleSection(name) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleDir(dirPath) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }

  function toggleFileSelection(filepath) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filepath)) next.delete(filepath);
      else next.add(filepath);
      return next;
    });
  }

  // --- Switcher ---
  async function openSwitcher() {
    const all = await window.api.gitRepoList();
    setSwitcherRepos(all.filter((r) => r.id !== repoData.savedId));
    setSwitcherQuery('');
    setSwitcherIndex(0);
    setSwitcherOpen(true);
  }

  function closeSwitcher() {
    setSwitcherOpen(false);
  }

  function filteredSwitcherRepos() {
    const q = switcherQuery().toLowerCase();
    if (!q) return switcherRepos();
    return switcherRepos().filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q),
    );
  }

  function switcherSelect(repo) {
    closeSwitcher();
    onSwitchRepo({
      savedId: repo.id,
      name: repo.name,
      path: repo.path,
      category_id: repo.category_id,
    });
  }

  // --- Identity ---
  async function loadIdentities() {
    const list = await window.api.identityList();
    setIdentities(list);
    if (repoData.savedId) {
      const assigned = await window.api.identityGetForRepo(
        repoData.savedId,
      );
      setCurrentIdentity(assigned);
    }
  }

  async function setRepoIdentity(identityId) {
    if (!repoData.savedId) return;
    await window.api.identitySetForRepo(
      repoData.savedId,
      identityId,
      repoPath,
    );
    if (identityId) {
      const match = identities().find((i) => i.id === identityId);
      setCurrentIdentity(match || null);
    } else {
      setCurrentIdentity(null);
    }
  }

  // --- Commit message persistence ---
  function saveCommitMessage() {
    const msg = commit.message;
    const desc = commit.description;
    if (msg || desc) {
      localStorage.setItem(
        commitKey,
        JSON.stringify({ message: msg, description: desc }),
      );
    } else {
      localStorage.removeItem(commitKey);
    }
  }

  function restoreCommitMessage() {
    try {
      const saved = localStorage.getItem(commitKey);
      if (saved) {
        const { message, description } = JSON.parse(saved);
        if (message) setCommit('message', message);
        if (description) setCommit('description', description);
      }
    } catch {}
  }

  // --- Lifecycle ---
  let removeFsListener;
  let removeProgressListener;

  onMount(() => {
    restoreCommitMessage();
    reloadRepo();
    stashOps.loadStashes();
    loadReadme();
    loadIdentities();
    initHomeDir();
    document.addEventListener('click', dismissCtxMenu);
    window.addEventListener('beforeunload', saveCommitMessage);
    window.api.gitWatchRepo(repoPath);
    removeFsListener = window.api.onFsChanged((changedPath) => {
      if (changedPath === repoPath) refresh();
    });
    removeProgressListener = window.api.onGitProgress((line) => {
      setProgressLine(line);
    });
  });

  onCleanup(() => {
    saveCommitMessage();
    window.removeEventListener('beforeunload', saveCommitMessage);
    document.removeEventListener('click', dismissCtxMenu);
    window.api.gitUnwatchRepo(repoPath);
    if (removeFsListener) removeFsListener();
    if (removeProgressListener) removeProgressListener();
  });

  const ctx = {
    repoPath,
    repoData,
    onBack,
    onSwitchRepo,
    // Stores
    status,
    setStatus,
    diff,
    setDiff,
    commit,
    setCommit,
    log,
    setLog,
    remotes,
    branches,
    tags,
    stashes,
    worktrees,
    stashDetail,
    setStashDetail,
    commitDetail,
    setCommitDetail,
    // Signals
    tab,
    setTab,
    operating,
    progressLine,
    outputLog,
    outputOpen,
    setOutputOpen,
    toggleOutputPanel,
    clearOutputLog,
    expandedDirs,
    collapsedSections,
    ctxMenu,
    setCtxMenu,
    opState,
    submodules,
    expandedDetailFiles,
    setExpandedDetailFiles,
    logBranch,
    setLogBranch,
    logBranches,
    logSearch,
    setLogSearch,
    logTopoOrder,
    setLogTopoOrder,
    selectedFiles,
    allFiles,
    switcherOpen,
    switcherQuery,
    setSwitcherQuery,
    switcherRepos,
    switcherIndex,
    setSwitcherIndex,
    // Operations
    reloadRepo,
    refresh,
    onTabChange,
    viewDiff: diffOps.viewDiff,
    ...stagingOps,
    ...hunkOps,
    ...discardOps,
    ...conflictOps,
    ...patchOps,
    ...commitOps,
    ...syncOps,
    ...branchOps,
    ...mergeRebaseOps,
    ...logOps,
    loadRemotes: remoteOps.loadRemotes,
    addRemote: remoteOps.addRemote,
    removeRemote: remoteOps.removeRemote,
    editRemoteUrl: remoteOps.editRemoteUrl,
    loadBranches,
    ...tagOps,
    ...stashOps,
    ...worktreeOps,
    ...fileHistoryOps,
    ...bisectOps,
    initSubmodule,
    openSubmodule,
    onFileContextMenu,
    onFolderContextMenu,
    dismissCtxMenu,
    toggleSection,
    toggleDir,
    toggleFileSelection,
    openSwitcher,
    closeSwitcher,
    filteredSwitcherRepos,
    switcherSelect,
    identities,
    currentIdentity,
    setRepoIdentity,
    loadIdentities,
    readme,
    loadReadme,
  };

  return (
    <WorkspaceContext.Provider value={ctx}>
      {props.children}
    </WorkspaceContext.Provider>
  );
}
