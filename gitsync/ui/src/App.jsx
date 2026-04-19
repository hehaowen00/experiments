import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import GitClient from './pages/GitClient';
import GitWorkspace from './pages/GitWorkspace';
import Modal from './components/Modal';
import Toast from './components/Toast';
import Icon from './lib/Icon';

export default function App() {
  const [tabs, setTabs] = createSignal([]);
  const [activeTab, setActiveTab] = createSignal(null); // null = landing

  function openGit(repoData) {
    const existing = tabs().find((t) => t.path === repoData.path);
    if (existing) {
      setActiveTab(existing.path);
      return;
    }
    setTabs((prev) => [...prev, repoData]);
    setActiveTab(repoData.path);
  }

  function closeTabByPath(path) {
    const current = tabs();
    const idx = current.findIndex((t) => t.path === path);
    if (idx === -1) return;
    const next = current.filter((t) => t.path !== path);
    setTabs(next);
    if (activeTab() === path) {
      if (next.length === 0) {
        setActiveTab(null);
      } else {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTab(next[newIdx].path);
      }
    }
  }

  function closeTab(e, path) {
    e.stopPropagation();
    closeTabByPath(path);
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      const active = activeTab();
      if (active) {
        closeTabByPath(active);
      } else {
        window.api.windowClose();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      e.preventDefault();
      goHome();
    }
  }

  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  function switchRepo(repoData) {
    openGit(repoData);
  }

  function goHome() {
    setActiveTab(null);
    document.title = 'GitSync';
  }

  // --- Tab drag reorder ---
  let dragTabPath = null;

  let dragImageEl;
  function onTabDragStart(e, path) {
    dragTabPath = path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
    if (!dragImageEl) {
      dragImageEl = document.createElement('div');
      dragImageEl.style.cssText = 'position:absolute;top:-9999px;width:1px;height:1px;';
      document.body.appendChild(dragImageEl);
    }
    e.dataTransfer.setDragImage(dragImageEl, 0, 0);
    e.currentTarget.classList.add('dragging');
  }

  function onTabDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragTabPath = null;
  }

  function onTabDragOver(e, path) {
    if (!dragTabPath || dragTabPath === path) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const current = tabs();
    const fromIdx = current.findIndex((t) => t.path === dragTabPath);
    const toIdx = current.findIndex((t) => t.path === path);
    if (fromIdx === -1 || toIdx === -1) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    const insertBefore = e.clientX < mid;
    let insertIdx = insertBefore ? toIdx : toIdx + 1;
    if (fromIdx < insertIdx) insertIdx--;
    if (fromIdx === insertIdx) return;

    const next = [...current];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(insertIdx, 0, moved);
    setTabs(next);
  }

  function onTabDrop(e) {
    e.preventDefault();
    dragTabPath = null;
  }

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div class="app-tabbar">
        <div class="app-tabs">
          <button
            class={`app-tab ${activeTab() === null ? 'active' : ''}`}
            onClick={goHome}
            title="Repositories"
          >
            <Icon name="fa-solid fa-house" />
          </button>
          <For each={tabs()}>{(tab) => (
            <button
              class={`app-tab ${activeTab() === tab.path ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.path)}
              title={tab.path}
              draggable="true"
              onDragStart={(e) => onTabDragStart(e, tab.path)}
              onDragEnd={onTabDragEnd}
              onDragOver={(e) => onTabDragOver(e, tab.path)}
              onDrop={onTabDrop}
            >
              <Icon name="fa-solid fa-code-branch" />
              <span>{tab.name}</span>
              <span
                class="app-tab-close"
                onClick={(e) => closeTab(e, tab.path)}
              >
                <Icon name="fa-solid fa-xmark" />
              </span>
            </button>
          )}</For>
          <button
            class="app-tab app-tab-add"
            onClick={goHome}
            title="New Tab"
          >
            <Icon name="fa-solid fa-plus" />
          </button>
        </div>
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
      </div>

      {/* Landing page */}
      <div class="git-client" style={{
        display: activeTab() === null ? 'flex' : 'none',
        'flex-direction': 'column',
        flex: 1,
        overflow: 'hidden',
      }}>
        <GitClient onOpenGit={openGit} />
        <Modal />
      </div>

      {/* Repo workspaces (kept alive) */}
      <For each={tabs()}>{(tab) => (
        <div style={{
          display: activeTab() === tab.path ? 'flex' : 'none',
          'flex-direction': 'column',
          flex: 1,
          overflow: 'hidden',
        }}>
          <GitWorkspace
            repoData={tab}
            onBack={goHome}
            onSwitchRepo={switchRepo}
          />
        </div>
      )}</For>
      <Toast />
    </div>
  );
}
