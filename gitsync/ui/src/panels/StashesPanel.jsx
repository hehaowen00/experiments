import { Show, For, createSignal, createMemo } from 'solid-js';
import Icon from '../lib/Icon';
import ResizeHandle from '../lib/ResizeHandle';
import { useWorkspace } from '../context/WorkspaceContext';
import { parseDiffFiles, DiffLines } from '../utils/diff';
import { buildTree, compactTree } from '../utils/tree';

function StashTreeDir(props) {
  const [expanded, setExpanded] = createSignal(true);
  const dirPath = () => props.parentPath ? props.parentPath + '/' + props.node.name : props.node.name;
  const dirs = () => Object.keys(props.node.children).sort();
  const files = () => [...props.node.files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div class="git-tree-dir">
      <div
        class="git-tree-dir-header"
        style={{ 'padding-left': `${props.depth * 16 + 4}px` }}
        onClick={() => setExpanded(v => !v)}
      >
        <Icon name={expanded() ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'} class="git-tree-chevron" />
        <Icon name="fa-solid fa-folder" class="git-tree-folder-icon" />
        <span class="git-tree-dir-name">{props.node.name}</span>
      </div>
      <Show when={expanded()}>
        <For each={dirs()}>{(name) => (
          <StashTreeDir
            node={props.node.children[name]}
            parentPath={dirPath()}
            depth={props.depth + 1}
            selectedFile={props.selectedFile}
            onSelectFile={props.onSelectFile}
            fileMap={props.fileMap}
          />
        )}</For>
        <For each={files()}>{(file) => {
          const info = () => props.fileMap[file.path];
          return (
            <div
              class={`git-file-item ${props.selectedFile() === file.path ? 'active' : ''}`}
              style={{ 'padding-left': `${(props.depth + 1) * 16 + 4}px` }}
              onClick={() => props.onSelectFile(file.path)}
            >
              <span class="git-file-path" title={file.path}>{file.path.split('/').pop()}</span>
              <span class="git-detail-file-stats">
                <Show when={info()?.additions > 0}>
                  <span class="git-detail-stat-add">+{info().additions}</span>
                </Show>
                <Show when={info()?.deletions > 0}>
                  <span class="git-detail-stat-del">-{info().deletions}</span>
                </Show>
              </span>
            </div>
          );
        }}</For>
      </Show>
    </div>
  );
}

function StashTreeRoot(props) {
  const dirs = () => Object.keys(props.node.children).sort();
  const files = () => [...props.node.files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <>
      <For each={dirs()}>{(name) => (
        <StashTreeDir
          node={props.node.children[name]}
          parentPath=""
          depth={0}
          selectedFile={props.selectedFile}
          onSelectFile={props.onSelectFile}
          fileMap={props.fileMap}
        />
      )}</For>
      <For each={files()}>{(file) => {
        const info = () => props.fileMap[file.path];
        return (
          <div
            class={`git-file-item ${props.selectedFile() === file.path ? 'active' : ''}`}
            style={{ 'padding-left': '4px' }}
            onClick={() => props.onSelectFile(file.path)}
          >
            <span class="git-file-path" title={file.path}>{file.path.split('/').pop()}</span>
            <span class="git-detail-file-stats">
              <Show when={info()?.additions > 0}>
                <span class="git-detail-stat-add">+{info().additions}</span>
              </Show>
              <Show when={info()?.deletions > 0}>
                <span class="git-detail-stat-del">-{info().deletions}</span>
              </Show>
            </span>
          </div>
        );
      }}</For>
    </>
  );
}

export default function StashesPanel() {
  const ws = useWorkspace();
  const [selectedFile, setSelectedFile] = createSignal(null);
  const [listWidth, setListWidth] = createSignal(280);

  const files = createMemo(() => {
    if (!ws.stashDetail.diff) return [];
    return parseDiffFiles(ws.stashDetail.diff);
  });

  const fileMap = createMemo(() => {
    const map = {};
    for (const f of files()) {
      map[f.filename] = f;
    }
    return map;
  });

  const tree = createMemo(() => {
    const treeFiles = files().map(f => ({ path: f.filename }));
    if (treeFiles.length === 0) return null;
    return compactTree(buildTree(treeFiles));
  });

  const selectedDiff = createMemo(() => {
    const name = selectedFile();
    if (!name) return null;
    return files().find(f => f.filename === name) || null;
  });

  function onViewStash(ref) {
    setSelectedFile(null);
    ws.viewStashDiff(ref);
  }

  function onSelectFile(filename) {
    setSelectedFile(prev => prev === filename ? null : filename);
  }

  function onResizeList(delta) {
    setListWidth(w => Math.max(180, Math.min(w + delta, 500)));
  }

  return (
    <div class="git-stashes-panel">
      {/* Stash list */}
      <div class="git-section">
        <div class="git-section-header">
          <span>Stashes</span>
          <button class="btn btn-ghost btn-xs" onClick={ws.doStashPush}>
            <Icon name="fa-solid fa-plus" /> Stash
          </button>
          <button class="btn btn-ghost btn-xs" onClick={ws.loadStashes}>
            <Icon name="fa-solid fa-rotate" />
          </button>
        </div>
        <Show when={ws.stashes.list.length === 0 && !ws.stashes.loading}>
          <div class="git-empty">No stashes</div>
        </Show>
        <For each={ws.stashes.list}>{(s) => (
          <div class={`git-stash-item ${ws.stashDetail.ref === s.ref ? 'git-stash-selected' : ''}`}>
            <div class="git-stash-info" onClick={() => onViewStash(s.ref)}>
              <span class="git-stash-ref">{s.ref}</span>
              <span class="git-stash-message">{s.message}</span>
              <span class="git-stash-date">{new Date(s.date).toLocaleDateString()}</span>
            </div>
            <div class="git-stash-actions">
              <button class="btn btn-ghost btn-xs" onClick={() => ws.doStashApply(s.ref)} title="Apply (keep stash)">
                <Icon name="fa-solid fa-paste" />
              </button>
              <button class="btn btn-ghost btn-xs" onClick={() => ws.doStashPop(s.ref)} title="Pop (apply & drop)">
                <Icon name="fa-solid fa-arrow-up-from-bracket" />
              </button>
              <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={() => ws.doStashDrop(s.ref)} title="Drop">
                <Icon name="fa-solid fa-trash" />
              </button>
            </div>
          </div>
        )}</For>
      </div>

      {/* Stash contents: file tree + diff */}
      <Show when={ws.stashDetail.ref}>
        <div class="git-stash-preview">
          <div class="git-stash-preview-header">
            <span class="git-stash-preview-title">{ws.stashDetail.ref}</span>
            <span class="git-stash-preview-count">{files().length} file{files().length !== 1 ? 's' : ''}</span>
            <button class="btn btn-ghost btn-xs" onClick={() => { ws.setStashDetail({ ref: null, diff: '' }); setSelectedFile(null); }} title="Close">
              <Icon name="fa-solid fa-xmark" />
            </button>
          </div>
          <div class="git-stash-preview-split">
            <div class="git-stash-file-list" style={{ width: `${listWidth()}px` }}>
              <Show when={tree()}>
                {(t) => (
                  <StashTreeRoot
                    node={t()}
                    selectedFile={selectedFile}
                    onSelectFile={onSelectFile}
                    fileMap={fileMap()}
                  />
                )}
              </Show>
            </div>
            <ResizeHandle direction="col" onResize={onResizeList} />
            <div class="git-stash-file-diff">
              <Show when={selectedDiff()} fallback={
                <div class="git-empty">Select a file to view its diff</div>
              }>
                <div class="git-diff-header">
                  <span class="git-diff-filepath">{selectedDiff().filename}</span>
                </div>
                <pre class="git-diff-content git-detail-file-diff">
                  <div class="git-diff-inner">
                    <DiffLines raw={selectedDiff().diff} />
                  </div>
                </pre>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
