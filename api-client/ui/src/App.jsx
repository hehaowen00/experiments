import { createSignal } from 'solid-js';
import t from './locale';
import Collection from './pages/Collection';
import Landing from './pages/Landing';
import DatabaseWorkspace from './pages/DatabaseWorkspace';
import GitWorkspace from './pages/GitWorkspace';

export default function App() {
  const [page, setPage] = createSignal({ type: 'landing' });

  function openCollection(id) {
    setPage({ type: 'collection', id });
  }

  function openDatabase(connData) {
    setPage({ type: 'database', connData });
  }

  function openGit(repoData) {
    // Force remount by briefly clearing the page so Solid destroys the old component
    setPage({ type: 'none' });
    queueMicrotask(() => setPage({ type: 'git', repoData }));
  }

  function goHome() {
    setPage({ type: 'landing' });
    document.title = t.app.name;
  }

  return (
    <>
      {page().type === 'landing' && (
        <Landing onOpen={openCollection} onOpenDb={openDatabase} onOpenGit={openGit} />
      )}
      {page().type === 'collection' && (
        <Collection id={page().id} onBack={goHome} />
      )}
      {page().type === 'database' && (
        <DatabaseWorkspace connData={page().connData} onBack={goHome} />
      )}
      {page().type === 'git' && (
        <GitWorkspace repoData={page().repoData} onBack={goHome} onSwitchRepo={openGit} />
      )}
    </>
  );
}
