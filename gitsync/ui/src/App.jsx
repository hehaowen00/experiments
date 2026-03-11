import { createSignal } from 'solid-js';
import GitClient from './pages/GitClient';
import GitWorkspace from './pages/GitWorkspace';
import PeersPage from './pages/PeersPage';
import PeerReposPage from './pages/PeerReposPage';
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

  function openPeers() {
    setPage({ type: 'peers' });
  }

  function openPeerRepos(peerId, peerName) {
    setPage({ type: 'peer-repos', peerId, peerName });
  }

  return (
    <>
      {page().type === 'landing' && (
        <div class="git-client" style={{ display: 'flex', 'flex-direction': 'column', height: '100vh' }}>
          <GitClient onOpenGit={openGit} onOpenPeers={openPeers} />
          <Modal />
        </div>
      )}
      {page().type === 'git' && (
        <GitWorkspace repoData={page().repoData} onBack={goHome} onSwitchRepo={openGit} />
      )}
      {page().type === 'peers' && (
        <div class="git-client" style={{ display: 'flex', 'flex-direction': 'column', height: '100vh' }}>
          <PeersPage onBack={goHome} onBrowseRepos={openPeerRepos} />
          <Modal />
        </div>
      )}
      {page().type === 'peer-repos' && (
        <div class="git-client" style={{ display: 'flex', 'flex-direction': 'column', height: '100vh' }}>
          <PeerReposPage peerId={page().peerId} peerName={page().peerName} onBack={openPeers} />
          <Modal />
        </div>
      )}
    </>
  );
}
