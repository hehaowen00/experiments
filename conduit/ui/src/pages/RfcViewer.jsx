import { createSignal, createEffect, Show, For, onMount, onCleanup } from 'solid-js';
import Icon from '../components/Icon';

export default function RfcViewer(props) {
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal([]);
  const [selectedRfc, setSelectedRfc] = createSignal(null);
  const [rfcContent, setRfcContent] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [syncing, setSyncing] = createSignal(false);
  const [syncStatus, setSyncStatus] = createSignal(null);
  const [syncMessage, setSyncMessage] = createSignal('');
  const [contentLoading, setContentLoading] = createSignal(false);
  const [browseOffset, setBrowseOffset] = createSignal(0);
  const [activeNumber, setActiveNumber] = createSignal(null);
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [metaOpen, setMetaOpen] = createSignal(true);
  const PAGE_SIZE = 100;

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      setSidebarOpen(!sidebarOpen());
    }
  }

  // Auto-close sidebar on portrait aspect ratio
  const mql = window.matchMedia('(max-aspect-ratio: 1/1)');
  function onLayoutChange(e) {
    if (e.matches) setSidebarOpen(false);
  }

  onMount(async () => {
    document.addEventListener('keydown', onKeyDown);
    mql.addEventListener('change', onLayoutChange);
    if (mql.matches) setSidebarOpen(false);

    const status = await window.api.rfcGetSyncStatus();
    setSyncStatus(status);
    if (status.count > 0) {
      loadBrowse(0);
    }
    window.api.onRfcSyncProgress((data) => {
      setSyncMessage(data.message);
      if (data.stage === 'done') {
        setSyncing(false);
        window.api.rfcGetSyncStatus().then((s) => {
          setSyncStatus(s);
          loadBrowse(0);
        });
      }
    });
  });

  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown);
    mql.removeEventListener('change', onLayoutChange);
  });

  async function loadBrowse(offset) {
    setLoading(true);
    const rfcs = await window.api.rfcBrowse(offset, PAGE_SIZE);
    setResults(rfcs);
    setBrowseOffset(offset);
    setLoading(false);
  }

  async function doSearch() {
    const q = query().trim();
    if (!q) {
      loadBrowse(0);
      return;
    }
    setLoading(true);
    const rfcs = await window.api.rfcSearch(q, PAGE_SIZE);
    setResults(rfcs);
    setLoading(false);
  }

  async function syncIndex() {
    setSyncing(true);
    setSyncMessage('Starting sync...');
    try {
      await window.api.rfcSyncIndex();
    } catch (e) {
      setSyncMessage('Sync failed: ' + e.message);
      setSyncing(false);
    }
  }

  async function openRfc(number) {
    setActiveNumber(number);
    setContentLoading(true);
    const rfc = await window.api.rfcGet(number);
    setSelectedRfc(rfc);
    const content = await window.api.rfcGetContent(number);
    setRfcContent(content);
    setContentLoading(false);
  }

  return (
    <div class="rfc-shell" style={props.style}>
      <Show when={sidebarOpen()}>
        <div class="rfc-sidebar">
          <div class="rfc-header">
            <div class="rfc-title-row">
              <h2 class="rfc-title">RFCs</h2>
              <button
                class="btn btn-ghost btn-xs"
                onClick={syncIndex}
                disabled={syncing()}
                title="Sync RFC index from IETF"
              >
                <Icon name="fa-solid fa-rotate" />
              </button>
            </div>
            <Show when={syncStatus()}>
              <div class="rfc-sync-info">
                {syncStatus().count} indexed
                <Show when={syncStatus().lastSync}>
                  <span class="rfc-text-dim">
                    {' '}
                    &middot;{' '}
                    {new Date(syncStatus().lastSync).toLocaleDateString()}
                  </span>
                </Show>
              </div>
            </Show>
            <Show when={syncing()}>
              <div class="rfc-sync-progress">{syncMessage()}</div>
            </Show>
            <div class="rfc-search-row">
              <input
                type="text"
                class="rfc-search-input"
                placeholder="Search RFC number, title, keyword..."
                value={query()}
                onInput={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              />
            </div>
          </div>

          <Show when={loading()}>
            <div class="rfc-loading">Loading...</div>
          </Show>

          <Show when={!loading() && results().length === 0}>
            <div class="rfc-empty">
              <Show
                when={syncStatus()?.count > 0}
                fallback={
                  <p>
                    No RFCs indexed. Click{' '}
                    <Icon name="fa-solid fa-rotate" /> to sync.
                  </p>
                }
              >
                <p>No results found.</p>
              </Show>
            </div>
          </Show>

          <Show when={!loading() && results().length > 0}>
            <div class="rfc-results">
              <For each={results()}>
                {(rfc) => (
                  <button
                    class={`rfc-result-row ${activeNumber() === rfc.number ? 'active' : ''}`}
                    onClick={() => openRfc(rfc.number)}
                  >
                    <div class="rfc-result-number">RFC {rfc.number}</div>
                    <div class="rfc-result-title">{rfc.title}</div>
                    <div class="rfc-result-meta">
                      <Show when={rfc.status}>
                        <span
                          class={`rfc-status rfc-status-${rfc.status.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          {rfc.status}
                        </span>
                      </Show>
                      <Show when={rfc.dateYear}>
                        <span class="rfc-text-dim">
                          {rfc.dateMonth} {rfc.dateYear}
                        </span>
                      </Show>
                      <Show when={rfc.obsoletedBy}>
                        <span class="rfc-obsoleted">Obsoleted</span>
                      </Show>
                    </div>
                  </button>
                )}
              </For>
            </div>

            <Show when={!query().trim()}>
              <div class="rfc-pagination">
                <button
                  class="btn btn-ghost btn-xs"
                  onClick={() =>
                    loadBrowse(Math.max(0, browseOffset() - PAGE_SIZE))
                  }
                  disabled={browseOffset() === 0}
                >
                  <Icon name="fa-solid fa-chevron-left" />
                </button>
                <span class="rfc-text-dim rfc-page-info">
                  {browseOffset() + 1}&ndash;
                  {browseOffset() + results().length}
                </span>
                <button
                  class="btn btn-ghost btn-xs"
                  onClick={() => loadBrowse(browseOffset() + PAGE_SIZE)}
                  disabled={results().length < PAGE_SIZE}
                >
                  <Icon name="fa-solid fa-chevron-right" />
                </button>
              </div>
            </Show>
          </Show>
        </div>
      </Show>

      <div class="rfc-content-pane">
        <div class="rfc-toolbar">
          <Show when={!sidebarOpen()}>
            <button
              class="btn btn-ghost btn-xs"
              onClick={() => setSidebarOpen(true)}
              title="Show sidebar (Ctrl+B)"
            >
              <Icon name="fa-solid fa-bars" />
            </button>
          </Show>
          <Show when={selectedRfc()}>
            <h2 class="rfc-detail-title">
              RFC {selectedRfc().number}: {selectedRfc().title}
            </h2>
            <button
              class="btn btn-ghost btn-xs"
              onClick={() => {
                const el = document.getElementById('rfc-toc');
                if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
              }}
              title="Jump to Table of Contents"
            >
              <Icon name="fa-solid fa-list" />
            </button>
            <button
              class="btn btn-ghost btn-xs"
              onClick={() => setMetaOpen(!metaOpen())}
              title={metaOpen() ? 'Hide metadata' : 'Show metadata'}
            >
              <Icon name="fa-solid fa-circle-info" />
            </button>
          </Show>
        </div>
        <Show
          when={selectedRfc()}
          fallback={
            <div class="rfc-empty-pane">
              <p class="rfc-text-dim">Select an RFC to view</p>
            </div>
          }
        >
          <RfcContent
            content={rfcContent}
            loading={contentLoading}
            onOpen={openRfc}
          />
        </Show>
      </div>

      <Show when={metaOpen() && selectedRfc()}>
        <RfcMetaSidebar rfc={selectedRfc} onOpen={openRfc} />
      </Show>
    </div>
  );
}

function RfcContent(props) {
  const [findOpen, setFindOpen] = createSignal(false);
  const [findQuery, setFindQuery] = createSignal('');
  const [matchIndex, setMatchIndex] = createSignal(0);
  const [matchCount, setMatchCount] = createSignal(0);
  let findInputRef;
  let wrapperRef;

  // TOC entry with dot leaders + page: "   1.1.  Title ......... 7"
  // Also handles spaced dots: "   1.1.  Title . . . . . 7"
  // Also handles "Appendix A." prefixed entries
  const TOC_DOTS_RE =
    /^(\s+)((?:Appendix\s+)?(?:\d+|[A-Z])(?:\.\d+)*\.?)\s+(.*?)\s*(?:\.[\s.]*\.)\s*(\d+)\s*$/;
  // TOC entry without dots (newer RFCs): "     1.1.  Title"
  // Also matches "   8.  References" (single space after number)
  const TOC_PLAIN_RE =
    /^(\s{2,})((?:Appendix\s+)?(?:\d+|[A-Z])(?:\.\d+)*\.)\s+(\S.*)$/;
  // Unnumbered TOC entries: "   Acknowledgments", "   Authors' Addresses"
  const TOC_UNNUM_RE = /^(\s{3,})([A-Z][A-Za-z']+(?:\s+[A-Za-z']+)*)\s*$/;
  // Section header at start of line (after optional \f):
  //   "1.  Title" or "Appendix A.  Title"
  const SEC_RE =
    /^[\f]?(?:Appendix\s+)?((?:\d+|[A-Z])(?:\.\d+)*\.)\s{2,}(\S.*)/;

  function sectionId(num) {
    return 'rfc-sec-' + num.replace(/^Appendix\s+/i, '').replace(/\.$/, '');
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      setFindOpen(true);
      setTimeout(() => findInputRef?.focus(), 0);
    }
    if (e.key === 'Escape' && findOpen()) {
      closeFindBar();
    }
  }

  function closeFindBar() {
    setFindOpen(false);
    setFindQuery('');
    setMatchIndex(0);
    setMatchCount(0);
  }

  function nextMatch() {
    if (matchCount() === 0) return;
    setMatchIndex((matchIndex() + 1) % matchCount());
    scrollToMatch();
  }

  function prevMatch() {
    if (matchCount() === 0) return;
    setMatchIndex((matchIndex() - 1 + matchCount()) % matchCount());
    scrollToMatch();
  }

  function scrollToMatch() {
    setTimeout(() => {
      const el = wrapperRef?.querySelector('.rfc-find-active');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  }

  function onFindKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) prevMatch();
      else nextMatch();
    }
    if (e.key === 'Escape') {
      closeFindBar();
    }
  }

  function onFindInput(val) {
    setFindQuery(val);
    setMatchIndex(0);
  }

  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  // Split a line into parts: RFC references, then find-query highlights
  function buildLineParts(line, q, findIdx) {
    // Step 1: split by RFC references
    const rfcParts = [];
    const rfcRegex = /\[?RFC\s*(\d{1,5})\]?/gi;
    let last = 0;
    let m;
    while ((m = rfcRegex.exec(line)) !== null) {
      if (m.index > last) {
        rfcParts.push({ type: 'text', value: line.slice(last, m.index) });
      }
      rfcParts.push({
        type: 'rfc',
        value: m[0],
        number: parseInt(m[1], 10),
      });
      last = m.index + m[0].length;
    }
    if (last < line.length) {
      rfcParts.push({ type: 'text', value: line.slice(last) });
    }

    // Step 2: split text parts by find query
    if (!q) return { parts: rfcParts, findMatches: 0 };

    const result = [];
    let count = 0;
    for (const part of rfcParts) {
      if (part.type !== 'text') {
        result.push(part);
        continue;
      }
      const lower = part.value.toLowerCase();
      let idx = 0;
      let pos;
      while ((pos = lower.indexOf(q, idx)) !== -1) {
        if (pos > idx) {
          result.push({ type: 'text', value: part.value.slice(idx, pos) });
        }
        result.push({
          type: 'find',
          value: part.value.slice(pos, pos + q.length),
          matchIdx: findIdx + count,
        });
        count++;
        idx = pos + q.length;
      }
      if (idx < part.value.length) {
        result.push({ type: 'text', value: part.value.slice(idx) });
      }
    }
    return { parts: result, findMatches: count };
  }

  function renderParts(parts) {
    return parts.map((part) => {
      if (part.type === 'rfc') {
        return (
          <a
            class="rfc-link"
            onClick={(e) => {
              e.preventDefault();
              props.onOpen(part.number);
            }}
            title={`Open RFC ${part.number}`}
          >
            {part.value}
          </a>
        );
      }
      if (part.type === 'find') {
        return (
          <mark
            class={`rfc-find-match ${part.matchIdx === matchIndex() ? 'rfc-find-active' : ''}`}
          >
            {part.value}
          </mark>
        );
      }
      return part.value;
    });
  }

  function scrollToId(id) {
    const el = wrapperRef?.querySelector('#' + CSS.escape(id));
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function renderContent() {
    const text = props.content()?.replace(/^([\t \f]*\n)+/, '');
    if (!text) return null;

    const q = findQuery().trim().toLowerCase();
    const lines = text.split('\n');

    // Count total find matches
    let totalMatches = 0;
    if (q) {
      const lower = text.toLowerCase();
      let pos = 0;
      while ((pos = lower.indexOf(q, pos)) !== -1) {
        totalMatches++;
        pos += q.length;
      }
    }
    setMatchCount(totalMatches);
    if (matchIndex() >= totalMatches && totalMatches > 0) setMatchIndex(0);

    if (q && totalMatches > 0) scrollToMatch();

    let globalFindIdx = 0;
    let inToc = false;

    const rendered = lines.map((line, i) => {
      const nl = i < lines.length - 1 ? '\n' : '';
      const { parts, findMatches } = buildLineParts(line, q, globalFindIdx);
      globalFindIdx += findMatches;
      const inner = renderParts(parts);

      // Detect "Table of Contents" header
      if (/^\s*Table of Contents\s*$/i.test(line)) {
        inToc = true;
        return (
          <>
            <span id="rfc-toc">{inner}</span>
            {nl}
          </>
        );
      }

      // TOC entries: inside TOC block
      if (inToc) {
        const tocMatch =
          TOC_DOTS_RE.exec(line) || TOC_PLAIN_RE.exec(line);
        if (tocMatch) {
          const target = sectionId(tocMatch[2]);
          return (
            <>
              <a
                class="rfc-toc-link"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToId(target);
                }}
              >
                {inner}
              </a>
              {nl}
            </>
          );
        }
        // Unnumbered TOC entries like "Acknowledgments", "Authors' Addresses"
        const unnumMatch = TOC_UNNUM_RE.exec(line);
        if (unnumMatch) {
          const target = 'rfc-sec-' + unnumMatch[2].replace(/\s+/g, '-');
          return (
            <>
              <a
                class="rfc-toc-link"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToId(target);
                }}
              >
                {inner}
              </a>
              {nl}
            </>
          );
        }
        // End TOC only at an unindented section header (no leading space
        // after optional \f). TOC entries are always indented, so a
        // flush-left section header means the real content has started.
        const stripped = line.replace(/^\f/, '');
        if (stripped.length > 0 && stripped[0] !== ' ' && SEC_RE.test(line)) {
          inToc = false;
        }
      }

      // Section headers at start of line
      const secMatch = SEC_RE.exec(line);
      if (secMatch) {
        const id = sectionId(secMatch[1]);
        return (
          <>
            <span id={id} class="rfc-section-header">
              {inner}
            </span>
            {nl}
          </>
        );
      }

      // Unnumbered section headers (flush-left, after optional \f)
      const UNNUM_SEC_RE = /^[\f]?(Acknowledgments|Acknowledgements|Authors?'?\s+Addresses?|References|Index|Contributors|Full Copyright Statement|Intellectual Property|Copyright Notice)\s*$/i;
      const unnumSecMatch = UNNUM_SEC_RE.exec(line);
      if (unnumSecMatch) {
        const id = 'rfc-sec-' + unnumSecMatch[1].replace(/\s+/g, '-');
        return (
          <>
            <span id={id} class="rfc-section-header">
              {inner}
            </span>
            {nl}
          </>
        );
      }

      return (
        <>
          {inner}
          {nl}
        </>
      );
    });

    return <pre class="rfc-content">{rendered}</pre>;
  }

  return (
    <>
      <Show when={findOpen()}>
        <div class="rfc-find-bar">
          <input
            ref={findInputRef}
            type="text"
            class="rfc-find-input"
            placeholder="Find in RFC..."
            value={findQuery()}
            onInput={(e) => onFindInput(e.target.value)}
            onKeyDown={onFindKeyDown}
          />
          <span class="rfc-find-count">
            {matchCount() > 0
              ? `${matchIndex() + 1}/${matchCount()}`
              : findQuery().trim()
                ? 'No matches'
                : ''}
          </span>
          <button
            class="btn btn-ghost btn-xs"
            onClick={prevMatch}
            disabled={matchCount() === 0}
            title="Previous (Shift+Enter)"
          >
            <Icon name="fa-solid fa-chevron-up" />
          </button>
          <button
            class="btn btn-ghost btn-xs"
            onClick={nextMatch}
            disabled={matchCount() === 0}
            title="Next (Enter)"
          >
            <Icon name="fa-solid fa-chevron-down" />
          </button>
          <button
            class="btn btn-ghost btn-xs"
            onClick={closeFindBar}
            title="Close (Esc)"
          >
            <Icon name="fa-solid fa-xmark" />
          </button>
        </div>
      </Show>
      <Show when={props.loading()}>
        <div class="rfc-loading">Loading RFC content...</div>
      </Show>
      <Show when={!props.loading() && props.content()}>
        <div class="rfc-content-wrapper" ref={wrapperRef}>
          {renderContent()}
        </div>
      </Show>
    </>
  );
}

function RfcMetaSidebar(props) {
  const [refTitles, setRefTitles] = createSignal({});

  // Fetch titles for all referenced RFCs whenever the selected RFC changes
  createEffect(async () => {
    const rfc = props.rfc();
    if (!rfc) return;
    const allRefs = [
      rfc.obsoletes,
      rfc.obsoletedBy,
      rfc.updates,
      rfc.updatedBy,
    ]
      .filter(Boolean)
      .join(', ');
    const numbers = [
      ...new Set(
        allRefs
          .split(',')
          .map((r) => parseInt(r.trim().replace(/^RFC0*/, ''), 10))
          .filter((n) => !isNaN(n)),
      ),
    ];
    if (numbers.length === 0) {
      setRefTitles({});
      return;
    }
    const titles = await window.api.rfcGetTitles(numbers);
    setRefTitles(titles);
  });

  function refLinks(refStr) {
    if (!refStr) return null;
    const titles = refTitles();
    return refStr
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const num = parseInt(r.replace(/^RFC0*/, ''), 10);
        if (isNaN(num)) return <span class="rfc-text-dim">{r} </span>;
        const title = titles[num];
        return (
          <a
            class="rfc-ref-link"
            onClick={(e) => {
              e.preventDefault();
              props.onOpen(num);
            }}
            title={title ? `RFC ${num}: ${title}` : `Open RFC ${num}`}
          >
            RFC {num}
            <Show when={title}>
              <span class="rfc-ref-title"> — {title}</span>
            </Show>
          </a>
        );
      });
  }

  return (
    <div class="rfc-meta-sidebar">
      <div class="rfc-meta-sidebar-header">Metadata</div>
      <div class="rfc-meta-sidebar-body">
        <Show when={props.rfc().authors}>
          <div class="rfc-meta-row">
            <span class="rfc-meta-label">Authors</span>
            <span class="rfc-meta-value">{props.rfc().authors}</span>
          </div>
        </Show>
        <Show when={props.rfc().dateYear}>
          <div class="rfc-meta-row">
            <span class="rfc-meta-label">Date</span>
            <span class="rfc-meta-value">
              {props.rfc().dateMonth} {props.rfc().dateYear}
            </span>
          </div>
        </Show>
        <Show when={props.rfc().status}>
          <div class="rfc-meta-row">
            <span class="rfc-meta-label">Status</span>
            <span class="rfc-meta-value">{props.rfc().status}</span>
          </div>
        </Show>
        <Show when={props.rfc().keywords}>
          <div class="rfc-meta-row">
            <span class="rfc-meta-label">Keywords</span>
            <span class="rfc-meta-value">{props.rfc().keywords}</span>
          </div>
        </Show>
        <Show when={props.rfc().abstract}>
          <div class="rfc-meta-row rfc-meta-row-block">
            <span class="rfc-meta-label">Abstract</span>
            <span class="rfc-meta-value rfc-abstract">
              {props.rfc().abstract}
            </span>
          </div>
        </Show>
        <Show when={props.rfc().obsoletes}>
          <div class="rfc-meta-row">
            <span class="rfc-meta-label">Obsoletes</span>
            <span class="rfc-meta-value">
              {refLinks(props.rfc().obsoletes)}
            </span>
          </div>
        </Show>
        <Show when={props.rfc().obsoletedBy}>
          <div class="rfc-meta-row">
            <span class="rfc-meta-label">Obsoleted By</span>
            <span class="rfc-meta-value">
              {refLinks(props.rfc().obsoletedBy)}
            </span>
          </div>
        </Show>
        <Show when={props.rfc().updates}>
          <div class="rfc-meta-row">
            <span class="rfc-meta-label">Updates</span>
            <span class="rfc-meta-value">
              {refLinks(props.rfc().updates)}
            </span>
          </div>
        </Show>
        <Show when={props.rfc().updatedBy}>
          <div class="rfc-meta-row">
            <span class="rfc-meta-label">Updated By</span>
            <span class="rfc-meta-value">
              {refLinks(props.rfc().updatedBy)}
            </span>
          </div>
        </Show>
        <Show when={props.rfc().references}>
          <div class="rfc-meta-row">
            <span class="rfc-meta-label">Also Known As</span>
            <span class="rfc-meta-value">{props.rfc().references}</span>
          </div>
        </Show>
      </div>
    </div>
  );
}
