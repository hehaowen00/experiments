import { createSignal, createEffect, onCleanup, onMount, Show, For } from 'solid-js';
import ContextMenu from '../components/ContextMenu';
import FileHistory from '../components/FileHistory';
import Icon from '../lib/Icon';
import InteractiveRebase from '../components/InteractiveRebase';
import Modal from '../components/Modal';
import RepoSwitcher from '../components/RepoSwitcher';
import { useWorkspace, WorkspaceProvider } from '../context/WorkspaceContext';
import ChangesPanel from '../panels/ChangesPanel';
import LogPanel from '../panels/LogPanel';
import RemotesPanel from '../panels/RemotesPanel';
import ReadmePanel from '../panels/ReadmePanel';
import ContributorsPanel from '../panels/ContributorsPanel';

function WorkspaceInner() {
  const ws = useWorkspace();
  let tabsRef;
  const [overflowMenu, setOverflowMenu] = createSignal(null);
  const [hiddenTabs, setHiddenTabs] = createSignal([]);

  const allTabs = () => {
    const tabs = [
      { id: 'changes', label: 'Workspace', badge: ws.status.files.length || 0 },
      { id: 'log', label: 'History' },
      { id: 'remotes', label: 'Refs' },
      { id: 'contributors', label: 'Contributors' },
    ];
    if (ws.readme().content) tabs.push({ id: 'readme', label: 'README' });
    return tabs;
  };

  function checkOverflow() {
    if (!tabsRef) return;
    const containerWidth = tabsRef.clientWidth;
    const children = tabsRef.children;
    const hidden = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.offsetLeft + child.offsetWidth > containerWidth + 1) {
        const tabId = child.dataset.tab;
        if (tabId) hidden.push(tabId);
      }
    }
    setHiddenTabs(hidden);
  }

  let resizeObserver;
  onMount(() => {
    checkOverflow();
    resizeObserver = new ResizeObserver(checkOverflow);
    if (tabsRef) resizeObserver.observe(tabsRef);
  });
  onCleanup(() => resizeObserver?.disconnect());

  createEffect(() => {
    allTabs();
    requestAnimationFrame(checkOverflow);
  });

  let skipDismiss = false;
  function dismissOverflowMenu() {
    if (skipDismiss) { skipDismiss = false; return; }
    setOverflowMenu(null);
  }
  document.addEventListener('click', dismissOverflowMenu);
  onCleanup(() => document.removeEventListener('click', dismissOverflowMenu));

  function onGlobalKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
      e.preventDefault();
      if (ws.switcherOpen()) ws.closeSwitcher();
      else ws.openSwitcher();
    }
  }

  onMount(() => document.addEventListener('keydown', onGlobalKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onGlobalKeyDown));

  return (
    <div class="git-workspace">
      {/* Toolbar */}
      <div class="git-toolbar">
        <span class="git-header-branch" onClick={() => ws.onTabChange('remotes')} title={ws.status.branch || ''}>
          <Icon name="fa-solid fa-code-branch" />
          <span class="git-header-branch-name">{ws.status.branch || '...'}</span>
        </span>
        <Show when={ws.status.upstream}>
          <span class="git-header-sync">
            <Show when={ws.status.ahead > 0}>
              <span class="git-ahead" title={`${ws.status.ahead} ahead`}>{ws.status.ahead}<Icon name="fa-solid fa-arrow-up" /></span>
            </Show>
            <Show when={ws.status.behind > 0}>
              <span class="git-behind" title={`${ws.status.behind} behind`}>{ws.status.behind}<Icon name="fa-solid fa-arrow-down" /></span>
            </Show>
          </span>
        </Show>
        <div class="git-toolbar-sep" />
        <div class="git-tabs-container" ref={tabsRef}>
          <For each={allTabs()}>{(t) => (
            <button
              class={`git-tab ${ws.tab() === t.id ? 'active' : ''}`}
              data-tab={t.id}
              onClick={() => ws.onTabChange(t.id)}
            >
              {t.label}
              <Show when={t.badge > 0}>
                <span class="git-tab-badge">{t.badge}</span>
              </Show>
            </button>
          )}</For>
        </div>
        <Show when={hiddenTabs().length > 0}>
          <button
            class="btn btn-ghost btn-sm git-tabs-overflow-btn"
            onClick={(e) => {
              skipDismiss = true;
              const rect = e.currentTarget.getBoundingClientRect();
              setOverflowMenu(overflowMenu() ? null : { x: rect.left, y: rect.bottom + 4 });
            }}
            title="More tabs"
          >
            <Icon name="fa-solid fa-ellipsis" />
          </button>
        </Show>
        <Show when={ws.operating()}>
          <span class="git-operating">
            {ws.operating()}
            <Show when={ws.progressLine()}>
              <span class="git-progress-line">{ws.progressLine()}</span>
            </Show>
          </span>
        </Show>
        <button class="btn btn-ghost btn-sm" onClick={ws.doStashPush} disabled={!!ws.operating()} title="Stash">
          <Icon name="fa-solid fa-box-archive" />
        </button>
        <button class="btn btn-ghost btn-sm" onClick={ws.doFetch} disabled={!!ws.operating()} title="Fetch">
          <Icon name="fa-solid fa-cloud-arrow-down" />
        </button>
        <button class="btn btn-ghost btn-sm" onClick={() => ws.doPull()} disabled={!!ws.operating()} title="Pull">
          <Icon name="fa-solid fa-download" />
        </button>
        <button class="btn btn-ghost btn-sm" onClick={ws.doPush} disabled={!!ws.operating()} title="Push">
          <Icon name="fa-solid fa-upload" />
        </button>
        <button class="btn btn-ghost btn-sm" onClick={ws.refresh} title="Refresh">
          <Icon name="fa-solid fa-rotate" />
        </button>
        <button
          class={`btn btn-ghost btn-sm ${ws.outputOpen() ? 'btn-active' : ''}`}
          onClick={ws.toggleOutputPanel}
          title="Toggle output log"
        >
          <Icon name="fa-solid fa-terminal" />
          <Show when={ws.outputLog().length > 0}>
            <span class="git-tab-badge">{ws.outputLog().length}</span>
          </Show>
        </button>
      </div>

      <Show when={ws.status.error}>
        <div class="git-error">{ws.status.error}</div>
      </Show>

      {/* Output sidebar */}
      <Show when={ws.outputOpen()}>
        <div class="git-output-sidebar">
          <div class="git-output-sidebar-header">
            <span>Output Log</span>
            <div style={{ flex: 1 }} />
            <button class="btn btn-ghost btn-xs" onClick={ws.clearOutputLog} title="Clear log">
              <Icon name="fa-solid fa-trash" />
            </button>
            <button class="btn btn-ghost btn-xs" onClick={ws.toggleOutputPanel} title="Close">
              <Icon name="fa-solid fa-xmark" />
            </button>
          </div>
          <div class="git-output-sidebar-body">
            <Show when={ws.outputLog().length === 0}>
              <div class="git-empty">No output yet</div>
            </Show>
            <For each={ws.outputLog()}>{(entry) => (
              <div class="git-output-entry">
                <span class="git-output-time">{new Date(entry.time).toLocaleTimeString()}</span>
                <pre class="git-output-text">{entry.text}</pre>
              </div>
            )}</For>
          </div>
        </div>
      </Show>

      {/* Merge/rebase operation banner */}
      <Show when={ws.opState()}>
        <div class="git-op-banner">
          <Show when={ws.opState() === 'merge'}>
            <Icon name="fa-solid fa-code-merge" />
            <span>Merge in progress — resolve conflicts, stage files, then commit</span>
            <button class="btn btn-danger btn-sm" onClick={ws.doMergeAbort}>Abort Merge</button>
          </Show>
          <Show when={ws.opState() === 'rebase'}>
            <Icon name="fa-solid fa-arrow-right-arrow-left" />
            <span>Rebase in progress — resolve conflicts, stage files, then continue</span>
            <button class="btn btn-primary btn-sm" onClick={ws.doRebaseContinue}>Continue</button>
            <button class="btn btn-danger btn-sm" onClick={ws.doRebaseAbort}>Abort Rebase</button>
          </Show>
          <Show when={ws.opState() === 'bisect'}>
            <Icon name="fa-solid fa-magnifying-glass" />
            <span>Bisect in progress — test this commit and mark it</span>
            <button class="btn btn-success btn-sm" onClick={() => ws.doBisectMark('good')}>Good</button>
            <button class="btn btn-danger btn-sm" onClick={() => ws.doBisectMark('bad')}>Bad</button>
            <button class="btn btn-ghost btn-sm" onClick={() => ws.doBisectMark('skip')}>Skip</button>
            <button class="btn btn-ghost btn-sm" onClick={ws.doBisectReset}>Reset</button>
          </Show>
        </div>
      </Show>

      <Show when={ws.bisect.selecting}>
        <div class="git-op-banner">
          <Icon name="fa-solid fa-magnifying-glass" />
          <span>Bisect: bad = <code>{ws.bisect.selecting.badShort}</code> — now right-click a known good commit</span>
          <button class="btn btn-ghost btn-sm" onClick={ws.cancelBisectSelect}>Cancel</button>
        </div>
      </Show>

      {/* Tab content */}
      <div class="git-content" style={{ display: ws.tab() === 'changes' ? '' : 'none' }}>
        <ChangesPanel />
      </div>
      <div class="git-content" style={{ display: ws.tab() === 'log' ? '' : 'none' }}>
        <LogPanel />
      </div>
      <div class="git-content" style={{ display: ws.tab() === 'remotes' ? '' : 'none' }}>
        <RemotesPanel />
      </div>
      <div class="git-content" style={{ display: ws.tab() === 'contributors' ? '' : 'none' }}>
        <ContributorsPanel />
      </div>
      <div class="git-content" style={{ display: ws.tab() === 'readme' ? '' : 'none' }}>
        <ReadmePanel />
      </div>

      <Show when={overflowMenu()}>
        {(() => {
          const menu = overflowMenu();
          return (
            <div
              class="file-context-menu"
              style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              <For each={allTabs().filter(t => hiddenTabs().includes(t.id))}>{(t) => (
                <button class="file-context-menu-item" onClick={() => {
                  dismissOverflowMenu();
                  ws.onTabChange(t.id);
                }}>
                  {t.label}
                  <Show when={t.badge > 0}>
                    <span class="git-tab-badge">{t.badge}</span>
                  </Show>
                </button>
              )}</For>
            </div>
          );
        })()}
      </Show>

      <Modal />
      <RepoSwitcher />
      <ContextMenu />
      <Show when={ws.interactiveRebase()}>
        <InteractiveRebase />
      </Show>
      <Show when={ws.fileHistory.open}>
        <FileHistory />
      </Show>
    </div>
  );
}

export default function GitWorkspace(props) {
  return (
    <WorkspaceProvider repoData={props.repoData} onSwitchRepo={props.onSwitchRepo} onBack={props.onBack}>
      <WorkspaceInner />
    </WorkspaceProvider>
  );
}
