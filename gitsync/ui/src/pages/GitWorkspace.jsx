import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import Icon from '../components/Icon';
import Modal, { showAlert, showConfirm, showPrompt } from '../components/Modal';

export default function GitWorkspace(props) {
  const { repoData } = props;
  const repoPath = repoData.path;

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
  });

  const [commit, setCommit] = createStore({
    message: '',
    description: '',
    amend: false,
    running: false,
  });

  const LOG_PAGE_SIZE = 100;

  const [log, setLog] = createStore({
    commits: [],
    graph: [],
    maxCols: 0,
    loading: false,
    loadingMore: false,
    hasMore: true,
    lanes: [],   // carry lane state for incremental graph building
  });

  const [logBranch, setLogBranch] = createSignal('__current__');
  const [logBranches, setLogBranches] = createSignal([]);
  let logPanelRef;

  const [remotes, setRemotes] = createStore({
    list: [],
    loading: false,
  });

  const [branches, setBranches] = createStore({
    list: [],
    loading: false,
  });

  const [commitDetail, setCommitDetail] = createStore({
    hash: null,
    body: '',
    author: '',
    email: '',
    date: '',
    parents: [],
    diff: '',
    loading: false,
  });

  const [expandedDetailFiles, setExpandedDetailFiles] = createSignal(new Set());

  const [tab, setTab] = createSignal('changes');
  const [operating, setOperating] = createSignal('');
  const [output, setOutput] = createSignal('');
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [selectedFiles, setSelectedFiles] = createSignal(new Set());
  const [expandedDirs, setExpandedDirs] = createSignal(new Set());
  const [collapsedSections, setCollapsedSections] = createSignal(new Set());
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [switcherQuery, setSwitcherQuery] = createSignal('');
  const [switcherRepos, setSwitcherRepos] = createSignal([]);
  const [switcherIndex, setSwitcherIndex] = createSignal(0);
  let switcherInputRef;

  async function openSwitcher() {
    const all = await window.api.gitRepoList();
    setSwitcherRepos(all.filter(r => r.id !== repoData.savedId));
    setSwitcherQuery('');
    setSwitcherIndex(0);
    setSwitcherOpen(true);
    requestAnimationFrame(() => switcherInputRef?.focus());
  }

  function closeSwitcher() {
    setSwitcherOpen(false);
  }

  function filteredSwitcherRepos() {
    const q = switcherQuery().toLowerCase();
    if (!q) return switcherRepos();
    return switcherRepos().filter(r =>
      r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
    );
  }

  function switcherSelect(repo) {
    closeSwitcher();
    props.onSwitchRepo({ savedId: repo.id, name: repo.name, path: repo.path, category_id: repo.category_id });
  }

  function onSwitcherKeyDown(e) {
    const list = filteredSwitcherRepos();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSwitcherIndex(i => Math.min(i + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSwitcherIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && list.length > 0) {
      e.preventDefault();
      switcherSelect(list[switcherIndex()]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSwitcher();
    }
  }

  function onGlobalKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
      e.preventDefault();
      if (switcherOpen()) closeSwitcher();
      else openSwitcher();
    }
  }

  let homeDir = '';
  function shortenPath(p) {
    if (homeDir && p.startsWith(homeDir)) return '~' + p.slice(homeDir.length);
    return p;
  }

  onMount(() => {
    refresh();
    loadLog();
    document.addEventListener('keydown', onGlobalKeyDown);
    window.api.homeDir().then(d => { homeDir = d; });
  });

  onCleanup(() => {
    document.removeEventListener('keydown', onGlobalKeyDown);
  });

  async function refresh() {
    setStatus('loading', true);
    const result = await window.api.gitStatus(repoPath);
    if (result.error) {
      setStatus({ loading: false, error: result.error });
    } else {
      setStatus({ ...result, loading: false, error: null });
    }
  }

  async function loadLog() {
    setLog('loading', true);
    const branch = logBranch();
    const allBranches = branch === '__all__';
    const branchName = (branch === '__current__' || branch === '__all__') ? null : branch;
    const result = await window.api.gitLog(repoPath, LOG_PAGE_SIZE, allBranches, branchName, 0);
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
    const allBranches = branch === '__all__';
    const branchName = (branch === '__current__' || branch === '__all__') ? null : branch;
    const skip = log.commits.length;
    const result = await window.api.gitLog(repoPath, LOG_PAGE_SIZE, allBranches, branchName, skip);
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

  function onLogScroll(e) {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      loadMoreLog();
    }
  }

  async function loadLogBranches() {
    const result = await window.api.gitBranchList(repoPath);
    if (!result.error) {
      setLogBranches(result.branches);
    }
  }

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
      setCommitDetail({
        hash,
        body: result.body,
        author: result.author,
        email: result.email,
        date: result.date,
        parents: result.parents,
        diff: result.diff,
        loading: false,
      });
    }
  }

  function parseDiffFiles(rawDiff) {
    if (!rawDiff) return [];
    const files = [];
    const chunks = rawDiff.split(/^(?=diff --git )/m);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      // Extract filename from "diff --git a/path b/path" or rename headers
      const headerMatch = chunk.match(/^diff --git a\/(.*?) b\/(.*)$/m);
      let filename = headerMatch ? headerMatch[2] : 'unknown';
      // Count additions and deletions
      let additions = 0, deletions = 0;
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
      files.push({ filename, diff: chunk, additions, deletions });
    }
    return files;
  }

  // Build commit graph with split top/bottom halves so merges are visible.
  // Accepts initial lane state for incremental building.
  function buildGraph(commits, initialLanes) {
    if (!commits.length) return { graph: [], maxCols: 0, lanes: initialLanes || [] };

    let lanes = initialLanes ? [...initialLanes] : [];
    const rows = [];
    let maxCols = 0;

    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      const hash = c.hash;
      const parents = c.parents;

      // Find which lane this commit occupies
      let col = lanes.indexOf(hash);
      if (col === -1) {
        col = lanes.indexOf(null);
        if (col === -1) { col = lanes.length; lanes.push(hash); }
        else lanes[col] = hash;
      }

      const topPipes = [];  // top of row -> commit dot
      const botPipes = [];  // commit dot -> bottom of row

      // --- TOP HALF: lines from previous row into this row ---
      // The commit's own lane converges to col
      topPipes.push({ from: col, to: col, color: col });

      // Check for other lanes that also target this hash (branch convergence)
      for (let l = 0; l < lanes.length; l++) {
        if (l === col) continue;
        if (lanes[l] === hash) {
          // Another lane was waiting for this commit - converge to col
          topPipes.push({ from: l, to: col, color: l });
          lanes[l] = null; // consumed
        } else if (lanes[l] && lanes[l] !== null) {
          // Pass-through: stays in its column through top half
          topPipes.push({ from: l, to: l, color: l });
        }
      }

      // --- Compute next lanes ---
      const nextLanes = [...lanes];
      nextLanes[col] = null; // commit consumed its lane

      // First parent continues in the commit's column
      if (parents.length > 0) {
        const p0 = parents[0];
        const existing = nextLanes.indexOf(p0);
        if (existing !== -1 && existing !== col) {
          // p0 already tracked in another lane - this lane merges down into it
          botPipes.push({ from: col, to: existing, color: col });
          // col stays null (lane ends here)
        } else {
          nextLanes[col] = p0;
          botPipes.push({ from: col, to: col, color: col });
        }
      }

      // Additional parents (merge) fork out from the commit dot
      for (let p = 1; p < parents.length; p++) {
        const ph = parents[p];
        const existing = nextLanes.indexOf(ph);
        if (existing !== -1) {
          // Already tracked - draw merge line from col to that lane
          botPipes.push({ from: col, to: existing, color: existing });
        } else {
          // Allocate a new lane
          let slot = nextLanes.indexOf(null);
          if (slot === -1) { slot = nextLanes.length; nextLanes.push(ph); }
          else nextLanes[slot] = ph;
          botPipes.push({ from: col, to: slot, color: slot });
        }
      }

      // Pass-through for lanes not involved in this commit (bottom half)
      for (let l = 0; l < Math.max(lanes.length, nextLanes.length); l++) {
        if (l === col) continue;
        const laneHash = lanes[l];
        if (laneHash && laneHash !== hash && laneHash !== null) {
          const dest = nextLanes.indexOf(laneHash);
          if (dest !== -1) {
            botPipes.push({ from: l, to: dest, color: dest });
          }
        }
      }

      // Trim trailing nulls
      while (nextLanes.length > 0 && nextLanes[nextLanes.length - 1] === null) {
        nextLanes.pop();
      }

      const rowWidth = Math.max(lanes.length, nextLanes.length);
      if (rowWidth > maxCols) maxCols = rowWidth;

      rows.push({ col, topPipes, botPipes, isMerge: parents.length > 1 });
      lanes = nextLanes;
    }

    return { graph: rows, maxCols: Math.max(maxCols, 1), lanes };
  }

  async function loadRemotes() {
    setRemotes('loading', true);
    const result = await window.api.gitRemoteList(repoPath);
    if (!result.error) {
      setRemotes({ list: result.remotes, loading: false });
    } else {
      setRemotes('loading', false);
    }
  }

  async function loadBranches() {
    setBranches('loading', true);
    const result = await window.api.gitBranchList(repoPath);
    if (!result.error) {
      const tagged = result.branches.map(b => ({
        ...b,
        remote: b.name.startsWith('remotes/'),
      }));
      setBranches({ list: tagged, loading: false });
    } else {
      setBranches('loading', false);
    }
  }

  function onTabChange(t) {
    setTab(t);
    if (t === 'log') { loadLog(); loadLogBranches(); }
    if (t === 'remotes') { loadRemotes(); loadBranches(); }
  }

  // File categorization
  function stagedFiles() {
    return status.files.filter(f => f.index !== '?' && f.index !== ' ' && f.index !== '!');
  }

  function unstagedFiles() {
    return status.files.filter(f => f.working !== ' ' && f.working !== '?' && f.working !== '!');
  }

  function untrackedFiles() {
    return status.files.filter(f => f.index === '?');
  }

  // File status display
  function statusLabel(code) {
    const map = { 'M': 'Modified', 'A': 'Added', 'D': 'Deleted', 'R': 'Renamed', 'C': 'Copied', '?': 'Untracked', 'U': 'Conflict' };
    return map[code] || code;
  }

  function statusClass(code) {
    const map = { 'M': 'git-modified', 'A': 'git-added', 'D': 'git-deleted', 'R': 'git-renamed', '?': 'git-untracked', 'U': 'git-conflict' };
    return map[code] || '';
  }

  // Diff viewing
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

  // Staging
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

  async function stageAll() {
    await window.api.gitStageAll(repoPath);
    await refresh();
  }

  async function unstageAll() {
    await window.api.gitUnstageAll(repoPath);
    await refresh();
  }

  async function discardFile(filepath) {
    if (await showConfirm(`Discard changes to "${filepath}"?`, 'This cannot be undone.')) {
      await window.api.gitDiscard(repoPath, [filepath]);
      await refresh();
      if (diff.filepath === filepath) setDiff({ content: '', filepath: null });
    }
  }

  // Staging selected
  function toggleFileSelection(filepath) {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filepath)) next.delete(filepath);
      else next.add(filepath);
      return next;
    });
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

  // Commit
  async function doCommit() {
    const subject = commit.message.trim();
    const desc = commit.description.trim();
    if (!subject && !commit.amend) { showAlert('Error', 'Commit message is required'); return; }

    const fullMsg = desc ? `${subject}\n\n${desc}` : subject;

    setCommit('running', true);
    let result;
    if (commit.amend) {
      result = await window.api.gitCommitAmend(repoPath, fullMsg || null);
    } else {
      result = await window.api.gitCommit(repoPath, fullMsg);
    }
    setCommit('running', false);

    if (result.error) {
      showAlert('Commit Failed', result.error);
    } else {
      setCommit({ message: '', description: '', amend: false });
      setOutput(result.output || 'Committed successfully');
      await refresh();
      loadLog();
    }
  }

  async function toggleAmend() {
    const newAmend = !commit.amend;
    setCommit('amend', newAmend);
    if (newAmend && !commit.message) {
      const result = await window.api.gitLastCommitMessage(repoPath);
      if (result.message) {
        const parts = result.message.split(/\n\n(.*)$/s);
        setCommit('message', parts[0] || '');
        setCommit('description', parts[1] || '');
      }
    }
  }

  // Pull / Push / Fetch
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

  // Remotes management
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
    // remoteBranch looks like "remotes/origin/feature" — extract local name
    const parts = remoteBranch.replace(/^remotes\//, '').split('/');
    const remote = parts[0];
    const localName = parts.slice(1).join('/');
    const trackRef = `${remote}/${localName}`;

    // Check if local branch already exists
    const localExists = branches.list.some(b => !b.remote && b.name === localName);
    if (localExists) {
      // Just checkout the existing local branch
      return checkoutBranch(localName);
    }

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

  async function editRemoteUrl(name, currentUrl) {
    const url = await showPrompt('Remote URL', currentUrl);
    if (!url) return;
    const result = await window.api.gitRemoteSetUrl(repoPath, name, url.trim());
    if (result.error) showAlert('Error', result.error);
    else loadRemotes();
  }

  const GRAPH_COLORS = [
    '#7c5cfc', '#50c878', '#f0a030', '#e05555', '#5090f0',
    '#c070f0', '#f06090', '#40c0c0', '#d0a050', '#8888cc',
  ];

  function GraphCell(cellProps) {
    const { row, maxCols } = cellProps;
    const w = Math.max(maxCols, 1) * 16 + 8;
    const h = 24;
    const mid = h / 2;
    const cx = row.col * 16 + 12;

    function pipeHalf(pipe, y0, y1) {
      const x1 = pipe.from * 16 + 12;
      const x2 = pipe.to * 16 + 12;
      const color = GRAPH_COLORS[pipe.color % GRAPH_COLORS.length];
      const halfH = y1 - y0;
      if (x1 === x2) {
        return <line x1={x1} y1={y0} x2={x2} y2={y1} stroke={color} stroke-width="2" />;
      }
      return <path d={`M ${x1} ${y0} C ${x1} ${y0 + halfH * 0.6}, ${x2} ${y1 - halfH * 0.6}, ${x2} ${y1}`} fill="none" stroke={color} stroke-width="2" />;
    }

    return (
      <svg width={w} height={h} class="git-graph-svg">
        {/* Top half: entering the commit row */}
        <For each={row.topPipes}>{(pipe) => pipeHalf(pipe, 0, mid)}</For>
        {/* Bottom half: exiting the commit row */}
        <For each={row.botPipes}>{(pipe) => pipeHalf(pipe, mid, h)}</For>
        {/* Commit dot - larger for merge commits */}
        <circle cx={cx} cy={mid} r={row.isMerge ? 5 : 4} fill={GRAPH_COLORS[row.col % GRAPH_COLORS.length]}
          stroke={row.isMerge ? '#fff' : 'none'} stroke-width={row.isMerge ? 1.5 : 0} />
      </svg>
    );
  }

  function parseRefs(refStr) {
    if (!refStr) return [];
    return refStr.split(',').map(r => r.trim()).filter(Boolean).map(r => {
      if (r.startsWith('HEAD -> ')) return { name: r.slice(8), type: 'git-ref-head' };
      if (r === 'HEAD') return { name: 'HEAD', type: 'git-ref-head' };
      if (r.startsWith('tag: ')) return { name: r.slice(5), type: 'git-ref-tag' };
      if (r.includes('/')) return { name: r, type: 'git-ref-remote' };
      return { name: r, type: 'git-ref-branch' };
    });
  }

  function parseDiffLines(raw) {
    const lines = raw.split('\n');
    const result = [];
    let oldNum = 0, newNum = 0;
    for (const line of lines) {
      if (line.startsWith('@@')) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) { oldNum = parseInt(m[1]); newNum = parseInt(m[2]); }
        result.push({ cls: 'git-diff-line git-diff-hunk', text: line, oldN: '', newN: '' });
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        result.push({ cls: 'git-diff-line git-diff-add', text: line, oldN: '', newN: newNum });
        newNum++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        result.push({ cls: 'git-diff-line git-diff-del', text: line, oldN: oldNum, newN: '' });
        oldNum++;
      } else if (line.startsWith('diff ')) {
        result.push({ cls: 'git-diff-line git-diff-header', text: line, oldN: '', newN: '' });
      } else if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity') || line.startsWith('rename') || line.startsWith('old mode') || line.startsWith('new mode')) {
        result.push({ cls: 'git-diff-line git-diff-header', text: line, oldN: '', newN: '' });
      } else {
        result.push({ cls: 'git-diff-line', text: line, oldN: oldNum, newN: newNum });
        oldNum++;
        newNum++;
      }
    }
    return result;
  }

  function renderDiffLine(l) {
    return (
      <div class={l.cls}>
        <span class="git-diff-ln">{l.oldN}</span>
        <span class="git-diff-ln">{l.newN}</span>
        <span class="git-diff-text">{l.text}</span>
      </div>
    );
  }

  // Build a tree from a flat list of files
  function buildTree(files, section) {
    const root = { name: '', children: {}, files: [] };
    for (const file of files) {
      const parts = file.path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts[i];
        if (!node.children[dir]) {
          node.children[dir] = { name: dir, children: {}, files: [] };
        }
        node = node.children[dir];
      }
      node.files.push(file);
    }
    return root;
  }

  // Collapse single-child directory chains into "a/b/c" nodes
  function compactTree(node) {
    const dirKeys = Object.keys(node.children);
    for (const key of dirKeys) {
      node.children[key] = compactTree(node.children[key]);
    }
    // If this node has exactly one child dir and no files, merge downward
    if (dirKeys.length === 1 && node.files.length === 0 && node.name) {
      const childKey = dirKeys[0];
      const child = node.children[childKey];
      return {
        name: node.name + '/' + child.name,
        children: child.children,
        files: child.files,
      };
    }
    return node;
  }

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

  function allFilesInTree(node) {
    const result = [...node.files];
    for (const child of Object.values(node.children)) {
      result.push(...allFilesInTree(child));
    }
    return result;
  }

  function TreeDir(treeProps) {
    const { child, dirPath, section, depth, isStaged } = treeProps;
    const fileCount = allFilesInTree(child).length;

    return (
      <div class="git-tree-dir">
        <div
          class="git-tree-dir-header"
          style={{ 'padding-left': `${depth * 16 + 4}px` }}
          onClick={() => toggleDir(dirPath)}
        >
          <Icon name={expandedDirs().has(dirPath) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'} class="git-tree-chevron" />
          <Icon name="fa-solid fa-folder" class="git-tree-folder-icon" />
          <span class="git-tree-dir-name">{child.name}</span>
          <span class="git-tree-dir-count">{fileCount}</span>
          <span class="git-file-actions">
            {isStaged && (
              <button class="btn btn-ghost btn-xs" onClick={(e) => {
                e.stopPropagation();
                const paths = allFilesInTree(child).map(f => f.path);
                paths.forEach(p => unstageFile(p));
              }} title="Unstage all in folder">
                <Icon name="fa-solid fa-minus" />
              </button>
            )}
            {!isStaged && (
              <button class="btn btn-ghost btn-xs" onClick={(e) => {
                e.stopPropagation();
                const paths = allFilesInTree(child).map(f => f.path);
                window.api.gitStage(repoPath, paths).then(refresh);
              }} title="Stage all in folder">
                <Icon name="fa-solid fa-plus" />
              </button>
            )}
          </span>
        </div>
        <Show when={expandedDirs().has(dirPath)}>
          {renderTree(child, section, depth + 1, dirPath)}
        </Show>
      </div>
    );
  }

  function renderTree(node, section, depth, parentPath) {
    const dirs = Object.keys(node.children).sort();
    const files = node.files.sort((a, b) => a.path.localeCompare(b.path));
    const isStaged = section === 'staged';
    const isUntracked = section === 'untracked';

    return (
      <>
        <For each={dirs}>{(dirName) => {
          const child = node.children[dirName];
          const dirPath = parentPath ? parentPath + '/' + child.name : child.name;
          return <TreeDir child={child} dirPath={dirPath} section={section} depth={depth} isStaged={isStaged} />;
        }}</For>
        <For each={files}>{(file) => {
          const code = isStaged ? file.index : file.working === '?' ? '?' : file.working;
          const filepath = file.path;
          const filename = filepath.split('/').pop();

          return (
            <div
              class={`git-file-item ${diff.filepath === filepath ? 'active' : ''}`}
              style={{ 'padding-left': `${depth * 16 + 4}px` }}
              onClick={() => viewDiff(filepath, isStaged)}
            >
              <span class={`git-file-status ${statusClass(code)}`}>{code}</span>
              <span class="git-file-path" title={filepath}>{filename}</span>
              <span class="git-file-actions">
                {isStaged && (
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); unstageFile(filepath); }} title="Unstage">
                    <Icon name="fa-solid fa-minus" />
                  </button>
                )}
                {!isStaged && !isUntracked && (
                  <>
                    <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); stageFile(filepath); }} title="Stage">
                      <Icon name="fa-solid fa-plus" />
                    </button>
                    <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={(e) => { e.stopPropagation(); discardFile(filepath); }} title="Discard">
                      <Icon name="fa-solid fa-xmark" />
                    </button>
                  </>
                )}
                {isUntracked && (
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); stageFile(filepath); }} title="Stage">
                    <Icon name="fa-solid fa-plus" />
                  </button>
                )}
              </span>
            </div>
          );
        }}</For>
      </>
    );
  }

  function renderFileTree(files, section) {
    const tree = compactTree(buildTree(files, section));
    return renderTree(tree, section, 0, '');
  }

  return (
    <div class="git-workspace">
      {/* Header */}
      <div class="git-header">
        <button class="btn btn-ghost btn-sm" onClick={props.onBack} title="Back to repos">
          <Icon name="fa-solid fa-arrow-left" />
        </button>
        <button class="git-header-name" onClick={openSwitcher} title="Switch repo (Ctrl+P)">
          {repoData.name}
        </button>
        <span class="git-header-branch" onClick={() => onTabChange('remotes')} title="View branches">
          <Icon name="fa-solid fa-code-branch" />
          {status.branch || '...'}
        </span>
        <Show when={status.upstream}>
          <span class="git-header-sync">
            <Show when={status.ahead > 0}>
              <span class="git-ahead" title={`${status.ahead} ahead`}>{status.ahead}<Icon name="fa-solid fa-arrow-up" /></span>
            </Show>
            <Show when={status.behind > 0}>
              <span class="git-behind" title={`${status.behind} behind`}>{status.behind}<Icon name="fa-solid fa-arrow-down" /></span>
            </Show>
          </span>
        </Show>
        <div style={{ flex: 1 }} />
        <Show when={operating()}>
          <span class="git-operating">{operating()}</span>
        </Show>
        <button class="btn btn-ghost btn-sm" onClick={doFetch} title="Fetch">
          <Icon name="fa-solid fa-cloud-arrow-down" /> Fetch
        </button>
        <button class="btn btn-ghost btn-sm" onClick={doPull} title="Pull">
          <Icon name="fa-solid fa-download" /> Pull
        </button>
        <button class="btn btn-ghost btn-sm" onClick={doPush} title="Push">
          <Icon name="fa-solid fa-upload" /> Push
        </button>
        <button class="btn btn-ghost btn-sm" onClick={refresh} title="Refresh">
          <Icon name="fa-solid fa-rotate" />
        </button>
      </div>

      {/* Tabs */}
      <div class="git-tabs">
        <button class={`git-tab ${tab() === 'changes' ? 'active' : ''}`} onClick={() => onTabChange('changes')}>
          Changes
          <Show when={status.files.length > 0}>
            <span class="git-tab-badge">{status.files.length}</span>
          </Show>
        </button>
        <button class={`git-tab ${tab() === 'log' ? 'active' : ''}`} onClick={() => onTabChange('log')}>
          Log
        </button>
        <button class={`git-tab ${tab() === 'remotes' ? 'active' : ''}`} onClick={() => onTabChange('remotes')}>
          Remotes
        </button>
      </div>

      <Show when={status.error}>
        <div class="git-error">{status.error}</div>
      </Show>

      {/* Output bar */}
      <Show when={output()}>
        <div class="git-output-bar">
          <pre>{output()}</pre>
          <button class="btn btn-ghost btn-xs" onClick={() => setOutput('')}>
            <Icon name="fa-solid fa-xmark" />
          </button>
        </div>
      </Show>

      {/* Changes tab */}
      <div class="git-content" style={{ display: tab() === 'changes' ? '' : 'none' }}>
        <div class="git-changes-panel">
          {/* File list */}
          <div class="git-files-panel">
            <Show when={stagedFiles().length > 0}>
              <div class="git-section">
                <div class="git-section-header" onClick={() => toggleSection('staged')}>
                  <Icon name={collapsedSections().has('staged') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
                  <span>Staged ({stagedFiles().length})</span>
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); unstageAll(); }} title="Unstage all">
                    <Icon name="fa-solid fa-minus" /> All
                  </button>
                </div>
                <Show when={!collapsedSections().has('staged')}>
                  {renderFileTree(stagedFiles(), 'staged')}
                </Show>
              </div>
            </Show>

            <Show when={unstagedFiles().length > 0}>
              <div class="git-section">
                <div class="git-section-header" onClick={() => toggleSection('unstaged')}>
                  <Icon name={collapsedSections().has('unstaged') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
                  <span>Changes ({unstagedFiles().length})</span>
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); stageAll(); }} title="Stage all">
                    <Icon name="fa-solid fa-plus" /> All
                  </button>
                </div>
                <Show when={!collapsedSections().has('unstaged')}>
                  {renderFileTree(unstagedFiles(), 'unstaged')}
                </Show>
              </div>
            </Show>

            <Show when={untrackedFiles().length > 0}>
              <div class="git-section">
                <div class="git-section-header" onClick={() => toggleSection('untracked')}>
                  <Icon name={collapsedSections().has('untracked') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
                  <span>Untracked ({untrackedFiles().length})</span>
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); stageAll(); }} title="Stage all">
                    <Icon name="fa-solid fa-plus" /> All
                  </button>
                </div>
                <Show when={!collapsedSections().has('untracked')}>
                  {renderFileTree(untrackedFiles(), 'untracked')}
                </Show>
              </div>
            </Show>

            <Show when={status.files.length === 0 && !status.loading}>
              <div class="git-empty">Working tree clean</div>
            </Show>
          </div>

          {/* Diff + commit panel */}
          <div class="git-right-panel">
            <div class="git-diff-panel">
              <Show when={diff.filepath} fallback={
                <div class="git-empty">Select a file to view diff</div>
              }>
                <div class="git-diff-header">
                  <span class="git-diff-filepath">{diff.filepath}</span>
                  <span class="git-diff-label">{diff.staged ? 'Staged' : 'Working'}</span>
                </div>
                <pre class="git-diff-content">
                  <For each={parseDiffLines(diff.content)}>{(l) => renderDiffLine(l)}</For>
                </pre>
              </Show>
            </div>

            <div class="git-commit-box">
              <input
                type="text"
                class="git-commit-subject"
                placeholder="Commit message"
                value={commit.message}
                onInput={(e) => setCommit('message', e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    doCommit();
                  }
                }}
              />
              <textarea
                class="git-commit-description"
                placeholder="Description (optional)"
                value={commit.description}
                onInput={(e) => setCommit('description', e.target.value)}
                rows={3}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    doCommit();
                  }
                }}
              />
              <div class="git-commit-actions">
                <label class="git-amend-label">
                  <input type="checkbox" checked={commit.amend} onChange={toggleAmend} />
                  Amend
                </label>
                <button
                  class="btn btn-primary btn-sm"
                  onClick={doCommit}
                  disabled={commit.running || (!commit.message.trim() && !commit.amend)}
                >
                  {commit.running ? 'Committing...' : commit.amend ? 'Amend Commit' : 'Commit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Log tab */}
      <div class="git-content" style={{ display: tab() === 'log' ? '' : 'none' }}>
        <div class="git-log-wrapper">
          <div class="git-log-toolbar">
            <select
              class="git-log-branch-select"
              value={logBranch()}
              onChange={(e) => { setLogBranch(e.target.value); setTimeout(loadLog, 0); }}
            >
              <option value="__current__">Current branch</option>
              <option value="__all__">All branches</option>
              <For each={logBranches()}>{(b) => (
                <option value={b.name}>{b.name}{b.current ? ' *' : ''}</option>
              )}</For>
            </select>
            <button class="btn btn-ghost btn-xs" onClick={loadLog}>
              <Icon name="fa-solid fa-rotate" />
            </button>
          </div>
          <div class="git-log-split">
            <div class="git-log-panel" ref={logPanelRef} onScroll={onLogScroll}>
              <Show when={log.loading}>
                <div class="git-empty">Loading...</div>
              </Show>
              <table class="git-log-table">
                <thead>
                  <tr>
                    <th class="git-log-graph" style={{ width: `${Math.max(log.maxCols, 1) * 16 + 8}px` }}>Graph</th>
                    <th class="git-log-hash">Hash</th>
                    <th class="git-log-subject">Message</th>
                    <th class="git-log-author">Author</th>
                    <th class="git-log-date">Date</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={log.commits}>{(c, idx) => {
                    const row = log.graph[idx()];
                    return (
                      <tr
                        class={commitDetail.hash === c.hash ? 'git-log-row-selected' : ''}
                        onClick={() => selectCommit(c.hash)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td class="git-log-graph-cell" style={{ width: `${Math.max(log.maxCols, 1) * 16 + 8}px` }}>
                          <Show when={row}>
                            <GraphCell row={row} maxCols={log.maxCols} />
                          </Show>
                        </td>
                        <td class="git-log-hash"><code>{c.short}</code></td>
                        <td class="git-log-subject">
                          <Show when={c.refs}>
                            <For each={parseRefs(c.refs)}>{(ref) => (
                              <span class={`git-log-ref ${ref.type}`}>{ref.name}</span>
                            )}</For>
                          </Show>
                          {c.subject}
                        </td>
                        <td class="git-log-author">{c.author}</td>
                        <td class="git-log-date">{new Date(c.date).toLocaleDateString()}</td>
                      </tr>
                    );
                  }}</For>
                </tbody>
              </table>
              <Show when={log.loadingMore}>
                <div class="git-log-loading-more">Loading more...</div>
              </Show>
              <Show when={!log.hasMore && log.commits.length > 0}>
                <div class="git-log-end">End of history</div>
              </Show>
            </div>

            <Show when={commitDetail.hash}>
              <div class="git-commit-detail">
                <div class="git-commit-detail-header">
                  <div class="git-commit-detail-meta">
                    <code class="git-commit-detail-hash">{commitDetail.hash?.substring(0, 12)}</code>
                    <span class="git-commit-detail-author">{commitDetail.author} &lt;{commitDetail.email}&gt;</span>
                    <span class="git-commit-detail-date">
                      {commitDetail.date ? new Date(commitDetail.date).toLocaleString() : ''}
                    </span>
                    <Show when={commitDetail.parents.length > 0}>
                      <span class="git-commit-detail-parents">
                        {commitDetail.parents.length > 1 ? 'Merge: ' : 'Parent: '}
                        {commitDetail.parents.map(p => p.substring(0, 8)).join(' ')}
                      </span>
                    </Show>
                  </div>
                  <button class="btn btn-ghost btn-xs" onClick={() => setCommitDetail({ hash: null })} title="Close">
                    <Icon name="fa-solid fa-xmark" />
                  </button>
                </div>
                <Show when={commitDetail.body}>
                  <pre class="git-commit-detail-body">{commitDetail.body}</pre>
                </Show>
                <Show when={commitDetail.loading}>
                  <div class="git-empty">Loading...</div>
                </Show>
                <Show when={commitDetail.diff}>
                  <div class="git-commit-detail-files">
                    <For each={parseDiffFiles(commitDetail.diff)}>{(file) => {
                      const toggleFile = () => {
                        const s = new Set(expandedDetailFiles());
                        if (s.has(file.filename)) s.delete(file.filename);
                        else s.add(file.filename);
                        setExpandedDetailFiles(s);
                      };
                      return (
                        <div class="git-detail-file">
                          <div class="git-detail-file-header" onClick={toggleFile}>
                            <Icon
                              name={expandedDetailFiles().has(file.filename) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'}
                              class="git-section-chevron"
                            />
                            <span class="git-detail-file-name">{file.filename}</span>
                            <span class="git-detail-file-stats">
                              <Show when={file.additions > 0}>
                                <span class="git-detail-stat-add">+{file.additions}</span>
                              </Show>
                              <Show when={file.deletions > 0}>
                                <span class="git-detail-stat-del">-{file.deletions}</span>
                              </Show>
                            </span>
                          </div>
                          <Show when={expandedDetailFiles().has(file.filename)}>
                            <pre class="git-diff-content git-detail-file-diff">
                              <For each={parseDiffLines(file.diff)}>{(l) => renderDiffLine(l)}</For>
                            </pre>
                          </Show>
                        </div>
                      );
                    }}</For>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>

      {/* Remotes tab */}
      <div class="git-content" style={{ display: tab() === 'remotes' ? '' : 'none' }}>
        <div class="git-remotes-panel">
          <div class="git-section">
            <div class="git-section-header">
              <span>Remotes</span>
              <button class="btn btn-ghost btn-xs" onClick={addRemote}>
                <Icon name="fa-solid fa-plus" /> Add
              </button>
            </div>
            <Show when={remotes.list.length === 0 && !remotes.loading}>
              <div class="git-empty">No remotes configured</div>
            </Show>
            <For each={remotes.list}>{(r) => (
              <div class="git-remote-item">
                <div class="git-remote-name">{r.name}</div>
                <div class="git-remote-urls">
                  <div class="git-remote-url" onClick={() => editRemoteUrl(r.name, r.fetch)}>
                    <span class="git-remote-url-label">fetch</span>
                    <span class="git-remote-url-value">{r.fetch}</span>
                  </div>
                  <Show when={r.push && r.push !== r.fetch}>
                    <div class="git-remote-url">
                      <span class="git-remote-url-label">push</span>
                      <span class="git-remote-url-value">{r.push}</span>
                    </div>
                  </Show>
                </div>
                <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={() => removeRemote(r.name)} title="Remove">
                  <Icon name="fa-solid fa-trash" />
                </button>
              </div>
            )}</For>
          </div>

          <div class="git-section" style={{ 'margin-top': '16px' }}>
            <div class="git-section-header">
              <span>Local Branches</span>
              <button class="btn btn-ghost btn-xs" onClick={createBranch}>
                <Icon name="fa-solid fa-plus" /> New
              </button>
              <button class="btn btn-ghost btn-xs" onClick={loadBranches}>
                <Icon name="fa-solid fa-rotate" />
              </button>
            </div>
            <For each={branches.list.filter(b => !b.remote)}>{(b) => (
              <div class={`git-branch-item ${b.current ? 'git-branch-current' : ''}`}>
                <Show when={b.current}><Icon name="fa-solid fa-circle" class="git-branch-dot" /></Show>
                <span class="git-branch-name">{b.name}</span>
                <Show when={!b.current}>
                  <button class="btn btn-ghost btn-xs git-branch-checkout" onClick={() => checkoutBranch(b.name)} title="Checkout">
                    <Icon name="fa-solid fa-right-to-bracket" />
                  </button>
                </Show>
              </div>
            )}</For>
          </div>

          <div class="git-section" style={{ 'margin-top': '16px' }}>
            <div class="git-section-header">
              <span>Remote Branches</span>
            </div>
            <For each={branches.list.filter(b => b.remote && !b.name.includes('/HEAD'))}>{(b) => (
              <div class="git-branch-item">
                <Icon name="fa-solid fa-cloud" class="git-branch-dot" style={{ 'font-size': '8px', opacity: 0.5 }} />
                <span class="git-branch-name">{b.name.replace(/^remotes\//, '')}</span>
                <button class="btn btn-ghost btn-xs git-branch-checkout" onClick={() => checkoutRemoteBranch(b.name)} title="Checkout to local">
                  <Icon name="fa-solid fa-download" />
                </button>
              </div>
            )}</For>
          </div>
        </div>
      </div>

      <Modal />

      <Show when={switcherOpen()}>
        <div class="git-switcher-overlay" onClick={closeSwitcher}>
          <div class="git-switcher" onClick={(e) => e.stopPropagation()} onKeyDown={onSwitcherKeyDown}>
            <div class="git-switcher-input-row">
              <Icon name="fa-solid fa-magnifying-glass" class="git-switcher-icon" />
              <input
                ref={switcherInputRef}
                type="text"
                class="git-switcher-input"
                placeholder="Switch repository..."
                value={switcherQuery()}
                onInput={(e) => { setSwitcherQuery(e.target.value); setSwitcherIndex(0); }}
              />
            </div>
            <div class="git-switcher-list">
              <Show when={filteredSwitcherRepos().length === 0}>
                <div class="git-switcher-empty">No matching repos</div>
              </Show>
              <For each={filteredSwitcherRepos()}>{(repo, idx) => (
                <button
                  class={`git-switcher-item ${idx() === switcherIndex() ? 'git-switcher-item-active' : ''}`}
                  onClick={() => switcherSelect(repo)}
                  onMouseEnter={() => setSwitcherIndex(idx())}
                >
                  <Icon name="fa-solid fa-code-branch" class="git-switcher-item-icon" />
                  <div class="git-switcher-item-text">
                    <span class="git-switcher-item-name">{repo.name}</span>
                    <span class="git-switcher-item-path">{shortenPath(repo.path)}</span>
                  </div>
                </button>
              )}</For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
