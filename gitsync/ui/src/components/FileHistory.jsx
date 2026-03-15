import { Show, For } from 'solid-js';
import Icon from '../lib/Icon';
import { useWorkspace } from '../context/WorkspaceContext';
import { DiffLines } from '../utils/diff';

export default function FileHistory() {
  const ws = useWorkspace();
  const h = () => ws.fileHistory;

  return (
    <div class="fhistory-overlay" onClick={() => ws.closeFileHistory()}>
      <div class="fhistory-panel" onClick={(e) => e.stopPropagation()}>
        <div class="fhistory-header">
          <h3>File History</h3>
          <code class="fhistory-path">{h().filepath}</code>
          <div style={{ flex: 1 }} />
          <button class="btn btn-ghost btn-xs" onClick={() => ws.closeFileHistory()}>
            <Icon name="fa-solid fa-xmark" />
          </button>
        </div>

        <div class="fhistory-body">
          <div class="fhistory-commits">
            <Show when={h().loading}>
              <div class="fhistory-empty">Loading...</div>
            </Show>
            <Show when={!h().loading && h().commits.length === 0}>
              <div class="fhistory-empty">No history found</div>
            </Show>
            <For each={h().commits}>{(c) => (
              <div
                class={`fhistory-commit ${h().selectedHash === c.hash ? 'fhistory-commit-selected' : ''}`}
                onClick={() => ws.selectFileHistoryCommit(c.hash)}
              >
                <div class="fhistory-commit-top">
                  <code class="fhistory-commit-hash">{c.short}</code>
                  <span class="fhistory-commit-date">{new Date(c.date).toLocaleDateString()}</span>
                </div>
                <div class="fhistory-commit-subject">{c.subject}</div>
                <div class="fhistory-commit-author">{c.author}</div>
              </div>
            )}</For>
          </div>

          <div class="fhistory-diff">
            <Show when={!h().selectedHash}>
              <div class="fhistory-empty">Select a commit to view changes</div>
            </Show>
            <Show when={h().diffLoading}>
              <div class="fhistory-empty">Loading diff...</div>
            </Show>
            <Show when={h().selectedHash && !h().diffLoading && h().diff}>
              <pre class="git-diff-content fhistory-diff-content">
                <div class="git-diff-inner">
                  <DiffLines raw={h().diff} />
                </div>
              </pre>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
