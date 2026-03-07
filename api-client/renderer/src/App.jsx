import { createSignal } from 'solid-js';
import t from './locale';
import Collection from './pages/Collection';
import Landing from './pages/Landing';

export default function App() {
  const [page, setPage] = createSignal({ type: 'landing' });

  function openCollection(id) {
    setPage({ type: 'collection', id });
  }

  function goHome() {
    setPage({ type: 'landing' });
    document.title = t.app.name;
  }

  return (
    <>
      {page().type === 'landing' && <Landing onOpen={openCollection} />}
      {page().type === 'collection' && <Collection id={page().id} onBack={goHome} />}
    </>
  );
}
