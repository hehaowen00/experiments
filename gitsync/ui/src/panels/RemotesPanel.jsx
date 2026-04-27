import { Show, For, createSignal } from 'solid-js';
import FormModal, { FormField } from '../lib/FormModal';
import Icon from '../lib/Icon';
import Select from '../lib/Select';
import { showPrompt } from '../components/Modal';
import { useWorkspace } from '../context/WorkspaceContext';

export default function RemotesPanel() {
  const ws = useWorkspace();
  const [newTagOpen, setNewTagOpen] = createSignal(false);
  const [tagName, setTagName] = createSignal('');
  const [tagMessage, setTagMessage] = createSignal('');
  const [tagTarget, setTagTarget] = createSignal('');

  // Worktree form state
  const [wtFormOpen, setWtFormOpen] = createSignal(false);
  const [wtBranch, setWtBranch] = createSignal('');
  const [wtNewBranchName, setWtNewBranchName] = createSignal('');
  const [wtCreateNew, setWtCreateNew] = createSignal(false);
  const [wtDetach, setWtDetach] = createSignal(false);
  const [wtForce, setWtForce] = createSignal(false);
  const [wtNickname, setWtNickname] = createSignal('');
  const [wtPath, setWtPath] = createSignal('');
  const [wtError, setWtError] = createSignal('');
  const [wtPathEdited, setWtPathEdited] = createSignal(false);

  const hasRemotes = () => ws.remotes.list.length > 0;
  const localBranches = () => ws.branches.list.filter(b => !b.remote);
  const remoteBranches = () => ws.branches.list.filter(b => b.remote && !b.name.includes('/HEAD'));
  const hasTags = () => ws.tags.list.length > 0;
  const hasWorktrees = () => ws.worktrees.list.length > 1; // >1 because main worktree always exists

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

  function defaultWtPathFor(branch) {
    if (!branch) return '';
    const dirName = branch.replace(/\//g, '-');
    return ws.repoPath + '/.worktrees/' + dirName;
  }

  async function suggestPath(desired) {
    if (!desired) return '';
    const result = await window.api.gitSuggestWorktreePath(desired);
    return result.path || desired;
  }

  async function openWtForm() {
    const firstLocal = localBranches()[0];
    setWtBranch(firstLocal ? firstLocal.name : '');
    setWtNewBranchName('');
    setWtCreateNew(false);
    setWtDetach(false);
    setWtForce(false);
    setWtNickname('');
    setWtPath(firstLocal ? await suggestPath(defaultWtPathFor(firstLocal.name)) : '');
    setWtError('');
    setWtPathEdited(false);
    setWtFormOpen(true);
  }

  function closeWtForm() {
    setWtFormOpen(false);
  }

  async function browseWtPath() {
    const picked = await window.api.gitPickWorktreeFolder();
    if (picked) { setWtPathEdited(true); setWtPath(picked); }
  }

  async function submitWtForm() {
    const branch = wtCreateNew() ? wtNewBranchName().trim() : wtBranch().trim();
    if (!branch && !wtDetach()) { setWtError('Branch name is required.'); return; }
    const path = wtPath().trim();
    if (!path) { setWtError('Directory path is required.'); return; }
    setWtError('');
    const ok = await ws.addWorktree(branch, path, {
      createNew: wtCreateNew(),
      detach: wtDetach(),
      force: wtForce(),
      nickname: wtNickname(),
    });
    if (ok) closeWtForm();
  }

  async function renameWorktree(wt) {
    const current = wt.nickname || '';
    const next = await showPrompt(
      'Rename Worktree',
      current,
      `Nickname for ${wt.path}. Leave empty to clear.`,
      'Nickname',
    );
    if (next === null) return;
    ws.setWorktreeName(wt.path, next);
  }

  return (
    <div class="git-remotes-panel">
      <div class="git-section">
        <div class="git-section-header" onClick={() => ws.toggleSection('worktrees')}>
          <Icon name={!hasWorktrees() || ws.collapsedSections().has('worktrees') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
          <span>Worktrees ({Math.max(0, ws.worktrees.list.length - 1)})</span>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); openWtForm(); }} title="Add worktree">
            <Icon name="fa-solid fa-plus" /> Add
          </button>
          <Show when={hasWorktrees()}>
            <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.pruneWorktrees(); }} title="Prune stale worktrees">
              <Icon name="fa-solid fa-broom" />
            </button>
          </Show>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.loadWorktrees(); }} title="Refresh worktrees">
            <Icon name="fa-solid fa-rotate" />
          </button>
        </div>
        <Show when={hasWorktrees() && !ws.collapsedSections().has('worktrees')}>
          <For each={ws.worktrees.list.filter(wt => wt.path !== ws.repoPath)}>{(wt) => (
            <div class="git-worktree-item">
              <Icon name={wt.prunable ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-folder-tree'} class="git-worktree-icon" style={{ color: wt.prunable ? 'var(--warning)' : 'var(--text-dim)' }} />
              <div class="git-worktree-info">
                <span class="git-worktree-branch">
                  <Show when={wt.nickname}>
                    <span class="git-worktree-nickname">{wt.nickname}</span>
                    <span class="git-worktree-branch-sep"> · </span>
                  </Show>
                  {wt.branch || (wt.detached ? `detached @ ${wt.head?.slice(0, 7)}` : 'bare')}
                </span>
                <span class="git-worktree-path" title={wt.path}>{wt.path}</span>
              </div>
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => renameWorktree(wt)} title="Rename (nickname)">
                <Icon name="fa-solid fa-pen" />
              </button>
              <Show when={!wt.prunable}>
                <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.openWorktree(wt)} title="Open worktree">
                  <Icon name="fa-solid fa-arrow-up-right-from-square" />
                </button>
              </Show>
              <button class="btn btn-ghost btn-xs btn-danger-hover git-branch-action" onClick={() => ws.removeWorktree(wt.path)} title="Remove worktree" disabled={!!ws.operating()}>
                <Icon name="fa-solid fa-trash" />
              </button>
            </div>
          )}</For>
        </Show>
      </div>

      <div class="git-section" style={{ 'margin-top': '16px' }}>
        <div class="git-section-header" onClick={() => ws.toggleSection('remotes')}>
          <Icon name={!hasRemotes() || ws.collapsedSections().has('remotes') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
          <span>Remotes ({ws.remotes.list.length})</span>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.addRemote(); }} title="Add remote">
            <Icon name="fa-solid fa-plus" /> Add
          </button>
        </div>
        <Show when={hasRemotes() && !ws.collapsedSections().has('remotes')}>
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
          <Icon name={localBranches().length === 0 || ws.collapsedSections().has('local-branches') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
          <span>Local Branches ({localBranches().length})</span>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.createBranch(); }} title="Create new branch">
            <Icon name="fa-solid fa-plus" /> New
          </button>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.loadBranches(); }} title="Refresh branches">
            <Icon name="fa-solid fa-rotate" />
          </button>
        </div>
        <Show when={localBranches().length > 0 && !ws.collapsedSections().has('local-branches')}>
          <For each={localBranches()}>{(b) => (
            <div class={`git-branch-item ${b.current ? 'git-branch-current' : ''}`}>
              <Show when={b.current}><Icon name="fa-solid fa-circle" class="git-branch-dot" /></Show>
              <span class="git-branch-name">{b.name}</span>
              <Show when={b.ahead > 0}>
                <span class="git-branch-badge git-ahead" title={`${b.ahead} ahead`}>{b.ahead}<Icon name="fa-solid fa-arrow-up" /></span>
              </Show>
              <Show when={b.behind > 0}>
                <span class="git-branch-badge git-behind" title={`${b.behind} behind`}>{b.behind}<Icon name="fa-solid fa-arrow-down" /></span>
              </Show>
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doRenameBranch(b.name)} title={`Rename ${b.name}`} disabled={!!ws.operating()}>
                <Icon name="fa-solid fa-pen" />
              </button>
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doPushBranch(b.name)} title={`Push ${b.name} to remote`} disabled={!!ws.operating()}>
                <Icon name="fa-solid fa-upload" />
              </button>
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doResetToBranch(b.name)} title={`Reset current branch to ${b.name}`} disabled={!!ws.operating()}>
                <Icon name="fa-solid fa-backward" />
              </button>
              <Show when={!b.current}>
                <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doRebase(b.name)} title={`Rebase ${ws.status.branch} onto ${b.name}`} disabled={!!ws.operating()}>
                  <Icon name="fa-solid fa-arrow-right-arrow-left" />
                </button>
                <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doMerge(b.name)} title={`Merge ${b.name} into ${ws.status.branch}`} disabled={!!ws.operating()}>
                  <Icon name="fa-solid fa-code-merge" />
                </button>
                <button class="btn btn-ghost btn-xs git-branch-checkout" onClick={() => ws.checkoutBranch(b.name)} title={`Checkout ${b.name}`} disabled={!!ws.operating()}>
                  <Icon name="fa-solid fa-right-to-bracket" />
                </button>
                <button class="btn btn-ghost btn-xs btn-danger-hover git-branch-action" onClick={() => ws.doDeleteBranch(b.name)} title={`Delete ${b.name}`} disabled={!!ws.operating()}>
                  <Icon name="fa-solid fa-trash" />
                </button>
              </Show>
            </div>
          )}</For>
        </Show>
      </div>

      <div class="git-section" style={{ 'margin-top': '16px' }}>
        <div class="git-section-header" onClick={() => ws.toggleSection('remote-branches')}>
          <Icon name={remoteBranches().length === 0 || ws.collapsedSections().has('remote-branches') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
          <span>Remote Branches ({remoteBranches().length})</span>
        </div>
        <Show when={remoteBranches().length > 0 && !ws.collapsedSections().has('remote-branches')}>
          <For each={remoteBranches()}>{(b) => {
            const shortName = b.name.replace(/^remotes\//, '');
            return (
              <div class="git-branch-item">
                <Icon name="fa-solid fa-cloud" class="git-branch-dot" style={{ 'font-size': '8px', opacity: 0.5 }} />
                <span class="git-branch-name">{shortName}</span>
                <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doResetToBranch(b.name)} title={`Reset current branch to ${shortName}`} disabled={!!ws.operating()}>
                  <Icon name="fa-solid fa-backward" />
                </button>
                <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doRebase(b.name)} title={`Rebase ${ws.status.branch} onto ${shortName}`}>
                  <Icon name="fa-solid fa-arrow-right-arrow-left" />
                </button>
                <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => ws.doMerge(b.name)} title={`Merge ${shortName} into ${ws.status.branch}`}>
                  <Icon name="fa-solid fa-code-merge" />
                </button>
                <button class="btn btn-ghost btn-xs git-branch-checkout" onClick={() => ws.checkoutRemoteBranch(b.name)} title={`Checkout ${shortName} to local`} disabled={!!ws.operating()}>
                  <Icon name="fa-solid fa-download" />
                </button>
              </div>
            );
          }}</For>
        </Show>
      </div>

      <div class="git-section" style={{ 'margin-top': '16px' }}>
        <div class="git-section-header" onClick={() => ws.toggleSection('tags')}>
          <Icon name={!hasTags() || ws.collapsedSections().has('tags') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
          <span>Tags ({ws.tags.list.length})</span>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); setNewTagOpen(!newTagOpen()); }} title="Create new tag">
            <Icon name="fa-solid fa-plus" /> New
          </button>
          <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.loadTags(); }} title="Refresh tags">
            <Icon name="fa-solid fa-rotate" />
          </button>
        </div>
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
        <Show when={hasTags() && !ws.collapsedSections().has('tags')}>
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
              <button class="btn btn-ghost btn-xs git-branch-action" onClick={() => handlePushTag(t.name)} title={`Push tag ${t.name}`} disabled={!!ws.operating()}>
                <Icon name="fa-solid fa-upload" />
              </button>
              <button class="btn btn-ghost btn-xs btn-danger-hover git-branch-action" onClick={() => handleDeleteRemoteTag(t.name)} title={`Delete tag ${t.name} from remote`} disabled={!!ws.operating()}>
                <Icon name="fa-solid fa-cloud-arrow-down" />
              </button>
              <button class="btn btn-ghost btn-xs btn-danger-hover git-branch-action" onClick={() => ws.doDeleteTag(t.name)} title={`Delete tag ${t.name}`} disabled={!!ws.operating()}>
                <Icon name="fa-solid fa-trash" />
              </button>
            </div>
          )}</For>
        </Show>
      </div>

      <Show when={wtFormOpen()}>
        <FormModal
          title="Add Worktree"
          error={wtError()}
          submitLabel="Add"
          onClose={closeWtForm}
          onSubmit={submitWtForm}
        >
          <FormField label="Branch">
            <Show when={!wtCreateNew()} fallback={
              <input
                type="text"
                value={wtNewBranchName()}
                onInput={async (e) => {
                  setWtNewBranchName(e.target.value);
                  if (!wtPathEdited()) {
                    const base = wtNickname().trim() || e.target.value.trim();
                    setWtPath(await suggestPath(defaultWtPathFor(base)));
                  }
                }}
                placeholder="New branch name"
                onKeyDown={(e) => e.key === 'Enter' && submitWtForm()}
                autofocus
              />
            }>
              <Select
                class="select-full select-sm"
                value={wtBranch()}
                placeholder="Select a branch"
                options={[
                  ...localBranches().map((b) => ({ value: b.name, label: b.name })),
                  ...remoteBranches().map((b) => ({ value: b.name, label: b.name })),
                ]}
                onChange={async (v) => {
                  setWtBranch(v);
                  if (!wtPathEdited()) {
                    const base = wtNickname().trim() || v;
                    setWtPath(await suggestPath(defaultWtPathFor(base)));
                  }
                }}
              />
            </Show>
          </FormField>
          <FormField label="">
            <label style={{ display: 'inline-flex', 'align-items': 'center', gap: '6px', 'margin-right': '12px' }}>
              <input
                type="checkbox"
                checked={wtCreateNew()}
                onChange={(e) => {
                  setWtCreateNew(e.target.checked);
                  if (e.target.checked) setWtDetach(false);
                }}
              />
              Create new branch
            </label>
            <label style={{ display: 'inline-flex', 'align-items': 'center', gap: '6px', 'margin-right': '12px' }}>
              <input
                type="checkbox"
                checked={wtDetach()}
                disabled={wtCreateNew()}
                onChange={(e) => setWtDetach(e.target.checked)}
              />
              Detached
            </label>
            <label style={{ display: 'inline-flex', 'align-items': 'center', gap: '6px' }}>
              <input
                type="checkbox"
                checked={wtForce()}
                onChange={(e) => setWtForce(e.target.checked)}
              />
              Force
            </label>
          </FormField>
          <FormField label="Directory">
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={wtPath()}
                onInput={(e) => { setWtPathEdited(true); setWtPath(e.target.value); }}
                style={{ flex: 1 }}
                onKeyDown={(e) => e.key === 'Enter' && submitWtForm()}
              />
              <button class="btn btn-ghost btn-sm" onClick={browseWtPath} title="Browse">
                <Icon name="fa-solid fa-folder-open" />
              </button>
            </div>
          </FormField>
          <FormField label="Nickname">
            <input
              type="text"
              value={wtNickname()}
              onInput={async (e) => {
                setWtNickname(e.target.value);
                if (!wtPathEdited()) {
                  const base = e.target.value.trim() || (wtCreateNew() ? wtNewBranchName().trim() : wtBranch().trim());
                  setWtPath(await suggestPath(defaultWtPathFor(base)));
                }
              }}
              placeholder="Optional display name"
              onKeyDown={(e) => e.key === 'Enter' && submitWtForm()}
            />
          </FormField>
        </FormModal>
      </Show>
    </div>
  );
}
