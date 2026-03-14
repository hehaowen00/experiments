import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { contentTypeToFormat, esc } from '../helpers';
import { highlightXmlFlat } from '../highlight';
import t from '../locale';
import { evaluateJsonPath, searchXPathResults } from '../search';
import { useCollection } from '../store/collection';
import Icon from './Icon';
import ResponseViewer from './ResponseViewer';
import Select from './Select';

// Foldable JSON renderer (DOM-based for performance with large responses)
function renderFoldableJson(value) {
  const el = document.createElement('div');
  el.className = 'fold-tree';
  el.appendChild(buildJsonNode(value, 0));

  el.addEventListener('click', (e) => {
    const toggle = e.target.closest('.fold-toggle');
    if (!toggle) return;
    const block = toggle.closest('.fold-block');
    if (!block.classList.contains('open') && block._lazyRender) {
      block._lazyRender();
      block._lazyRender = null;
    }
    block.classList.toggle('open');
  });

  return el;
}

const JSON_CHUNK_SIZE = 100;

function spanText(text, cls) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function buildJsonNode(value, depth) {
  if (value === null) return spanText('null', 'hl-bool');
  if (typeof value === 'string')
    return spanText(JSON.stringify(value), 'hl-str');
  if (typeof value === 'number') return spanText(String(value), 'hl-num');
  if (typeof value === 'boolean') return spanText(String(value), 'hl-bool');

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';

  if (entries.length === 0) return spanText(`${open}${close}`, 'hl-punct');

  const block = document.createElement('span');
  block.className = depth === 0 ? 'fold-block open' : 'fold-block';

  const toggle = document.createElement('span');
  toggle.className = 'fold-toggle';
  block.appendChild(toggle);
  block.appendChild(spanText(open, 'hl-punct'));

  const preview = document.createElement('span');
  preview.className = 'fold-preview';
  preview.textContent = ` ${entries.length} ${isArray ? 'items' : 'keys'} `;
  block.appendChild(preview);

  const previewClose = document.createElement('span');
  previewClose.className = 'fold-preview';
  previewClose.appendChild(spanText(close, 'hl-punct'));
  block.appendChild(previewClose);

  const content = document.createElement('div');
  content.className = 'fold-content';
  block.appendChild(content);

  const closeSpan = document.createElement('span');
  closeSpan.className = 'fold-close';
  closeSpan.appendChild(spanText(close, 'hl-punct'));
  block.appendChild(closeSpan);

  function renderEntries() {
    const frag = document.createDocumentFragment();
    let rendered = 0;
    function renderChunk() {
      const end = Math.min(rendered + JSON_CHUNK_SIZE, entries.length);
      for (let i = rendered; i < end; i++) {
        const [k, v] = entries[i];
        const line = document.createElement('div');
        line.className = 'fold-line';
        if (!isArray) {
          line.appendChild(spanText(JSON.stringify(String(k)), 'hl-key'));
          line.appendChild(spanText(': ', 'hl-punct'));
        }
        line.appendChild(buildJsonNode(v, depth + 1));
        if (i < entries.length - 1) line.appendChild(spanText(',', 'hl-punct'));
        frag.appendChild(line);
      }
      rendered = end;
      content.appendChild(frag);
      if (rendered < entries.length) requestAnimationFrame(renderChunk);
    }
    renderChunk();
  }

  if (depth === 0) renderEntries();
  else block._lazyRender = renderEntries;

  return block;
}

// Foldable XML renderer
function renderFoldableXml(str) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(str, 'text/xml');

  if (doc.querySelector('parsererror')) {
    const pre = document.createElement('pre');
    pre.className = 'response-pre';
    pre.innerHTML = highlightXmlFlat(str);
    return pre;
  }

  const el = document.createElement('div');
  el.className = 'fold-tree';
  el.appendChild(buildXmlNode(doc.documentElement, 0));

  el.addEventListener('click', (e) => {
    const toggle = e.target.closest('.fold-toggle');
    if (!toggle) return;
    const block = toggle.closest('.fold-block');
    if (!block.classList.contains('open') && block._lazyRender) {
      block._lazyRender();
      block._lazyRender = null;
    }
    block.classList.toggle('open');
  });

  return el;
}

