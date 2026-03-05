import { createSignal } from 'solid-js';
import Landing from './pages/Landing';
import Collection from './pages/Collection';

export default function App() {
  const [page, setPage] = createSignal({ type: 'landing' });

  function openCollection(id) {
    setPage({ type: 'collection', id });
  }

  function goHome() {
    setPage({ type: 'landing' });
  }

  return (
    <>
      {page().type === 'landing' && <Landing onOpen={openCollection} />}
      {page().type === 'collection' && <Collection id={page().id} onBack={goHome} />}
    </>
  );
}
