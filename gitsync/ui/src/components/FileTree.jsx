import { For, Show } from 'solid-js';
import Icon from './Icon';
import { useWorkspace } from '../context/WorkspaceContext';
import { statusClass } from '../utils/status';
import { allFilesInTree } from '../utils/tree';
import { buildTree, compactTree } from '../utils/tree';

function TreeDir(props) {
  const { child, dirPath, section, depth, isStaged } = props;
  const ws = useWorkspace();
  const isUnstaged = section === 'unstaged';
  const isUntracked = section === 'untracked';
  const fileCount = allFilesInTree(child).length;

  return (
    <div class="git-tree-dir">
      <div
        class="git-tree-dir-header"
        style={{ 'padding-left': `${depth * 16 + 4}px` }}
        onClick={() => ws.toggleDir(dirPath)}
        onContextMenu={(e) => ws.onFolderContextMenu(e, dirPath, child, section)}
      >
        <Icon name={ws.expandedDirs().has(dirPath) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'} class="git-tree-chevron" />
        <Icon name="fa-solid fa-folder" class="git-tree-folder-icon" />
        <span class="git-tree-dir-name">{child.name}</span>
        <span class="git-tree-dir-count">{fileCount}</span>
        <span class="git-file-actions">
          {isStaged && (
            <button class="btn btn-ghost btn-xs" onClick={(e) => {
              e.stopPropagation();
              const paths = allFilesInTree(child).map(f => f.path);
              paths.forEach(p => ws.unstageFile(p));
            }} title="Unstage all in folder">
              <Icon name="fa-solid fa-minus" />
            </button>
          )}
          {!isStaged && (
            <button class="btn btn-ghost btn-xs" onClick={(e) => {
              e.stopPropagation();
              const paths = allFilesInTree(child).map(f => f.path);
              window.api.gitStage(ws.repoPath, paths).then(ws.refresh);
            }} title="Stage all in folder">
              <Icon name="fa-solid fa-plus" />
            </button>
          )}
          {isUnstaged && (
            <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={(e) => {
              e.stopPropagation();
              const paths = allFilesInTree(child).map(f => f.path);
              ws.discardFiles(paths);
            }} title="Discard all in folder">
              <Icon name="fa-solid fa-xmark" />
            </button>
          )}
          {isUntracked && (
            <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={(e) => {
              e.stopPropagation();
              const paths = allFilesInTree(child).map(f => f.path);
              ws.deleteUntrackedFiles(paths);
            }} title="Delete all in folder">
              <Icon name="fa-solid fa-xmark" />
            </button>
          )}
        </span>
      </div>
      <Show when={ws.expandedDirs().has(dirPath)}>
        <FileTreeNode node={child} section={section} depth={depth + 1} parentPath={dirPath} />
      </Show>
    </div>
  );
}

function FileTreeNode(props) {
  const { node, section, depth, parentPath } = props;
  const ws = useWorkspace();
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
            class={`git-file-item ${ws.diff.filepath === filepath ? 'active' : ''} ${file.isGitRepo ? 'git-nested-repo' : ''}`}
            style={{ 'padding-left': `${depth * 16 + 4}px` }}
            onClick={() => !file.isGitRepo && ws.viewDiff(filepath, isStaged)}
            onContextMenu={(e) => ws.onFileContextMenu(e, filepath, section)}
          >
            <span class={`git-file-status ${statusClass(code)}`}>{code}</span>
            {file.isGitRepo
              ? <><Icon name="fa-solid fa-code-branch" class="git-nested-repo-icon" /><span class="git-file-path git-nested-repo-label" title={filepath}>{filename}</span><span class="git-nested-repo-badge">repo</span></>
              : <span class="git-file-path" title={filepath}>{filename}</span>
            }
            <span class="git-file-actions">
              {isStaged && (
                <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.unstageFile(filepath); }} title="Unstage">
                  <Icon name="fa-solid fa-minus" />
                </button>
              )}
              {!isStaged && !isUntracked && (
                <>
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.stageFile(filepath); }} title="Stage">
                    <Icon name="fa-solid fa-plus" />
                  </button>
                  <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={(e) => { e.stopPropagation(); ws.discardFile(filepath); }} title="Discard">
                    <Icon name="fa-solid fa-xmark" />
                  </button>
                </>
              )}
              {isUntracked && (
                <>
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.stageFile(filepath); }} title="Stage">
                    <Icon name="fa-solid fa-plus" />
                  </button>
                  <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={(e) => { e.stopPropagation(); ws.deleteUntrackedFiles([filepath]); }} title="Delete">
                    <Icon name="fa-solid fa-xmark" />
                  </button>
                </>
              )}
            </span>
          </div>
        );
      }}</For>
    </>
  );
}

export default function FileTree(props) {
  const tree = () => compactTree(buildTree(props.files));
  return <FileTreeNode node={tree()} section={props.section} depth={0} parentPath="" />;
}
