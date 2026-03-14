import { createContext, useContext, createSignal, onMount, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { showAlert, showChoice, showConfirm, showPrompt } from '../components/Modal';
import { buildGraph, resetGraphColors } from '../utils/graph';
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
  const [tags, setTags] = createStore({ list: [], loading: false });
  const [stashDetail, setStashDetail] = createStore({ ref: null, diff: '' });

  const [commitDetail, setCommitDetail] = createStore({
    hash: null, body: '', author: '', email: '', date: '', parents: [], diff: '', loading: false,
  });

  // --- Signals ---
  const [tab, setTab] = createSignal('changes');
  const [operating, setOperating] = createSignal('');
  const [outputLog, setOutputLog] = createSignal([]);
  const [outputOpen, setOutputOpen] = createSignal(false);
  function setOutput(msg, autoOpen) {
    if (!msg) return;
    setOutputLog(prev => [{ text: msg, time: new Date() }, ...prev]);
    if (autoOpen) setOutputOpen(true);
  }
  function clearOutputLog() { setOutputLog([]); setOutputOpen(false); }
  function toggleOutputPanel() { setOutputOpen(v => !v); }
  const [readme, setReadme] = createSignal({ content: null, filename: null });
  const [expandedDirs, setExpandedDirs] = createSignal(new Set());
  const [collapsedSections, setCollapsedSections] = createSignal(new Set());
  const [ctxMenu, setCtxMenu] = createSignal(null);
  const [opState, setOpState] = createSignal(null);
  const [submodules, setSubmodules] = createSignal([]);
  const [expandedDetailFiles, setExpandedDetailFiles] = createSignal(new Set());
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

  // Reload working tree + commit history. Use after any operation that
  // may change files, branches, or commits so callers don't need to
  // remember which combination of loaders to invoke.
  async function loadReadme() {
    const result = await window.api.gitReadme(repoPath);
    setReadme({ content: result.content, filename: result.filename });
  }

  async function reloadRepo() {
    await refresh();
    loadLog();
  }

  async function refresh() {
    setStatus('loading', true);
    const [result, opResult, subResult, filesResult] = await Promise.all([
      window.api.gitStatus(repoPath),
      window.api.gitOperationState(repoPath),
      window.api.gitSubmodules(repoPath),
      window.api.gitListFiles(repoPath),
    ]);
    if (result.error) {
      setStatus({ loading: false, error: result.error });
    } else {
      setStatus('files', reconcile(result.files, { key: 'path', merge: false }));
      setStatus('branch', result.branch);
      setStatus('upstream', result.upstream);
      setStatus('ahead', result.ahead);
      setStatus('behind', result.behind);
      setStatus('loading', false);
      setStatus('error', null);
    }
    if (filesResult.files) {
      const statusPaths = new Set((result.files || []).map(f => f.path));
      const extra = filesResult.files
        .filter(p => !statusPaths.has(p))
        .map(p => ({ path: p, index: '?', working: '?', isGitRepo: false, clean: false }));
      setAllFiles(extra);
    }
    if (subResult.submodules) setSubmodules(subResult.submodules);
    setOpState(opResult.state);
  }

  async function loadLog() {
    const isInitial = log.commits.length === 0;
    if (isInitial) setLog('loading', true);
    const branch = logBranch();
    const search = logSearch();
    const allBranches = branch === '__all__';
    const branchName = (branch === '__current__' || branch === '__all__') ? null : branch;
    const result = await window.api.gitLog(repoPath, LOG_PAGE_SIZE, allBranches, branchName, 0, search, logTopoOrder());
    if (!result.error) {
      resetGraphColors();
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
    const result = await window.api.gitLog(repoPath, LOG_PAGE_SIZE, allBranches, branchName, skip, search, logTopoOrder());
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

  async function loadTags() {
    setTags('loading', true);
    const result = await window.api.gitTagList(repoPath);
    if (!result.error) setTags({ list: result.tags, loading: false });
    else setTags('loading', false);
  }

  async function doCreateTag(name, message, target) {
    const result = await window.api.gitTagCreate(repoPath, name, message || '', target || '');
    if (result.error) showAlert('Tag Failed', result.error);
    else loadTags();
  }

  async function doDeleteTag(name) {
    if (!await showConfirm(`Delete tag "${name}"?`, '')) return;
    const result = await window.api.gitTagDelete(repoPath, name);
    if (result.error) showAlert('Delete Tag Failed', result.error);
    else loadTags();
  }

  async function doPushTag(remote, name) {
    const result = await window.api.gitTagPush(repoPath, remote, name, false);
    if (result.error) showAlert('Push Tag Failed', result.error);
    else setOutput(`Tag "${name}" pushed to ${remote}`);
  }

  async function doDeleteRemoteTag(remote, name) {
    if (!await showConfirm(`Delete tag "${name}" from remote "${remote}"?`, '')) return;
    const result = await window.api.gitTagPush(repoPath, remote, name, true);
    if (result.error) showAlert('Delete Remote Tag Failed', result.error);
    else setOutput(`Tag "${name}" deleted from ${remote}`);
  }

  function onTabChange(t) {
    setTab(t);
    if (t === 'log') { loadLog(); loadLogBranches(); }
    if (t === 'remotes') { loadRemotes(); loadBranches(); loadTags(); }
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
    const result = await window.api.gitStage(repoPath, [filepath]);
    if (result?.error) { showAlert('Stage Failed', result.error); return; }
    await refresh();
    if (diff.filepath === filepath) viewDiff(filepath, true);
  }

  async function unstageFile(filepath) {
    const result = await window.api.gitUnstage(repoPath, [filepath]);
    if (result?.error) { showAlert('Unstage Failed', result.error); return; }
    await refresh();
    if (diff.filepath === filepath) viewDiff(filepath, false);
  }

  async function stageAll(files) {
    let result;
    if (files && files.length > 0) {
      result = await window.api.gitStage(repoPath, files.map(f => f.path));
    } else {
      result = await window.api.gitStageAll(repoPath);
    }
    if (result?.error) { showAlert('Stage Failed', result.error); return; }
    await refresh();
  }

  async function unstageAll() {
    const result = await window.api.gitUnstageAll(repoPath);
    if (result?.error) { showAlert('Unstage Failed', result.error); return; }
    await refresh();
  }

  async function stageSelected() {
    const files = [...selectedFiles()];
    if (files.length === 0) return;
    const result = await window.api.gitStage(repoPath, files);
    if (result?.error) { showAlert('Stage Failed', result.error); return; }
    setSelectedFiles(new Set());
    await refresh();
  }

  async function unstageSelected() {
    const files = [...selectedFiles()];
    if (files.length === 0) return;
    const result = await window.api.gitUnstage(repoPath, files);
    if (result?.error) { showAlert('Unstage Failed', result.error); return; }
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

  async function discardStagedFiles(filepaths) {
    const label = filepaths.length === 1 ? `"${filepaths[0]}"` : `${filepaths.length} files`;
    if (await showConfirm(`Discard staged changes to ${label}?`, 'This will unstage and discard all changes. This cannot be undone.')) {
      await window.api.gitUnstage(repoPath, filepaths);
      // New files become untracked after unstaging — delete them
      const newFiles = filepaths.filter((fp) => {
        const f = status.files.find((s) => s.path === fp);
        return f && f.index === 'A';
      });
      const modifiedFiles = filepaths.filter((fp) => !newFiles.includes(fp));
      if (modifiedFiles.length > 0) {
        await window.api.gitDiscard(repoPath, modifiedFiles);
      }
      if (newFiles.length > 0) {
        await window.api.gitDeleteUntracked(repoPath, newFiles);
      }
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

  // --- Conflict resolution ---
  async function resolveOurs(filepaths) {
    const result = await window.api.gitResolveOurs(repoPath, filepaths);
    if (result.error) showAlert('Resolve Failed', result.error);
    else await refresh();
  }

  async function resolveTheirs(filepaths) {
    const result = await window.api.gitResolveTheirs(repoPath, filepaths);
    if (result.error) showAlert('Resolve Failed', result.error);
    else await refresh();
  }

  async function viewConflictDiff(filepath) {
    const result = await window.api.gitDiffConflict(repoPath, filepath);
    if (result.error) {
      setDiff({ content: `Error: ${result.error}`, filepath, staged: false });
    } else {
      setDiff({ content: result.diff || '(no changes)', filepath, staged: false });
    }
  }

  // --- Patch export ---
  async function exportStagedPatch() {
    const result = await window.api.gitExportStagedPatch(repoPath);
    if (result.error) showAlert('Export Failed', result.error);
    else if (result.ok) setOutput(`Patch saved to ${result.path}`);
  }

  async function applyPatch() {
    const result = await window.api.gitApplyPatch(repoPath);
    if (result.canceled) return;
    if (result.error) showAlert('Apply Patch Failed', result.error);
    else {
      setOutput(result.output || 'Patch applied');
      await refresh();
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
    try {
      if (commit.amend) {
        result = await window.api.gitCommit(repoPath, fullMsg || commit.originalAmendMsg);
      } else {
        result = await window.api.gitCommit(repoPath, fullMsg);
      }
    } catch (e) {
      setCommit('running', false);
      showAlert('Commit Failed', e.message);
      return;
    }
    setCommit('running', false);
    if (result.error) {
      showAlert('Commit Failed', result.error);
    } else {
      setCommit({ message: '', description: '', amend: false, originalAmendMsg: '', amendHash: null });
      localStorage.removeItem(commitKey);
      // Clear diff if the displayed file was part of the commit (staged)
      if (diff.filepath && diff.staged) {
        setDiff({ content: '', filepath: null, staged: false });
      }
      setOutput(result.output || 'Committed successfully');
      await reloadRepo();
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
  let lastRemote = null;

  async function pickRemote(title, description) {
    const remoteResult = await window.api.gitRemoteList(repoPath);
    const remoteList = remoteResult.remotes || [];
    if (remoteList.length === 0) return null;
    if (remoteList.length === 1) return remoteList[0].name;

    const choices = remoteList.map((r) => ({
      label: r.name + (r.name === lastRemote ? ' (last used)' : ''),
      value: r.name,
      description: r.fetch,
    }));
    if (lastRemote) {
      const idx = choices.findIndex((c) => c.value === lastRemote);
      if (idx > 0) choices.unshift(choices.splice(idx, 1)[0]);
    }

    return await showChoice(title, description, choices);
  }

  async function doPull(strategy, remote) {
    if (!remote) {
      remote = await pickRemote('Pull from Remote', 'Select which remote to pull from.');
      if (!remote) return;
    }
    lastRemote = remote;

    setOperating('Pulling...');
    const result = await window.api.gitPull(repoPath, strategy, remote);
    setOperating('');
    if (result.error) {
      if (result.divergent) {
        const choice = await showChoice(
          'Divergent Branches',
          'Local and remote branches have diverged.',
          [
            { label: 'Fast-forward only', value: 'ff-only', description: 'Fail if not possible without creating a merge commit' },
            { label: 'Rebase', value: 'rebase', description: 'Replay local commits on top of remote changes' },
            { label: 'Merge', value: 'merge', description: 'Create a merge commit combining both histories' },
          ],
        );
        if (choice) return doPull(choice, remote);
      } else {
        showAlert('Pull Failed', result.error);
      }
    } else {
      setOutput(result.output || 'Pull complete');
    }
    await reloadRepo();
  }

  async function doPush() {
    const remote = await pickRemote('Push to Remote', 'Select which remote to push to.');
    if (!remote) return;
    lastRemote = remote;

    setOperating('Pushing...');
    let result;
    if (!status.upstream && status.branch) {
      result = await window.api.gitPushSetUpstream(repoPath, remote, status.branch);
    } else {
      result = await window.api.gitPush(repoPath, remote);
    }
    setOperating('');
    if (result.error) {
      if (result.divergent) {
        const choice = await showChoice(
          'Push Rejected',
          'The remote has changes you don\'t have locally.',
          [
            { label: 'Pull (rebase) then push', value: 'pull-rebase', description: 'Rebase local commits on top of remote, then push' },
            { label: 'Pull (merge) then push', value: 'pull-merge', description: 'Merge remote changes locally, then push' },
            { label: 'Force push', value: 'force', style: 'danger', description: 'Overwrite remote with local (uses --force-with-lease)' },
          ],
        );
        if (choice === 'pull-rebase') {
          await doPull('rebase', remote);
          const retry = await window.api.gitPush(repoPath, remote);
          if (retry.error) showAlert('Push Failed', retry.error);
          else setOutput(retry.output || 'Push complete');
        } else if (choice === 'pull-merge') {
          await doPull('merge', remote);
          const retry = await window.api.gitPush(repoPath, remote);
          if (retry.error) showAlert('Push Failed', retry.error);
          else setOutput(retry.output || 'Push complete');
        } else if (choice === 'force') {
          setOperating('Force pushing...');
          const retry = await window.api.gitPushForce(repoPath, remote);
          setOperating('');
          if (retry.error) showAlert('Force Push Failed', retry.error);
          else setOutput(retry.output || 'Force push complete');
        }
      } else {
        showAlert('Push Failed', result.error);
      }
    } else {
      setOutput(result.output || 'Push complete');
    }
    await reloadRepo();
  }

  async function doFetch() {
    setOperating('Fetching...');
    const result = await window.api.gitFetch(repoPath);
    setOperating('');
    if (result.error) showAlert('Fetch Failed', result.error);
    else setOutput(result.output || 'Fetch complete');
    await reloadRepo();
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
      await reloadRepo();
      loadBranches();
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
      await reloadRepo();
      loadBranches();
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
      await reloadRepo();
      loadBranches();
    }
  }

  // --- Merge & Rebase ---
  async function doMerge(branch) {
    if (!await showConfirm(`Merge "${branch}" into "${status.branch}"?`, '')) return;
    setOperating('Merging...');
    const result = await window.api.gitMerge(repoPath, branch);
    setOperating('');
    if (result.error) showAlert('Merge Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Merge conflicts detected', true);
    else setOutput(result.output || 'Merge complete');
    await reloadRepo();
  }

  async function doMergeAbort() {
    if (!await showConfirm('Abort merge?', 'This will discard all merge changes.')) return;
    setOperating('Aborting merge...');
    const result = await window.api.gitMergeAbort(repoPath);
    setOperating('');
    if (result.error) showAlert('Error', result.error);
    else setOutput('Merge aborted');
    await reloadRepo();
  }

  async function doRebase(branch) {
    if (!await showConfirm(`Rebase "${status.branch}" onto "${branch}"?`, '')) return;
    setOperating('Rebasing...');
    const result = await window.api.gitRebase(repoPath, branch);
    setOperating('');
    if (result.error) showAlert('Rebase Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Rebase conflicts detected — resolve and continue', true);
    else setOutput(result.output || 'Rebase complete');
    await reloadRepo();
  }

  async function doRebaseContinue() {
    setOperating('Continuing rebase...');
    const result = await window.api.gitRebaseContinue(repoPath);
    setOperating('');
    if (result.error) showAlert('Rebase Continue Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'More conflicts — resolve and continue', true);
    else setOutput(result.output || 'Rebase complete');
    await reloadRepo();
  }

  async function doRebaseAbort() {
    if (!await showConfirm('Abort rebase?', 'This will restore the branch to its original state.')) return;
    setOperating('Aborting rebase...');
    const result = await window.api.gitRebaseAbort(repoPath);
    setOperating('');
    if (result.error) showAlert('Error', result.error);
    else setOutput('Rebase aborted');
    await reloadRepo();
  }

  // --- Checkout commit ---
  async function checkoutCommit(hash) {
    if (!await showConfirm(`Checkout commit ${hash.substring(0, 8)}?`, 'This will put you in detached HEAD state.', { confirmLabel: 'Checkout', confirmStyle: 'primary' })) return;
    setOperating('Checking out...');
    const result = await window.api.gitCheckout(repoPath, hash);
    setOperating('');
    if (result.error) {
      showAlert('Checkout Failed', result.error);
    } else {
      setOutput(result.output || `Checked out ${hash.substring(0, 8)} (detached HEAD)`);
      await reloadRepo();
      loadBranches();
    }
  }

  // --- Cherry-pick & Drop ---
  async function doCherryPick(hash) {
    if (!await showConfirm(`Cherry-pick commit ${hash.substring(0, 8)}?`, '', { confirmLabel: 'Cherry-pick', confirmStyle: 'primary' })) return;
    setOperating('Cherry-picking...');
    const result = await window.api.gitCherryPick(repoPath, hash);
    setOperating('');
    if (result.error) showAlert('Cherry-pick Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Cherry-pick conflicts detected — resolve and commit', true);
    else setOutput(result.output || 'Cherry-pick complete');
    await reloadRepo();
  }

  async function doRevert(hash) {
    if (!await showConfirm(`Revert commit ${hash.substring(0, 8)}?`, 'This creates a new commit that undoes the changes.', { confirmLabel: 'Revert', confirmStyle: 'primary' })) return;
    setOperating('Reverting...');
    const result = await window.api.gitRevert(repoPath, hash);
    setOperating('');
    if (result.error) showAlert('Revert Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Revert conflicts detected — resolve and commit', true);
    else setOutput(result.output || 'Revert complete');
    await reloadRepo();
  }

  async function doDropCommit(hash) {
    if (!await showConfirm(`Drop commit ${hash.substring(0, 8)}?`, 'This will rebase to remove this commit. This cannot be easily undone.')) return;
    setOperating('Dropping commit...');
    const result = await window.api.gitDropCommit(repoPath, hash);
    setOperating('');
    if (result.error) showAlert('Drop Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Conflicts while dropping — resolve and continue rebase', true);
    else setOutput(result.output || 'Commit dropped');
    await reloadRepo();
  }

  // --- Interactive Rebase ---
  const [interactiveRebase, setInteractiveRebase] = createSignal(null);

  function startInteractiveRebase(baseHash) {
    // Collect commits from HEAD down to (not including) baseHash
    const commits = [];
    for (const c of log.commits) {
      if (c.hash === baseHash) break;
      commits.push({ action: 'pick', hash: c.short, fullHash: c.hash, subject: c.subject });
    }
    if (commits.length === 0) return;
    // Reverse so oldest is first (matches git rebase todo order)
    commits.reverse();
    setInteractiveRebase({ baseHash, commits });
  }

  async function executeInteractiveRebase() {
    const state = interactiveRebase();
    if (!state) return;
    setInteractiveRebase(null);
    setOperating('Rebasing...');
    const result = await window.api.gitInteractiveRebase(repoPath, state.baseHash, state.commits);
    setOperating('');
    if (result.error) showAlert('Rebase Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Rebase conflicts — resolve and continue', true);
    else setOutput(result.output || 'Interactive rebase complete');
    await reloadRepo();
  }

  function cancelInteractiveRebase() {
    setInteractiveRebase(null);
  }

  // --- File History ---
  const [fileHistory, setFileHistory] = createStore({
    open: false, filepath: null, commits: [], loading: false,
    selectedHash: null, diff: '', diffLoading: false,
  });

  async function openFileHistory(filepath) {
    setFileHistory({ open: true, filepath, commits: [], loading: true, selectedHash: null, diff: '' });
    const result = await window.api.gitFileLog(repoPath, filepath, 100);
    if (!result.error) {
      setFileHistory({ commits: result.commits, loading: false });
    } else {
      setFileHistory({ loading: false });
      showAlert('File History Error', result.error);
    }
  }

  function closeFileHistory() {
    setFileHistory({ open: false, filepath: null, commits: [], selectedHash: null, diff: '' });
  }

  async function selectFileHistoryCommit(hash) {
    setFileHistory({ selectedHash: hash, diff: '', diffLoading: true });
    const result = await window.api.gitFileShowAtCommit(repoPath, hash, fileHistory.filepath);
    if (!result.error) {
      setFileHistory({ diff: result.diff || '(no changes)', diffLoading: false });
    } else {
      setFileHistory({ diff: `Error: ${result.error}`, diffLoading: false });
    }
  }

  // --- Bisect ---
  const [bisect, setBisect] = createStore({ active: false, selecting: null });

  function startBisectSelect(commit) {
    // First right-click sets bad, prompt for good
    setBisect({ active: false, selecting: { badHash: commit.hash, badShort: commit.short } });
  }

  async function finishBisectSelect(goodCommit) {
    const bad = bisect.selecting;
    if (!bad) return;
    setBisect({ selecting: null });
    setOperating('Starting bisect...');
    const result = await window.api.gitBisectStart(repoPath, bad.badHash, goodCommit.hash);
    setOperating('');
    if (result.error) {
      showAlert('Bisect Failed', result.error);
    } else {
      setOutput(result.output || 'Bisect started — test this commit and mark good/bad');
    }
    await reloadRepo();
  }

  function cancelBisectSelect() {
    setBisect({ selecting: null });
  }

  async function doBisectMark(verdict) {
    setOperating(`Marking ${verdict}...`);
    const result = await window.api.gitBisectMark(repoPath, verdict);
    setOperating('');
    if (result.error) {
      showAlert('Bisect Error', result.error);
    } else if (result.done) {
      setOutput(result.output || 'Bisect complete — found the bad commit');
    } else {
      setOutput(result.output || `Marked ${verdict} — test this commit`);
    }
    await reloadRepo();
  }

  async function doBisectReset() {
    setOperating('Resetting bisect...');
    const result = await window.api.gitBisectReset(repoPath);
    setOperating('');
    if (result.error) showAlert('Bisect Reset Failed', result.error);
    else setOutput('Bisect reset');
    await reloadRepo();
  }

  // --- Branch delete & rename ---
  async function doPushBranch(branch) {
    const remote = await pickRemote('Push Branch', `Push "${branch}" to remote.`);
    if (!remote) return;
    lastRemote = remote;
    setOperating('Pushing...');
    const result = await window.api.gitPushSetUpstream(repoPath, remote, branch);
    setOperating('');
    if (result.error) showAlert('Push Failed', result.error);
    else setOutput(result.output || `Pushed "${branch}" to ${remote}`);
    await reloadRepo();
  }

  async function doDeleteBranch(branch) {
    if (!await showConfirm(`Delete branch "${branch}"?`, '')) return;
    setOperating('Deleting branch...');
    let result = await window.api.gitBranchDelete(repoPath, branch, false);
    if (result.error && result.error.includes('not fully merged')) {
      if (await showConfirm(`Branch "${branch}" is not fully merged. Force delete?`, 'Unmerged changes will be lost.')) {
        result = await window.api.gitBranchDelete(repoPath, branch, true);
      }
    }
    setOperating('');
    if (result.error) showAlert('Delete Failed', result.error);
    else setOutput(result.output || `Branch "${branch}" deleted`);
    await reloadRepo();
    loadBranches();
  }

  async function doRenameBranch(oldName) {
    const newName = await showPrompt('Rename Branch', '', oldName, 'New branch name');
    if (!newName || newName === oldName) return;
    setOperating('Renaming branch...');
    const result = await window.api.gitBranchRename(repoPath, oldName, newName);
    setOperating('');
    if (result.error) showAlert('Rename Failed', result.error);
    else setOutput(result.output || `Branch renamed to "${newName}"`);
    await reloadRepo();
    loadBranches();
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
    loadStashes();
  }

  async function doStashPop(ref) {
    setOperating('Popping stash...');
    const result = await window.api.gitStashPop(repoPath, ref);
    setOperating('');
    if (result.error) showAlert('Stash Pop Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Stash applied with conflicts', true);
    else setOutput(result.output || 'Stash popped');
    await refresh();
    loadStashes();
  }

  async function doStashApply(ref) {
    setOperating('Applying stash...');
    const result = await window.api.gitStashApply(repoPath, ref);
    setOperating('');
    if (result.error) showAlert('Stash Apply Failed', result.error);
    else if (result.conflict) setOutput(result.output || 'Stash applied with conflicts', true);
    else setOutput(result.output || 'Stash applied');
    await refresh();
    loadStashes();
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

  // --- Commit message persistence ---
  const commitKey = `gitsync:commit:${repoPath}`;

  function saveCommitMessage() {
    const msg = commit.message;
    const desc = commit.description;
    if (msg || desc) {
      localStorage.setItem(commitKey, JSON.stringify({ message: msg, description: desc }));
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

  onMount(() => {
    restoreCommitMessage();
    reloadRepo();
    loadStashes();
    loadReadme();
    loadIdentities();
    initHomeDir();
    document.addEventListener('click', dismissCtxMenu);
    window.addEventListener('beforeunload', saveCommitMessage);
    window.api.gitWatchRepo(repoPath);
    removeFsListener = window.api.onFsChanged((changedPath) => {
      if (changedPath === repoPath) reloadRepo();
    });
  });

  onCleanup(() => {
    saveCommitMessage();
    window.removeEventListener('beforeunload', saveCommitMessage);
    document.removeEventListener('click', dismissCtxMenu);
    window.api.gitUnwatchRepo(repoPath);
    if (removeFsListener) removeFsListener();
  });

  const ctx = {
    repoPath, repoData, onBack, onSwitchRepo,
    // Stores
    status, setStatus, diff, setDiff, commit, setCommit,
    log, setLog, remotes, branches, tags, stashes, stashDetail, setStashDetail,
    commitDetail, setCommitDetail,
    // Signals
    tab, setTab, operating, outputLog, outputOpen, setOutputOpen, toggleOutputPanel, clearOutputLog,
    expandedDirs, collapsedSections, ctxMenu, setCtxMenu, opState, submodules,
    expandedDetailFiles, setExpandedDetailFiles,
    logBranch, setLogBranch, logBranches, logSearch, setLogSearch, logTopoOrder, setLogTopoOrder, selectedFiles, allFiles,
    switcherOpen, switcherQuery, setSwitcherQuery, switcherRepos, switcherIndex, setSwitcherIndex,
    // Operations
    reloadRepo, refresh, loadLog, loadMoreLog, loadLogBranches, loadRemotes, loadBranches, loadTags, loadStashes,
    onTabChange, viewDiff,
    stageFile, unstageFile, stageAll, unstageAll, stageSelected, unstageSelected, exportStagedPatch, applyPatch,
    resolveOurs, resolveTheirs, viewConflictDiff,
    discardFile, discardFiles, discardStagedFiles, deleteUntrackedFiles,
    doCommit, toggleAmend,
    doPull, doPush, doFetch, pickRemote,
    addRemote, removeRemote, editRemoteUrl,
    checkoutBranch, checkoutRemoteBranch, checkoutCommit, createBranch,
    doMerge, doMergeAbort, doRebase, doRebaseContinue, doRebaseAbort,
    doCherryPick, doRevert, doDropCommit,
    interactiveRebase, setInteractiveRebase, startInteractiveRebase, executeInteractiveRebase, cancelInteractiveRebase,
    fileHistory, openFileHistory, closeFileHistory, selectFileHistoryCommit,
    bisect, startBisectSelect, finishBisectSelect, cancelBisectSelect, doBisectMark, doBisectReset,
    doPushBranch, doDeleteBranch, doRenameBranch,
    doCreateTag, doDeleteTag, doPushTag, doDeleteRemoteTag,
    doStashPush, doStashPop, doStashApply, doStashDrop, viewStashDiff,
    initSubmodule, openSubmodule, selectCommit,
    onFileContextMenu, onFolderContextMenu, dismissCtxMenu,
    toggleSection, toggleDir, toggleFileSelection,
    openSwitcher, closeSwitcher, filteredSwitcherRepos, switcherSelect,
    identities, currentIdentity, setRepoIdentity, loadIdentities,
    readme, loadReadme,
  };

  return (
    <WorkspaceContext.Provider value={ctx}>
      {props.children}
    </WorkspaceContext.Provider>
  );
}
