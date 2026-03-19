import { createEffect, createSignal, For, Match, Show, Switch, onMount, onCleanup } from 'solid-js';
import Icon from './components/Icon';
import Modal, { showSettings } from './components/Modal';
import NewTabPage from './components/NewTabPage';
import Collection from './pages/Collection';
import DatabaseClient from './pages/DatabaseClient';
import DatabaseWorkspace from './pages/DatabaseWorkspace';
import DateTimeTool from './pages/DateTimeTool';
import Drop from './pages/Drop';
import Landing from './pages/Landing';
import RfcViewer from './pages/RfcViewer';
import { TabProvider, useTabs, TAB_TYPES, PINNED_TOOLS } from './store/tabs';

export default function App() {
  return (
    <TabProvider>
      <AppShell />
      <Modal />
    </TabProvider>
  );
}

function AppShell() {
  const [state, actions] = useTabs();
  const [isMac, setIsMac] = createSignal(true);

  onMount(async () => {
    const platform = await window.api.platform();
    setIsMac(platform === 'darwin');
  });

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      if (state.pinnedTab) {
        actions.togglePinnedTab(state.pinnedTab);
      } else if (actions.closeTab(state.activeTabId) === 'quit') {
        window.api.quit();
      }
    }
  }

  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

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

  function openCollection(id, name) {
    const existing = state.tabs.find((t) => t.type === 'collection' && t.collectionId === id);
    if (existing) {
      actions.activateTab(existing.id);
      return;
    }
    actions.replaceTab(state.activeTabId, 'collection', { collectionId: id, label: name });
  }

  function openDatabase(connData) {
    actions.replaceTab(state.activeTabId, 'database', { connData, label: connData.name });
  }

  const showingPinned = () => state.pinnedTab !== null;

  createEffect(() => {
    const pinned = state.pinnedTab;
    if (pinned) {
      const def = TAB_TYPES[pinned];
      document.title = def ? `Conduit - ${def.label}` : 'Conduit';
      return;
    }
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (!tab) return;
    if (tab.type === 'collection' || tab.type === 'database') {
      document.title = `Conduit - ${tab.label}`;
    } else {
      document.title = 'Conduit';
    }
  });

  return (
    <div class="app-shell">
      <div class="app-tabbar">
        <Show when={isMac()}>
          <div class="titlebar-traffic-light-spacer" />
        </Show>
        <div class="app-tabs">
          <For each={state.tabs}>
            {(tab, idx) => (
              <button
                class={`app-tab ${!showingPinned() && state.activeTabId === tab.id ? 'active' : ''}`}
                onClick={() => {
                  actions.togglePinnedTab(null);
                  actions.activateTab(tab.id);
                }}
                draggable="true"
                onDragStart={(e) => onTabDragStart(e, idx())}
                onDragEnd={onTabDragEnd}
                onDragOver={(e) => onTabDragOver(e, idx())}
                onDrop={(e) => onTabDrop(e, idx())}
              >
                <Icon name={tab.icon} />
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
          <button
            class="app-tab app-tab-add"
            onClick={() => {
              actions.togglePinnedTab(null);
              actions.createTab('new');
            }}
            title="New Tab"
          >
            <Icon name="fa-solid fa-plus" />
          </button>
        </div>
        <div class="app-tab-pinned">
          {PINNED_TOOLS.map((tool) => (
            <button
              class={`btn btn-ghost btn-xs app-tab-pinned-btn ${state.pinnedTab === tool.type ? 'active' : ''}`}
              onClick={() => actions.togglePinnedTab(tool.type)}
              title={tool.label}
            >
              <Icon name={tool.icon} />
            </button>
          ))}
          <button
            class="btn btn-ghost btn-xs app-tab-settings"
            onClick={() => showSettings()}
          >
            <Icon name="fa-solid fa-gear" />
          </button>
        </div>
        <Show when={!isMac()}>
          <div class="titlebar-controls">
            <button class="titlebar-btn" onClick={() => window.api.windowMinimize()}>
              <Icon name="fa-solid fa-minus" />
            </button>
            <button class="titlebar-btn" onClick={() => window.api.windowMaximize()}>
              <Icon name="fa-regular fa-square" />
            </button>
            <button class="titlebar-btn titlebar-btn-close" onClick={() => window.api.windowClose()}>
              <Icon name="fa-solid fa-xmark" />
            </button>
          </div>
        </Show>
      </div>

      <For each={state.tabs}>
        {(tab) => {
          const style = () => ({ display: !showingPinned() && state.activeTabId === tab.id ? '' : 'none' });
          return (
            <Switch fallback={<NewTabPage tabId={tab.id} style={style()} />}>
              <Match when={tab.type === 'new'}>
                <NewTabPage tabId={tab.id} style={style()} />
              </Match>
              <Match when={tab.type === 'api'}>
                <Landing onOpen={(id, name) => openCollection(id, name)} style={style()} />
              </Match>
              <Match when={tab.type === 'collection'}>
                <Collection id={tab.collectionId} onBack={() => actions.replaceTab(tab.id, 'api')} style={style()} />
              </Match>
              <Match when={tab.type === 'db'}>
                <DatabaseClient onOpenDb={(connData) => openDatabase(connData)} style={style()} />
              </Match>
              <Match when={tab.type === 'database'}>
                <DatabaseWorkspace connData={tab.connData} onBack={() => actions.replaceTab(tab.id, 'db')} style={style()} />
              </Match>
              <Match when={tab.type === 'rfc'}>
                <RfcViewer style={style()} />
              </Match>
            </Switch>
          );
        }}
      </For>
      <DateTimeTool style={{ display: state.pinnedTab === 'datetime' ? '' : 'none' }} />
      <Drop style={{ display: state.pinnedTab === 'drop' ? '' : 'none' }} />
    </div>
  );
}