function buildXmlNode(node, depth) {
  if (node.nodeType === 3) {
    const text = node.textContent.trim();
    if (!text) return null;
    return document.createTextNode(text);
  }
  if (node.nodeType === 8)
    return spanText(`<!--${node.textContent}-->`, 'hl-comment');
  if (node.nodeType !== 1) return null;

  const tag = node.tagName;
  const attrs = Array.from(node.attributes)
    .map(
      (a) =>
        ` <span class="hl-attr">${esc(a.name)}</span>=<span class="hl-str">"${esc(a.value)}"</span>`,
    )
    .join('');

  const children = Array.from(node.childNodes).filter(
    (c) => c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim()),
  );

  if (children.length === 0) {
    const s = document.createElement('span');
    s.innerHTML = `<span class="hl-tag">&lt;${esc(tag)}</span>${attrs}<span class="hl-tag"> /&gt;</span>`;
    return s;
  }

  if (children.length === 1 && children[0].nodeType === 3) {
    const s = document.createElement('span');
    s.innerHTML = `<span class="hl-tag">&lt;${esc(tag)}</span>${attrs}<span class="hl-tag">&gt;</span>${esc(children[0].textContent.trim())}<span class="hl-tag">&lt;/${esc(tag)}&gt;</span>`;
    return s;
  }

  const block = document.createElement('span');
  block.className = depth === 0 ? 'fold-block open' : 'fold-block';

  const toggle = document.createElement('span');
  toggle.className = 'fold-toggle';
  block.appendChild(toggle);

  const openTag = document.createElement('span');
  openTag.innerHTML = `<span class="hl-tag">&lt;${esc(tag)}</span>${attrs}<span class="hl-tag">&gt;</span>`;
  block.appendChild(openTag);

  const previewEl = document.createElement('span');
  previewEl.className = 'fold-preview';
  previewEl.textContent = '...';
  block.appendChild(previewEl);

  const previewClose = document.createElement('span');
  previewClose.className = 'fold-preview';
  previewClose.innerHTML = `<span class="hl-tag">&lt;/${esc(tag)}&gt;</span>`;
  block.appendChild(previewClose);

  const content = document.createElement('div');
  content.className = 'fold-content';
  block.appendChild(content);

  const closeTag = document.createElement('span');
  closeTag.className = 'fold-close';
  closeTag.innerHTML = `<span class="hl-tag">&lt;/${esc(tag)}&gt;</span>`;
  block.appendChild(closeTag);

  function renderChildren() {
    const frag = document.createDocumentFragment();
    children.forEach((c) => {
      const built = buildXmlNode(c, depth + 1);
      if (built) {
        const line = document.createElement('div');
        line.className = 'fold-line';
        line.appendChild(built);
        frag.appendChild(line);
      }
    });
    content.appendChild(frag);
  }

  if (depth === 0) renderChildren();
  else block._lazyRender = renderChildren;

  return block;
}

function generateLineNumbersHtml(count) {
  const nums = [];
  for (let i = 1; i <= count; i++)
    nums.push(`<span class="line-num">${i}</span>`);
  return nums.join('');
}

function wrapWithLineNumbers(contentEl, lineCount) {
  const wrapper = document.createElement('div');
  wrapper.className = 'response-lined';
  const gutter = document.createElement('div');
  gutter.className = 'line-numbers';
  gutter.innerHTML = generateLineNumbersHtml(lineCount);
  wrapper.appendChild(gutter);
  wrapper.appendChild(contentEl);
  contentEl.addEventListener('scroll', () => {
    gutter.scrollTop = contentEl.scrollTop;
  });
  return wrapper;
}

