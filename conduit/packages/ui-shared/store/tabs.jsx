import { createContext, useContext } from 'solid-js';
import { createStore } from 'solid-js/store';

const TabContext = createContext();
export const useTabs = () => useContext(TabContext);

let nextId = 1;

function makeTab(type, tabTypes, extra) {
  const def = tabTypes[type] || tabTypes[Object.keys(tabTypes)[0]];
  return {
    id: 'tab-' + nextId++,
    type,
    icon: def.icon,
    label: def.label,
    ...extra,
  };
}

export function TabProvider(props) {
  const tabTypes = props.tabTypes;
  const pinnedTools = props.pinnedTools || [];
  const initialType = props.initialType || Object.keys(tabTypes)[0];
  const newTabType = props.newTabType || initialType;

  const [state, setState] = createStore({
    tabs: [makeTab(initialType, tabTypes)],
    activeTabId: 'tab-1',
    pinnedTab: null,
    tabTypes,
    pinnedTools,
  });

  function createTab(type, extra) {
    const tab = makeTab(type, tabTypes, extra);
    setState('tabs', (prev) => [...prev, tab]);
    setState('activeTabId', tab.id);
    return tab.id;
  }

  function closeTab(id) {
    const tabs = state.tabs;
    if (tabs.length === 1) {
      const tab = tabs[0];
      if (tab.type === initialType) {
        return 'quit';
      }
      const newTab = makeTab(initialType, tabTypes);
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
    const def = tabTypes[type] || tabTypes[initialType];
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
    initialType: () => initialType,
    newTabType: () => newTabType,
  };

  return (
    <TabContext.Provider value={[state, actions]}>
      {props.children}
    </TabContext.Provider>
  );
}
