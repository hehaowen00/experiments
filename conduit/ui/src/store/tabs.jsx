import { createContext, useContext } from 'solid-js';
import { createStore } from 'solid-js/store';

const TabContext = createContext();
export const useTabs = () => useContext(TabContext);

let nextId = 1;

export const TAB_TYPES = {
  'new':         { icon: 'fa-solid fa-plus',           label: 'New Tab' },
  'api':         { icon: 'fa-solid fa-paper-plane',    label: 'API Client' },
  'collection':  { icon: 'fa-solid fa-paper-plane',    label: 'Collection' },
  'db':          { icon: 'fa-solid fa-database',       label: 'Database' },
  'database':    { icon: 'fa-solid fa-database',       label: 'Database' },
  'datetime':    { icon: 'fa-solid fa-clock',          label: 'Date / Time' },
  'drop':        { icon: 'fa-solid fa-cloud-arrow-up', label: 'Drop' },
};

function makeTab(type, extra) {
  const def = TAB_TYPES[type] || TAB_TYPES['new'];
  return {
    id: 'tab-' + nextId++,
    type,
    icon: def.icon,
    label: def.label,
    ...extra,
  };
}

export const PINNED_TOOLS = [
  { type: 'datetime', icon: TAB_TYPES.datetime.icon, label: TAB_TYPES.datetime.label },
  { type: 'drop', icon: TAB_TYPES.drop.icon, label: TAB_TYPES.drop.label },
];

export function TabProvider(props) {
  const [state, setState] = createStore({
    tabs: [makeTab('new')],
    activeTabId: 'tab-1',
    pinnedTab: null, // 'datetime' | 'drop' | null
  });

  function createTab(type, extra) {
    const tab = makeTab(type, extra);
    setState('tabs', (prev) => [...prev, tab]);
    setState('activeTabId', tab.id);
    return tab.id;
  }

  function closeTab(id) {
    const tabs = state.tabs;
    if (tabs.length === 1) {
      const tab = tabs[0];
      if (tab.type === 'new') {
        return 'quit';
      }
      // Last non-new tab: replace with a new tab
      const newTab = makeTab('new');
      setState('tabs', [newTab]);
      setState('activeTabId', newTab.id);
      return 'new';
    }
    const idx = tabs.findIndex((t) => t.id === id);
    setState('tabs', (prev) => prev.filter((t) => t.id !== id));
    if (state.activeTabId === id) {
      const newIdx = Math.min(idx, state.tabs.length - 1);
      setState('activeTabId', state.tabs[newIdx].id);
    }
    return 'closed';
  }

  function activateTab(id) {
    setState('activeTabId', id);
  }

  function updateTab(id, updates) {
    setState('tabs', (t) => t.id === id, updates);
  }

  function replaceTab(id, type, extra) {
    const def = TAB_TYPES[type] || TAB_TYPES['new'];
    setState('tabs', (t) => t.id === id, {
      type,
      icon: def.icon,
      label: def.label,
      ...extra,
    });
  }

  function reorderTabs(fromIdx, toIdx) {
    setState('tabs', (prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  function togglePinnedTab(type) {
    if (type === null || state.pinnedTab === type) {
      setState('pinnedTab', null);
    } else {
      setState('pinnedTab', type);
    }
  }

  const actions = {
    createTab,
    closeTab,
    activateTab,
    updateTab,
    replaceTab,
    reorderTabs,
    togglePinnedTab,
  };

  return (
    <TabContext.Provider value={[state, actions]}>
      {props.children}
    </TabContext.Provider>
  );
}
