import { Show, For, createSignal } from 'solid-js';
import Icon from '../components/Icon';
import FileTree from '../components/FileTree';
import { useWorkspace } from '../context/WorkspaceContext';
import { stagedFiles, unstagedFiles, untrackedFiles } from '../utils/status';
import { parseDiffLines, DiffLine } from '../utils/diff';

export default function ChangesPanel() {
  const ws = useWorkspace();

  const staged = () => stagedFiles(ws.status.files);
  const unstaged = () => unstagedFiles(ws.status.files);
  const untracked = () => untrackedFiles(ws.status.files);

  return (
    <div class="git-changes-panel">
      <div class="git-files-panel">
        <Show when={staged().length > 0}>
          <div class="git-section">
            <div class="git-section-header" onClick={() => ws.toggleSection('staged')}>
              <Icon name={ws.collapsedSections().has('staged') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
              <span>Staged ({staged().length})</span>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.unstageAll(); }} title="Unstage all">
                <Icon name="fa-solid fa-minus" /> All
              </button>
            </div>
            <Show when={!ws.collapsedSections().has('staged')}>
              <FileTree files={staged()} section="staged" />
            </Show>
          </div>
        </Show>

        <Show when={unstaged().length > 0}>
          <div class="git-section">
            <div class="git-section-header" onClick={() => ws.toggleSection('unstaged')}>
              <Icon name={ws.collapsedSections().has('unstaged') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
              <span>Changes ({unstaged().length})</span>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.stageAll(); }} title="Stage all">
                <Icon name="fa-solid fa-plus" /> All
              </button>
            </div>
            <Show when={!ws.collapsedSections().has('unstaged')}>
              <FileTree files={unstaged()} section="unstaged" />
            </Show>
          </div>
        </Show>

        <Show when={untracked().length > 0}>
          <div class="git-section">
            <div class="git-section-header" onClick={() => ws.toggleSection('untracked')}>
              <Icon name={ws.collapsedSections().has('untracked') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
              <span>Untracked ({untracked().length})</span>
              <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.stageAll(); }} title="Stage all">
                <Icon name="fa-solid fa-plus" /> All
              </button>
            </div>
            <Show when={!ws.collapsedSections().has('untracked')}>
              <FileTree files={untracked()} section="untracked" />
            </Show>
          </div>
        </Show>

        <Show when={ws.submodules().length > 0}>
          <div class="git-section">
            <div class="git-section-header" onClick={() => ws.toggleSection('submodules')}>
              <Icon name={ws.collapsedSections().has('submodules') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
              <span>Submodules ({ws.submodules().length})</span>
            </div>
            <Show when={!ws.collapsedSections().has('submodules')}>
              <For each={ws.submodules()}>{(sub) => (
                <div class="git-submodule-item">
                  <span class={`git-submodule-status git-submodule-${sub.status}`} title={sub.status}>
                    {sub.status === 'clean' ? '✓' : sub.status === 'dirty' ? '●' : '○'}
                  </span>
                  <Icon name={sub.type === 'submodule' ? 'fa-solid fa-cube' : 'fa-solid fa-folder-tree'} class="git-submodule-icon" />
                  <div class="git-submodule-info">
                    <span class="git-submodule-name">{sub.name}</span>
                    <span class="git-submodule-meta">
                      {sub.branch && <span class="git-submodule-branch"><Icon name="fa-solid fa-code-branch" /> {sub.branch}</span>}
                      <span class="git-submodule-type">{sub.type}</span>
                    </span>
                  </div>
                  <div class="git-submodule-actions">
                    <Show when={sub.status === 'not-initialized'}>
                      <button class="btn btn-ghost btn-xs" onClick={() => ws.initSubmodule(sub.path)} title="Initialize">
                        <Icon name="fa-solid fa-download" /> Init
                      </button>
                    </Show>
                    <Show when={sub.status !== 'not-initialized'}>
                      <button class="btn btn-ghost btn-xs" onClick={() => ws.openSubmodule(sub)} title="Open">
                        <Icon name="fa-solid fa-arrow-up-right-from-square" /> Open
                      </button>
                    </Show>
                  </div>
                </div>
              )}</For>
            </Show>
          </div>
        </Show>

        <Show when={ws.status.files.length === 0 && ws.submodules().length === 0 && !ws.status.loading}>
          <div class="git-empty">Working tree clean</div>
        </Show>

        <div class="git-section git-stashes-sidebar">
          <div class="git-section-header" onClick={() => ws.toggleSection('stashes')}>
            <Icon name={ws.collapsedSections().has('stashes') ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down'} class="git-section-chevron" />
            <span>Stashes{ws.stashes.list.length > 0 ? ` (${ws.stashes.list.length})` : ''}</span>
            <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.doStashPush(); }} title="Stash changes">
              <Icon name="fa-solid fa-plus" />
            </button>
          </div>
          <Show when={!ws.collapsedSections().has('stashes')}>
            <Show when={ws.stashes.list.length === 0 && !ws.stashes.loading}>
              <div class="git-empty">No stashes</div>
            </Show>
            <For each={ws.stashes.list}>{(s) => (
              <div class={`git-stash-item ${ws.stashDetail.ref === s.ref ? 'selected' : ''}`} onClick={() => ws.viewStashDiff(s.ref)}>
                <div class="git-stash-info">
                  <span class="git-stash-ref">{s.ref}</span>
                  <span class="git-stash-message">{s.message}</span>
                </div>
                <div class="git-stash-actions">
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.doStashApply(s.ref); }} title="Apply">
                    <Icon name="fa-solid fa-paste" />
                  </button>
                  <button class="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); ws.doStashPop(s.ref); }} title="Pop">
                    <Icon name="fa-solid fa-arrow-up-from-bracket" />
                  </button>
                  <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={(e) => { e.stopPropagation(); ws.doStashDrop(s.ref); }} title="Drop">
                    <Icon name="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
            )}</For>
          </Show>
        </div>
      </div>

      <div class="git-right-panel">
        <div class="git-diff-panel">
          <Show when={ws.stashDetail.ref} fallback={
            <Show when={ws.diff.filepath} fallback={
              <div class="git-empty">Select a file to view diff</div>
            }>
              <div class="git-diff-header">
                <span class="git-diff-filepath">{ws.diff.filepath}</span>
                <span class="git-diff-label">{ws.diff.staged ? 'Staged' : 'Working'}</span>
              </div>
              <pre class="git-diff-content">
                <For each={parseDiffLines(ws.diff.content)}>{(l) => <DiffLine line={l} />}</For>
              </pre>
            </Show>
          }>
            <div class="git-diff-header">
              <span class="git-diff-filepath">{ws.stashDetail.ref}</span>
              <button class="btn btn-ghost btn-xs" onClick={() => ws.setStashDetail({ ref: null, diff: '' })} title="Close stash diff">
                <Icon name="fa-solid fa-xmark" />
              </button>
            </div>
            <pre class="git-diff-content">
              <For each={parseDiffLines(ws.stashDetail.diff)}>{(l) => <DiffLine line={l} />}</For>
            </pre>
          </Show>
        </div>

        <div class="git-commit-box">
          <Show when={ws.identities().length > 0}>
            <select
              class="git-identity-select"
              value={ws.currentIdentity()?.id || ''}
              onChange={(e) => ws.setRepoIdentity(e.target.value || null)}
              title="Git identity for this repo"
            >
              <option value="">No identity</option>
              <For each={ws.identities()}>
                {(id) => <option value={id.id}>{id.name} &lt;{id.email}&gt;</option>}
              </For>
            </select>
          </Show>
          <input
            type="text"
            class="git-commit-subject"
            placeholder="Commit message"
            value={ws.commit.message}
            onInput={(e) => ws.setCommit('message', e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); ws.doCommit(); }
            }}
          />
          <textarea
            class="git-commit-description"
            placeholder="Description (optional)"
            value={ws.commit.description}
            onInput={(e) => ws.setCommit('description', e.target.value)}
            rows={3}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); ws.doCommit(); }
            }}
          />
          <div class="git-commit-actions">
            <label class="git-amend-label">
              <input type="checkbox" checked={ws.commit.amend} onChange={ws.toggleAmend} />
              Amend
            </label>
            <button
              class="btn btn-primary btn-sm"
              onClick={ws.doCommit}
              disabled={ws.commit.running || (!ws.commit.message.trim() && !ws.commit.amend)}
            >
              {ws.commit.running ? 'Committing...' : ws.commit.amend ? 'Amend Commit' : 'Commit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
