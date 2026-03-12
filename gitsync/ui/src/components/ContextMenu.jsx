import { Show } from 'solid-js';
import Icon from './Icon';
import { useWorkspace } from '../context/WorkspaceContext';

export default function ContextMenu() {
  const ws = useWorkspace();

  return (
    <Show when={ws.ctxMenu()}>
      {(() => {
        const menu = ws.ctxMenu();
        const isStaged = menu.section === 'staged';
        const isUntracked = menu.section === 'untracked';
        const label = menu.isFolder ? 'Folder' : 'File';
        return (
          <div
            class="file-context-menu"
            style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            {isStaged && (
              <button class="file-context-menu-item" onClick={() => {
                ws.setCtxMenu(null);
                window.api.gitUnstage(ws.repoPath, menu.filepaths).then(ws.refresh);
              }}>
                <Icon name="fa-solid fa-minus" /> Unstage {label}
              </button>
            )}
            {!isStaged && (
              <button class="file-context-menu-item" onClick={() => {
                ws.setCtxMenu(null);
                if (menu.isFolder) {
                  window.api.gitStage(ws.repoPath, menu.filepaths).then(ws.refresh);
                } else {
                  ws.stageFile(menu.filepath);
                }
              }}>
                <Icon name="fa-solid fa-plus" /> Stage {label}
              </button>
            )}
            {!isStaged && !isUntracked && (
              <button class="file-context-menu-item danger" onClick={() => {
                ws.setCtxMenu(null);
                ws.discardFiles(menu.filepaths);
              }}>
                <Icon name="fa-solid fa-xmark" /> Discard Changes
              </button>
            )}
            {isUntracked && (
              <button class="file-context-menu-item danger" onClick={() => {
                ws.setCtxMenu(null);
                ws.deleteUntrackedFiles(menu.filepaths);
              }}>
                <Icon name="fa-solid fa-trash" /> Delete {label}
              </button>
            )}
            {!menu.isFolder && !isUntracked && (
              <button class="file-context-menu-item" onClick={() => {
                ws.setCtxMenu(null);
                ws.openFileHistory(menu.filepath);
              }}>
                <Icon name="fa-solid fa-clock-rotate-left" /> File History
              </button>
            )}
          </div>
        );
      })()}
    </Show>
  );
}
