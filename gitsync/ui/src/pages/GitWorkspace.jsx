import { onMount, onCleanup, Show } from 'solid-js';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import ContextMenu from '../components/ContextMenu';
import RepoSwitcher from '../components/RepoSwitcher';
import { WorkspaceProvider, useWorkspace } from '../context/WorkspaceContext';
import ChangesPanel from '../panels/ChangesPanel';
import LogPanel from '../panels/LogPanel';
import RemotesPanel from '../panels/RemotesPanel';
import StashesPanel from '../panels/StashesPanel';

function WorkspaceInner() {
  const ws = useWorkspace();

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
      {/* Header */}
      <div class="git-header">
        <button class="btn btn-ghost btn-sm" onClick={ws.onBack} title="Back to repos">
          <Icon name="fa-solid fa-arrow-left" />
        </button>
        <button class="git-header-name" onClick={ws.openSwitcher} title="Switch repo (Ctrl+P)">
          {ws.repoData.name}
        </button>
        <span class="git-header-branch" onClick={() => ws.onTabChange('remotes')} title="View branches">
          <Icon name="fa-solid fa-code-branch" />
          {ws.status.branch || '...'}
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
        <div style={{ flex: 1 }} />
        <Show when={ws.operating()}>
          <span class="git-operating">{ws.operating()}</span>
        </Show>
        <button class="btn btn-ghost btn-sm" onClick={ws.doStashPush} title="Stash">
          <Icon name="fa-solid fa-box-archive" /> Stash
        </button>
        <button class="btn btn-ghost btn-sm" onClick={ws.doFetch} title="Fetch">
          <Icon name="fa-solid fa-cloud-arrow-down" /> Fetch
        </button>
        <button class="btn btn-ghost btn-sm" onClick={ws.doPull} title="Pull">
          <Icon name="fa-solid fa-download" /> Pull
        </button>
        <button class="btn btn-ghost btn-sm" onClick={ws.doPush} title="Push">
          <Icon name="fa-solid fa-upload" /> Push
        </button>
        <button class="btn btn-ghost btn-sm" onClick={ws.refresh} title="Refresh">
          <Icon name="fa-solid fa-rotate" />
        </button>
      </div>

      {/* Tabs */}
      <div class="git-tabs">
        <button class={`git-tab ${ws.tab() === 'changes' ? 'active' : ''}`} onClick={() => ws.onTabChange('changes')}>
          Changes
          <Show when={ws.status.files.length > 0}>
            <span class="git-tab-badge">{ws.status.files.length}</span>
          </Show>
        </button>
        <button class={`git-tab ${ws.tab() === 'log' ? 'active' : ''}`} onClick={() => ws.onTabChange('log')}>
          Log
        </button>
        <button class={`git-tab ${ws.tab() === 'remotes' ? 'active' : ''}`} onClick={() => ws.onTabChange('remotes')}>
          Remotes
        </button>
        <button class={`git-tab ${ws.tab() === 'stashes' ? 'active' : ''}`} onClick={() => ws.onTabChange('stashes')}>
          Stashes
          <Show when={ws.stashes.list.length > 0}>
            <span class="git-tab-badge">{ws.stashes.list.length}</span>
          </Show>
        </button>
      </div>

      <Show when={ws.status.error}>
        <div class="git-error">{ws.status.error}</div>
      </Show>

      {/* Output bar */}
      <Show when={ws.output()}>
        <div class="git-output-bar">
          <pre>{ws.output()}</pre>
          <button class="btn btn-ghost btn-xs" onClick={() => ws.setOutput('')}>
            <Icon name="fa-solid fa-xmark" />
          </button>
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
      <div class="git-content" style={{ display: ws.tab() === 'stashes' ? '' : 'none' }}>
        <StashesPanel />
      </div>

      <Modal />
      <RepoSwitcher />
      <ContextMenu />
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
