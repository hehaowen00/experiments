import { Show, For, createSignal, createMemo, createEffect, on, onMount, onCleanup } from 'solid-js';
import Icon from '../lib/Icon';
import FileTree from '../components/FileTree';
import ResizeHandle from '../lib/ResizeHandle';
import Select from '../lib/Select';
import { useWorkspace } from '../context/WorkspaceContext';
import { stagedFiles, unstagedFiles, untrackedFiles, conflictFiles } from '../utils/status';
import { DiffLines, DiffHunks, DiffStructural, isImageFile, ImagePreview } from '../utils/diff';
import { buildTree, compactTree } from '../utils/tree';
import { usePortrait } from '../utils/usePortrait';

function StashTreeDir(props) {
  const [expanded, setExpanded] = createSignal(true);
  const dirPath = () =>
    props.parentPath
      ? props.parentPath + '/' + props.node.name
      : props.node.name;
  const dirs = () => Object.keys(props.node.children).sort();
  const files = () =>
    [...props.node.files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div class="git-tree-dir">
      <div
        class="git-tree-dir-header"
        style={{ 'padding-left': `${props.depth * 16 + 4}px` }}
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon
          name={
            expanded()
              ? 'fa-solid fa-chevron-down'
              : 'fa-solid fa-chevron-right'
          }
          class="git-tree-chevron"
        />
        <Icon name="fa-solid fa-folder" class="git-tree-folder-icon" />
        <span class="git-tree-dir-name">{props.node.name}</span>
      </div>
      <Show when={expanded()}>
        <For each={dirs()}>
          {(name) => (
            <StashTreeDir
              node={props.node.children[name]}
              parentPath={dirPath()}
              depth={props.depth + 1}
              selectedFile={props.selectedFile}
              onSelectFile={props.onSelectFile}
              fileMap={props.fileMap}
            />
          )}
        </For>
        <For each={files()}>
          {(file) => {
            const info = () => props.fileMap[file.path];
            return (
              <div
                class={`git-file-item ${props.selectedFile() === file.path ? 'active' : ''}`}
                style={{
                  'padding-left': `${(props.depth + 1) * 16 + 4}px`,
                }}
                onClick={() => props.onSelectFile(file.path)}
              >
                <span class="git-file-path" title={file.path}>
                  {file.path.split('/').pop()}
                </span>
                <span class="git-detail-file-stats">
                  <Show when={info()?.binary}>
                    <span class="git-detail-stat-bin">binary</span>
                  </Show>
                  <Show when={info()?.additions > 0}>
                    <span class="git-detail-stat-add">
                      +{info().additions}
                    </span>
                  </Show>
                  <Show when={info()?.deletions > 0}>
                    <span class="git-detail-stat-del">
                      -{info().deletions}
                    </span>
                  </Show>
                </span>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}

function StashTreeRoot(props) {
  const dirs = () => Object.keys(props.node.children).sort();
  const files = () =>
    [...props.node.files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <>
      <For each={dirs()}>
        {(name) => (
          <StashTreeDir
            node={props.node.children[name]}
            parentPath=""
            depth={0}
            selectedFile={props.selectedFile}
            onSelectFile={props.onSelectFile}
            fileMap={props.fileMap}
          />
        )}
      </For>
      <For each={files()}>
        {(file) => {
          const info = () => props.fileMap[file.path];
          return (
            <div
              class={`git-file-item ${props.selectedFile() === file.path ? 'active' : ''}`}
              style={{ 'padding-left': '4px' }}
              onClick={() => props.onSelectFile(file.path)}
            >
              <span class="git-file-path" title={file.path}>
                {file.path.split('/').pop()}
              </span>
              <span class="git-detail-file-stats">
                <Show when={info()?.binary}>
                  <span class="git-detail-stat-bin">binary</span>
                </Show>
                <Show when={info()?.additions > 0}>
                  <span class="git-detail-stat-add">
                    +{info().additions}
                  </span>
                </Show>
                <Show when={info()?.deletions > 0}>
                  <span class="git-detail-stat-del">
                    -{info().deletions}
                  </span>
                </Show>
              </span>
            </div>
          );
        }}
      </For>
    </>
  );
}

export default function ChangesPanel() {
  const ws = useWorkspace();
  const portrait = usePortrait();
  const [filesWidth, setFilesWidth] = createSignal(320);
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [viewMode, setViewMode] = createSignal('changes');
  const [stashFile, setStashFile] = createSignal(null);
  const [stashFileDiff, setStashFileDiff] = createSignal(null);
  const [stashFileListWidth, setStashFileListWidth] = createSignal(280);

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      setSidebarOpen((v) => !v);
    }
  };
  onMount(() => window.addEventListener('keydown', onKeyDown));
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  // Switch back to changes view when a file diff is triggered
  createEffect(on(() => ws.diff.filepath, (fp) => {
    if (fp) setViewMode('changes');
  }, { defer: true }));

  const conflicts = () => conflictFiles(ws.status.files);
  const staged = () => stagedFiles(ws.status.files);
  const unstaged = () => unstagedFiles(ws.status.files);
  const untracked = () => [...untrackedFiles(ws.status.files), ...ws.allFiles()];

  const stashFiles = () => ws.stashDetail.files || [];

  const stashFileMap = createMemo(() => {
    const map = {};
    for (const f of stashFiles()) {
      map[f.filename] = f;
    }
    return map;
  });

  const stashTree = createMemo(() => {
    const treeFiles = stashFiles().map((f) => ({ path: f.filename }));
    if (treeFiles.length === 0) return null;
    return compactTree(buildTree(treeFiles));
  });

  function onResizeFiles(delta) {
    setFilesWidth((w) => Math.max(200, Math.min(w + delta, 600)));
  }

  function onResizeStashFileList(delta) {
    setStashFileListWidth((w) => Math.max(180, Math.min(w + delta, 500)));
  }

  function onStashClick(ref) {
    if (ws.stashDetail.ref === ref) {
      closeStashView();
      return;
    }
    setStashFile(null);
    setStashFileDiff(null);
    ws.viewStashDiff(ref);
    setViewMode('stash');
  }

  function closeStashView() {
    ws.setStashDetail({ ref: null, files: [] });
    setStashFile(null);
    setStashFileDiff(null);
    setViewMode('changes');
  }

  async function onStashFileSelect(filename) {
    if (stashFile() === filename) {
      setStashFile(null);
      setStashFileDiff(null);
      return;
    }
    setStashFile(filename);
    setStashFileDiff(null);
    const diff = await ws.loadStashFileDiff(
      ws.stashDetail.ref,
      filename,
    );
    if (diff !== null) setStashFileDiff(diff);
  }

  return (
    <div class="git-changes-panel">
      <Show when={!sidebarOpen()}>
        <button class="sidebar-toggle sidebar-toggle-closed" onClick={() => setSidebarOpen(true)} title="Show file list">
          <Icon name="fa-solid fa-chevron-right" />
        </button>
      </Show>
      <Show when={sidebarOpen()}>
      <div class={`git-files-panel ${portrait() ? 'portrait-overlay' : ''}`} style={{ width: `${filesWidth()}px` }}>
        <Show when={conflicts().length > 0}>
          <div class="git-section git-section-conflicts">
            <div class="git-section-header" onClick={() => ws.toggleSection('conflicts')}>
              <Icon name={ws.collapsedSections().has('conflicts') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
              <span class="git-conflict-label">Conflicts ({conflicts().length})</span>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.resolveOurs(conflicts().map(f => f.path)); }} title="Accept all ours">
                Ours
              </button>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.resolveTheirs(conflicts().map(f => f.path)); }} title="Accept all theirs">
                Theirs
              </button>
            </div>
            <Show when={!ws.collapsedSections().has('conflicts')}>
              <For each={conflicts()}>{(file) => {
                const filename = file.path.split('/').pop();
                return (
                  <div
                    class={`git-file-item git-conflict-file ${ws.diff.filepath === file.path && viewMode() === 'changes' ? 'active' : ''}`}
                    onClick={() => ws.viewConflictDiff(file.path)}
                  >
                    <span class="git-file-status git-conflict">U</span>
                    <span class="git-file-path" title={file.path}>{filename}</span>
                    <span class="git-file-actions">
                      <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.resolveOurs([file.path]); }} title="Accept ours (local)">
                        <Icon name="fa-solid fa-house" />
                      </button>
                      <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.resolveTheirs([file.path]); }} title="Accept theirs (remote)">
                        <Icon name="fa-solid fa-cloud" />
                      </button>
                    </span>
                  </div>
                );
              }}</For>
            </Show>
          </div>
        </Show>

        <Show when={staged().length > 0}>
          <div class="git-section">
            <div class="git-section-header" onClick={() => ws.toggleSection('staged')}>
              <Icon name={ws.collapsedSections().has('staged') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
              <span>Staged ({staged().length})</span>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.exportStagedPatch(); }} title="Export staged as patch">
                <Icon name="fa-solid fa-file-export" />
              </button>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.unstageAll(); }} title="Unstage all">
                <Icon name="fa-solid fa-minus" /> All
              </button>
            </div>
            <Show when={!ws.collapsedSections().has('staged')}>
              <FileTree getFiles={staged} section="staged" />
            </Show>
          </div>
        </Show>

        <Show when={unstaged().length > 0}>
          <div class="git-section">
            <div class="git-section-header" onClick={() => ws.toggleSection('unstaged')}>
              <Icon name={ws.collapsedSections().has('unstaged') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
              <span>Changes ({unstaged().length})</span>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.applyPatch(); }} title="Apply patch file">
                <Icon name="fa-solid fa-file-import" />
              </button>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.stageAll(unstaged()); }} title="Stage all changes">
                <Icon name="fa-solid fa-plus" /> All
              </button>
            </div>
            <Show when={!ws.collapsedSections().has('unstaged')}>
              <FileTree getFiles={unstaged} section="unstaged" />
            </Show>
          </div>
        </Show>

        <Show when={untracked().length > 0}>
          <div class="git-section">
            <div class="git-section-header" onClick={() => ws.toggleSection('untracked')}>
              <Icon name={ws.collapsedSections().has('untracked') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
              <span>Untracked ({untracked().length})</span>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.stageAll(untracked()); }} title="Stage all untracked">
                <Icon name="fa-solid fa-plus" /> All
              </button>
            </div>
            <Show when={!ws.collapsedSections().has('untracked')}>
              <FileTree getFiles={untracked} section="untracked" />
            </Show>
          </div>
        </Show>

        <Show when={ws.submodules().length > 0}>
          <div class="git-section">
            <div class="git-section-header" onClick={() => ws.toggleSection('submodules')}>
              <Icon name={ws.collapsedSections().has('submodules') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
              <span>Submodules ({ws.submodules().length})</span>
            </div>
            <Show when={!ws.collapsedSections().has('submodules')}>
              <For each={ws.submodules()}>{(sub) => (
                <div class="git-submodule-item">
                  <span class={`git-submodule-status git-submodule-${sub.status}`} title={sub.status}>
                    {sub.status === 'clean' ? '✓' : sub.status === 'dirty' ? '●' : '○'}
                  </span>
                  <Icon name={sub.type === 'submodule' ? 'fa-solid fa-cube' : 'fa-solid fa-folder-tree'} class="git-submodule-icon" />
                  <div class="git-submodule-info">
                    <span class="git-submodule-name">{sub.name}</span>
                    <span class="git-submodule-meta">
                      {sub.branch && <span class="git-submodule-branch"><Icon name="fa-solid fa-code-branch" /> {sub.branch}</span>}
                      <span class="git-submodule-type">{sub.type}</span>
                    </span>
                  </div>
                  <div class="git-submodule-actions">
                    <Show when={sub.status === 'not-initialized'}>
                      <button class="btn btn-ghost btn-xs" onClick={() => ws.initSubmodule(sub.path)} title="Initialize">
                        <Icon name="fa-solid fa-download" /> Init
                      </button>
                    </Show>
                    <Show when={sub.status !== 'not-initialized'}>
                      <button class="btn btn-ghost btn-xs" onClick={() => ws.openSubmodule(sub)} title="Open">
                        <Icon name="fa-solid fa-arrow-up-right-from-square" /> Open
                      </button>
                    </Show>
                  </div>
                </div>
              )}</For>
            </Show>
          </div>
        </Show>

        <Show when={ws.status.files.length === 0 && ws.submodules().length === 0 && !ws.status.loading}>
          <div class="git-empty">Working tree clean</div>
        </Show>

        <div class="git-section git-stashes-sidebar">
          <div class="git-section-header" onClick={() => ws.toggleSection('stashes')}>
            <Icon name={ws.collapsedSections().has('stashes') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
            <span>Stashes{ws.stashes.list.length > 0 ? ` (${ws.stashes.list.length})` : ''}</span>
            <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.doStashPush(); }} title="Stash changes">
              <Icon name="fa-solid fa-plus" />
            </button>
          </div>
          <Show when={!ws.collapsedSections().has('stashes')}>
            <Show when={ws.stashes.list.length === 0 && !ws.stashes.loading}>
              <div class="git-empty">No stashes</div>
            </Show>
            <For each={ws.stashes.list}>{(s) => (
              <div class={`git-stash-item ${ws.stashDetail.ref === s.ref ? 'selected' : ''}`} onClick={() => onStashClick(s.ref)}>
                <div class="git-stash-info">
                  <span class="git-stash-ref">{s.ref}</span>
                  <span class="git-stash-message">{s.message}</span>
                </div>
                <div class="git-stash-actions">
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.doStashApply(s.ref); }} title="Apply">
                    <Icon name="fa-solid fa-paste" />
                  </button>
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.doStashPop(s.ref); }} title="Pop">
                    <Icon name="fa-solid fa-arrow-up-from-bracket" />
                  </button>
                  <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={(e) => { e.stopPropagation(); ws.doStashDrop(s.ref); }} title="Drop">
                    <Icon name="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
            )}</For>
          </Show>
        </div>
        <button class="sidebar-toggle sidebar-toggle-inside" onClick={() => setSidebarOpen(false)} title="Hide file list">
          <Icon name="fa-solid fa-chevron-left" />
        </button>
      </div>
      <Show when={!portrait()}>
        <ResizeHandle direction="col" onResize={onResizeFiles} />
      </Show>
      </Show>

      {/* Right panel: changes diff or stash detail */}
      <Show when={viewMode() === 'stash' && ws.stashDetail.ref} fallback={
        <div class="git-right-panel">
          <div class="git-diff-panel">
            <Show when={ws.diff.filepath} fallback={
              <div class="git-empty">Select a file to view diff</div>
            }>
              <div class="git-diff-header">
                <span class="git-diff-filepath">{ws.diff.filepath}</span>
                <span class="git-diff-label">{ws.diff.staged ? 'Staged' : 'Working'}</span>
              </div>
              <Show when={isImageFile(ws.diff.filepath)} fallback={
                <Show when={ws.diff.structural} fallback={
                  <pre class="git-diff-content">
                    <div class="git-diff-inner">
                      <Show when={ws.diff.header} fallback={<DiffLines raw={ws.diff.content} />}>
                        <DiffHunks
                          raw={ws.diff.content}
                          onStageHunk={!ws.diff.staged ? (idx) => ws.stageHunk(idx) : undefined}
                          onUnstageHunk={ws.diff.staged ? (idx) => ws.unstageHunk(idx) : undefined}
                          onDiscardHunk={!ws.diff.staged ? (idx) => ws.discardHunk(idx) : undefined}
                        />
                      </Show>
                    </div>
                  </pre>
                }>
                  <pre class="git-diff-content">
                    <DiffStructural raw={ws.diff.content} />
                  </pre>
                </Show>
              }>
                <ImagePreview repoPath={ws.repoPath} filepath={ws.diff.filepath} />
              </Show>
            </Show>
          </div>

          <div class="git-commit-box">
            <Show when={ws.identities().length > 0}>
              <Select
                class="select-full select-sm"
                value={ws.currentIdentity()?.id || ''}
                placeholder="No identity"
                options={[
                  { value: '', label: 'No identity' },
                  ...ws.identities().map((id) => ({
                    value: id.id,
                    label: `${id.name} <${id.email}>`,
                  })),
                ]}
                onChange={(v) => ws.setRepoIdentity(v || null)}
              />
            </Show>
            <input
              type="text"
              class="git-commit-subject"
              placeholder="Commit message"
              value={ws.commit.message}
              onInput={(e) => ws.setCommit('message', e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); ws.doCommit(); }
              }}
            />
            <textarea
              class="git-commit-description"
              placeholder="Description (optional)"
              value={ws.commit.description}
              onInput={(e) => ws.setCommit('description', e.target.value)}
              rows={3}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); ws.doCommit(); }
              }}
            />
            <div class="git-commit-actions">
              <label class="git-amend-label">
                <input type="checkbox" checked={ws.commit.amend} onChange={ws.toggleAmend} />
                Amend
              </label>
              <button
                class="btn btn-primary btn-sm"
                onClick={ws.doCommit}
                disabled={ws.commit.running || (!ws.commit.message.trim() && !ws.commit.amend) || staged().length === 0}
              >
                {ws.commit.running ? 'Committing...' : ws.commit.amend ? 'Amend Commit' : 'Commit'}
              </button>
            </div>
          </div>
        </div>
      }>
        <div class="git-stash-detail">
          <div class="git-stash-preview-header">
            <span class="git-stash-preview-title">
              {ws.stashDetail.ref}
            </span>
            <span class="git-stash-preview-count">
              {stashFiles().length} file{stashFiles().length !== 1 ? 's' : ''}
            </span>
            <button
              class="btn btn-ghost btn-xs"
              onClick={closeStashView}
              title="Close"
            >
              <Icon name="fa-solid fa-xmark" />
            </button>
          </div>
          <div class="git-stash-preview-split">
            <div
              class="git-stash-file-list"
              style={{ width: `${stashFileListWidth()}px` }}
            >
              <Show when={stashTree()}>
                {(t) => (
                  <StashTreeRoot
                    node={t()}
                    selectedFile={stashFile}
                    onSelectFile={onStashFileSelect}
                    fileMap={stashFileMap()}
                  />
                )}
              </Show>
            </div>
            <ResizeHandle direction="col" onResize={onResizeStashFileList} />
            <div class="git-stash-file-diff">
              <Show
                when={stashFile()}
                fallback={
                  <div class="git-empty">
                    Select a file to view its diff
                  </div>
                }
              >
                <div class="git-diff-header">
                  <span class="git-diff-filepath">
                    {stashFile()}
                  </span>
                </div>
                <Show when={isImageFile(stashFile())} fallback={
                  <Show
                    when={stashFileDiff()}
                    fallback={
                      <div class="git-empty">Loading...</div>
                    }
                  >
                    <pre class="git-diff-content git-detail-file-diff">
                      <div class="git-diff-inner">
                        <DiffLines raw={stashFileDiff()} />
                      </div>
                    </pre>
                  </Show>
                }>
                  <ImagePreview repoPath={ws.repoPath} filepath={stashFile()} gitRef={ws.stashDetail.ref} />
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
