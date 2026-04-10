import { Show, For, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import Icon from '../lib/Icon';
import Select from '../lib/Select';
import ResizeHandle from '../lib/ResizeHandle';
import { useWorkspace } from '../context/WorkspaceContext';
import { DiffLines, isImageFile, ImagePreview } from '../utils/diff';
import { buildGraph, GraphCell } from '../utils/graph';

const ROW_HEIGHT = 24;
const OVERSCAN = 10;

function fmtDate(ts) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function parseRefs(refStr) {
  if (!refStr) return [];
  return refStr.split(',').map(r => r.trim()).filter(Boolean).map(r => {
    if (r.startsWith('HEAD -> ')) return { name: r.slice(8), type: 'git-ref-head' };
    if (r === 'HEAD') return { name: 'HEAD', type: 'git-ref-head' };
    if (r.startsWith('tag: ')) return { name: r.slice(5), type: 'git-ref-tag' };
    if (r.includes('/')) return { name: r, type: 'git-ref-remote' };
    return { name: r, type: 'git-ref-branch' };
  });
}

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
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewHeight, setViewHeight] = createSignal(600);

  let resizeObserver;
  onMount(() => {
    if (logPanelRef) {
      setViewHeight(logPanelRef.clientHeight);
      resizeObserver = new ResizeObserver(() => {
        if (logPanelRef.clientHeight > 0) setViewHeight(logPanelRef.clientHeight);
      });
      resizeObserver.observe(logPanelRef);
    }
  });
  onCleanup(() => resizeObserver?.disconnect());

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
    setScrollTop(el.scrollTop);
    setViewHeight(el.clientHeight);
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      ws.loadMoreLog();
    }
  }

  const visibleRange = createMemo(() => {
    const total = ws.log.commits.length;
    if (total === 0) return { start: 0, end: 0 };
    const st = scrollTop();
    const start = Math.max(0, Math.floor(st / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(total, Math.ceil((st + viewHeight()) / ROW_HEIGHT) + OVERSCAN);
    return { start, end };
  });

  const visibleCommits = createMemo(() => {
    const { start, end } = visibleRange();
    return ws.log.commits.slice(start, end);
  });

  const graphData = createMemo(() => buildGraph(ws.log.commits));

  const totalHeight = () => ws.log.commits.length * ROW_HEIGHT;

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
          <Show when={ws.log.commits.length > 0}>
            <div class="git-log-header-row">
              <span class="git-log-col git-log-hash">Hash</span>
              <span class="git-log-col git-log-subject">Message</span>
              <span class="git-log-col git-log-author">Author</span>
              <span class="git-log-col git-log-date">Date</span>
            </div>
            <div class="git-log-virtual" style={{ height: `${totalHeight()}px` }}>
              <For each={visibleCommits()}>{(c, localIdx) => {
                const rowIdx = () => visibleRange().start + localIdx();
                return (
                  <div
                    class={`git-log-row ${ws.commitDetail.hash === c.hash ? 'git-log-row-selected' : ''}`}
                    onClick={() => ws.selectCommit(c.hash)}
                    onContextMenu={(e) => onCommitContextMenu(e, c)}
                    style={{ top: `${rowIdx() * ROW_HEIGHT}px` }}
                  >
                    <span class="git-log-col git-log-hash"><code onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(c.hash); }} title="Click to copy full hash">{c.short}</code></span>
                    <span class="git-log-col git-log-subject">
                      <Show when={graphData().rows[rowIdx()]}>
                        <GraphCell
                          row={graphData().rows[rowIdx()]}
                          height={ROW_HEIGHT}
                        />
                      </Show>
                      <span class="git-log-subject-text">
                        <Show when={c.refs}>
                          <For each={parseRefs(c.refs)}>{(ref) => (
                            <span class={`git-log-ref ${ref.type}`}>{ref.name}</span>
                          )}</For>
                        </Show>
                        {c.subject}
                      </span>
                    </span>
                    <span class="git-log-col git-log-author">{c.author}</span>
                    <span class="git-log-col git-log-date">{fmtDate(c.date)}</span>
                  </div>
                );
              }}</For>
            </div>
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
                  {ws.commitDetail.date ? fmtDate(ws.commitDetail.date) : ''}
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
                      ws.setExpandedDetailFiles({});
                    } else if (isImage()) {
                      ws.setExpandedDetailFiles({ [file.filename]: '__image__' });
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
              <For each={parseRefs(menu.commit.refs).filter(r => (r.type === 'git-ref-branch' || r.type === 'git-ref-remote') && r.name !== ws.status.branch)}>{(ref) => (
                <button class="file-context-menu-item" disabled={!!ws.operating()} onClick={() => {
                  dismissCommitMenu();
                  ws.doMerge(ref.name);
                }}>
                  <Icon name="fa-solid fa-code-branch" /> Merge {ref.name}
                </button>
              )}</For>
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
