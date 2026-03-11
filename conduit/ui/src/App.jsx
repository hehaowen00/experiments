import { createSignal, For, onMount } from 'solid-js';
import Icon from './components/Icon';
import Modal, { showSettings } from './components/Modal';
import t from './locale';
import Collection from './pages/Collection';
import Landing from './pages/Landing';
import DatabaseWorkspace from './pages/DatabaseWorkspace';

let nextPageId = 1;

export default function App() {
  const [activePage, setActivePage] = createSignal('landing');
  const [activeNav, setActiveNavRaw] = createSignal('api');
  const [openPages, setOpenPages] = createSignal([]);

  function setActiveNav(val) {
    setActiveNavRaw(val);
    setActivePage('landing');
    window.api.setSetting('lastActiveNav', val);
  }

  onMount(async () => {
    const saved = await window.api.getSetting('lastActiveNav');
    if (saved) setActiveNavRaw(saved);
  });

  function openCollection(id) {
    const existing = openPages().find((p) => p.type === 'collection' && p.collectionId === id);
    if (existing) {
      setActivePage(existing.pageId);
      return;
    }
    const pageId = 'page-' + nextPageId++;
    setOpenPages((prev) => [...prev, { pageId, type: 'collection', collectionId: id }]);
    setActivePage(pageId);
  }

  function openDatabase(connData) {
    const pageId = 'page-' + nextPageId++;
    setOpenPages((prev) => [...prev, { pageId, type: 'database', connData }]);
    setActivePage(pageId);
  }

  function closePage(pageId) {
    setOpenPages((prev) => prev.filter((p) => p.pageId !== pageId));
    if (activePage() === pageId) {
      setActivePage('landing');
      document.title = t.app.name;
    }
  }

  function goHome() {
    setActivePage('landing');
    document.title = t.app.name;
  }

  const isLanding = () => activePage() === 'landing';

  return (
    <div class="app-shell">
      <div class="app-tabbar">
        <div class="app-tabs">
          <button
            class={`app-tab ${isLanding() && activeNav() === 'api' ? 'active' : ''}`}
            onClick={() => setActiveNav('api')}
          >
            <Icon name="fa-solid fa-paper-plane" />
            <span>{t.landing.nav.apiClient}</span>
          </button>
          <button
            class={`app-tab ${isLanding() && activeNav() === 'database' ? 'active' : ''}`}
            onClick={() => setActiveNav('database')}
          >
            <Icon name="fa-solid fa-database" />
            <span>{t.landing.nav.database}</span>
          </button>
          <button
            class={`app-tab ${isLanding() && activeNav() === 'datetime' ? 'active' : ''}`}
            onClick={() => setActiveNav('datetime')}
          >
            <Icon name="fa-solid fa-clock" />
            <span>{t.landing.nav.dateTime}</span>
          </button>
          <button
            class={`app-tab ${isLanding() && activeNav() === 'drop' ? 'active' : ''}`}
            onClick={() => setActiveNav('drop')}
          >
            <Icon name="fa-solid fa-cloud-arrow-up" />
            <span>{t.landing.nav.drop}</span>
          </button>
          <For each={openPages()}>
            {(pg) => (
              <button
                class={`app-tab ${activePage() === pg.pageId ? 'active' : ''}`}
                onClick={() => setActivePage(pg.pageId)}
              >
                <Icon name={pg.type === 'collection' ? 'fa-solid fa-paper-plane' : 'fa-solid fa-database'} />
                <span class="app-tab-close" onClick={(e) => { e.stopPropagation(); closePage(pg.pageId); }}>
                  <Icon name="fa-solid fa-xmark" />
                </span>
              </button>
            )}
          </For>
        </div>
        {!isLanding() && (
          <button class="btn btn-ghost btn-xs app-tab-back" onClick={goHome} title="Back to home">
            <Icon name="fa-solid fa-arrow-left" />
          </button>
        )}
        <button class="btn btn-ghost btn-xs app-tab-settings" onClick={() => showSettings()}>
          <Icon name="fa-solid fa-gear" />
        </button>
      </div>

      <Landing
        activeNav={activeNav}
        onOpen={openCollection}
        onOpenDb={openDatabase}
        style={{ display: isLanding() ? '' : 'none' }}
      />
      <For each={openPages()}>
        {(pg) => (
          pg.type === 'collection'
            ? <Collection
                id={pg.collectionId}
                onBack={() => closePage(pg.pageId)}
                style={{ display: activePage() === pg.pageId ? '' : 'none' }}
              />
            : <DatabaseWorkspace
                connData={pg.connData}
                onBack={() => closePage(pg.pageId)}
                style={{ display: activePage() === pg.pageId ? '' : 'none' }}
              />
        )}
      </For>
      <Modal />
    </div>
  );
}
