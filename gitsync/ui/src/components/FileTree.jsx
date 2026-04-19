import { createMemo, For, Show } from 'solid-js';
import Icon from '../lib/Icon';
import { useWorkspace } from '../context/WorkspaceContext';
import { statusClass } from '../utils/status';
import { allFilesInTree } from '../utils/tree';
import { buildTree, compactTree } from '../utils/tree';

function TreeDir(props) {
  const ws = useWorkspace();
  const isUnstaged = () => props.section === 'unstaged';
  const isUntracked = () => props.section === 'untracked';
  const fileCount = () => allFilesInTree(props.child).length;
  const hasChangedFiles = () => allFilesInTree(props.child).some(f => !f.clean);
  const dirKey = () => `${props.section}:${props.dirPath}`;

  return (
    <div class="git-tree-dir">
      <div
        class="git-tree-dir-header"
        style={{ 'padding-left': `${props.depth * 16 + 4}px` }}
        onClick={() => ws.toggleDir(dirKey())}
        onContextMenu={(e) => ws.onFolderContextMenu(e, props.dirPath, props.child, props.section)}
      >
        <Icon name={ws.expandedDirs().has(dirKey()) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'} class="git-tree-chevron" />
        <Icon name="fa-solid fa-folder" class="git-tree-folder-icon" />
        <span class="git-tree-dir-name" title={props.dirPath}>{props.child.name}</span>
        <span class="git-tree-dir-count">{fileCount()}</span>
        <span class="git-file-actions">
          {props.isStaged && (
            <button class="btn btn-ghost btn-xs" onClick={(e) => {
              e.stopPropagation();
              const paths = allFilesInTree(props.child).filter(f => !f.clean).map(f => f.path);
              window.api.gitUnstage(ws.repoPath, paths).then(ws.refresh);
            }} title="Unstage all in folder">
              <Icon name="fa-solid fa-minus" />
            </button>
          )}
          {!props.isStaged && hasChangedFiles() && (
            <button class="btn btn-ghost btn-xs" onClick={(e) => {
              e.stopPropagation();
              const paths = allFilesInTree(props.child).filter(f => !f.clean).map(f => f.path);
              window.api.gitStage(ws.repoPath, paths).then(ws.refresh);
            }} title="Stage all in folder">
              <Icon name="fa-solid fa-plus" />
            </button>
          )}
          {isUnstaged() && (
            <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={(e) => {
              e.stopPropagation();
              ws.discardFolder(props.dirPath, 'unstaged');
            }} title="Discard all in folder">
              <Icon name="fa-solid fa-xmark" />
            </button>
          )}
          {isUntracked() && hasChangedFiles() && (
            <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={(e) => {
              e.stopPropagation();
              ws.discardFolder(props.dirPath, 'untracked');
            }} title="Delete all in folder">
              <Icon name="fa-solid fa-xmark" />
            </button>
          )}
        </span>
      </div>
      <Show when={ws.expandedDirs().has(dirKey())}>
        <FileTreeNode node={props.child} section={props.section} depth={props.depth + 1} parentPath={props.dirPath} />
      </Show>
    </div>
  );
}

function FileTreeNode(props) {
  const ws = useWorkspace();
  const dirs = () => Object.keys(props.node.children).sort();
  const files = () => [...props.node.files].sort((a, b) => a.path.localeCompare(b.path));
  const isStaged = () => props.section === 'staged';
  const isUntracked = () => props.section === 'untracked';

  return (
    <>
      <For each={dirs()}>{(dirName) => {
        const child = () => props.node.children[dirName];
        const dirPath = () => props.parentPath ? props.parentPath + '/' + child().name : child().name;
        return <TreeDir child={child()} dirPath={dirPath()} section={props.section} depth={props.depth} isStaged={isStaged()} />;
      }}</For>
      <For each={files()}>{(file) => {
        const code = () => isStaged() ? file.index : file.working === '?' ? '?' : file.working;
        const filepath = file.path;
        const filename = filepath.split('/').pop();
        const isClean = file.clean;

        return (
          <div
            class={`git-file-item ${ws.diff.filepath === filepath ? 'active' : ''} ${file.isGitRepo ? 'git-nested-repo' : ''} ${isClean ? 'git-file-clean' : ''}`}
            style={{ 'padding-left': `${props.depth * 16 + 4}px` }}
            data-filepath={filepath}
            data-section={props.section}
            data-staged={isStaged() ? '1' : ''}
            onClick={() => !file.isGitRepo && !isClean && ws.viewDiff(filepath, isStaged())}
            onContextMenu={(e) => !isClean && ws.onFileContextMenu(e, filepath, props.section)}
          >
            <span class={`git-file-status ${isClean ? '' : statusClass(code())}`}>{isClean ? ' ' : code()}</span>
            {file.isGitRepo
              ? <><Icon name="fa-solid fa-code-branch" class="git-nested-repo-icon" /><span class="git-file-path git-nested-repo-label" title={filepath}>{filename}</span><span class="git-nested-repo-badge">repo</span></>
              : <span class="git-file-path" title={file.origPath ? `${file.origPath} → ${filepath}` : filepath}>{filename}{file.origPath ? <span class="git-rename-from"> ← {file.origPath.split('/').pop()}</span> : null}</span>
            }
            <Show when={!isClean}>
              <span class="git-file-actions">
                {isStaged() && (
                  <button class="btn btn-ghost btn-xs" data-action="unstage" data-path={filepath} title="Unstage">
                    <Icon name="fa-solid fa-minus" />
                  </button>
                )}
                {!isStaged() && !isUntracked() && (
                  <>
                    <button class="btn btn-ghost btn-xs" data-action="stage" data-path={filepath} title="Stage">
                      <Icon name="fa-solid fa-plus" />
                    </button>
                    <button class="btn btn-ghost btn-xs btn-danger-hover" data-action="discard" data-path={filepath} title="Discard">
                      <Icon name="fa-solid fa-xmark" />
                    </button>
                  </>
                )}
                {isUntracked() && (
                  <>
                    <button class="btn btn-ghost btn-xs" data-action="stage" data-path={filepath} title="Stage">
                      <Icon name="fa-solid fa-plus" />
                    </button>
                    <button class="btn btn-ghost btn-xs btn-danger-hover" data-action="delete" data-path={filepath} title="Delete">
                      <Icon name="fa-solid fa-xmark" />
                    </button>
                  </>
                )}
              </span>
            </Show>
          </div>
        );
      }}</For>
    </>
  );
}

export default function FileTree(props) {
  const ws = useWorkspace();
  const tree = createMemo(() => compactTree(buildTree(props.getFiles())));

  // Event delegation: handle file-level button clicks from a single handler
  function onTreeClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();

    const action = btn.dataset.action;
    const path = btn.dataset.path;
    if (!path) return;

    switch (action) {
      case 'stage': ws.stageFile(path); break;
      case 'unstage': ws.unstageFile(path); break;
      case 'discard': ws.discardFile(path); break;
      case 'delete': ws.deleteUntrackedFiles([path]); break;
    }
  }

  return (
    <div onClick={onTreeClick}>
      <Show when={tree()}>
        {(t) => <FileTreeNode node={t()} section={props.section} depth={0} parentPath="" />}
      </Show>
    </div>
  );
}
