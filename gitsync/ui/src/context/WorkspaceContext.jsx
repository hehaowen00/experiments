import { createContext, useContext, createSignal, onMount, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { showAlert, showConfirm, showPrompt } from '../components/Modal';
import { buildGraph } from '../utils/graph';
import { initHomeDir } from '../utils/path';
import { allFilesInTree } from '../utils/tree';

const WorkspaceContext = createContext();

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

const LOG_PAGE_SIZE = 100;

export function WorkspaceProvider(props) {
  const { repoData, onSwitchRepo, onBack } = props;
  const repoPath = repoData.path;

  // --- Stores ---
  const [status, setStatus] = createStore({
    branch: '', upstream: '', ahead: 0, behind: 0, files: [], loading: false, error: null,
  });

  const [diff, setDiff] = createStore({
    content: '', filepath: null, staged: false,
  });

  const [commit, setCommit] = createStore({
    message: '', description: '', amend: false, running: false, originalAmendMsg: '', amendHash: null,
  });

  const [log, setLog] = createStore({
    commits: [], graph: [], maxCols: 0, loading: false, loadingMore: false, hasMore: true, lanes: [],
  });

  const [remotes, setRemotes] = createStore({ list: [], loading: false });
  const [branches, setBranches] = createStore({ list: [], loading: false });
  const [stashes, setStashes] = createStore({ list: [], loading: false });
  const [stashDetail, setStashDetail] = createStore({ ref: null, diff: '' });

  const [commitDetail, setCommitDetail] = createStore({
    hash: null, body: '', author: '', email: '', date: '', parents: [], diff: '', loading: false,
  });

  // --- Signals ---
  const [tab, setTab] = createSignal('changes');
  const [operating, setOperating] = createSignal('');
  const [output, setOutput] = createSignal('');
  const [expandedDirs, setExpandedDirs] = createSignal(new Set());
  const [collapsedSections, setCollapsedSections] = createSignal(new Set());
  const [ctxMenu, setCtxMenu] = createSignal(null);
  const [opState, setOpState] = createSignal(null);
  const [submodules, setSubmodules] = createSignal([]);
  const [expandedDetailFiles, setExpandedDetailFiles] = createSignal(new Set());
  const [logBranch, setLogBranch] = createSignal('__all__');
  const [logBranches, setLogBranches] = createSignal([]);
  const [logSearch, setLogSearch] = createSignal('');
  const [selectedFiles, setSelectedFiles] = createSignal(new Set());

  // --- Identity ---
  const [identities, setIdentities] = createSignal([]);
  const [currentIdentity, setCurrentIdentity] = createSignal(null);

  // --- Switcher ---
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [switcherQuery, setSwitcherQuery] = createSignal('');
  const [switcherRepos, setSwitcherRepos] = createSignal([]);
  const [switcherIndex, setSwitcherIndex] = createSignal(0);

  // --- Core operations ---
  async function refresh() {
    setStatus('loading', true);
    const [result, opResult, subResult] = await Promise.all([
      window.api.gitStatus(repoPath),
      window.api.gitOperationState(repoPath),
      window.api.gitSubmodules(repoPath),
    ]);
    if (result.error) {
      setStatus({ loading: false, error: result.error });
    } else {
      setStatus(reconcile({
        branch: result.branch,
        upstream: result.upstream,
        ahead: result.ahead,
        behind: result.behind,
        files: result.files,
        loading: false,
        error: null,
      }));
    }
    if (subResult.submodules) setSubmodules(subResult.submodules);
    setOpState(opResult.state);
  }

  async function loadLog() {
    setLog('loading', true);
    const branch = logBranch();
    const search = logSearch();
    const allBranches = branch === '__all__';
    const branchName = (branch === '__current__' || branch === '__all__') ? null : branch;
    const result = await window.api.gitLog(repoPath, LOG_PAGE_SIZE, allBranches, branchName, 0, search);
    if (!result.error) {
      const { graph, maxCols, lanes } = buildGraph(result.commits, []);
      setLog({
        commits: result.commits, graph, maxCols, lanes,
        loading: false, loadingMore: false,
        hasMore: result.commits.length >= LOG_PAGE_SIZE,
      });
    } else {
      setLog('loading', false);
    }
  }

  async function loadMoreLog() {
    if (log.loadingMore || !log.hasMore) return;
    setLog('loadingMore', true);
    const branch = logBranch();
    const search = logSearch();
    const allBranches = branch === '__all__';
    const branchName = (branch === '__current__' || branch === '__all__') ? null : branch;
    const skip = log.commits.length;
    const result = await window.api.gitLog(repoPath, LOG_PAGE_SIZE, allBranches, branchName, skip, search);
    if (!result.error) {
      if (result.commits.length === 0) {
        setLog({ loadingMore: false, hasMore: false });
        return;
      }
      const { graph: newGraph, maxCols: newMaxCols, lanes } = buildGraph(result.commits, log.lanes);
      setLog({
        commits: [...log.commits, ...result.commits],
        graph: [...log.graph, ...newGraph],
        maxCols: Math.max(log.maxCols, newMaxCols),
        lanes,
        loadingMore: false,
        hasMore: result.commits.length >= LOG_PAGE_SIZE,
      });
    } else {
      setLog('loadingMore', false);
    }
  }

  async function loadLogBranches() {
    const result = await window.api.gitBranchList(repoPath);
    if (!result.error) setLogBranches(result.branches);
  }

  async function loadRemotes() {
    setRemotes('loading', true);
    const result = await window.api.gitRemoteList(repoPath);
    if (!result.error) setRemotes({ list: result.remotes, loading: false });
    else setRemotes('loading', false);
  }

  async function loadBranches() {
    setBranches('loading', true);
    const result = await window.api.gitBranchList(repoPath);
    if (!result.error) {
      const tagged = result.branches.map(b => ({ ...b, remote: b.name.startsWith('remotes/') }));
      setBranches({ list: tagged, loading: false });
    } else {
      setBranches('loading', false);
    }
  }

  async function loadStashes() {
    setStashes('loading', true);
    const result = await window.api.gitStashList(repoPath);
    if (!result.error) setStashes({ list: result.stashes, loading: false });
    else setStashes('loading', false);
  }

  function onTabChange(t) {
    setTab(t);
    if (t === 'log') { loadLog(); loadLogBranches(); }
    if (t === 'remotes') { loadRemotes(); loadBranches(); }
    if (t === 'stashes') { loadStashes(); }
  }

  // --- Diff ---
  async function viewDiff(filepath, staged) {
    const file = status.files.find(f => f.path === filepath);
    const isUntracked = file && file.index === '?' && file.working === '?';
    let result;
    if (isUntracked) {
      result = await window.api.gitDiffUntracked(repoPath, filepath);
    } else {
      result = await window.api.gitDiff(repoPath, filepath, staged);
    }
    if (result.error) {
      setDiff({ content: `Error: ${result.error}`, filepath, staged });
    } else {
      setDiff({ content: result.diff || '(no changes)', filepath, staged });
    }
  }

  // --- Staging ---
  async function stageFile(filepath) {
    await window.api.gitStage(repoPath, [filepath]);
    await refresh();
    if (diff.filepath === filepath) viewDiff(filepath, true);
  }

  async function unstageFile(filepath) {
    await window.api.gitUnstage(repoPath, [filepath]);
    await refresh();
    if (diff.filepath === filepath) viewDiff(filepath, false);
  }

  async function stageAll(files) {
    if (files && files.length > 0) {
      await window.api.gitStage(repoPath, files.map(f => f.path));
    } else {
      await window.api.gitStageAll(repoPath);
    }
    await refresh();
  }

  async function unstageAll() {
    await window.api.gitUnstageAll(repoPath);
    await refresh();
  }

  async function stageSelected() {
    const files = [...selectedFiles()];
    if (files.length === 0) return;
    await window.api.gitStage(repoPath, files);
    setSelectedFiles(new Set());
    await refresh();
  }

  async function unstageSelected() {
    const files = [...selectedFiles()];
    if (files.length === 0) return;
    await window.api.gitUnstage(repoPath, files);
    setSelectedFiles(new Set());
    await refresh();
  }

  // --- Discard ---
  async function discardFile(filepath) {
    if (await showConfirm(`Discard changes to "${filepath}"?`, 'This cannot be undone.')) {
      await window.api.gitDiscard(repoPath, [filepath]);
      await refresh();
      if (diff.filepath === filepath) setDiff({ content: '', filepath: null });
    }
  }

  async function discardFiles(filepaths) {
    const label = filepaths.length === 1 ? `"${filepaths[0]}"` : `${filepaths.length} files`;
    if (await showConfirm(`Discard changes to ${label}?`, 'This cannot be undone.')) {
      await window.api.gitDiscard(repoPath, filepaths);
      await refresh();
      if (filepaths.includes(diff.filepath)) setDiff({ content: '', filepath: null });
    }
  }

  async function deleteUntrackedFiles(filepaths) {
    const label = filepaths.length === 1 ? `"${filepaths[0]}"` : `${filepaths.length} files`;
    if (await showConfirm(`Delete ${label}?`, 'This cannot be undone.')) {
      await window.api.gitDeleteUntracked(repoPath, filepaths);
      await refresh();
      if (filepaths.includes(diff.filepath)) setDiff({ content: '', filepath: null });
    }
  }

  // --- Commit ---
  async function doCommit() {
    const subject = commit.message.trim();
    const desc = commit.description.trim();
    if (!subject && !commit.amend) { showAlert('Error', 'Commit message is required'); return; }
    const fullMsg = desc ? `${subject}\n\n${desc}` : subject;
    setCommit('running', true);
    let result;
    if (commit.amend) {
      result = await window.api.gitCommit(repoPath, fullMsg || commit.originalAmendMsg);
    } else {
      result = await window.api.gitCommit(repoPath, fullMsg);
    }
    setCommit('running', false);
    if (result.error) {
      showAlert('Commit Failed', result.error);
    } else {
      setCommit({ message: '', description: '', amend: false, originalAmendMsg: '', amendHash: null });
      setOutput(result.output || 'Committed successfully');
      await refresh();
      loadLog();
    }
  }

  async function toggleAmend() {
    const newAmend = !commit.amend;
    if (newAmend) {
      const resetResult = await window.api.gitResetSoftHead(repoPath);
      if (resetResult.error) { showAlert('Error', resetResult.error); return; }
      setCommit('amend', true);
      setCommit('amendHash', resetResult.hash);
      const showResult = await window.api.gitShow(repoPath, resetResult.hash);
      if (showResult.body) {
        const parts = showResult.body.split(/\n\n(.*)$/s);
        const subject = parts[0] || '';
        const desc = parts[1] || '';
        setCommit('message', subject);
        setCommit('description', desc);
        setCommit('originalAmendMsg', desc ? `${subject}\n\n${desc}` : subject);
      }
      await refresh();
    } else {
      if (commit.amendHash) {
        await window.api.gitResetSoftTo(repoPath, commit.amendHash);
      }
      setCommit({ message: '', description: '', amend: false, originalAmendMsg: '', amendHash: null });
      await refresh();
    }
  }

  // --- Pull/Push/Fetch ---
  async function doPull() {
    setOperating('Pulling...');
    const result = await window.api.gitPull(repoPath);
    setOperating('');
    if (result.error) showAlert('Pull Failed', result.error);
    else setOutput(result.output || 'Pull complete');
    await refresh();
    loadLog();
  }

  async function doPush() {
    setOperating('Pushing...');
    let result;
    if (!status.upstream && status.branch) {
      const remoteResult = await window.api.gitRemoteList(repoPath);
      const defaultRemote = remoteResult.remotes?.[0]?.name || 'origin';
      result = await window.api.gitPushSetUpstream(repoPath, defaultRemote, status.branch);
    } else {
      result = await window.api.gitPush(repoPath);
    }
    setOperating('');
    if (result.error) showAlert('Push Failed', result.error);
    else setOutput(result.output || 'Push complete');
    await refresh();
  }

  async function doFetch() {
    setOperating('Fetching...');
    const result = await window.api.gitFetch(repoPath);
    setOperating('');
    if (result.error) showAlert('Fetch Failed', result.error);
    else setOutput(result.output || 'Fetch complete');
    await refresh();
  }

  // --- Remotes ---
  async function addRemote() {
    const name = await showPrompt('Remote Name', '', '', 'origin');
    if (!name) return;
    const url = await showPrompt('Remote URL', '', '', 'https://...');
    if (!url) return;
    const result = await window.api.gitRemoteAdd(repoPath, name.trim(), url.trim());
    if (result.error) showAlert('Error', result.error);
    else loadRemotes();
  }

  async function removeRemote(name) {
    if (await showConfirm(`Remove remote "${name}"?`, 'This cannot be undone.')) {
      const result = await window.api.gitRemoteRemove(repoPath, name);
      if (result.error) showAlert('Error', result.error);
      else loadRemotes();
    }
  }

  async function editRemoteUrl(name, currentUrl) {
    const url = await showPrompt('Remote URL', currentUrl);
    if (!url) return;
    const result = await window.api.gitRemoteSetUrl(repoPath, name, url.trim());
    if (result.error) showAlert('Error', result.error);
    else loadRemotes();
  }

  // --- Branches ---
  async function checkoutBranch(name) {
    setOperating('Checking out...');
    const result = await window.api.gitCheckout(repoPath, name);
    setOperating('');
    if (result.error) {
      showAlert('Checkout Failed', result.error);
    } else {
      setOutput(result.output || `Switched to ${name}`);
      await refresh();
      loadBranches();
      loadLog();
    }
  }

  async function checkoutRemoteBranch(remoteBranch) {
    const parts = remoteBranch.replace(/^remotes\//, '').split('/');
    const remote = parts[0];
    const localName = parts.slice(1).join('/');
    const trackRef = `${remote}/${localName}`;
    const localExists = branches.list.some(b => !b.remote && b.name === localName);
    if (localExists) return checkoutBranch(localName);
    setOperating('Checking out...');
    const result = await window.api.gitCheckoutRemote(repoPath, localName, trackRef);
    setOperating('');
    if (result.error) {
      showAlert('Checkout Failed', result.error);
    } else {
      setOutput(result.output || `Checked out ${localName} tracking ${trackRef}`);
      await refresh();
      loadBranches();
      loadLog();
    }
  }

  async function createBranch() {
    const name = await showPrompt('New Branch', '', '', 'branch-name');
    if (!name || !name.trim()) return;
    setOperating('Creating branch...');
    const result = await window.api.gitCheckoutNewBranch(repoPath, name.trim());
    setOperating('');
    if (result.error) {
      showAlert('Error', result.error);
    } else {
      setOutput(result.output || `Created and switched to ${name.trim()}`);
      await refresh();
      loadBranches();
      loadLog();
    }
  }

  // --- Merge & Rebase ---
  async function doMerge(branch) {
    if (!await showConfirm(`Merge "${branch}" into "${status.branch}"?`, '')) return;
    setOperating('Merging...');
    const result = await window.api.gitMerge(repoPath, branch);
    setOperating('');
    if (result.error) showAlert('Merge Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Merge conflicts detected');
    else setOutput(result.output || 'Merge complete');
    await refresh();
    loadLog();
  }

  async function doMergeAbort() {
    if (!await showConfirm('Abort merge?', 'This will discard all merge changes.')) return;
    setOperating('Aborting merge...');
    const result = await window.api.gitMergeAbort(repoPath);
    setOperating('');
    if (result.error) showAlert('Error', result.error);
    else setOutput('Merge aborted');
    await refresh();
    loadLog();
  }

  async function doRebase(branch) {
    if (!await showConfirm(`Rebase "${status.branch}" onto "${branch}"?`, '')) return;
    setOperating('Rebasing...');
    const result = await window.api.gitRebase(repoPath, branch);
    setOperating('');
    if (result.error) showAlert('Rebase Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Rebase conflicts detected — resolve and continue');
    else setOutput(result.output || 'Rebase complete');
    await refresh();
    loadLog();
  }

  async function doRebaseContinue() {
    setOperating('Continuing rebase...');
    const result = await window.api.gitRebaseContinue(repoPath);
    setOperating('');
    if (result.error) showAlert('Rebase Continue Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'More conflicts — resolve and continue');
    else setOutput(result.output || 'Rebase complete');
    await refresh();
    loadLog();
  }

  async function doRebaseAbort() {
    if (!await showConfirm('Abort rebase?', 'This will restore the branch to its original state.')) return;
    setOperating('Aborting rebase...');
    const result = await window.api.gitRebaseAbort(repoPath);
    setOperating('');
    if (result.error) showAlert('Error', result.error);
    else setOutput('Rebase aborted');
    await refresh();
    loadLog();
  }

  // --- Stash ---
  async function doStashPush() {
    const message = await showPrompt('Stash Message', '', '', 'Optional message');
    if (message === null) return;
    setOperating('Stashing...');
    const result = await window.api.gitStashPush(repoPath, message || '', true);
    setOperating('');
    if (result.error) showAlert('Stash Failed', result.error);
    else setOutput(result.output || 'Changes stashed');
    await refresh();
    if (tab() === 'stashes') loadStashes();
  }

  async function doStashPop(ref) {
    setOperating('Popping stash...');
    const result = await window.api.gitStashPop(repoPath, ref);
    setOperating('');
    if (result.error) showAlert('Stash Pop Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Stash applied with conflicts');
    else setOutput(result.output || 'Stash popped');
    await refresh();
    loadStashes();
  }

  async function doStashApply(ref) {
    setOperating('Applying stash...');
    const result = await window.api.gitStashApply(repoPath, ref);
    setOperating('');
    if (result.error) showAlert('Stash Apply Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Stash applied with conflicts');
    else setOutput(result.output || 'Stash applied');
    await refresh();
  }

  async function doStashDrop(ref) {
    if (!await showConfirm(`Drop "${ref}"?`, 'This cannot be undone.')) return;
    const result = await window.api.gitStashDrop(repoPath, ref);
    if (result.error) showAlert('Error', result.error);
    else setOutput('Stash dropped');
    loadStashes();
  }

  async function viewStashDiff(ref) {
    if (stashDetail.ref === ref) {
      setStashDetail({ ref: null, diff: '' });
      return;
    }
    const result = await window.api.gitStashShow(repoPath, ref);
    if (result.error) showAlert('Error', result.error);
    else setStashDetail({ ref, diff: result.diff });
  }

  // --- Submodules ---
  async function initSubmodule(subPath) {
    setOperating('Initializing submodule...');
    const result = await window.api.gitSubmoduleUpdate(repoPath, subPath);
    setOperating('');
    if (result.error) showAlert('Error', result.error);
    else setOutput(result.output || 'Submodule initialized');
    await refresh();
  }

  function openSubmodule(sub) {
    onSwitchRepo({ name: sub.name, path: sub.fullPath });
  }

  // --- Commit detail ---
  async function selectCommit(hash) {
    if (commitDetail.hash === hash) {
      setCommitDetail({ hash: null, body: '', author: '', email: '', date: '', parents: [], diff: '', loading: false });
      return;
    }
    setCommitDetail({ hash, loading: true, body: '', diff: '', author: '', email: '', date: '', parents: [] });
    setExpandedDetailFiles(new Set());
    const result = await window.api.gitShow(repoPath, hash);
    if (result.error) {
      setCommitDetail({ hash, loading: false, body: result.error, diff: '', author: '', email: '', date: '', parents: [] });
    } else {
      setCommitDetail({ hash, body: result.body, author: result.author, email: result.email, date: result.date, parents: result.parents, diff: result.diff, loading: false });
    }
  }

  // --- Context menu ---
  function onFileContextMenu(e, filepath, section) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, filepath, filepaths: [filepath], section, isFolder: false });
  }

  function onFolderContextMenu(e, dirPath, treeNode, section) {
    e.preventDefault();
    e.stopPropagation();
    const paths = allFilesInTree(treeNode).map(f => f.path);
    setCtxMenu({ x: e.clientX, y: e.clientY, filepath: dirPath, filepaths: paths, section, isFolder: true });
  }

  function dismissCtxMenu() { setCtxMenu(null); }

  // --- UI toggles ---
  function toggleSection(name) {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleDir(dirPath) {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }

  function toggleFileSelection(filepath) {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filepath)) next.delete(filepath);
      else next.add(filepath);
      return next;
    });
  }

  // --- Switcher ---
  async function openSwitcher() {
    const all = await window.api.gitRepoList();
    setSwitcherRepos(all.filter(r => r.id !== repoData.savedId));
    setSwitcherQuery('');
    setSwitcherIndex(0);
    setSwitcherOpen(true);
  }

  function closeSwitcher() { setSwitcherOpen(false); }

  function filteredSwitcherRepos() {
    const q = switcherQuery().toLowerCase();
    if (!q) return switcherRepos();
    return switcherRepos().filter(r => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
  }

  function switcherSelect(repo) {
    closeSwitcher();
    onSwitchRepo({ savedId: repo.id, name: repo.name, path: repo.path, category_id: repo.category_id });
  }

  // --- Identity ---
  async function loadIdentities() {
    const list = await window.api.identityList();
    setIdentities(list);
    if (repoData.savedId) {
      const assigned = await window.api.identityGetForRepo(repoData.savedId);
      setCurrentIdentity(assigned);
    }
  }

  async function setRepoIdentity(identityId) {
    if (!repoData.savedId) return;
    await window.api.identitySetForRepo(repoData.savedId, identityId, repoPath);
    if (identityId) {
      const match = identities().find((i) => i.id === identityId);
      setCurrentIdentity(match || null);
    } else {
      setCurrentIdentity(null);
    }
  }

  // --- Lifecycle ---
  onMount(() => {
    refresh();
    loadLog();
    loadStashes();
    loadIdentities();
    initHomeDir();
    document.addEventListener('click', dismissCtxMenu);
  });

  onCleanup(() => {
    document.removeEventListener('click', dismissCtxMenu);
  });

  const ctx = {
    repoPath, repoData, onBack, onSwitchRepo,
    // Stores
    status, setStatus, diff, setDiff, commit, setCommit,
    log, setLog, remotes, branches, stashes, stashDetail, setStashDetail,
    commitDetail, setCommitDetail,
    // Signals
    tab, setTab, operating, output, setOutput,
    expandedDirs, collapsedSections, ctxMenu, setCtxMenu, opState, submodules,
    expandedDetailFiles, setExpandedDetailFiles,
    logBranch, setLogBranch, logBranches, logSearch, setLogSearch, selectedFiles,
    switcherOpen, switcherQuery, setSwitcherQuery, switcherRepos, switcherIndex, setSwitcherIndex,
    // Operations
    refresh, loadLog, loadMoreLog, loadLogBranches, loadRemotes, loadBranches, loadStashes,
    onTabChange, viewDiff,
    stageFile, unstageFile, stageAll, unstageAll, stageSelected, unstageSelected,
    discardFile, discardFiles, deleteUntrackedFiles,
    doCommit, toggleAmend,
    doPull, doPush, doFetch,
    addRemote, removeRemote, editRemoteUrl,
    checkoutBranch, checkoutRemoteBranch, createBranch,
    doMerge, doMergeAbort, doRebase, doRebaseContinue, doRebaseAbort,
    doStashPush, doStashPop, doStashApply, doStashDrop, viewStashDiff,
    initSubmodule, openSubmodule, selectCommit,
    onFileContextMenu, onFolderContextMenu, dismissCtxMenu,
    toggleSection, toggleDir, toggleFileSelection,
    openSwitcher, closeSwitcher, filteredSwitcherRepos, switcherSelect,
    identities, currentIdentity, setRepoIdentity, loadIdentities,
  };

  return (
    <WorkspaceContext.Provider value={ctx}>
      {props.children}
    </WorkspaceContext.Provider>
  );
}
