import { For, Show } from 'solid-js';
import t from '../locale';
import Icon from './Icon';

function TreeItems(props) {
  const sorted = () => [...props.items].sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return 0;
  });

  return (
    <For each={sorted()}>
      {(item) => (
        <Show when={item.type === 'folder'} fallback={
          <div
            class={`tree-item ${item.id === props.activeId ? 'active' : ''}`}
            data-id={item.id}
            draggable="true"
            style={props.depth > 0 ? { 'padding-left': `${12 + props.depth * 16}px` } : {}}
            onClick={() => props.onSelect(item.id)}
            onDragStart={(e) => props.onDragStart(e, item.id)}
            onDragOver={(e) => props.onDragOver(e, item.id, false)}
            onDragLeave={(e) => props.onDragLeave(e)}
            onDrop={(e) => props.onDrop(e, item.id)}
          >
            <span class={`method-badge ${item.method || 'GET'}`}>{item.method || 'GET'}</span>
            <span class="item-name">{item.name}</span>
            <div class="item-actions">
              <button data-action="rename" onClick={(e) => { e.stopPropagation(); props.onRename(item.id); }} title={t.sidebar.renameItemTitle}><Icon name="fa-solid fa-ellipsis" /></button>
              <button data-action="delete" onClick={(e) => { e.stopPropagation(); props.onDelete(item.id); }} title={t.sidebar.deleteItemTitle}><Icon name="fa-solid fa-xmark" /></button>
            </div>
          </div>
        }>
          <>
            <div
              class="folder-header"
              data-id={item.id}
              draggable="true"

              onClick={() => props.onToggleFolder(item.id)}
              onDragStart={(e) => props.onDragStart(e, item.id)}
              onDragOver={(e) => props.onDragOver(e, item.id, true)}
              onDragLeave={(e) => props.onDragLeave(e)}
              onDrop={(e) => props.onDrop(e, item.id)}
            >
              <Icon name={item.collapsed ? 'fa-solid fa-caret-right' : 'fa-solid fa-caret-down'} />
              <span>{item.name}</span>
              <div class="folder-actions">
                <button onClick={(e) => { e.stopPropagation(); props.onAddToFolder(item.id); }} title={t.sidebar.addToFolderTitle}><Icon name="fa-solid fa-plus" /></button>
                <button onClick={(e) => { e.stopPropagation(); props.onRename(item.id); }} title={t.sidebar.renameItemTitle}><Icon name="fa-solid fa-ellipsis" /></button>
                <button onClick={(e) => { e.stopPropagation(); props.onDelete(item.id); }} title={t.sidebar.deleteItemTitle}><Icon name="fa-solid fa-xmark" /></button>
              </div>
            </div>
            <Show when={!item.collapsed}>
              <div class="folder-children" data-folder-children={item.id}>
                <TreeItems
                  items={item.children || []}
                  depth={props.depth + 1}
                  activeId={props.activeId}
                  onSelect={props.onSelect}
                  onRename={props.onRename}
                  onDelete={props.onDelete}
                  onToggleFolder={props.onToggleFolder}
                  onAddToFolder={props.onAddToFolder}
                  onDragStart={props.onDragStart}
                  onDragOver={props.onDragOver}
                  onDragLeave={props.onDragLeave}
                  onDrop={props.onDrop}
                />
              </div>
            </Show>
          </>
        </Show>
      )}
    </For>
  );
}

export default function Sidebar(props) {
  let sidebarRef;

  return (
    <div class="sidebar" ref={sidebarRef}>
      <div class="sidebar-header">
        <div class="back-row">
          <button class="back-btn" onClick={props.onBack} title={t.sidebar.backTitle}><Icon name="fa-solid fa-arrow-left" /></button>
          <span class="collection-name" onClick={props.onRenameCollection} title={t.sidebar.renameTitle}>{props.name}</span>
          <button class="back-btn sidebar-close-btn" onClick={props.onToggleSidebar} title={t.sidebar.closeSidebarTitle}><Icon name="fa-solid fa-xmark" /></button>
        </div>
        <div class="sidebar-actions">
          <button class="btn btn-primary btn-sm" onClick={props.onAddRequest}><Icon name="fa-solid fa-plus" /> {t.sidebar.addRequestButton}</button>
          <button class="btn btn-ghost btn-sm" onClick={props.onAddFolder}><Icon name="fa-solid fa-folder-plus" /> {t.sidebar.addFolderButton}</button>
          <button class="btn btn-ghost btn-sm" onClick={props.onImportRequests}><Icon name="fa-solid fa-file-import" /> {t.sidebar.importButton}</button>
        </div>
      </div>
      <div class="tree">
        <TreeItems
          items={props.items}
          depth={0}
          activeId={props.activeId}
          onSelect={props.onSelect}
          onRename={props.onRename}
          onDelete={props.onDelete}
          onToggleFolder={props.onToggleFolder}
          onAddToFolder={props.onAddToFolder}
          onDragStart={props.onDragStart}
          onDragOver={props.onDragOver}
          onDragLeave={props.onDragLeave}
          onDrop={props.onDrop}
        />
      </div>
    </div>
  );
}
