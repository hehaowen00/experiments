import { Show, For } from 'solid-js';
import Icon from '../components/Icon';
import { useWorkspace } from '../context/WorkspaceContext';

export default function RemotesPanel() {
  const ws = useWorkspace();

  return (
    <div class="git-remotes-panel">
      <div class="git-section">
        <div class="git-section-header">
          <span>Remotes</span>
          <button class="btn btn-ghost btn-xs" onClick={ws.addRemote} title="Add remote">
            <Icon name="fa-solid fa-plus" /> Add
          </button>
        </div>
        <Show when={ws.remotes.list.length === 0 && !ws.remotes.loading}>
          <div class="git-empty">No remotes configured</div>
        </Show>
        <For each={ws.remotes.list}>{(r) => (
          <div class="git-remote-item">
            <div class="git-remote-name">{r.name}</div>
            <div class="git-remote-urls">
              <div class="git-remote-url" onClick={() => ws.editRemoteUrl(r.name, r.fetch)} title="Click to edit URL">
                <span class="git-remote-url-label">fetch</span>
                <span class="git-remote-url-value">{r.fetch}</span>
              </div>
              <Show when={r.push && r.push !== r.fetch}>
                <div class="git-remote-url">
                  <span class="git-remote-url-label">push</span>
                  <span class="git-remote-url-value">{r.push}</span>
                </div>
              </Show>
            </div>
            <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={() => ws.removeRemote(r.name)} title={`Remove remote ${r.name}`}>
              <Icon name="fa-solid fa-trash" />
            </button>
          </div>
        )}</For>
      </div>

      <div class="git-section" style={{ 'margin-top': '16px' }}>
        <div class="git-section-header">
          <span>Local Branches</span>
          <button class="btn btn-ghost btn-xs" onClick={ws.createBranch} title="Create new branch">
            <Icon name="fa-solid fa-plus" /> New
          </button>
          <button class="btn btn-ghost btn-xs" onClick={ws.loadBranches} title="Refresh branches">
            <Icon name="fa-solid fa-rotate" />
          </button>
        </div>
        <For each={ws.branches.list.filter(b => !b.remote)}>{(b) => (
          <div class={`git-branch-item ${b.current ? 'git-branch-current' : ''}`}>
            <Show when={b.current}><Icon name="fa-solid fa-circle" class="git-branch-dot" /></Show>
            <span class="git-branch-name">{b.name}</span>
            <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doRenameBranch(b.name)} title={`Rename ${b.name}`}>
              <Icon name="fa-solid fa-pen" />
            </button>
            <Show when={!b.current}>
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doMerge(b.name)} title={`Merge ${b.name} into ${ws.status.branch}`}>
                <Icon name="fa-solid fa-code-merge" />
              </button>
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doRebase(b.name)} title={`Rebase ${ws.status.branch} onto ${b.name}`}>
                <Icon name="fa-solid fa-arrow-right-arrow-left" />
              </button>
              <button class="btn btn-ghost btn-xs git-branch-checkout" onClick={() => ws.checkoutBranch(b.name)} title={`Checkout ${b.name}`}>
                <Icon name="fa-solid fa-right-to-bracket" />
              </button>
              <button class="btn btn-ghost btn-xs btn-danger-hover git-branch-action" onClick={() => ws.doDeleteBranch(b.name)} title={`Delete ${b.name}`}>
                <Icon name="fa-solid fa-trash" />
              </button>
            </Show>
          </div>
        )}</For>
      </div>

      <div class="git-section" style={{ 'margin-top': '16px' }}>
        <div class="git-section-header">
          <span>Remote Branches</span>
        </div>
        <For each={ws.branches.list.filter(b => b.remote && !b.name.includes('/HEAD'))}>{(b) => {
          const shortName = b.name.replace(/^remotes\//, '');
          return (
            <div class="git-branch-item">
              <Icon name="fa-solid fa-cloud" class="git-branch-dot" style={{ 'font-size': '8px', opacity: 0.5 }} />
              <span class="git-branch-name">{shortName}</span>
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doMerge(b.name)} title={`Merge ${shortName} into ${ws.status.branch}`}>
                <Icon name="fa-solid fa-code-merge" />
              </button>
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doRebase(b.name)} title={`Rebase ${ws.status.branch} onto ${shortName}`}>
                <Icon name="fa-solid fa-arrow-right-arrow-left" />
              </button>
              <button class="btn btn-ghost btn-xs git-branch-checkout" onClick={() => ws.checkoutRemoteBranch(b.name)} title={`Checkout ${shortName} to local`}>
                <Icon name="fa-solid fa-download" />
              </button>
            </div>
          );
        }}</For>
      </div>
    </div>
  );
}
