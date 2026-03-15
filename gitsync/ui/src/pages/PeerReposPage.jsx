import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import Icon from '../lib/Icon';
import { showAlert } from '../components/Modal';

export default function PeerReposPage(props) {
  const [repos, setRepos] = createStore([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [cloning, setCloning] = createSignal(null);
  const [cloneProgress, setCloneProgress] = createSignal(null);

  onMount(async () => {
    const unsub = window.api.onP2pCloneProgress((data) => {
      setCloneProgress(data);
    });
    onCleanup(() => unsub());
    await fetchRepos();
  });

  async function fetchRepos() {
    setLoading(true);
    setError(null);
    const result = await window.api.p2pFetchPeerRepos(props.peerId);
    if (result.error) {
      setError(result.error);
    } else {
      setRepos(result.repos || []);
    }
    setLoading(false);
  }

  async function cloneRepo(repo) {
    setCloning(repo.exportName);
    setCloneProgress(null);
    const result = await window.api.p2pCloneFromPeer(
      props.peerId,
      repo.exportName,
      repo.name,
      repo.originUrl,
    );
    setCloning(null);
    setCloneProgress(null);
    if (result.error) {
      await showAlert('Clone Failed', result.error);
    } else if (!result.canceled) {
      await showAlert('Cloned', `Repository cloned to ${result.path}\nBoth peers now have each other as remotes.`);
      await fetchRepos();
    }
  }

  return (
    <div class="peers-page">
      <div class="peers-header">
        <button class="btn btn-ghost btn-sm" onClick={props.onBack}>
          <Icon name="fa-solid fa-arrow-left" /> Back
        </button>
        <h2>{props.peerName}'s Repos</h2>
        <button
          class="btn btn-ghost btn-xs"
          onClick={fetchRepos}
          title="Refresh"
        >
          <Icon name="fa-solid fa-arrows-rotate" />
        </button>
      </div>

      <div class="peers-content">
        <Show when={loading()}>
          <div class="peers-empty">Loading...</div>
        </Show>

        <Show when={error()}>
          <div
            class="peers-empty peer-error-copyable"
            style={{ color: 'var(--danger)' }}
            title="Click to copy"
            onClick={() => navigator.clipboard.writeText(error())}
          >
            {error()}
          </div>
        </Show>

        <Show when={!loading() && !error() && repos.length === 0}>
          <div class="peers-empty">This peer hasn't shared any repos.</div>
        </Show>

        <For each={repos}>
          {(repo) => (
            <div class="peer-card" style={{ 'flex-direction': 'column', 'align-items': 'stretch' }}>
              <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}>
                <div class="peer-card-info">
                  <span class="peer-name">
                    <Icon name="fa-solid fa-code-branch" /> {repo.name}
                  </span>
                  <Show when={repo.local_path}>
                    <span class="pr-status-badge pr-status-merged" style={{ 'font-size': '10px' }}>synced</span>
                  </Show>
                </div>
                <div class="peer-card-actions">
                  <Show when={!repo.local_path}>
                    <button
                      class="btn btn-primary btn-xs"
                      onClick={() => cloneRepo(repo)}
                      disabled={cloning() === repo.exportName}
                    >
                      <Icon name="fa-solid fa-download" />
                      {cloning() === repo.exportName ? 'Cloning...' : 'Clone'}
                    </button>
                  </Show>
                </div>
              </div>

              <Show when={cloning() === repo.exportName && cloneProgress()}>
                <div class="clone-progress">
                  <div class="clone-progress-label">
                    {cloneProgress().phase}: {cloneProgress().percent}%
                    <Show when={cloneProgress().total > 0}>
                      {' '}({cloneProgress().current}/{cloneProgress().total})
                    </Show>
                  </div>
                  <div class="clone-progress-bar">
                    <div
                      class="clone-progress-fill"
                      style={{ width: `${cloneProgress().percent}%` }}
                    />
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