const timelineIcons = {
  info: '\u2022',
  'req-header': '\u25B6',
  'res-status': '\u25C0',
  'res-header': '\u25C0',
  tls: '\u26BF',
  error: '\u2716',
};

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function parseCookies(headers) {
  if (!headers) return [];
  const raw = headers['set-cookie'];
  if (!raw) return [];
  const cookies = Array.isArray(raw) ? raw : [raw];
  return cookies.map((str) => {
    const parts = str.split(';').map((s) => s.trim());
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf('=');
    const name = eqIdx > -1 ? nameVal.slice(0, eqIdx) : nameVal;
    const value = eqIdx > -1 ? nameVal.slice(eqIdx + 1) : '';
    let domain = '',
      path = '',
      expires = '';
    const flags = [];
    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      if (lower.startsWith('domain=')) domain = attr.slice(7);
      else if (lower.startsWith('path=')) path = attr.slice(5);
      else if (lower.startsWith('expires=')) expires = attr.slice(8);
      else if (lower.startsWith('max-age='))
        expires = `max-age: ${attr.slice(8)}s`;
      else if (
        lower === 'secure' ||
        lower === 'httponly' ||
        lower.startsWith('samesite')
      )
        flags.push(attr);
    }
    return { name, value, domain, path, expires, flags };
  });
}

