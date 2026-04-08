import { createSignal, For, Show, onMount } from 'solid-js';
import GitClient from './pages/GitClient';
import GitWorkspace from './pages/GitWorkspace';
import Modal from './components/Modal';
import Icon from './lib/Icon';

export default function App() {
  const [tabs, setTabs] = createSignal([]);
  const [activeTab, setActiveTab] = createSignal(null); // null = landing
  const [isMac, setIsMac] = createSignal(true);

  onMount(async () => {
    const platform = await window.api.platform();
    setIsMac(platform === 'darwin');
  });

  function openGit(repoData) {
    const existing = tabs().find((t) => t.path === repoData.path);
    if (existing) {
      setActiveTab(existing.path);
      return;
    }
    setTabs((prev) => [...prev, repoData]);
    setActiveTab(repoData.path);
  }

  function closeTab(e, path) {
    e.stopPropagation();
    const current = tabs();
    const idx = current.findIndex((t) => t.path === path);
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

  function switchRepo(repoData) {
    openGit(repoData);
  }

  function goHome() {
    setActiveTab(null);
    document.title = 'GitSync';
  }

  // --- Tab drag reorder ---
  let dragTabPath = null;
  const [dropIndicator, setDropIndicator] = createSignal(null);

  function onTabDragStart(e, path) {
    dragTabPath = path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
    e.currentTarget.classList.add('dragging');
  }

  function onTabDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragTabPath = null;
    setDropIndicator(null);
  }

  function onTabDragOver(e, path) {
    if (!dragTabPath || dragTabPath === path) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    setDropIndicator({ path, side: e.clientX < mid ? 'left' : 'right' });
  }

  function onTabDragLeave() {
    setDropIndicator(null);
  }

  function onTabDrop(e, targetPath) {
    e.preventDefault();
    setDropIndicator(null);
    if (!dragTabPath || dragTabPath === targetPath) return;

    const current = [...tabs()];
    const fromIdx = current.findIndex((t) => t.path === dragTabPath);
    const toIdx = current.findIndex((t) => t.path === targetPath);
    if (fromIdx === -1 || toIdx === -1) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    let insertIdx = e.clientX < mid ? toIdx : toIdx + 1;
    if (fromIdx < insertIdx) insertIdx--;

    const [moved] = current.splice(fromIdx, 1);
    current.splice(insertIdx, 0, moved);
    setTabs(current);
    dragTabPath = null;
  }

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div class="app-tabbar">
        <Show when={isMac()}>
          <div class="titlebar-traffic-light-spacer" />
        </Show>
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
              classList={{
                'drag-over-left': dropIndicator()?.path === tab.path && dropIndicator()?.side === 'left',
                'drag-over-right': dropIndicator()?.path === tab.path && dropIndicator()?.side === 'right',
              }}
              onClick={() => setActiveTab(tab.path)}
              title={tab.path}
              draggable="true"
              onDragStart={(e) => onTabDragStart(e, tab.path)}
              onDragEnd={onTabDragEnd}
              onDragOver={(e) => onTabDragOver(e, tab.path)}
              onDragLeave={onTabDragLeave}
              onDrop={(e) => onTabDrop(e, tab.path)}
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
    </div>
  );
}
