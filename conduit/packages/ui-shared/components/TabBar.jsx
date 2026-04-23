import { For, Show } from 'solid-js';
import Icon from './Icon';
import TitleBar from './TitleBar';
import { useTabs } from '../store/tabs';
import { showSettings } from './Modal';

export default function TabBar(props) {
  const [state, actions] = useTabs();
  let dragFromIdx = null;

  function onTabDragStart(e, idx) {
    dragFromIdx = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', idx);
    e.currentTarget.classList.add('dragging');
  }

  function onTabDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragFromIdx = null;
    document.querySelectorAll('.app-tab.drag-over-left, .app-tab.drag-over-right').forEach((el) => {
      el.classList.remove('drag-over-left', 'drag-over-right');
    });
  }

  function onTabDragOver(e, idx) {
    if (dragFromIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.app-tab.drag-over-left, .app-tab.drag-over-right').forEach((el) => {
      el.classList.remove('drag-over-left', 'drag-over-right');
    });
    if (idx !== dragFromIdx) {
      const side = idx < dragFromIdx ? 'drag-over-left' : 'drag-over-right';
      e.currentTarget.classList.add(side);
    }
  }

  function onTabDrop(e, toIdx) {
    e.preventDefault();
    document.querySelectorAll('.app-tab.drag-over-left, .app-tab.drag-over-right').forEach((el) => {
      el.classList.remove('drag-over-left', 'drag-over-right');
    });
    if (dragFromIdx !== null && dragFromIdx !== toIdx) {
      actions.reorderTabs(dragFromIdx, toIdx);
    }
    dragFromIdx = null;
  }

  const showingPinned = () => state.pinnedTab !== null;

  const visibleTabs = () =>
    state.tabs
      .map((tab, originalIdx) => ({ tab, originalIdx }))
      .filter(({ tab }) => tab.type !== actions.initialType());

  function onHome() {
    actions.togglePinnedTab(null);
    const newType = actions.newTabType();
    const active = state.tabs.find((t) => t.id === state.activeTabId);
    if (active?.type === newType || active?.type === actions.initialType()) return;
    actions.replaceTab(state.activeTabId, newType);
  }

  function onAdd() {
    actions.togglePinnedTab(null);
    actions.createTab(actions.newTabType());
  }

  return (
    <div class="app-tabbar">
      <div class="app-tabs">
        <button class="app-tab" onClick={onHome} title="Home">
          <Icon name="fa-solid fa-house" />
        </button>
        <For each={visibleTabs()}>
          {({ tab, originalIdx }) => (
            <button
              class={`app-tab ${!showingPinned() && state.activeTabId === tab.id ? 'active' : ''}`}
              onClick={() => {
                actions.togglePinnedTab(null);
                actions.activateTab(tab.id);
              }}
              draggable="true"
              onDragStart={(e) => onTabDragStart(e, originalIdx)}
              onDragEnd={onTabDragEnd}
              onDragOver={(e) => onTabDragOver(e, originalIdx)}
              onDrop={(e) => onTabDrop(e, originalIdx)}
            >
              <Show when={tab.icon}>
                <Icon name={tab.icon} />
              </Show>
              <span>{tab.label}</span>
              <span
                class="app-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  if (actions.closeTab(tab.id) === 'quit') window.api.quit();
                }}
              >
                <Icon name="fa-solid fa-xmark" />
              </span>
            </button>
          )}
        </For>
        <button class="app-tab app-tab-add" onClick={onAdd} title="New Tab">
          <Icon name="fa-solid fa-plus" />
        </button>
      </div>
      <div class="app-tab-pinned">
        <For each={state.pinnedTools}>
          {(tool) => (
            <button
              class={`btn btn-ghost btn-xs app-tab-pinned-btn ${state.pinnedTab === tool.type ? 'active' : ''}`}
              onClick={() => actions.togglePinnedTab(tool.type)}
              title={tool.label}
            >
              <Icon name={tool.icon} />
            </button>
          )}
        </For>
        <button class="btn btn-ghost btn-xs app-tab-settings" onClick={() => showSettings()}>
          <Icon name="fa-solid fa-gear" />
        </button>
      </div>
      <TitleBar />
    </div>
  );
}
