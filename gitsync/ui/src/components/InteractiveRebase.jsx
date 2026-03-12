import { For, createSignal } from 'solid-js';
import Icon from './Icon';
import { useWorkspace } from '../context/WorkspaceContext';

const ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop'];

export default function InteractiveRebase() {
  const ws = useWorkspace();
  const state = () => ws.interactiveRebase();
  const [dragIdx, setDragIdx] = createSignal(null);

  function setAction(idx, action) {
    const commits = [...state().commits];
    commits[idx] = { ...commits[idx], action };
    ws.setInteractiveRebase({ ...state(), commits });
  }

  function moveCommit(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= state().commits.length) return;
    const commits = [...state().commits];
    const [item] = commits.splice(fromIdx, 1);
    commits.splice(toIdx, 0, item);
    ws.setInteractiveRebase({ ...state(), commits });
  }

  function onDragStart(e, idx) {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, idx) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function onDrop(e, idx) {
    e.preventDefault();
    const from = dragIdx();
    if (from !== null && from !== idx) {
      moveCommit(from, idx);
    }
    setDragIdx(null);
  }

  return (
    <div class="irebase-overlay" onClick={() => ws.cancelInteractiveRebase()}>
      <div class="irebase-panel" onClick={(e) => e.stopPropagation()}>
        <div class="irebase-header">
          <h3>Interactive Rebase</h3>
          <span class="irebase-hint">
            Rebase onto <code>{state().baseHash.substring(0, 8)}</code>
          </span>
        </div>

        <div class="irebase-list">
          <For each={state().commits}>{(commit, idx) => (
            <div
              class={`irebase-row ${dragIdx() === idx() ? 'irebase-dragging' : ''}`}
              draggable={true}
              onDragStart={(e) => onDragStart(e, idx())}
              onDragOver={(e) => onDragOver(e, idx())}
              onDrop={(e) => onDrop(e, idx())}
            >
              <div class="irebase-grip" title="Drag to reorder">
                <Icon name="fa-solid fa-grip-vertical" />
              </div>
              <select
                class={`irebase-action irebase-action-${commit.action}`}
                value={commit.action}
                onChange={(e) => setAction(idx(), e.target.value)}
              >
                <For each={ACTIONS}>{(a) => (
                  <option value={a}>{a}</option>
                )}</For>
              </select>
              <code class="irebase-hash">{commit.hash}</code>
              <span class="irebase-subject">{commit.subject}</span>
              <div class="irebase-move">
                <button
                  class="btn btn-ghost btn-xs"
                  onClick={() => moveCommit(idx(), idx() - 1)}
                  disabled={idx() === 0}
                  title="Move up"
                >
                  <Icon name="fa-solid fa-chevron-up" />
                </button>
                <button
                  class="btn btn-ghost btn-xs"
                  onClick={() => moveCommit(idx(), idx() + 1)}
                  disabled={idx() === state().commits.length - 1}
                  title="Move down"
                >
                  <Icon name="fa-solid fa-chevron-down" />
                </button>
              </div>
            </div>
          )}</For>
        </div>

        <div class="irebase-footer">
          <span class="irebase-count">{state().commits.length} commits</span>
          <div class="irebase-actions">
            <button class="btn btn-ghost btn-sm" onClick={() => ws.cancelInteractiveRebase()}>
              Cancel
            </button>
            <button class="btn btn-primary btn-sm" onClick={() => ws.executeInteractiveRebase()}>
              Start Rebase
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
