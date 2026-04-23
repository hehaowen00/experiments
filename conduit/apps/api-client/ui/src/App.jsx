import { createEffect, For, Match, onCleanup, onMount, Switch } from 'solid-js';
import { Modal, TabBar, TabProvider, useTabs } from '@conduit/ui-shared';
import Collection from './pages/Collection';
import Landing from './pages/Landing';

const TAB_TYPES = {
  api: { icon: 'fa-solid fa-paper-plane', label: 'API Client' },
  new: { icon: '', label: 'New Tab' },
  collection: { icon: 'fa-solid fa-folder', label: 'Collection' },
};

export default function App() {
  return (
    <TabProvider tabTypes={TAB_TYPES} initialType="api" newTabType="new">
      <AppShell />
      <Modal />
    </TabProvider>
  );
}

function AppShell() {
  const [state, actions] = useTabs();

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      if (actions.closeTab(state.activeTabId) === 'quit') window.api.quit();
    }
  }

  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  function openCollection(id, name) {
    actions.replaceTab(state.activeTabId, 'collection', { collectionId: id, label: name });
  }

  createEffect(() => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (!tab) return;
    document.title =
      tab.type === 'collection' ? `Conduit — ${tab.label}` : 'Conduit API Client';
  });

  return (
    <div class="app-shell">
      <TabBar />
      <For each={state.tabs}>
        {(tab) => {
          const style = () => ({ display: state.activeTabId === tab.id ? '' : 'none' });
          return (
            <Switch fallback={<Landing onOpen={openCollection} style={style()} />}>
              <Match when={tab.type === 'api' || tab.type === 'new'}>
                <Landing onOpen={openCollection} style={style()} />
              </Match>
              <Match when={tab.type === 'collection'}>
                <Collection
                  id={tab.collectionId}
                  onBack={() => actions.replaceTab(tab.id, 'new')}
                  style={style()}
                />
              </Match>
            </Switch>
          );
        }}
      </For>
    </div>
  );
}
