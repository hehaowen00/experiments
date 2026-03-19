import { Show, For, createSignal, onCleanup } from 'solid-js';
import Icon from '../lib/Icon';
import Select from '../lib/Select';
import ResizeHandle from '../lib/ResizeHandle';
import { useWorkspace } from '../context/WorkspaceContext';
import { GraphCell, parseRefs } from '../utils/graph';
import { DiffLines, isImageFile, ImagePreview } from '../utils/diff';

export default function LogPanel() {
  const ws = useWorkspace();
  let logPanelRef;
  let splitRef;
  let searchTimer;
  const [logFlex, setLogFlex] = createSignal(1);
  const [detailFlex, setDetailFlex] = createSignal(1);
  const [commitMenu, setCommitMenu] = createSignal(null);
  const [showCommitBody, setShowCommitBody] = createSignal(true);
  const [bodyHeight, setBodyHeight] = createSignal(80);

  const verticalMq = window.matchMedia('(max-aspect-ratio: 4/3)');
  const [isVertical, setIsVertical] = createSignal(verticalMq.matches);
  const onMqChange = (e) => setIsVertical(e.matches);
  verticalMq.addEventListener('change', onMqChange);
  onCleanup(() => verticalMq.removeEventListener('change', onMqChange));

  function onResizeBody(delta) {
    setBodyHeight((h) => Math.max(24, h + delta));
  }

  function onCommitContextMenu(e, commit) {
    e.preventDefault();
    setCommitMenu({ x: e.clientX, y: e.clientY, commit });
  }

  function dismissCommitMenu() {
    setCommitMenu(null);
  }

  // Dismiss on click anywhere
  document.addEventListener('click', dismissCommitMenu);
  onCleanup(() => document.removeEventListener('click', dismissCommitMenu));

  function onLogScroll(e) {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      ws.loadMoreLog();
    }
  }

  function onSearchInput(value) {
    ws.setLogSearch(value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => ws.loadLog(), 300);
  }

  function clearSearch() {
    ws.setLogSearch('');
    ws.loadLog();
  }

  function onResizeLog(delta) {
    if (!splitRef) return;
    const vertical = isVertical();
    const total = vertical ? splitRef.offsetHeight : splitRef.offsetWidth;
    if (total <= 0) return;
    const logRatio = logFlex();
    const detailRatio = detailFlex();
    const sum = logRatio + detailRatio;
    const pxPerUnit = total / sum;
    const newLog = Math.max(0.2, logRatio + delta / pxPerUnit);
    const newDetail = Math.max(0.2, detailRatio - delta / pxPerUnit);
    setLogFlex(newLog);
    setDetailFlex(newDetail);
  }

  return (
    <div class="git-log-wrapper">
      <div class="git-log-toolbar">
        <Select
          value={ws.logBranch()}
          options={[
            { value: '__current__', label: 'Current branch' },
            { value: '__all__', label: 'All branches' },
            ...ws.logBranches().map((b) => ({ value: b.name, label: `${b.name}${b.current ? ' *' : ''}` })),
          ]}
          onChange={(value) => { ws.setLogBranch(value); setTimeout(ws.loadLog, 0); }}
          class="select-sm select-mono"
        />
        <div class="git-log-search">
          <Icon name="fa-solid fa-magnifying-glass" class="git-log-search-icon" />
          <input
            type="text"
            class="git-log-search-input"
            placeholder="Search hash, author, message..."
            value={ws.logSearch()}
            onInput={(e) => onSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); ws.loadLog(); } }}
          />
          <Show when={ws.logSearch()}>
            <button class="btn btn-ghost btn-xs git-log-search-clear" onClick={clearSearch} title="Clear search">
              <Icon name="fa-solid fa-xmark" />
            </button>
          </Show>
        </div>
        <button
          class={`btn btn-ghost btn-xs ${ws.logTopoOrder() ? 'btn-active' : ''}`}
          onClick={() => { ws.setLogTopoOrder(!ws.logTopoOrder()); setTimeout(ws.loadLog, 0); }}
          title={ws.logTopoOrder() ? 'Topological order (click for date order)' : 'Date order (click for topological)'}
        >
          <Icon name="fa-solid fa-timeline" />
        </button>
        <button class="btn btn-ghost btn-xs" onClick={ws.loadLog} title="Refresh log">
          <Icon name="fa-solid fa-rotate" />
        </button>
      </div>
      <div class="git-log-split" ref={splitRef}>
        <div class="git-log-panel" ref={logPanelRef} onScroll={onLogScroll} style={{ flex: logFlex() }}>
          <Show when={ws.log.loading}>
            <div class="git-empty">Loading...</div>
          </Show>
          <Show when={!ws.log.loading && ws.log.commits.length === 0}>
            <div class="git-empty">No commits found</div>
          </Show>
          <table class="git-log-table">
            <thead>
              <tr>
                <th class="git-log-graph" style={{ width: `${Math.max(ws.log.maxCols, 1) * 16 + 8}px` }}>Graph</th>
                <th class="git-log-hash">Hash</th>
                <th class="git-log-subject">Message</th>
                <th class="git-log-author">Author</th>
                <th class="git-log-date">Date</th>
              </tr>
            </thead>
            <tbody>
              <For each={ws.log.commits}>{(c, idx) => {
                const row = ws.log.graph[idx()];
                return (
                  <tr
                    class={ws.commitDetail.hash === c.hash ? 'git-log-row-selected' : ''}
                    onClick={() => ws.selectCommit(c.hash)}
                    onContextMenu={(e) => onCommitContextMenu(e, c)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td class="git-log-graph-cell" style={{ width: `${Math.max(ws.log.maxCols, 1) * 16 + 8}px` }}>
                      <Show when={row}>
                        <GraphCell row={row} maxCols={ws.log.maxCols} />
                      </Show>
                    </td>
                    <td class="git-log-hash"><code onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(c.hash); }}  title="Click to copy full hash">{c.short}</code></td>
                    <td class="git-log-subject">
                      <Show when={c.refs}>
                        <For each={parseRefs(c.refs)}>{(ref) => (
                          <span class={`git-log-ref ${ref.type}`}>{ref.name}</span>
                        )}</For>
                      </Show>
                      {c.subject}
                    </td>
                    <td class="git-log-author">{c.author}</td>
                    <td class="git-log-date">{new Date(c.date).toLocaleString()}</td>
                  </tr>
                );
              }}</For>
            </tbody>
          </table>
          <Show when={ws.log.loadingMore}>
            <div class="git-log-loading-more">Loading more...</div>
          </Show>
          <Show when={!ws.log.hasMore && ws.log.commits.length > 0}>
            <div class="git-log-end">End of history</div>
          </Show>
        </div>

        <Show when={ws.commitDetail.hash}>
          <ResizeHandle direction={isVertical() ? 'row' : 'col'} onResize={onResizeLog} />
          <div class="git-commit-detail" style={{ flex: detailFlex() }}>
            <div class="git-commit-detail-header">
              <div class="git-commit-detail-meta">
                <code class="git-commit-detail-hash">{ws.commitDetail.hash?.substring(0, 12)}</code>
                <button class="btn btn-ghost btn-xs" onClick={() => navigator.clipboard.writeText(ws.commitDetail.hash)} title="Copy full hash">
                  <Icon name="fa-solid fa-copy" />
                </button>
                <span class="git-commit-detail-author">{ws.commitDetail.author} &lt;{ws.commitDetail.email}&gt;</span>
                <span class="git-commit-detail-date">
                  {ws.commitDetail.date ? new Date(ws.commitDetail.date).toLocaleString() : ''}
                </span>
                <Show when={ws.commitDetail.parents.length > 0}>
                  <span class="git-commit-detail-parents">
                    {ws.commitDetail.parents.length > 1 ? 'Merge: ' : 'Parent: '}
                    {ws.commitDetail.parents.map(p => p.substring(0, 8)).join(' ')}
                  </span>
                </Show>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <Show when={ws.commitDetail.body}>
                  <button
                    class="btn btn-ghost btn-xs"
                    onClick={() => setShowCommitBody(!showCommitBody())}
                    title={showCommitBody() ? 'Hide commit message' : 'Show commit message'}
                  >
                    <Icon name={showCommitBody() ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'} />
                  </button>
                </Show>
                <button class="btn btn-ghost btn-xs" onClick={() => ws.setCommitDetail({ hash: null })} title="Close">
                  <Icon name="fa-solid fa-xmark" />
                </button>
              </div>
            </div>
            <Show when={ws.commitDetail.body && showCommitBody()}>
              <pre class="git-commit-detail-body" style={{ height: `${bodyHeight()}px`, overflow: 'auto' }}>{ws.commitDetail.body}</pre>
              <ResizeHandle direction="row" onResize={onResizeBody} />
            </Show>
            <Show when={ws.commitDetail.loading}>
              <div class="git-empty">Loading...</div>
            </Show>
            <Show when={ws.commitDetail.files.length > 0}>
              <div class="git-commit-detail-files">
                <For each={ws.commitDetail.files}>{(file) => {
                  const isExpanded = () => file.filename in ws.expandedDetailFiles();
                  const isImage = () => isImageFile(file.filename);
                  const toggleFile = () => {
                    if (isExpanded()) {
                      const next = { ...ws.expandedDetailFiles() };
                      delete next[file.filename];
                      ws.setExpandedDetailFiles(next);
                    } else if (isImage()) {
                      ws.setExpandedDetailFiles((prev) => ({ ...prev, [file.filename]: '__image__' }));
                    } else {
                      ws.loadFileDiff(ws.commitDetail.hash, file.filename);
                    }
                  };
                  return (
                    <div class="git-detail-file">
                      <div class="git-detail-file-header" onClick={toggleFile}>
                        <Icon
                          name={isExpanded() ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'}
                          class="git-section-chevron"
                        />
                        <span class="git-detail-file-name">{file.filename}</span>
                        <span class="git-detail-file-stats">
                          <Show when={file.binary}>
                            <span class="git-detail-stat-bin">binary</span>
                          </Show>
                          <Show when={file.additions > 0}>
                            <span class="git-detail-stat-add">+{file.additions}</span>
                          </Show>
                          <Show when={file.deletions > 0}>
                            <span class="git-detail-stat-del">-{file.deletions}</span>
                          </Show>
                        </span>
                      </div>
                      <Show when={isExpanded() && ws.expandedDetailFiles()[file.filename]}>
                        <Show when={isImage()} fallback={
                          <pre class="git-diff-content git-detail-file-diff">
                            <div class="git-diff-inner">
                              <DiffLines raw={ws.expandedDetailFiles()[file.filename]} />
                            </div>
                          </pre>
                        }>
                          <ImagePreview repoPath={ws.repoPath} filepath={file.filename} gitRef={ws.commitDetail.hash} />
                        </Show>
                      </Show>
                    </div>
                  );
                }}</For>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={commitMenu()}>
        {(() => {
          const menu = commitMenu();
          return (
            <div
              class="file-context-menu"
              style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              <button class="file-context-menu-item" disabled={!!ws.operating()} onClick={() => {
                dismissCommitMenu();
                ws.checkoutCommit(menu.commit.hash);
              }}>
                <Icon name="fa-solid fa-right-to-bracket" /> Checkout
              </button>
              <button class="file-context-menu-item" disabled={!!ws.operating()} onClick={() => {
                dismissCommitMenu();
                ws.doCherryPick(menu.commit.hash);
              }}>
                <Icon name="fa-solid fa-circle-dot" /> Cherry-pick
              </button>
              <button class="file-context-menu-item" disabled={!!ws.operating()} onClick={() => {
                dismissCommitMenu();
                ws.doRevert(menu.commit.hash);
              }}>
                <Icon name="fa-solid fa-rotate-left" /> Revert Commit
              </button>
              <button class="file-context-menu-item" disabled={!!ws.operating()} onClick={() => {
                dismissCommitMenu();
                ws.startInteractiveRebase(menu.commit.hash);
              }}>
                <Icon name="fa-solid fa-list-check" /> Interactive Rebase...
              </button>
              <Show when={!ws.bisect.selecting && ws.opState() !== 'bisect'}>
                <button class="file-context-menu-item" disabled={!!ws.operating()} onClick={() => {
                  dismissCommitMenu();
                  ws.startBisectSelect(menu.commit);
                }}>
                  <Icon name="fa-solid fa-magnifying-glass-minus" /> Bisect (bad)...
                </button>
              </Show>
              <Show when={ws.bisect.selecting}>
                <button class="file-context-menu-item" disabled={!!ws.operating()} onClick={() => {
                  dismissCommitMenu();
                  ws.finishBisectSelect(menu.commit);
                }}>
                  <Icon name="fa-solid fa-magnifying-glass-plus" /> Bisect (good)
                </button>
              </Show>
              <button class="file-context-menu-item danger" disabled={!!ws.operating()} onClick={() => {
                dismissCommitMenu();
                ws.doDropCommit(menu.commit.hash);
              }}>
                <Icon name="fa-solid fa-trash" /> Drop Commit
              </button>
            </div>
          );
        })()}
      </Show>
    </div>
  );
}
