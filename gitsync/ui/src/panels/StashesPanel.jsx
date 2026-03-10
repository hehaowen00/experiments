import { Show, For } from 'solid-js';
import Icon from '../components/Icon';
import { useWorkspace } from '../context/WorkspaceContext';
import { parseDiffLines, DiffLine } from '../utils/diff';

export default function StashesPanel() {
  const ws = useWorkspace();

  return (
    <div class="git-stashes-panel">
      <div class="git-section">
        <div class="git-section-header">
          <span>Stashes</span>
          <button class="btn btn-ghost btn-xs" onClick={ws.doStashPush}>
            <Icon name="fa-solid fa-plus" /> Stash
          </button>
          <button class="btn btn-ghost btn-xs" onClick={ws.loadStashes}>
            <Icon name="fa-solid fa-rotate" />
          </button>
        </div>
        <Show when={ws.stashes.list.length === 0 && !ws.stashes.loading}>
          <div class="git-empty">No stashes</div>
        </Show>
        <For each={ws.stashes.list}>{(s) => (
          <div class="git-stash-item">
            <div class="git-stash-info" onClick={() => ws.viewStashDiff(s.ref)}>
              <span class="git-stash-ref">{s.ref}</span>
              <span class="git-stash-message">{s.message}</span>
              <span class="git-stash-date">{new Date(s.date).toLocaleDateString()}</span>
            </div>
            <div class="git-stash-actions">
              <button class="btn btn-ghost btn-xs" onClick={() => ws.doStashApply(s.ref)} title="Apply (keep stash)">
                <Icon name="fa-solid fa-paste" />
              </button>
              <button class="btn btn-ghost btn-xs" onClick={() => ws.doStashPop(s.ref)} title="Pop (apply & drop)">
                <Icon name="fa-solid fa-arrow-up-from-bracket" />
              </button>
              <button class="btn btn-ghost btn-xs btn-danger-hover" onClick={() => ws.doStashDrop(s.ref)} title="Drop">
                <Icon name="fa-solid fa-trash" />
              </button>
            </div>
          </div>
        )}</For>
      </div>
      <Show when={ws.stashDetail.ref}>
        <div class="git-stash-diff">
          <div class="git-diff-header">
            <span class="git-diff-filepath">{ws.stashDetail.ref}</span>
            <button class="btn btn-ghost btn-xs" onClick={() => ws.setStashDetail({ ref: null, diff: '' })}>
              <Icon name="fa-solid fa-xmark" />
            </button>
          </div>
          <pre class="git-diff-content">
            <For each={parseDiffLines(ws.stashDetail.diff)}>{(l) => <DiffLine line={l} />}</For>
          </pre>
        </div>
      </Show>
    </div>
  );
}
