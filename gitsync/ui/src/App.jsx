import { createSignal } from 'solid-js';
import GitClient from './pages/GitClient';
import GitWorkspace from './pages/GitWorkspace';
import Modal, { showSettings } from './components/Modal';
import Icon from './components/Icon';

export default function App() {
  const [page, setPage] = createSignal({ type: 'landing' });

  function openGit(repoData) {
    setPage({ type: 'none' });
    queueMicrotask(() => setPage({ type: 'git', repoData }));
  }

  function goHome() {
    setPage({ type: 'landing' });
    document.title = 'GitSync';
  }

  return (
    <>
      {page().type === 'landing' && (
        <div class="git-client" style={{ display: 'flex', 'flex-direction': 'column', height: '100vh' }}>
          <GitClient onOpenGit={openGit} />
          <Modal />
        </div>
      )}
      {page().type === 'git' && (
        <GitWorkspace repoData={page().repoData} onBack={goHome} onSwitchRepo={openGit} />
      )}
    </>
  );
}
