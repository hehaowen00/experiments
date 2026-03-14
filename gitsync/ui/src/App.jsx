import { createSignal } from 'solid-js';
import GitClient from './pages/GitClient';
import GitWorkspace from './pages/GitWorkspace';
import PeersPage from './pages/PeersPage';
import PeerReposPage from './pages/PeerReposPage';
import Modal, { showSettings } from './components/Modal';
import Icon from './components/Icon';
import Titlebar from './components/Titlebar';

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
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100vh' }}>
      {page().type === 'landing' && (
        <>
          <Titlebar title="GitSync" />
          <div class="git-client" style={{ display: 'flex', 'flex-direction': 'column', flex: 1, overflow: 'hidden' }}>
            <GitClient onOpenGit={openGit} onOpenPeers={openPeers} />
            <Modal />
          </div>
        </>
      )}
      {page().type === 'git' && (
        <GitWorkspace repoData={page().repoData} onBack={goHome} onSwitchRepo={openGit} />
      )}
      {page().type === 'peers' && (
        <>
          <Titlebar title="Peers" />
          <div class="git-client" style={{ display: 'flex', 'flex-direction': 'column', flex: 1, overflow: 'hidden' }}>
            <PeersPage onBack={goHome} onBrowseRepos={openPeerRepos} />
            <Modal />
          </div>
        </>
      )}
      {page().type === 'peer-repos' && (
        <>
          <Titlebar title={page().peerName || 'Peer Repos'} />
          <div class="git-client" style={{ display: 'flex', 'flex-direction': 'column', flex: 1, overflow: 'hidden' }}>
            <PeerReposPage peerId={page().peerId} peerName={page().peerName} onBack={openPeers} />
            <Modal />
          </div>
        </>
      )}
    </div>
  );
}