export default function ResponsePane() {
  const [state, actions] = useCollection();

  const [activeTab, setActiveTab] = createSignal('body');
  const [bodyView, setBodyView] = createSignal('pretty');
  const [searchVisible, setSearchVisible] = createSignal(false);
  const [searchMode, setSearchMode] = createSignal('text');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchInfo, setSearchInfo] = createSignal('');
  const [searchResults, setSearchResults] = createSignal(null);
  const [history, setHistory] = createSignal([]);
  const [messageFilter, setMessageFilter] = createSignal('');

  let viewerAPI = null;
  let searchActiveIdx = -1;

  // Load history when request changes or new response arrives
  createEffect(async () => {
    const _track = state.response;
    if (state.activeRequestId) {
      const h = await window.api.getResponseHistory(state.activeRequestId);
      setHistory(h || []);
    }
  });

  function getViewerValue() {
    const sr = searchResults();
    if (sr) {
      const values = sr.map((r) => r.value);
      return JSON.stringify(values.length === 1 ? values[0] : values, null, 2);
    }

    const r = state.response;
    if (!r || r.error || !r.body) return '';
    if (bodyView() === 'raw') return r.body;
    if (isImageResponse()) return '';
    const format = contentTypeToFormat(r.contentType);
    if (format === 'json') {
      try {
        return JSON.stringify(JSON.parse(r.body), null, 2);
      } catch {
        return r.body;
      }
    }
    return r.body;
  }

  function getViewerFormat() {
    if (searchResults()) return 'json';
    if (bodyView() === 'raw') return 'text';
    const r = state.response;
    if (!r) return 'text';
    return contentTypeToFormat(r.contentType) || 'text';
  }

  function isImageResponse() {
    const r = state.response;
    return (
      r &&
      !r.error &&
      r.contentType &&
      r.contentType.startsWith('image/') &&
      r.body
    );
  }

  function statusClass(status) {
    if (!status) return 'error';
    if (status < 300) return 'ok';
    if (status < 400) return 'redirect';
    return 'error';
  }

  // Search
  function openSearch() {
    if (!state.response?.body) return;
    setSearchVisible(true);
  }

  function selectAllBody() {
    viewerAPI?.selectAll();
  }

  function closeSearch() {
    setSearchVisible(false);
    setSearchQuery('');
    setSearchInfo('');
    setSearchResults(null);
    searchActiveIdx = -1;
    viewerAPI?.clearSearch();
  }

  let searchDebounce = null;
  function onSearchInput(query) {
    setSearchQuery(query);
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => executeSearch(query), 200);
  }

  function executeSearch(query) {
    const mode = searchMode();
    searchActiveIdx = -1;
    setSearchInfo('');
    setSearchResults(null);
    viewerAPI?.clearSearch();

    if (!state.response?.body) return;
    if (!query) {
      setSearchInfo('');
      return;
    }

    if (mode === 'text') searchText(query);
    else if (mode === 'jsonpath') searchJsonPath(query);
    else if (mode === 'xpath') searchXPath(query);
  }

  function searchText(query) {
    if (!viewerAPI) return;
    const { count } = viewerAPI.searchText(query);
    if (count === 0) {
      setSearchInfo(t.responsePane.search.noMatches);
      return;
    }
    setSearchInfo(t.responsePane.search.found(count));
    searchActiveIdx = 0;
    highlightActive();
  }

  function highlightActive() {
    if (!viewerAPI) return;
    const count = viewerAPI.getMatchCount();
    if (count === 0) return;
    viewerAPI.highlightMatch(searchActiveIdx);
    setSearchInfo(t.responsePane.search.position(searchActiveIdx + 1, count));
  }

  function navigateSearch(dir) {
    if (!viewerAPI) return;
    const count = viewerAPI.getMatchCount();
    if (count === 0) return;
    searchActiveIdx = (searchActiveIdx + dir + count) % count;
    highlightActive();
  }

  function searchJsonPath(query) {
    const fmt = contentTypeToFormat(state.response?.contentType);
    if (fmt !== 'json') {
      setSearchInfo(t.responsePane.search.notJson);
      return;
    }
    let data;
    try {
      data = JSON.parse(state.response.body);
    } catch {
      setSearchInfo(t.responsePane.search.parseError);
      return;
    }
    try {
      const results = evaluateJsonPath(data, query);
      if (results.length === 0) {
        setSearchInfo(t.responsePane.search.noMatches);
        return;
      }
      setSearchInfo(t.responsePane.search.results(results.length));
      setSearchResults(results);
    } catch (e) {
      setSearchInfo(t.responsePane.search.error);
      setSearchResults([
        { path: t.responsePane.search.error, value: e.message },
      ]);
    }
  }

  function searchXPath(query) {
    const fmt = contentTypeToFormat(state.response?.contentType);
    if (fmt !== 'xml' && fmt !== 'html') {
      setSearchInfo(t.responsePane.search.notXml);
      return;
    }
    try {
      const results = searchXPathResults(state.response.body, query);
      if (results.length === 0) {
        setSearchInfo(t.responsePane.search.noMatches);
        return;
      }
      setSearchInfo(t.responsePane.search.results(results.length));
      setSearchResults(results);
    } catch (e) {
      setSearchInfo(t.responsePane.search.error);
      setSearchResults([
        { path: t.responsePane.search.error, value: e.message },
      ]);
    }
  }

  // Keyboard shortcuts
  function onKeyDown(e) {
    const tag = e.target.tagName;
    const isInput =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      e.target.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      openSearch();
    }
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === 'a' &&
      activeTab() === 'body' &&
      !isInput
    ) {
      e.preventDefault();
      selectAllBody();
    }
    if (e.key === 'Escape' && searchVisible()) closeSearch();
  }
  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  async function loadHistoryResponse(id) {
    const resp = await window.api.loadResponse(id);
    if (resp) {
      actions.setResponse(resp);
      setActiveTab('body');
    }
  }

  const r = () => state.response;
  const hasResponse = () => !!r();
  const isStreaming = () => !!state.streamStatus;
  const isWs = () => state.streamType === 'ws' || r()?.requestMethod === 'WS';
  const hasMessages = () =>
    isWs() || isStreaming() || state.streamMessages?.length > 0;

  createEffect(() => {
    setActiveTab(state.defaultTab || 'body');
  });

  createEffect(() => {
    if (state.streamType === 'ws') setActiveTab('messages');
  });

  return (
    <div
      class="response-pane"
      style={{ display: state.responsePaneVisible ? 'flex' : 'none' }}
    >
      <div class="response-section">
        {/* Response meta */}
        <Show when={hasResponse() || isStreaming() || hasMessages()}>
          <div class="response-meta">
            <Show when={isStreaming()}>
              <span class="response-status" innerHTML={state.streamStatus} />
            </Show>
            <Show when={hasResponse() && !isStreaming()}>
              <span
                class={`response-status ${r().error ? 'error' : statusClass(r().status)}`}
              >
                {r().error
                  ? t.responsePane.error
                  : `${r().status} ${r().statusText}`}
              </span>
            </Show>
            <span class="response-time">
              {r()?.time || state.streamTime
                ? `${r()?.time || state.streamTime}ms`
                : ''}
            </span>
            <Show when={!hasMessages()}>
              <div class="response-meta-actions">
                <div class="body-view-toggle">
                  <button
                    class={`btn btn-ghost btn-sm ${bodyView() === 'pretty' ? 'active' : ''}`}
                    onClick={() => {
                      setBodyView('pretty');
                      setActiveTab('body');
                    }}
                  >
                    {t.responsePane.prettyButton}
                  </button>
                  <button
                    class={`btn btn-ghost btn-sm ${bodyView() === 'raw' ? 'active' : ''}`}
                    onClick={() => {
                      setBodyView('raw');
                      setActiveTab('body');
                    }}
                  >
                    {t.responsePane.rawButton}
                  </button>
                </div>
                <Show when={hasResponse() && !r().error}>
                  <button
                    class="btn btn-ghost btn-sm"
                    onClick={selectAllBody}
                    title={t.responsePane.selectAllButton}
                  >
                    {t.responsePane.selectAllButton}
                  </button>
                </Show>
                <button
                  class="btn btn-ghost btn-sm"
                  onClick={() => {
                    openSearch();
                    setActiveTab('body');
                  }}
                  title={`${t.responsePane.searchButton} (Cmd+F)`}
                >
                  <Icon name="fa-solid fa-magnifying-glass" />{' '}
                  {t.responsePane.searchButton}
                </button>
              </div>
            </Show>
          </div>
        </Show>

        {/* Tabs */}
        <Show when={hasResponse() || isStreaming() || hasMessages()}>
          <div class="response-tabs">
            <Show when={!hasMessages()}>
              <button
                class={`section-tab ${activeTab() === 'body' ? 'active' : ''}`}
                onClick={() => setActiveTab('body')}
              >
                {t.responsePane.tabs.body}
              </button>
            </Show>
            <Show when={hasMessages()}>
              <button
                class={`section-tab ${activeTab() === 'messages' ? 'active' : ''}`}
                onClick={() => setActiveTab('messages')}
              >
                {t.responsePane.tabs.messages}
              </button>
            </Show>
            <button
              class={`section-tab ${activeTab() === 'resp-headers' ? 'active' : ''}`}
              onClick={() => setActiveTab('resp-headers')}
            >
              {t.responsePane.tabs.headers}
            </button>
            <button
              class={`section-tab ${activeTab() === 'cookies' ? 'active' : ''}`}
              onClick={() => setActiveTab('cookies')}
            >
              {t.responsePane.tabs.cookies}
            </button>
            <button
              class={`section-tab ${activeTab() === 'timeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('timeline')}
            >
              {t.responsePane.tabs.timeline}
            </button>
            <button
              class={`section-tab ${activeTab() === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              {t.responsePane.tabs.history}
            </button>
          </div>
        </Show>

        {/* Body tab */}
        <div
          class="response-tab-content"
          id="restab-body"
          style={{ display: activeTab() === 'body' ? 'flex' : 'none' }}
        >
          <Show when={searchVisible()}>
            <div class="response-search-bar" style={{ display: 'flex' }}>
              <Select
                class="select-sm"
                value={searchMode()}
                options={[
                  { value: 'text', label: t.responsePane.search.textMode },
                  { value: 'jsonpath', label: t.responsePane.search.jsonpathMode },
                  { value: 'xpath', label: t.responsePane.search.xpathMode },
                ]}
                onChange={(value) => {
                  setSearchMode(value);
                  executeSearch(searchQuery());
                }}
              />
              <input
                type="text"
                class="url-input search-input"
                placeholder={t.responsePane.searchPlaceholder}
                value={searchQuery()}
                onInput={(e) => onSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    navigateSearch(e.shiftKey ? -1 : 1);
                  }
                }}
                autofocus
              />
              <span class="search-info">{searchInfo()}</span>
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => navigateSearch(-1)}
                title={t.responsePane.search.previousTitle}
              >
                <Icon name="fa-solid fa-chevron-up" />
              </button>
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => navigateSearch(1)}
                title={t.responsePane.search.nextTitle}
              >
                <Icon name="fa-solid fa-chevron-down" />
              </button>
              <button
                class="btn btn-ghost btn-sm"
                onClick={closeSearch}
                title={t.responsePane.search.closeTitle}
              >
                <Icon name="fa-solid fa-xmark" />
              </button>
            </div>
          </Show>

          <Show when={!hasResponse() && !state.sending}>
            <div class="response-placeholder">{t.responsePane.sendPrompt}</div>
          </Show>
          <Show when={state.sending}>
            <div class="response-placeholder">
              <span class="spinner" /> {t.responsePane.sending}
            </div>
          </Show>

          <Show
            when={isImageResponse() && bodyView() !== 'raw' && !searchResults()}
          >
            <div class="response-image-container">
              <img
                class="response-image"
                src={`data:${r().contentType};base64,${r().body}`}
                alt={t.responsePane.responseImageAlt}
              />
            </div>
          </Show>
          <Show when={hasResponse() && r().error && !state.sending}>
            <pre class="response-pre" style="color:var(--danger);padding:8px">
              {r().error}
            </pre>
          </Show>
          <Show
            when={
              hasResponse() &&
              !r().error &&
              !state.sending &&
              !(isImageResponse() && bodyView() !== 'raw' && !searchResults())
            }
          >
            <ResponseViewer
              value={getViewerValue()}
              format={getViewerFormat()}
              onViewReady={(api) => {
                viewerAPI = api;
              }}
            />
          </Show>
        </div>

        {/* Messages tab (streaming) */}
        <div
          class="response-tab-content"
          id="restab-messages"
          style={{ display: activeTab() === 'messages' ? 'flex' : 'none' }}
        >
          <div class="message-search-bar">
            <Icon name="fa-solid fa-magnifying-glass" />
            <input
              type="text"
              class="url-input search-input"
              placeholder={t.responsePane.stream.filterPlaceholder}
              value={messageFilter()}
              onInput={(e) => setMessageFilter(e.target.value)}
            />
            <Show when={messageFilter()}>
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => setMessageFilter('')}
              >
                <Icon name="fa-solid fa-xmark" />
              </button>
            </Show>
          </div>
          <div class="stream-log">
            <For
              each={(state.streamMessages || []).filter((msg) => {
                const q = messageFilter().toLowerCase();
                if (!q) return true;
                return (
                  msg.body.toLowerCase().includes(q) ||
                  msg.type.toLowerCase().includes(q)
                );
              })}
            >
              {(msg) => (
                <div class="stream-entry">
                  <span class={`stream-dir ${msg.dir}`}>
                    {msg.dir === 'in'
                      ? '\u25C0'
                      : msg.dir === 'out'
                        ? '\u25B6'
                        : '\u2022'}
                  </span>
                  <span class="stream-type">{msg.type}</span>
                  <span class={`stream-body${msg.isError ? ' error' : ''}`}>
                    {msg.body}
                  </span>
                  <span class="stream-time">{msg.time}</span>
                </div>
              )}
            </For>
          </div>
          <Show when={state.streamType === 'ws' && state.streamConnected}>
            <div class="stream-compose">
              <Select
                class="select-sm"
                value={state.wsFrameType}
                options={[
                  { value: 'text', label: t.responsePane.stream.frameTypes.text },
                  { value: 'binary', label: t.responsePane.stream.frameTypes.binary },
                  { value: 'ping', label: t.responsePane.stream.frameTypes.ping },
                  { value: 'pong', label: t.responsePane.stream.frameTypes.pong },
                ]}
                onChange={(value) =>
                  actions.updateField('wsFrameType', value)
                }
              />
              <input
                type="text"
                class="url-input"
                placeholder={t.responsePane.stream.messagePlaceholder}
                value={state.wsInput}
                onInput={(e) => actions.updateField('wsInput', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') actions.wsSend();
                }}
              />
              <button class="btn btn-primary btn-sm" onClick={actions.wsSend}>
                <Icon name="fa-solid fa-paper-plane" />{' '}
                {t.responsePane.stream.sendButton}
              </button>
            </div>
          </Show>
        </div>

        {/* Headers tab */}
        <div
          class="response-tab-content"
          style={{ display: activeTab() === 'resp-headers' ? '' : 'none' }}
        >
          <Show
            when={r()?.headers && Object.keys(r().headers).length > 0}
            fallback={
              <div class="response-placeholder">{t.responsePane.noHeaders}</div>
            }
          >
            <div class="resp-headers-list">
              <For
                each={Object.entries(r()?.headers || {}).sort((a, b) =>
                  a[0].localeCompare(b[0]),
                )}
              >
                {([k, v]) => (
                  <div>
                    <span class="resp-header-name">{k}</span>:{' '}
                    <span class="resp-header-value">{String(v)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Cookies tab */}
        <div
          class="response-tab-content"
          style={{ display: activeTab() === 'cookies' ? '' : 'none' }}
        >
          <Show
            when={parseCookies(r()?.headers).length > 0}
            fallback={
              <div class="response-placeholder">{t.responsePane.noCookies}</div>
            }
          >
            <div class="cookies-table">
              <div class="cookies-header">
                <span class="cookie-col cookie-name">
                  {t.responsePane.cookieColumns.name}
                </span>
                <span class="cookie-col cookie-value">
                  {t.responsePane.cookieColumns.value}
                </span>
                <span class="cookie-col cookie-domain">
                  {t.responsePane.cookieColumns.domain}
                </span>
                <span class="cookie-col cookie-path">
                  {t.responsePane.cookieColumns.path}
                </span>
                <span class="cookie-col cookie-expires">
                  {t.responsePane.cookieColumns.expires}
                </span>
                <span class="cookie-col cookie-flags">
                  {t.responsePane.cookieColumns.flags}
                </span>
              </div>
              <For each={parseCookies(r()?.headers)}>
                {(c) => (
                  <div class="cookies-row">
                    <span class="cookie-col cookie-name" title={c.name}>
                      {c.name}
                    </span>
                    <span class="cookie-col cookie-value" title={c.value}>
                      {c.value}
                    </span>
                    <span class="cookie-col cookie-domain">{c.domain}</span>
                    <span class="cookie-col cookie-path">{c.path}</span>
                    <span class="cookie-col cookie-expires">{c.expires}</span>
                    <span class="cookie-col cookie-flags">
                      {c.flags.join(', ')}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Timeline tab */}
        <div
          class="response-tab-content"
          style={{ display: activeTab() === 'timeline' ? '' : 'none' }}
        >
          <Show
            when={r()?.timeline?.length > 0}
            fallback={
              <div class="response-placeholder">
                {t.responsePane.noTimeline}
              </div>
            }
          >
            <div class="timeline">
              <For each={r()?.timeline || []}>
                {(e) => (
                  <div class={`timeline-entry type-${e.type}`}>
                    <span class="timeline-time">{formatDuration(e.t)}</span>
                    <span class="timeline-icon">
                      {timelineIcons[e.type] || '\u2022'}
                    </span>
                    <span class="timeline-text">{e.text}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* History tab */}
        <div
          class="response-tab-content"
          style={{ display: activeTab() === 'history' ? '' : 'none' }}
        >
          <Show
            when={history().length > 0}
            fallback={
              <div class="response-placeholder">{t.responsePane.noHistory}</div>
            }
          >
            <div class="history-list">
              <For each={history()}>
                {(h) => {
                  const sc = h.error
                    ? 'error'
                    : h.status < 300
                      ? 'ok'
                      : h.status < 400
                        ? 'redirect'
                        : 'error';
                  const label = h.error
                    ? t.responsePane.error
                    : `${h.status} ${h.status_text}`;
                  const isWsEntry = h.request_method === 'WS';
                  const duration = isWsEntry
                    ? formatDuration(h.time_ms)
                    : `${h.time_ms}ms`;
                  return (
                    <div
                      class="history-item"
                      onClick={() => loadHistoryResponse(h.id)}
                    >
                      <span class={`history-status ${sc}`}>{label}</span>
                      <span class="history-method">{h.request_method}</span>
                      <span class="history-time">{duration}</span>
                      <span class="history-date">
                        {new Date(h.created_at + 'Z').toLocaleString()}
                      </span>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
