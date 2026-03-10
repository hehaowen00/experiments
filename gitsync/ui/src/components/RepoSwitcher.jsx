import { Show, For } from 'solid-js';
import Icon from './Icon';
import { useWorkspace } from '../context/WorkspaceContext';
import { shortenPath } from '../utils/path';

export default function RepoSwitcher() {
  const ws = useWorkspace();
  let inputRef;

  function onKeyDown(e) {
    const list = ws.filteredSwitcherRepos();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      ws.setSwitcherIndex(i => Math.min(i + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      ws.setSwitcherIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && list.length > 0) {
      e.preventDefault();
      ws.switcherSelect(list[ws.switcherIndex()]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      ws.closeSwitcher();
    }
  }

  return (
    <Show when={ws.switcherOpen()}>
      <div class="git-switcher-overlay" onClick={ws.closeSwitcher}>
        <div class="git-switcher" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
          <div class="git-switcher-input-row">
            <Icon name="fa-solid fa-magnifying-glass" class="git-switcher-icon" />
            <input
              ref={(el) => { inputRef = el; requestAnimationFrame(() => el?.focus()); }}
              type="text"
              class="git-switcher-input"
              placeholder="Switch repository..."
              value={ws.switcherQuery()}
              onInput={(e) => { ws.setSwitcherQuery(e.target.value); ws.setSwitcherIndex(0); }}
            />
          </div>
          <div class="git-switcher-list">
            <Show when={ws.filteredSwitcherRepos().length === 0}>
              <div class="git-switcher-empty">No matching repos</div>
            </Show>
            <For each={ws.filteredSwitcherRepos()}>{(repo, idx) => (
              <button
                class={`git-switcher-item ${idx() === ws.switcherIndex() ? 'git-switcher-item-active' : ''}`}
                onClick={() => ws.switcherSelect(repo)}
                onMouseEnter={() => ws.setSwitcherIndex(idx())}
              >
                <Icon name="fa-solid fa-code-branch" class="git-switcher-item-icon" />
                <div class="git-switcher-item-text">
                  <span class="git-switcher-item-name">{repo.name}</span>
                  <span class="git-switcher-item-path">{shortenPath(repo.path)}</span>
                </div>
              </button>
            )}</For>
          </div>
        </div>
      </div>
    </Show>
  );
}
