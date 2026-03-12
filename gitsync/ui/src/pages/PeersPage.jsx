import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import Icon from '../components/Icon';
import { showAlert, showPrompt } from '../components/Modal';

export default function PeersPage(props) {
  const [identity, setIdentity] = createSignal(null);
  const [peers, setPeers] = createStore([]);
  const [sharedRepos, setSharedRepos] = createStore([]);
  const [pendingRequests, setPendingRequests] = createSignal(0);

  async function refresh() {
    const [id, peerList, shared] = await Promise.all([
      window.api.p2pGetIdentity(),
      window.api.p2pPeerList(),
      window.api.p2pGetSharedRepos(),
    ]);
    setIdentity(id);
    setPeers(peerList);
    setSharedRepos(shared);
    setPendingRequests(peerList.filter((p) => p.status === 'request_received').length);
  }

  onMount(() => {
    refresh();
  });

  const unsub = window.api.onP2pPeersChanged(() => refresh());
  const unsub2 = window.api.onP2pFriendRequest(() => refresh());
  onCleanup(() => { unsub(); unsub2(); });

  async function toggleEnabled() {
    const id = identity();
    await window.api.p2pSetEnabled(!id.enabled);
    refresh();
  }

  async function editName() {
    const name = await showPrompt('Device Name', identity()?.displayName || '', '', 'Display name');
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed) {
      await window.api.p2pSetDisplayName(trimmed);
      refresh();
    }
  }

  async function sendRequest(peerId) {
    const result = await window.api.p2pSendFriendRequest(peerId);
    if (result.error) await showAlert('Error', result.error);
    refresh();
  }

  async function respond(peerId, accepted) {
    await window.api.p2pRespondFriendRequest(peerId, accepted);
    refresh();
  }

  async function blockPeer(peerId) {
    await window.api.p2pBlockPeer(peerId);
    refresh();
  }

  async function unblockPeer(peerId) {
    await window.api.p2pUnblockPeer(peerId);
    refresh();
  }

  async function removePeer(peerId) {
    await window.api.p2pRemovePeer(peerId);
    refresh();
  }

  async function toggleShared(repoId, currentlyShared) {
    await window.api.p2pSetRepoShared(repoId, !currentlyShared);
    refresh();
  }

  const incoming = () => peers.filter((p) => p.status === 'request_received');
  const friends = () => peers.filter((p) => p.status === 'accepted');
  const discovered = () => peers.filter((p) => p.status === 'discovered');
  const pending = () => peers.filter((p) => p.status === 'request_sent');
  const blocked = () => peers.filter((p) => p.status === 'blocked');

  return (
    <div class="peers-page">
      <div class="peers-header">
        <button class="btn btn-ghost btn-sm" onClick={props.onBack}>
          <Icon name="fa-solid fa-arrow-left" /> Back
        </button>
        <h2>Peers</h2>
      </div>

      <div class="peers-content">
        {/* Identity Section */}
        <div class="peers-section">
          <div class="peers-section-title">My Identity</div>
          <Show when={identity()}>
            <div class="peer-identity-card">
              <div class="peer-identity-row">
                <span class="peer-identity-label">Name</span>
                <span class="peer-identity-value">
                  {identity().displayName}
                  <button class="btn btn-ghost btn-xs" onClick={editName}>
                    <Icon name="fa-solid fa-pen" />
                  </button>
                </span>
              </div>
              <div class="peer-identity-row">
                <span class="peer-identity-label">Peer ID</span>
                <span class="peer-identity-value peer-id-mono">{identity().peerId?.slice(0, 12)}...</span>
              </div>
              <div class="peer-identity-row">
                <span class="peer-identity-label">Status</span>
                <label class="peer-toggle">
                  <input type="checkbox" checked={identity().enabled} onChange={toggleEnabled} />
                  <span>{identity().enabled ? 'Online' : 'Offline'}</span>
                </label>
              </div>
            </div>
          </Show>
        </div>

        {/* Incoming Requests */}
        <Show when={incoming().length > 0}>
          <div class="peers-section">
            <div class="peers-section-title">
              Incoming Requests
              <span class="peer-badge">{incoming().length}</span>
            </div>
            <For each={incoming()}>{(peer) => (
              <div class="peer-card">
                <div class="peer-card-info">
                  <span class="peer-name">{peer.name}</span>
                  <span class="peer-status-dot online" />
                </div>
                <div class="peer-card-actions">
                  <button class="btn btn-primary btn-xs" onClick={() => respond(peer.peer_id, true)}>Accept</button>
                  <button class="btn btn-ghost btn-xs" onClick={() => respond(peer.peer_id, false)}>Reject</button>
                  <button class="btn btn-danger btn-xs" onClick={() => blockPeer(peer.peer_id)}>Block</button>
                </div>
              </div>
            )}</For>
          </div>
        </Show>

        {/* Friends */}
        <Show when={friends().length > 0}>
          <div class="peers-section">
            <div class="peers-section-title">Friends</div>
            <For each={friends()}>{(peer) => (
              <div class="peer-card">
                <div class="peer-card-info">
                  <span class="peer-name">{peer.name}</span>
                  <span class={`peer-status-dot ${peer.online ? 'online' : 'offline'}`} />
                </div>
                <div class="peer-card-actions">
                  <button class="btn btn-primary btn-xs" onClick={() => props.onBrowseRepos(peer.peer_id, peer.name)} disabled={!peer.online}>
                    <Icon name="fa-solid fa-folder-open" /> Repos
                  </button>
                  <button class="btn btn-ghost btn-xs" onClick={() => removePeer(peer.peer_id)}>
                    <Icon name="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
            )}</For>
          </div>
        </Show>

        {/* Discovered Peers */}
        <Show when={discovered().length > 0}>
          <div class="peers-section">
            <div class="peers-section-title">Discovered</div>
            <For each={discovered()}>{(peer) => (
              <div class="peer-card">
                <div class="peer-card-info">
                  <span class="peer-name">{peer.name}</span>
                  <span class={`peer-status-dot ${peer.online ? 'online' : 'offline'}`} />
                </div>
                <div class="peer-card-actions">
                  <button class="btn btn-primary btn-xs" onClick={() => sendRequest(peer.peer_id)} disabled={!peer.online}>
                    <Icon name="fa-solid fa-user-plus" /> Add Friend
                  </button>
                </div>
              </div>
            )}</For>
          </div>
        </Show>

        {/* Pending */}
        <Show when={pending().length > 0}>
          <div class="peers-section">
            <div class="peers-section-title">Pending</div>
            <For each={pending()}>{(peer) => (
              <div class="peer-card">
                <div class="peer-card-info">
                  <span class="peer-name">{peer.name}</span>
                  <span class="peer-status-text">Waiting for response...</span>
                </div>
                <div class="peer-card-actions">
                  <button class="btn btn-ghost btn-xs" onClick={() => removePeer(peer.peer_id)}>
                    <Icon name="fa-solid fa-xmark" />
                  </button>
                </div>
              </div>
            )}</For>
          </div>
        </Show>

        {/* Blocked */}
        <Show when={blocked().length > 0}>
          <div class="peers-section">
            <div class="peers-section-title">Blocked</div>
            <For each={blocked()}>{(peer) => (
              <div class="peer-card">
                <div class="peer-card-info">
                  <span class="peer-name">{peer.name}</span>
                </div>
                <div class="peer-card-actions">
                  <button class="btn btn-ghost btn-xs" onClick={() => unblockPeer(peer.peer_id)}>Unblock</button>
                  <button class="btn btn-ghost btn-xs" onClick={() => removePeer(peer.peer_id)}>
                    <Icon name="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
            )}</For>
          </div>
        </Show>

        {/* Shared Repos */}
        <div class="peers-section">
          <div class="peers-section-title">Shared Repos</div>
          <Show when={sharedRepos.length === 0}>
            <div class="peers-empty">No repos to share. Add repos on the landing page first.</div>
          </Show>
          <For each={sharedRepos}>{(repo) => (
            <div class="peer-card">
              <div class="peer-card-info">
                <span class="peer-name">{repo.name}</span>
                <span class="peer-status-text">{repo.path}</span>
              </div>
              <div class="peer-card-actions">
                <label class="peer-share-toggle">
                  <input type="checkbox" checked={repo.shared} onChange={() => toggleShared(repo.id, repo.shared)} />
                  <span>{repo.shared ? 'Shared' : 'Not shared'}</span>
                </label>
              </div>
            </div>
          )}</For>
        </div>
      </div>
    </div>
  );
}
