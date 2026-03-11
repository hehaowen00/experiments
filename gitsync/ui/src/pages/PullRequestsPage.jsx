import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import Icon from '../components/Icon';
import { showAlert, showConfirm } from '../components/Modal';

export default function PullRequestsPage(props) {
  const [prs, setPrs] = createStore([]);
  const [loading, setLoading] = createSignal(true);
  const [expandedPr, setExpandedPr] = createSignal(null);
  const [diffText, setDiffText] = createSignal('');
  const [diffLoading, setDiffLoading] = createSignal(false);
  const [filter, setFilter] = createSignal('open');

  async function refresh() {
    setLoading(true);
    const list = await window.api.p2pListPullRequests();
    setPrs(list || []);
    setLoading(false);
  }

  onMount(() => refresh());

  const unsub = window.api.onP2pPullRequest(() => refresh());
  const unsub2 = window.api.onP2pPullRequestUpdated(() => refresh());
  onCleanup(() => { unsub(); unsub2(); });

  async function viewDiff(prId) {
    if (expandedPr() === prId) {
      setExpandedPr(null);
      return;
    }
    setExpandedPr(prId);
    setDiffLoading(true);
    setDiffText('');
    const result = await window.api.p2pPrDiff(prId);
    if (result.error) {
      setDiffText('Error loading diff: ' + result.error);
    } else {
      setDiffText(result.diff || '(no changes)');
    }
    setDiffLoading(false);
  }

  async function mergePr(prId) {
    const result = await window.api.p2pMergePullRequest(prId);
    if (result.error) {
      await showAlert('Merge Failed', result.error);
    }
    refresh();
  }

  async function closePr(prId) {
    const confirmed = await showConfirm('Close this pull request without merging?');
    if (!confirmed) return;
    const result = await window.api.p2pClosePullRequest(prId);
    if (result.error) {
      await showAlert('Error', result.error);
    }
    refresh();
  }

  const filtered = () => {
    const f = filter();
    if (f === 'all') return prs;
    return prs.filter((pr) => pr.status === f);
  };

  const counts = () => ({
    open: prs.filter((p) => p.status === 'open').length,
    merged: prs.filter((p) => p.status === 'merged').length,
    closed: prs.filter((p) => p.status === 'closed').length,
  });

  return (
    <div class="peers-page">
      <div class="peers-header">
        <button class="btn btn-ghost btn-sm" onClick={props.onBack}>
          <Icon name="fa-solid fa-arrow-left" /> Back
        </button>
        <h2>Pull Requests</h2>
        <button
          class="btn btn-ghost btn-xs"
          onClick={refresh}
          title="Refresh"
        >
          <Icon name="fa-solid fa-arrows-rotate" />
        </button>
      </div>

      <div class="pr-filters">
        <button
          class={`pr-filter-btn ${filter() === 'open' ? 'active' : ''}`}
          onClick={() => setFilter('open')}
        >
          Open ({counts().open})
        </button>
        <button
          class={`pr-filter-btn ${filter() === 'merged' ? 'active' : ''}`}
          onClick={() => setFilter('merged')}
        >
          Merged ({counts().merged})
        </button>
        <button
          class={`pr-filter-btn ${filter() === 'closed' ? 'active' : ''}`}
          onClick={() => setFilter('closed')}
        >
          Closed ({counts().closed})
        </button>
        <button
          class={`pr-filter-btn ${filter() === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
      </div>

      <div class="peers-content">
        <Show when={loading()}>
          <div class="peers-empty">Loading...</div>
        </Show>

        <Show when={!loading() && filtered().length === 0}>
          <div class="peers-empty">No pull requests.</div>
        </Show>

        <For each={filtered()}>
          {(pr) => (
            <div class="pr-card">
              <div class="pr-card-header">
                <div class="pr-card-info">
                  <span class={`pr-status-badge pr-status-${pr.status}`}>
                    {pr.status}
                  </span>
                  <span class="pr-title">{pr.title}</span>
                </div>
                <div class="pr-card-meta">
                  <span class="pr-meta-text">
                    {pr.from_peer_name} wants to merge
                    <code>{pr.branch}</code> into
                    <code>{pr.target_branch}</code>
                    on <strong>{pr.repo_name}</strong>
                  </span>
                </div>
              </div>

              <Show when={pr.message}>
                <div class="pr-description">{pr.message}</div>
              </Show>

              <div class="pr-card-actions">
                <button
                  class="btn btn-ghost btn-xs"
                  onClick={() => viewDiff(pr.id)}
                >
                  <Icon name="fa-solid fa-code" />
                  {expandedPr() === pr.id ? 'Hide Diff' : 'View Diff'}
                </button>

                <Show when={pr.status === 'open'}>
                  <button
                    class="btn btn-primary btn-xs"
                    onClick={() => mergePr(pr.id)}
                  >
                    <Icon name="fa-solid fa-code-merge" /> Merge
                  </button>
                  <button
                    class="btn btn-ghost btn-xs"
                    onClick={() => closePr(pr.id)}
                  >
                    <Icon name="fa-solid fa-xmark" /> Close
                  </button>
                </Show>
              </div>

              <Show when={expandedPr() === pr.id}>
                <div class="pr-diff-container">
                  <Show when={diffLoading()}>
                    <div class="peers-empty">Loading diff...</div>
                  </Show>
                  <Show when={!diffLoading()}>
                    <pre class="pr-diff">{diffText()}</pre>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
