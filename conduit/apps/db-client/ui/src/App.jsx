import { createEffect, For, Match, onCleanup, onMount, Switch } from 'solid-js';
import { Modal, TabBar, TabProvider, useTabs } from '@conduit/ui-shared';
import DatabaseClient from './pages/DatabaseClient';
import DatabaseWorkspace from './pages/DatabaseWorkspace';

const TAB_TYPES = {
  db: { icon: 'fa-solid fa-database', label: 'Databases' },
  new: { icon: '', label: 'New Tab' },
  database: { icon: 'fa-solid fa-database', label: 'Database' },
};

export default function App() {
  return (
    <TabProvider tabTypes={TAB_TYPES} initialType="db" newTabType="new">
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

  function openDatabase(connData) {
    actions.replaceTab(state.activeTabId, 'database', { connData, label: connData.name });
  }

  createEffect(() => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (!tab) return;
    document.title =
      tab.type === 'database' ? `Conduit — ${tab.label}` : 'Conduit DB Client';
  });

  return (
    <div class="app-shell">
      <TabBar />
      <For each={state.tabs}>
        {(tab) => {
          const style = () => ({ display: state.activeTabId === tab.id ? '' : 'none' });
          return (
            <Switch fallback={<DatabaseClient onOpenDb={openDatabase} style={style()} />}>
              <Match when={tab.type === 'db' || tab.type === 'new'}>
                <DatabaseClient onOpenDb={openDatabase} style={style()} />
              </Match>
              <Match when={tab.type === 'database'}>
                <DatabaseWorkspace
                  connData={tab.connData}
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
