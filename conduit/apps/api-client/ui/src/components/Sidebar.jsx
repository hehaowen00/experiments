import { For, Show } from 'solid-js';
import { Icon, t } from '@conduit/ui-shared';
import { useCollection } from '../store/collection';

function TreeItems(props) {
  const [state, actions] = useCollection();

  const sorted = () =>
    [...props.items].sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return 0;
    });

  return (
    <For each={sorted()}>
      {(item) => (
        <Show
          when={item.type === 'folder'}
          fallback={
            <div
              class={`tree-item ${item.id === state.activeRequestId ? 'active' : ''}`}
              data-id={item.id}
              draggable="true"
              style={
                props.depth > 0
                  ? { 'padding-left': `${12 + props.depth * 16}px` }
                  : {}
              }
              onClick={() => props.onSelect(item.id)}
              onDragStart={(e) => actions.onDragStart(e, item.id)}
              onDragEnd={(e) => actions.onDragEnd(e)}
              onDragOver={(e) => actions.onDragOver(e, item.id, false)}
              onDragLeave={(e) => actions.onDragLeave(e)}
              onDrop={(e) => actions.onDrop(e, item.id)}
            >
              <span class={`method-badge ${item.method || 'GET'}`}>
                {item.method || 'GET'}
              </span>
              <span class="item-name">{item.name}</span>
              <div class="item-actions">
                <button
                  data-action="rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.handleRename(item.id);
                  }}
                  title={t.sidebar.renameItemTitle}
                >
                  <Icon name="fa-solid fa-ellipsis" />
                </button>
                <button
                  data-action="delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.handleDelete(item.id);
                  }}
                  title={t.sidebar.deleteItemTitle}
                >
                  <Icon name="fa-solid fa-xmark" />
                </button>
              </div>
            </div>
          }
        >
          <>
            <div
              class="folder-header"
              data-id={item.id}
              draggable="true"
              onClick={() => actions.toggleFolder(item.id)}
              onDragStart={(e) => actions.onDragStart(e, item.id)}
              onDragEnd={(e) => actions.onDragEnd(e)}
              onDragOver={(e) => actions.onDragOver(e, item.id, true)}
              onDragLeave={(e) => actions.onDragLeave(e)}
              onDrop={(e) => actions.onDrop(e, item.id)}
            >
              <Icon
                name={
                  item.collapsed
                    ? 'fa-solid fa-caret-right'
                    : 'fa-solid fa-caret-down'
                }
              />
              <span>{item.name}</span>
              <div class="folder-actions">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.addToFolder(item.id);
                  }}
                  title={t.sidebar.addToFolderTitle}
                >
                  <Icon name="fa-solid fa-plus" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.handleRename(item.id);
                  }}
                  title={t.sidebar.renameItemTitle}
                >
                  <Icon name="fa-solid fa-ellipsis" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.handleDelete(item.id);
                  }}
                  title={t.sidebar.deleteItemTitle}
                >
                  <Icon name="fa-solid fa-xmark" />
                </button>
              </div>
            </div>
            <Show when={!item.collapsed}>
              <div class="folder-children" data-folder-children={item.id}>
                <TreeItems
                  items={item.children || []}
                  depth={props.depth + 1}
                  onSelect={props.onSelect}
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
  const [state, actions] = useCollection();

  return (
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-actions">
          <button class="btn btn-primary btn-sm" onClick={actions.addRequest}>
            <Icon name="fa-solid fa-plus" /> {t.sidebar.addRequestButton}
          </button>
          <button class="btn btn-ghost btn-sm" onClick={actions.addFolder}>
            <Icon name="fa-solid fa-folder-plus" /> {t.sidebar.addFolderButton}
          </button>
          <button class="btn btn-ghost btn-sm" onClick={actions.importRequests}>
            <Icon name="fa-solid fa-file-import" /> {t.sidebar.importButton}
          </button>
        </div>
      </div>
      <div class="tree">
        <TreeItems
          items={state.collection.items}
          depth={0}
          onSelect={props.onSelect}
        />
      </div>
    </div>
  );
}
