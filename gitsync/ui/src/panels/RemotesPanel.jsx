import { Show, For, createSignal } from 'solid-js';
import Icon from '../components/Icon';
import { useWorkspace } from '../context/WorkspaceContext';

export default function RemotesPanel() {
  const ws = useWorkspace();
  const [newTagOpen, setNewTagOpen] = createSignal(false);
  const [tagName, setTagName] = createSignal('');
  const [tagMessage, setTagMessage] = createSignal('');
  const [tagTarget, setTagTarget] = createSignal('');

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return dateStr; }
  }

  async function handleCreateTag() {
    const name = tagName().trim();
    if (!name) return;
    await ws.doCreateTag(name, tagMessage().trim(), tagTarget().trim());
    setNewTagOpen(false);
    setTagName('');
    setTagMessage('');
    setTagTarget('');
  }

  async function handlePushTag(name) {
    const remote = await ws.pickRemote('Push Tag', 'Select which remote to push the tag to.');
    if (!remote) return;
    ws.doPushTag(remote, name);
  }

  async function handleDeleteRemoteTag(name) {
    const remote = await ws.pickRemote('Delete Remote Tag', 'Select which remote to delete the tag from.');
    if (!remote) return;
    ws.doDeleteRemoteTag(remote, name);
  }

  return (
    <div class="git-remotes-panel">
      <div class="git-section">
        <div class="git-section-header" onClick={() => ws.toggleSection('remotes')}>
          <Icon name={ws.collapsedSections().has('remotes') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
          <span>Remotes</span>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.addRemote(); }} title="Add remote">
            <Icon name="fa-solid fa-plus" /> Add
          </button>
        </div>
        <Show when={!ws.collapsedSections().has('remotes')}>
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
        </Show>
      </div>

      <div class="git-section" style={{ 'margin-top': '16px' }}>
        <div class="git-section-header" onClick={() => ws.toggleSection('local-branches')}>
          <Icon name={ws.collapsedSections().has('local-branches') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
          <span>Local Branches</span>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.createBranch(); }} title="Create new branch">
            <Icon name="fa-solid fa-plus" /> New
          </button>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.loadBranches(); }} title="Refresh branches">
            <Icon name="fa-solid fa-rotate" />
          </button>
        </div>
        <Show when={!ws.collapsedSections().has('local-branches')}>
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
        </Show>
      </div>

      <div class="git-section" style={{ 'margin-top': '16px' }}>
        <div class="git-section-header" onClick={() => ws.toggleSection('remote-branches')}>
          <Icon name={ws.collapsedSections().has('remote-branches') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
          <span>Remote Branches</span>
        </div>
        <Show when={!ws.collapsedSections().has('remote-branches')}>
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
        </Show>
      </div>

      <div class="git-section" style={{ 'margin-top': '16px' }}>
        <div class="git-section-header" onClick={() => ws.toggleSection('tags')}>
          <Icon name={ws.collapsedSections().has('tags') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
          <span>Tags</span>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setNewTagOpen(!newTagOpen()); }} title="Create new tag">
            <Icon name="fa-solid fa-plus" /> New
          </button>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.loadTags(); }} title="Refresh tags">
            <Icon name="fa-solid fa-rotate" />
          </button>
        </div>
        <Show when={!ws.collapsedSections().has('tags')}>
          <Show when={newTagOpen()}>
            <div class="git-tag-form">
              <input
                type="text"
                class="input input-sm"
                placeholder="Tag name (required)"
                value={tagName()}
                onInput={(e) => setTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
              />
              <input
                type="text"
                class="input input-sm"
                placeholder="Message (optional, makes annotated tag)"
                value={tagMessage()}
                onInput={(e) => setTagMessage(e.target.value)}
              />
              <input
                type="text"
                class="input input-sm"
                placeholder="Target (optional, defaults to HEAD)"
                value={tagTarget()}
                onInput={(e) => setTagTarget(e.target.value)}
              />
              <div class="git-tag-form-actions">
                <button class="btn btn-primary btn-sm" onClick={handleCreateTag} disabled={!tagName().trim()}>
                  Create Tag
                </button>
                <button class="btn btn-ghost btn-sm" onClick={() => setNewTagOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </Show>

          <Show when={ws.tags.list.length === 0 && !ws.tags.loading && !newTagOpen()}>
            <div class="git-empty">No tags</div>
          </Show>
          <For each={ws.tags.list}>{(t) => (
            <div class="git-tag-item">
              <Icon name="fa-solid fa-tag" class="git-tag-icon" />
              <div class="git-tag-info">
                <span class="git-tag-name">{t.name}</span>
                <Show when={t.message}>
                  <span class="git-tag-message" title={t.message}>{t.message}</span>
                </Show>
                <Show when={t.date}>
                  <span class="git-tag-date">{formatDate(t.date)}</span>
                </Show>
              </div>
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => handlePushTag(t.name)} title={`Push tag ${t.name}`}>
                <Icon name="fa-solid fa-upload" />
              </button>
              <button class="btn btn-ghost btn-xs btn-danger-hover git-branch-action" onClick={() => handleDeleteRemoteTag(t.name)} title={`Delete tag ${t.name} from remote`}>
                <Icon name="fa-solid fa-cloud-arrow-down" />
              </button>
              <button class="btn btn-ghost btn-xs btn-danger-hover git-branch-action" onClick={() => ws.doDeleteTag(t.name)} title={`Delete tag ${t.name}`}>
                <Icon name="fa-solid fa-trash" />
              </button>
            </div>
          )}</For>
        </Show>
      </div>
    </div>
  );
}
