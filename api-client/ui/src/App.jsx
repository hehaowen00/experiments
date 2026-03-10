import { createSignal } from 'solid-js';
import t from './locale';
import Collection from './pages/Collection';
import Landing from './pages/Landing';
import DatabaseWorkspace from './pages/DatabaseWorkspace';

export default function App() {
  const [page, setPage] = createSignal({ type: 'landing' });

  function openCollection(id) {
    setPage({ type: 'collection', id });
  }

  function openDatabase(connData) {
    setPage({ type: 'database', connData });
  }

  function goHome() {
    setPage({ type: 'landing' });
    document.title = t.app.name;
  }

  return (
    <>
      {page().type === 'landing' && (
        <Landing onOpen={openCollection} onOpenDb={openDatabase} />
      )}
      {page().type === 'collection' && (
        <Collection id={page().id} onBack={goHome} />
      )}
      {page().type === 'database' && (
        <DatabaseWorkspace connData={page().connData} onBack={goHome} />
      )}
    </>
  );
}
