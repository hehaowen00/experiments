const params = new URLSearchParams(window.location.search);
const collectionId = params.get('id');

let collection = null;
let activeRequestId = null;
let currentHeaders = [{ key: '', value: '', enabled: true }];
let currentBodyType = 'text';
let currentFile = null; // { path, name, size }
let currentFormFields = [{ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }];
let autoSaveTimer = null;
let streamConnectionId = null; // active SSE or WS connection ID
let streamType = null; // 'sse' or 'ws'
let lastResponseBody = null;
let lastResponseContentType = '';
let searchMatches = [];
let searchActiveIdx = -1;

const treeEl = document.getElementById('tree');
const nameEl = document.getElementById('collection-name');
const methodEl = document.getElementById('method');
const urlEl = document.getElementById('url');
const bodyEl = document.getElementById('request-body');
const bodyHighlightEl = document.getElementById('request-body-highlight');
const bodyTypeEl = document.getElementById('body-type');
const responseMetaEl = document.getElementById('response-meta');
const responseTabsEl = document.getElementById('response-tabs');
const responseStatusEl = document.getElementById('response-status');
const responseTimeEl = document.getElementById('response-time');
const responsePlaceholderEl = document.getElementById('response-placeholder');
const responseBodyContainer = document.getElementById('response-body-container');
const respHeadersContentEl = document.getElementById('restab-resp-headers');
const timelineContentEl = document.getElementById('restab-timeline');
const historyContentEl = document.getElementById('restab-history');
const headersTableEl = document.getElementById('headers-table');
const formFieldsEl = document.getElementById('form-fields');
const contentTypeSelectEl = document.getElementById('content-type-select');
const requestLineNumbersEl = document.getElementById('request-line-numbers');
let selectedContentType = 'auto'; // auto, json, xml, html, text

// === Custom modal ===

function showPrompt(title, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const input = document.getElementById('modal-input');
    const titleEl = document.getElementById('modal-title');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');
    titleEl.textContent = title;
    input.value = defaultValue || '';
    overlay.classList.add('visible');
    input.focus();
    input.select();
    function cleanup() { overlay.classList.remove('visible'); okBtn.removeEventListener('click', onOk); cancelBtn.removeEventListener('click', onCancel); input.removeEventListener('keydown', onKey); }
    function onOk() { cleanup(); resolve(input.value); }
    function onCancel() { cleanup(); resolve(null); }
    function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function showConfirm(title) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay');
    const titleEl = document.getElementById('confirm-title');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    titleEl.textContent = title;
    overlay.classList.add('visible');
    okBtn.focus();
    function cleanup() { overlay.classList.remove('visible'); okBtn.removeEventListener('click', onOk); cancelBtn.removeEventListener('click', onCancel); overlay.removeEventListener('keydown', onKey); }
    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }
    function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('keydown', onKey);
  });
}

// === Helpers ===

function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function findItem(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.type === 'folder' && item.children) { const f = findItem(item.children, id); if (f) return f; }
  }
  return null;
}

function removeItem(items, id) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) { items.splice(i, 1); return true; }
    if (items[i].type === 'folder' && items[i].children) { if (removeItem(items[i].children, id)) return true; }
  }
  return false;
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// === Syntax highlighting (flat, for request body editor) ===

function detectFormat(str) {
  const t = str.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (t.startsWith('<')) return 'xml';
  return 'text';
}

function highlightJsonFlat(str) {
  const tokens = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
  let last = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) tokens.push(esc(str.slice(last, m.index)));
    if (m[1] && m[2]) tokens.push(`<span class="hl-key">${esc(m[1])}</span>${esc(m[2])}`);
    else if (m[1]) tokens.push(`<span class="hl-str">${esc(m[1])}</span>`);
    else if (m[3]) tokens.push(`<span class="hl-bool">${esc(m[3])}</span>`);
    else if (m[4]) tokens.push(`<span class="hl-num">${esc(m[4])}</span>`);
    else if (m[5]) tokens.push(`<span class="hl-punct">${esc(m[5])}</span>`);
    last = m.index + m[0].length;
  }
  if (last < str.length) tokens.push(esc(str.slice(last)));
  return tokens.join('');
}

function highlightXmlFlat(str) {
  const tokens = [];
  const re = /(<!--[\s\S]*?-->)|(<\/?[\w:.=-]+)|(\s[\w:.-]+=)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\/?>)/g;
  let last = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) tokens.push(esc(str.slice(last, m.index)));
    if (m[1]) tokens.push(`<span class="hl-comment">${esc(m[1])}</span>`);
    else if (m[2]) tokens.push(`<span class="hl-tag">${esc(m[2])}</span>`);
    else if (m[3] && m[4]) tokens.push(`<span class="hl-attr">${esc(m[3])}</span><span class="hl-str">${esc(m[4])}</span>`);
    else if (m[5]) tokens.push(`<span class="hl-tag">${esc(m[5])}</span>`);
    last = m.index + m[0].length;
  }
  if (last < str.length) tokens.push(esc(str.slice(last)));
  return tokens.join('');
}

function highlightFlat(str, format) {
  if (!str) return '';
  if (format === 'json') return highlightJsonFlat(str);
  if (format === 'xml' || format === 'html') return highlightXmlFlat(str);
  return esc(str);
}

function contentTypeToFormat(ct) {
  if (!ct) return 'text';
  if (ct.includes('json')) return 'json';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('html')) return 'html';
  return 'text';
}

// === Foldable JSON renderer ===

function renderFoldableJson(value) {
  const el = document.createElement('div');
  el.className = 'fold-tree';
  el.appendChild(buildJsonNode(value, 0));
  el.addEventListener('click', (e) => {
    const toggle = e.target.closest('.fold-toggle');
    if (!toggle) return;
    const block = toggle.closest('.fold-block');
    // Lazy render: populate content on first expand
    if (!block.classList.contains('open') && block._lazyRender) {
      block._lazyRender();
      block._lazyRender = null;
    }
    block.classList.toggle('open');
  });
  return el;
}

const JSON_CHUNK_SIZE = 100; // render in batches for large arrays/objects

function buildJsonNode(value, depth) {
  if (value === null) return spanText('null', 'hl-bool');
  if (typeof value === 'string') return spanText(JSON.stringify(value), 'hl-str');
  if (typeof value === 'number') return spanText(String(value), 'hl-num');
  if (typeof value === 'boolean') return spanText(String(value), 'hl-bool');

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';

  if (entries.length === 0) return spanText(`${open}${close}`, 'hl-punct');

  const block = document.createElement('span');
  // Only auto-open root level
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
      if (rendered < entries.length) {
        requestAnimationFrame(renderChunk);
      }
    }
    renderChunk();
  }

  // Lazy: defer child rendering until first expand (except root)
  if (depth === 0) {
    renderEntries();
  } else {
    block._lazyRender = renderEntries;
  }

  return block;
}

// === Foldable XML renderer ===

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
  if (node.nodeType === 8) {
    return spanText(`<!--${node.textContent}-->`, 'hl-comment');
  }
  if (node.nodeType !== 1) return null;

  const tag = node.tagName;
  const attrs = Array.from(node.attributes).map(a =>
    ` <span class="hl-attr">${esc(a.name)}</span>=<span class="hl-str">"${esc(a.value)}"</span>`
  ).join('');

  const children = Array.from(node.childNodes).filter(c =>
    c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim())
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

  const preview = document.createElement('span');
  preview.className = 'fold-preview';
  preview.textContent = `...`;
  block.appendChild(preview);

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
    children.forEach(c => {
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

  if (depth === 0) {
    renderChildren();
  } else {
    block._lazyRender = renderChildren;
  }

  return block;
}

function spanText(text, cls) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function generateLineNumbersHtml(count) {
  const nums = [];
  for (let i = 1; i <= count; i++) nums.push(`<span class="line-num">${i}</span>`);
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
  // Sync scroll
  contentEl.addEventListener('scroll', () => { gutter.scrollTop = contentEl.scrollTop; });
  return wrapper;
}

function renderResponseBody(body, contentType) {
  responseBodyContainer.innerHTML = '';
  lastResponseBody = body;
  lastResponseContentType = contentType;
  if (!body) { responseBodyContainer.innerHTML = '<div class="response-placeholder">Empty response</div>'; return; }

  const format = contentTypeToFormat(contentType);

  if (format === 'json') {
    try {
      const formatted = JSON.stringify(JSON.parse(body), null, 2);
      const lineCount = formatted.split('\n').length;
      const foldEl = renderFoldableJson(JSON.parse(body));
      responseBodyContainer.appendChild(wrapWithLineNumbers(foldEl, lineCount));
      return;
    } catch {}
  }

  if (format === 'xml' || format === 'html') {
    const lineCount = body.split('\n').length;
    const foldEl = renderFoldableXml(body);
    responseBodyContainer.appendChild(wrapWithLineNumbers(foldEl, lineCount));
    return;
  }

  const lineCount = body.split('\n').length;
  const pre = document.createElement('pre');
  pre.className = 'response-pre';
  pre.textContent = body;
  responseBodyContainer.appendChild(wrapWithLineNumbers(pre, lineCount));
}

// === Response search ===

const searchBarEl = document.getElementById('response-search-bar');
const searchModeEl = document.getElementById('search-mode');
const searchInputEl = document.getElementById('search-input');
const searchInfoEl = document.getElementById('search-info');
const searchResultsEl = document.getElementById('search-results-container');

function openSearch() {
  if (!lastResponseBody) return;
  searchBarEl.style.display = 'flex';
  searchInputEl.focus();
  // Auto-select mode based on content type
  const fmt = contentTypeToFormat(lastResponseContentType);
  if (fmt === 'json') searchModeEl.value = 'text';
  else if (fmt === 'xml' || fmt === 'html') searchModeEl.value = 'text';
}

function closeSearch() {
  searchBarEl.style.display = 'none';
  searchInputEl.value = '';
  searchInfoEl.textContent = '';
  searchResultsEl.style.display = 'none';
  searchResultsEl.innerHTML = '';
  searchMatches = [];
  searchActiveIdx = -1;
  clearTextHighlights();
  if (lastResponseBody) responseBodyContainer.style.display = 'flex';
}

document.getElementById('search-close').addEventListener('click', closeSearch);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    openSearch();
  }
  if (e.key === 'Escape' && searchBarEl.style.display !== 'none') {
    closeSearch();
  }
});

let searchDebounce = null;
searchInputEl.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(executeSearch, 200);
});
searchModeEl.addEventListener('change', () => executeSearch());
searchInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) navigateSearch(-1);
    else navigateSearch(1);
  }
});
document.getElementById('search-prev').addEventListener('click', () => navigateSearch(-1));
document.getElementById('search-next').addEventListener('click', () => navigateSearch(1));

function executeSearch() {
  const query = searchInputEl.value;
  const mode = searchModeEl.value;

  searchMatches = [];
  searchActiveIdx = -1;
  searchInfoEl.textContent = '';
  searchResultsEl.style.display = 'none';
  searchResultsEl.innerHTML = '';
  clearTextHighlights();

  if (!lastResponseBody) return;

  // Empty query: show full document
  if (!query) {
    responseBodyContainer.style.display = 'flex';
    searchInfoEl.textContent = '';
    return;
  }

  if (mode === 'text') {
    searchText(query);
  } else if (mode === 'jsonpath') {
    searchJsonPath(query);
  } else if (mode === 'xpath') {
    searchXPath(query);
  }
}

// --- Text search with highlighting ---

function clearTextHighlights() {
  responseBodyContainer.querySelectorAll('.search-highlight').forEach(el => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });
}

function searchText(query) {
  const lower = query.toLowerCase();

  // Walk text nodes in responseBodyContainer
  const walker = document.createTreeWalker(responseBodyContainer, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  const marks = [];
  for (const tn of textNodes) {
    const text = tn.textContent;
    const textLower = text.toLowerCase();
    let idx = 0;
    while ((idx = textLower.indexOf(lower, idx)) !== -1) {
      marks.push({ node: tn, start: idx, length: query.length });
      idx += query.length;
    }
  }

  // Apply highlights in reverse to not invalidate offsets
  for (let i = marks.length - 1; i >= 0; i--) {
    const { node: tn, start, length } = marks[i];
    const range = document.createRange();
    range.setStart(tn, start);
    range.setEnd(tn, start + length);
    const mark = document.createElement('span');
    mark.className = 'search-highlight';
    range.surroundContents(mark);
  }

  searchMatches = Array.from(responseBodyContainer.querySelectorAll('.search-highlight'));
  searchInfoEl.textContent = searchMatches.length ? `${searchMatches.length} found` : 'No matches';

  if (searchMatches.length > 0) {
    searchActiveIdx = 0;
    highlightActive();
  }
}

function highlightActive() {
  searchMatches.forEach((el, i) => el.classList.toggle('active', i === searchActiveIdx));
  if (searchMatches[searchActiveIdx]) {
    searchMatches[searchActiveIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    searchInfoEl.textContent = `${searchActiveIdx + 1} / ${searchMatches.length}`;
  }
}

function navigateSearch(dir) {
  if (searchMatches.length === 0) return;
  searchActiveIdx = (searchActiveIdx + dir + searchMatches.length) % searchMatches.length;
  highlightActive();
}

// --- JSONPath search ---

function searchJsonPath(query) {
  const fmt = contentTypeToFormat(lastResponseContentType);
  if (fmt !== 'json') {
    searchInfoEl.textContent = 'Not JSON';
    return;
  }

  let data;
  try { data = JSON.parse(lastResponseBody); } catch {
    searchInfoEl.textContent = 'Parse error';
    return;
  }

  try {
    const results = evaluateJsonPath(data, query);
    if (results.length === 0) {
      searchInfoEl.textContent = 'No matches';
      return;
    }

    searchInfoEl.textContent = `${results.length} result${results.length > 1 ? 's' : ''}`;
    searchResultsEl.style.display = '';
    responseBodyContainer.style.display = 'none';

    const container = document.createElement('div');
    container.className = 'search-results';
    results.forEach(r => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const pathEl = document.createElement('div');
      pathEl.className = 'search-result-path';
      pathEl.textContent = r.path;
      item.appendChild(pathEl);
      const valEl = document.createElement('div');
      valEl.className = 'search-result-value';
      valEl.textContent = typeof r.value === 'object' ? JSON.stringify(r.value, null, 2) : String(r.value);
      item.appendChild(valEl);
      container.appendChild(item);
    });
    searchResultsEl.innerHTML = '';
    searchResultsEl.appendChild(container);
  } catch (e) {
    searchInfoEl.textContent = 'Error';
    searchResultsEl.style.display = '';
    searchResultsEl.innerHTML = `<div class="search-result-error">${esc(e.message)}</div>`;
  }
}

// Minimal JSONPath evaluator: supports $, ., [], *, .., [n], [n:m], [?()]
function evaluateJsonPath(data, path) {
  const results = [];

  if (!path.startsWith('$')) path = '$' + (path.startsWith('.') || path.startsWith('[') ? '' : '.') + path;

  const tokens = tokenizeJsonPath(path);
  if (!tokens) throw new Error('Invalid JSONPath syntax');

  function walk(obj, tIdx, currentPath) {
    if (tIdx >= tokens.length) {
      results.push({ path: currentPath, value: obj });
      return;
    }

    const token = tokens[tIdx];

    if (token.type === 'root') {
      walk(obj, tIdx + 1, '$');
      return;
    }

    if (token.type === 'child') {
      if (obj == null || typeof obj !== 'object') return;
      const key = token.value;
      if (key === '*') {
        const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
        for (const [k, v] of entries) {
          walk(v, tIdx + 1, `${currentPath}[${JSON.stringify(k)}]`);
        }
      } else if (Array.isArray(obj)) {
        const idx = parseInt(key);
        if (!isNaN(idx) && idx >= 0 && idx < obj.length) {
          walk(obj[idx], tIdx + 1, `${currentPath}[${idx}]`);
        }
      } else if (key in obj) {
        walk(obj[key], tIdx + 1, `${currentPath}.${key}`);
      }
      return;
    }

    if (token.type === 'recursive') {
      // Apply remaining tokens at current level and all descendants
      walk(obj, tIdx + 1, currentPath);
      if (obj != null && typeof obj === 'object') {
        const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
        for (const [k, v] of entries) {
          const nextPath = Array.isArray(obj) ? `${currentPath}[${k}]` : `${currentPath}.${k}`;
          walk(v, tIdx, nextPath);
        }
      }
      return;
    }

    if (token.type === 'index') {
      if (!Array.isArray(obj)) return;
      const idx = token.value < 0 ? obj.length + token.value : token.value;
      if (idx >= 0 && idx < obj.length) {
        walk(obj[idx], tIdx + 1, `${currentPath}[${idx}]`);
      }
      return;
    }

    if (token.type === 'slice') {
      if (!Array.isArray(obj)) return;
      const start = (token.start ?? 0) < 0 ? Math.max(0, obj.length + token.start) : (token.start ?? 0);
      const end = (token.end ?? obj.length) < 0 ? Math.max(0, obj.length + token.end) : (token.end ?? obj.length);
      for (let i = start; i < Math.min(end, obj.length); i++) {
        walk(obj[i], tIdx + 1, `${currentPath}[${i}]`);
      }
      return;
    }

    if (token.type === 'filter') {
      if (obj == null || typeof obj !== 'object') return;
      const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
      for (const [k, v] of entries) {
        if (evalFilter(v, token.expr)) {
          const nextPath = Array.isArray(obj) ? `${currentPath}[${k}]` : `${currentPath}.${k}`;
          walk(v, tIdx + 1, nextPath);
        }
      }
      return;
    }
  }

  walk(data, 0, '');
  return results;
}

function tokenizeJsonPath(path) {
  const tokens = [];
  let i = 0;

  while (i < path.length) {
    if (path[i] === '$') {
      tokens.push({ type: 'root' });
      i++;
    } else if (path[i] === '.' && path[i + 1] === '.') {
      tokens.push({ type: 'recursive' });
      i += 2;
    } else if (path[i] === '.') {
      i++;
      let key = '';
      while (i < path.length && path[i] !== '.' && path[i] !== '[') {
        key += path[i++];
      }
      if (key) tokens.push({ type: 'child', value: key });
    } else if (path[i] === '[') {
      i++;
      if (path[i] === '?') {
        // Filter [?(...)]
        i++; // skip ?
        if (path[i] !== '(') return null;
        i++; // skip (
        let depth = 1, expr = '';
        while (i < path.length && depth > 0) {
          if (path[i] === '(') depth++;
          else if (path[i] === ')') { depth--; if (depth === 0) break; }
          expr += path[i++];
        }
        i++; // skip )
        if (path[i] === ']') i++;
        tokens.push({ type: 'filter', expr });
      } else if (path[i] === '\'' || path[i] === '"') {
        const q = path[i++];
        let key = '';
        while (i < path.length && path[i] !== q) key += path[i++];
        i++; // skip closing quote
        if (path[i] === ']') i++;
        tokens.push({ type: 'child', value: key });
      } else if (path[i] === '*') {
        i++;
        if (path[i] === ']') i++;
        tokens.push({ type: 'child', value: '*' });
      } else {
        let num = '';
        while (i < path.length && path[i] !== ']' && path[i] !== ':') num += path[i++];
        if (path[i] === ':') {
          i++;
          let end = '';
          while (i < path.length && path[i] !== ']') end += path[i++];
          if (path[i] === ']') i++;
          tokens.push({ type: 'slice', start: num ? parseInt(num) : null, end: end ? parseInt(end) : null });
        } else {
          if (path[i] === ']') i++;
          tokens.push({ type: 'index', value: parseInt(num) });
        }
      }
    } else {
      i++; // skip unexpected
    }
  }
  return tokens;
}

function evalFilter(value, expr) {
  // Simple filter: @.key op val
  const m = expr.match(/^@\.(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) {
    // Existence: @.key
    const em = expr.match(/^@\.(\w+)$/);
    if (em && value != null && typeof value === 'object') return em[1] in value;
    return false;
  }
  if (value == null || typeof value !== 'object') return false;
  const left = value[m[1]];
  let right = m[3].trim();
  // Parse right side
  if ((right.startsWith('"') && right.endsWith('"')) || (right.startsWith("'") && right.endsWith("'"))) {
    right = right.slice(1, -1);
  } else if (right === 'true') right = true;
  else if (right === 'false') right = false;
  else if (right === 'null') right = null;
  else if (!isNaN(Number(right))) right = Number(right);

  switch (m[2]) {
    case '==': return left == right;
    case '!=': return left != right;
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
  }
  return false;
}

// --- XPath search ---

function searchXPath(query) {
  const fmt = contentTypeToFormat(lastResponseContentType);
  if (fmt !== 'xml' && fmt !== 'html') {
    searchInfoEl.textContent = 'Not XML';
    return;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(lastResponseBody, 'text/xml');
    if (doc.querySelector('parsererror')) {
      searchInfoEl.textContent = 'Parse error';
      return;
    }

    const xpResult = doc.evaluate(query, doc, null, XPathResult.ANY_TYPE, null);
    const results = [];

    switch (xpResult.resultType) {
      case XPathResult.NUMBER_TYPE:
        results.push({ path: query, value: xpResult.numberValue });
        break;
      case XPathResult.STRING_TYPE:
        results.push({ path: query, value: xpResult.stringValue });
        break;
      case XPathResult.BOOLEAN_TYPE:
        results.push({ path: query, value: xpResult.booleanValue });
        break;
      default: {
        let node;
        while ((node = xpResult.iterateNext())) {
          const path = getXmlNodePath(node);
          const value = node.nodeType === 1 ? node.outerHTML || node.textContent : node.textContent;
          results.push({ path, value });
        }
      }
    }

    if (results.length === 0) {
      searchInfoEl.textContent = 'No matches';
      return;
    }

    searchInfoEl.textContent = `${results.length} result${results.length > 1 ? 's' : ''}`;
    searchResultsEl.style.display = '';
    responseBodyContainer.style.display = 'none';

    const container = document.createElement('div');
    container.className = 'search-results';
    results.forEach(r => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const pathEl = document.createElement('div');
      pathEl.className = 'search-result-path';
      pathEl.textContent = r.path;
      item.appendChild(pathEl);
      const valEl = document.createElement('div');
      valEl.className = 'search-result-value';
      valEl.textContent = String(r.value);
      item.appendChild(valEl);
      container.appendChild(item);
    });
    searchResultsEl.innerHTML = '';
    searchResultsEl.appendChild(container);
  } catch (e) {
    searchInfoEl.textContent = 'Error';
    searchResultsEl.style.display = '';
    searchResultsEl.innerHTML = `<div class="search-result-error">${esc(e.message)}</div>`;
  }
}

function getXmlNodePath(node) {
  const parts = [];
  let current = node;
  while (current && current.nodeType === 1) {
    let name = current.tagName;
    const parent = current.parentNode;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === name);
      if (siblings.length > 1) {
        name += `[${siblings.indexOf(current) + 1}]`;
      }
    }
    parts.unshift(name);
    current = current.parentNode;
  }
  return '/' + parts.join('/');
}

// === Request body editor overlay ===

function getRequestFormat() {
  if (selectedContentType !== 'auto') return selectedContentType;
  return detectFormat(bodyEl.value);
}

function updateRequestLineNumbers() {
  const text = bodyEl.value;
  const count = text ? text.split('\n').length : 1;
  const nums = [];
  for (let i = 1; i <= count; i++) nums.push(`<span class="line-num">${i}</span>`);
  requestLineNumbersEl.innerHTML = nums.join('');
}

function updateRequestBodyHighlight() {
  const text = bodyEl.value;
  updateRequestLineNumbers();
  if (!text) { bodyHighlightEl.innerHTML = ''; return; }
  const format = getRequestFormat();
  bodyHighlightEl.innerHTML = highlightFlat(text, format) + '\n';
  // Auto-detect content type indicator
  if (selectedContentType === 'auto') {
    const detected = detectFormat(text);
    contentTypeSelectEl.title = `Detected: ${detected}`;
  }
}

bodyEl.addEventListener('input', () => { updateRequestBodyHighlight(); scheduleAutoSave(); });
bodyEl.addEventListener('scroll', () => {
  const inner = bodyEl.parentElement;
  const pre = inner.querySelector('.code-highlight');
  pre.scrollTop = bodyEl.scrollTop;
  pre.scrollLeft = bodyEl.scrollLeft;
  requestLineNumbersEl.scrollTop = bodyEl.scrollTop;
});

contentTypeSelectEl.addEventListener('change', () => {
  selectedContentType = contentTypeSelectEl.value;
  updateRequestBodyHighlight();
  scheduleAutoSave();
});

// === Body type switching ===

function switchBodyType(type) {
  currentBodyType = type;
  bodyTypeEl.value = type;
  document.getElementById('body-panel-text').style.display = type === 'text' ? '' : 'none';
  document.getElementById('body-panel-file').style.display = type === 'file' ? '' : 'none';
  document.getElementById('body-panel-form').style.display = type === 'form' ? '' : 'none';
}

bodyTypeEl.addEventListener('change', () => { switchBodyType(bodyTypeEl.value); scheduleAutoSave(); });

// === File upload ===

document.getElementById('pick-file-btn').addEventListener('click', async () => {
  const file = await window.api.pickFile();
  if (!file) return;
  currentFile = file;
  renderFileInfo();
  scheduleAutoSave();
});

document.getElementById('clear-file-btn').addEventListener('click', () => {
  currentFile = null;
  renderFileInfo();
  scheduleAutoSave();
});

function renderFileInfo() {
  const info = document.getElementById('file-info');
  const clearBtn = document.getElementById('clear-file-btn');
  if (currentFile) {
    info.textContent = `${currentFile.name} (${formatBytes(currentFile.size)})`;
    clearBtn.style.display = '';
  } else {
    info.textContent = 'No file selected';
    clearBtn.style.display = 'none';
  }
}

// === Form data ===

function renderFormFields() {
  formFieldsEl.innerHTML = currentFormFields.map((f, i) => `
    <div class="form-field-row">
      <input type="text" placeholder="Name" value="${esc(f.key)}" data-form-idx="${i}" data-form-field="key" />
      <select data-form-idx="${i}" data-form-field="type">
        <option value="text" ${f.type === 'text' ? 'selected' : ''}>Text</option>
        <option value="file" ${f.type === 'file' ? 'selected' : ''}>File</option>
      </select>
      ${f.type === 'text'
        ? `<input type="text" placeholder="Value" value="${esc(f.value)}" data-form-idx="${i}" data-form-field="value" />`
        : `<button class="btn btn-ghost btn-sm form-pick-file" data-form-idx="${i}">${f.fileName ? esc(f.fileName) : 'Choose...'}</button>`
      }
      <button class="btn btn-danger btn-sm" data-remove-form="${i}">&times;</button>
    </div>
  `).join('');
}

formFieldsEl.addEventListener('input', (e) => {
  const idx = parseInt(e.target.dataset.formIdx);
  const field = e.target.dataset.formField;
  if (idx >= 0 && field) { currentFormFields[idx][field] = e.target.value; scheduleAutoSave(); }
});

formFieldsEl.addEventListener('change', (e) => {
  const idx = parseInt(e.target.dataset.formIdx);
  const field = e.target.dataset.formField;
  if (idx >= 0 && field === 'type') {
    currentFormFields[idx].type = e.target.value;
    renderFormFields();
    scheduleAutoSave();
  }
});

formFieldsEl.addEventListener('click', async (e) => {
  const removeBtn = e.target.closest('[data-remove-form]');
  if (removeBtn) {
    currentFormFields.splice(parseInt(removeBtn.dataset.removeForm), 1);
    if (currentFormFields.length === 0) currentFormFields.push({ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 });
    renderFormFields();
    scheduleAutoSave();
    return;
  }
  const pickBtn = e.target.closest('.form-pick-file');
  if (pickBtn) {
    const idx = parseInt(pickBtn.dataset.formIdx);
    const file = await window.api.pickFile();
    if (file) {
      currentFormFields[idx].filePath = file.path;
      currentFormFields[idx].fileName = file.name;
      currentFormFields[idx].fileSize = file.size;
      renderFormFields();
      scheduleAutoSave();
    }
  }
});

document.getElementById('add-form-field-btn').addEventListener('click', () => {
  currentFormFields.push({ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 });
  renderFormFields();
});

// === Auto-save ===

function scheduleAutoSave() {
  if (!activeRequestId) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    const item = findItem(collection.items, activeRequestId);
    if (!item) return;
    item.method = methodEl.value;
    item.url = urlEl.value;
    item.headers = currentHeaders.filter(h => h.key);
    item.bodyType = currentBodyType;
    item.contentType = selectedContentType;
    item.body = bodyEl.value;
    item.bodyFile = currentFile;
    item.bodyForm = currentFormFields.filter(f => f.key);
    save();
    renderTree();
  }, 500);
}

methodEl.addEventListener('change', () => scheduleAutoSave());
urlEl.addEventListener('input', () => scheduleAutoSave());

// === Save & Load ===

async function load() {
  collection = await window.api.loadCollection(collectionId);
  if (!collection) { window.location.href = 'index.html'; return; }
  nameEl.textContent = collection.name;
  document.title = `${collection.name} - API Client`;
  renderTree();
}

async function save() { await window.api.saveCollection(collection); }

// === Tree rendering ===

function renderTree() { treeEl.innerHTML = renderItems(collection.items, 0); }

function renderItems(items, depth) {
  return items.map(item => {
    if (item.type === 'folder') {
      const collapsed = item.collapsed ? 'collapsed' : '';
      const arrow = item.collapsed ? '&#9654;' : '&#9660;';
      return `<div class="folder-header" data-id="${item.id}" style="padding-left:${12 + depth * 16}px">
          <span>${arrow}</span><span>${esc(item.name)}</span>
          <div class="folder-actions">
            <button data-action="add-request" data-folder="${item.id}" title="Add request">+</button>
            <button data-action="rename" data-id="${item.id}" title="Rename">&hellip;</button>
            <button data-action="delete" data-id="${item.id}" title="Delete">&times;</button>
          </div></div>
        <div class="folder-children ${collapsed}" data-folder-children="${item.id}">${renderItems(item.children || [], depth + 1)}</div>`;
    }
    const isActive = item.id === activeRequestId ? 'active' : '';
    return `<div class="tree-item ${isActive}" data-id="${item.id}" style="padding-left:${12 + depth * 16}px">
        <span class="method-badge ${item.method || 'GET'}">${item.method || 'GET'}</span>
        <span class="item-name">${esc(item.name)}</span>
        <div class="item-actions">
          <button data-action="rename" data-id="${item.id}" title="Rename">&hellip;</button>
          <button data-action="delete" data-id="${item.id}" title="Delete">&times;</button>
        </div></div>`;
  }).join('');
}

// === Tree interactions ===

treeEl.addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    e.stopPropagation();
    const action = actionBtn.dataset.action;
    const id = actionBtn.dataset.id;
    if (action === 'add-request') {
      const folderId = actionBtn.dataset.folder;
      const folder = findItem(collection.items, folderId);
      if (folder) {
        const name = await showPrompt('Request name:', 'New Request');
        if (name) {
          const req = { id: generateId(), type: 'request', name, method: 'GET', url: '', headers: [], body: '', bodyType: 'text' };
          folder.children = folder.children || [];
          folder.children.push(req);
          await save(); renderTree(); selectRequest(req.id);
        }
      }
    } else if (action === 'rename') {
      const item = findItem(collection.items, id);
      if (item) { const n = await showPrompt('Rename:', item.name); if (n && n.trim()) { item.name = n.trim(); await save(); renderTree(); } }
    } else if (action === 'delete') {
      const item = findItem(collection.items, id);
      if (item && await showConfirm(`Delete "${item.name}"?`)) {
        removeItem(collection.items, id);
        if (activeRequestId === id) { activeRequestId = null; clearEditor(); }
        await save(); renderTree();
      }
    }
    return;
  }
  const folderHeader = e.target.closest('.folder-header');
  if (folderHeader) {
    const id = folderHeader.dataset.id;
    const folder = findItem(collection.items, id);
    if (folder) { folder.collapsed = !folder.collapsed; save(); renderTree(); }
    return;
  }
  const treeItem = e.target.closest('.tree-item');
  if (treeItem) selectRequest(treeItem.dataset.id);
});

async function selectRequest(id) {
  if (streamConnectionId) await disconnectStream();
  activeRequestId = id;
  const item = findItem(collection.items, id);
  if (!item || item.type === 'folder') return;
  methodEl.value = item.method || 'GET';
  urlEl.value = item.url || '';
  bodyEl.value = item.body || '';
  currentHeaders = item.headers && item.headers.length > 0 ? item.headers.map(h => ({ ...h })) : [{ key: '', value: '', enabled: true }];
  currentBodyType = item.bodyType || 'text';
  selectedContentType = item.contentType || 'auto';
  contentTypeSelectEl.value = selectedContentType;
  currentFile = item.bodyFile || null;
  currentFormFields = item.bodyForm && item.bodyForm.length > 0 ? item.bodyForm.map(f => ({ ...f })) : [{ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }];
  renderHeaders();
  updateRequestBodyHighlight();
  switchBodyType(currentBodyType);
  renderFileInfo();
  renderFormFields();
  renderTree();

  const lastResp = await window.api.getLatestResponse(id);
  if (lastResp) showResponse(lastResp);
  else resetResponse();
}

function showResponse(result) {
  closeSearch();
  responseMetaEl.style.display = 'flex';
  responseTabsEl.style.display = 'flex';
  messagesTabBtn.style.display = 'none';
  streamComposeEl.style.display = 'none';
  timelineContentEl.innerHTML = renderTimeline(result.timeline);

  if (result.error) {
    responsePlaceholderEl.style.display = 'none';
    responseBodyContainer.style.display = 'flex';
    responseBodyContainer.innerHTML = `<pre class="response-pre" style="color:var(--danger)">${esc(result.error)}</pre>`;
    responseStatusEl.textContent = 'Error';
    responseStatusEl.className = 'response-status error';
    responseTimeEl.textContent = `${result.time}ms`;
    respHeadersContentEl.innerHTML = '<div class="response-placeholder">No headers</div>';
  } else {
    responsePlaceholderEl.style.display = 'none';
    responseBodyContainer.style.display = 'flex';
    renderResponseBody(result.body, result.contentType);
    responseStatusEl.textContent = `${result.status} ${result.statusText}`;
    responseStatusEl.className = 'response-status ' + (result.status < 300 ? 'ok' : result.status < 400 ? 'redirect' : 'error');
    responseTimeEl.textContent = `${result.time}ms`;
    respHeadersContentEl.innerHTML = renderRespHeaders(result.headers);
  }
  if (activeRequestId) loadHistory(activeRequestId);
}

function clearEditor() {
  methodEl.value = 'GET'; urlEl.value = ''; bodyEl.value = '';
  currentHeaders = [{ key: '', value: '', enabled: true }];
  currentBodyType = 'text'; currentFile = null; selectedContentType = 'auto'; contentTypeSelectEl.value = 'auto';
  currentFormFields = [{ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }];
  renderHeaders(); updateRequestBodyHighlight(); switchBodyType('text'); renderFileInfo(); renderFormFields(); resetResponse();
}

function resetResponse() {
  lastResponseBody = null; lastResponseContentType = '';
  closeSearch();
  responseMetaEl.style.display = 'none'; responseTabsEl.style.display = 'none';
  responsePlaceholderEl.style.display = ''; responsePlaceholderEl.textContent = 'Send a request to see the response';
  responseBodyContainer.style.display = 'none'; responseBodyContainer.innerHTML = '';
  searchResultsEl.style.display = 'none'; searchResultsEl.innerHTML = '';
  respHeadersContentEl.innerHTML = ''; timelineContentEl.innerHTML = ''; historyContentEl.innerHTML = '';
  document.getElementById('stream-log').innerHTML = '';
  document.getElementById('messages-tab-btn').style.display = 'none';
  document.getElementById('stream-compose').style.display = 'none';
  switchResponseTab('body');
}

// === Headers ===

function renderHeaders() {
  headersTableEl.innerHTML = currentHeaders.map((h, i) => `
    <div class="header-row">
      <input type="checkbox" ${h.enabled ? 'checked' : ''} data-header-idx="${i}" data-field="enabled" />
      <input type="text" placeholder="Header name" value="${esc(h.key)}" data-header-idx="${i}" data-field="key" />
      <input type="text" placeholder="Value" value="${esc(h.value)}" data-header-idx="${i}" data-field="value" />
      <button class="btn btn-danger btn-sm" data-remove-header="${i}">&times;</button>
    </div>`).join('');
}

headersTableEl.addEventListener('input', (e) => {
  const idx = parseInt(e.target.dataset.headerIdx), field = e.target.dataset.field;
  if (idx >= 0 && field) { currentHeaders[idx][field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; scheduleAutoSave(); }
});
headersTableEl.addEventListener('change', (e) => {
  if (e.target.type === 'checkbox') { const idx = parseInt(e.target.dataset.headerIdx); if (idx >= 0) { currentHeaders[idx].enabled = e.target.checked; scheduleAutoSave(); } }
});
headersTableEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-header]');
  if (btn) { currentHeaders.splice(parseInt(btn.dataset.removeHeader), 1); if (currentHeaders.length === 0) currentHeaders.push({ key: '', value: '', enabled: true }); renderHeaders(); scheduleAutoSave(); }
});
document.getElementById('add-header-btn').addEventListener('click', () => { currentHeaders.push({ key: '', value: '', enabled: true }); renderHeaders(); });

// === Request tabs ===

function switchRequestTab(activeTab) {
  document.querySelectorAll('.section-tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
  document.getElementById('tab-headers').style.display = activeTab === 'headers' ? '' : 'none';
  document.getElementById('tab-body').style.display = activeTab === 'body' ? '' : 'none';
}

document.querySelectorAll('.section-tab[data-tab]').forEach(tab => {
  tab.addEventListener('click', () => switchRequestTab(tab.dataset.tab));
});

switchRequestTab('headers');

// === Response tabs ===

function switchResponseTab(tab) {
  document.querySelectorAll('[data-restab]').forEach(t => t.classList.toggle('active', t.dataset.restab === tab));
  document.getElementById('restab-body').style.display = tab === 'body' ? 'flex' : 'none';
  document.getElementById('restab-messages').style.display = tab === 'messages' ? 'flex' : 'none';
  document.getElementById('restab-resp-headers').style.display = tab === 'resp-headers' ? '' : 'none';
  document.getElementById('restab-timeline').style.display = tab === 'timeline' ? '' : 'none';
  document.getElementById('restab-history').style.display = tab === 'history' ? '' : 'none';
}

responseTabsEl.addEventListener('click', (e) => { const tab = e.target.closest('[data-restab]'); if (tab) switchResponseTab(tab.dataset.restab); });

switchResponseTab('body');

const timelineIcons = { 'info': '\u2022', 'req-header': '\u25B6', 'res-status': '\u25C0', 'res-header': '\u25C0', 'tls': '\u26BF', 'error': '\u2716' };

function renderTimeline(timeline) {
  if (!timeline || !timeline.length) return '<div class="response-placeholder">No timeline data</div>';
  return '<div class="timeline">' + timeline.map(e =>
    `<div class="timeline-entry type-${e.type}"><span class="timeline-time">${e.t}ms</span><span class="timeline-icon">${timelineIcons[e.type] || '\u2022'}</span><span class="timeline-text">${esc(e.text)}</span></div>`
  ).join('') + '</div>';
}

function renderRespHeaders(headers) {
  if (!headers || !Object.keys(headers).length) return '<div class="response-placeholder">No headers</div>';
  return '<div class="resp-headers-list">' + Object.entries(headers).map(([k, v]) =>
    `<div><span class="resp-header-name">${esc(k)}</span>: <span class="resp-header-value">${esc(String(v))}</span></div>`
  ).join('') + '</div>';
}

// === History ===

async function loadHistory(requestId) {
  const history = await window.api.getResponseHistory(requestId);
  if (!history || !history.length) { historyContentEl.innerHTML = '<div class="response-placeholder">No history yet</div>'; return; }
  historyContentEl.innerHTML = '<div class="history-list">' + history.map(h => {
    const sc = h.error ? 'error' : (h.status < 300 ? 'ok' : h.status < 400 ? 'redirect' : 'error');
    const label = h.error ? 'Error' : `${h.status} ${h.status_text}`;
    const date = new Date(h.created_at + 'Z').toLocaleString();
    return `<div class="history-item" data-response-id="${h.id}"><span class="history-status ${sc}">${esc(label)}</span><span class="history-method">${esc(h.request_method)}</span><span class="history-time">${h.time_ms}ms</span><span class="history-date">${esc(date)}</span></div>`;
  }).join('') + '</div>';
}

historyContentEl.addEventListener('click', async (e) => {
  const item = e.target.closest('.history-item');
  if (!item) return;
  const resp = await window.api.loadResponse(parseInt(item.dataset.responseId));
  if (resp) { showResponse(resp); switchResponseTab('body'); }
});

// === Send request ===

const sendBtn = document.getElementById('send-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const streamLogEl = document.getElementById('stream-log');
const messagesTabBtn = document.getElementById('messages-tab-btn');
const streamComposeEl = document.getElementById('stream-compose');
const wsMessageInput = document.getElementById('ws-message-input');

function setStreamUI(connected) {
  sendBtn.style.display = connected ? 'none' : '';
  disconnectBtn.style.display = connected ? '' : 'none';
}

function appendStreamEntry(dir, type, body, isError) {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'stream-entry';
  const arrow = dir === 'in' ? '\u25C0' : dir === 'out' ? '\u25B6' : '\u2022';
  entry.innerHTML = `<span class="stream-dir ${dir}">${arrow}</span><span class="stream-type">${esc(type)}</span><span class="stream-body${isError ? ' error' : ''}">${esc(body)}</span><span class="stream-time">${esc(time)}</span>`;
  streamLogEl.appendChild(entry);
  streamLogEl.scrollTop = streamLogEl.scrollHeight;
}

async function disconnectStream() {
  if (streamConnectionId) {
    if (streamType === 'sse') await window.api.sseDisconnect(streamConnectionId);
    else if (streamType === 'ws') await window.api.wsDisconnect(streamConnectionId);
    streamConnectionId = null;
    streamType = null;
  }
  setStreamUI(false);
}

disconnectBtn.addEventListener('click', () => {
  appendStreamEntry('sys', 'system', 'Disconnected by user');
  disconnectStream();
});

async function ensureActiveRequest(method, url) {
  if (!activeRequestId) {
    const req = { id: generateId(), type: 'request', name: url.replace(/^(?:wss?|https?):\/\//, '').slice(0, 40), method, url, headers: currentHeaders.filter(h => h.key), body: bodyEl.value, bodyType: currentBodyType };
    collection.items.push(req);
    activeRequestId = req.id;
    await save(); renderTree();
  }
}

sendBtn.addEventListener('click', async () => {
  let method = methodEl.value;
  const url = urlEl.value.trim();
  if (!url) { urlEl.focus(); return; }

  // Auto-detect WebSocket from URL scheme
  if (method !== 'WS' && (url.startsWith('ws://') || url.startsWith('wss://'))) {
    method = 'WS';
    methodEl.value = 'WS';
  }

  // Disconnect any existing stream
  if (streamConnectionId) await disconnectStream();

  await ensureActiveRequest(method, url);

  if (method === 'WS') {
    await startWs(url);
  } else {
    await sendHttpRequest(method, url);
  }
});

async function sendHttpRequest(method, url) {
  responsePlaceholderEl.style.display = '';
  responsePlaceholderEl.innerHTML = '<span class="spinner"></span> Sending...';
  responseBodyContainer.style.display = 'none';
  responseMetaEl.style.display = 'none';
  responseTabsEl.style.display = 'none';
  messagesTabBtn.style.display = 'none';

  const sendOpts = {
    method, url,
    headers: currentHeaders.filter(h => h.key),
    bodyType: currentBodyType,
    body: bodyEl.value,
    filePath: currentFile?.path || null,
    formFields: currentFormFields.filter(f => f.key).map(f => ({
      key: f.key, value: f.value, type: f.type,
      filePath: f.filePath, fileName: f.fileName, fileMimeType: '',
    })),
    _requestId: activeRequestId,
  };

  const result = await window.api.sendRequest(sendOpts);

  // SSE detected — switch to streaming mode
  if (result.sse) {
    streamConnectionId = result.sseId;
    streamType = 'sse';

    streamLogEl.innerHTML = '';
    messagesTabBtn.style.display = '';
    streamComposeEl.style.display = 'none';
    responseMetaEl.style.display = 'flex';
    responseTabsEl.style.display = 'flex';
    responsePlaceholderEl.style.display = 'none';
    responseBodyContainer.style.display = 'none';

    responseStatusEl.innerHTML = `<span class="stream-status"><span class="dot connected"></span> SSE ${result.status}</span>`;
    responseStatusEl.className = 'response-status';
    responseTimeEl.textContent = `${result.time}ms`;

    respHeadersContentEl.innerHTML = renderRespHeaders(result.headers);
    timelineContentEl.innerHTML = renderTimeline(result.timeline);

    setStreamUI(true);
    switchResponseTab('messages');
    return;
  }

  await window.api.saveResponse({
    request_id: activeRequestId, collection_id: collectionId,
    status: result.status || null, status_text: result.statusText || null,
    response_headers: result.headers || {}, response_body: result.body || null,
    timeline: result.timeline || [], time_ms: result.time,
    request_method: method, request_url: url,
    request_headers: currentHeaders.filter(h => h.key), request_body: bodyEl.value,
    content_type: result.contentType || '', error: result.error || null,
  });

  showResponse(result);
  switchResponseTab(result.error ? 'timeline' : 'body');
}

// === WebSocket ===

async function startWs(url) {
  // Convert http(s) to ws(s) if needed, or leave ws(s) as-is
  let wsUrl = url;
  if (wsUrl.startsWith('http://')) wsUrl = 'ws://' + wsUrl.slice(7);
  else if (wsUrl.startsWith('https://')) wsUrl = 'wss://' + wsUrl.slice(8);
  else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) wsUrl = 'ws://' + wsUrl;

  const connId = generateId();
  streamConnectionId = connId;
  streamType = 'ws';

  streamLogEl.innerHTML = '';
  messagesTabBtn.style.display = '';
  streamComposeEl.style.display = 'flex';
  responseMetaEl.style.display = 'flex';
  responseTabsEl.style.display = 'flex';
  responsePlaceholderEl.style.display = 'none';
  responseBodyContainer.style.display = 'none';

  responseStatusEl.innerHTML = '<span class="stream-status"><span class="dot connected"></span> Connecting...</span>';
  responseStatusEl.className = 'response-status';
  responseTimeEl.textContent = '';

  setStreamUI(true);
  switchResponseTab('messages');

  appendStreamEntry('sys', 'system', `Connecting to ${wsUrl}...`);

  await window.api.wsConnect({
    id: connId, url: wsUrl,
    headers: currentHeaders.filter(h => h.key),
  });
}

// WS send message
document.getElementById('ws-send-msg-btn').addEventListener('click', async () => {
  const msg = wsMessageInput.value;
  if (!msg || !streamConnectionId || streamType !== 'ws') return;
  await window.api.wsSend({ id: streamConnectionId, data: msg });
  appendStreamEntry('out', 'sent', msg);
  wsMessageInput.value = '';
});

wsMessageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('ws-send-msg-btn').click();
});

// === SSE event listeners ===

window.api.onSseOpen((d) => {
  if (d.id !== streamConnectionId) return;
  responseStatusEl.innerHTML = `<span class="stream-status"><span class="dot connected"></span> Connected</span>`;
  appendStreamEntry('sys', 'system', `Connected — ${d.status} ${d.statusText}`);
});

window.api.onSseEvent((d) => {
  if (d.id !== streamConnectionId) return;
  const label = d.event.type !== 'message' ? d.event.type : 'data';
  appendStreamEntry('in', label, d.event.data);
});

window.api.onSseError((d) => {
  if (d.id !== streamConnectionId) return;
  appendStreamEntry('sys', 'error', d.error, true);
  responseStatusEl.innerHTML = `<span class="stream-status"><span class="dot disconnected"></span> Error</span>`;
  setStreamUI(false);
  streamConnectionId = null; streamType = null;
});

window.api.onSseClose((d) => {
  if (d.id !== streamConnectionId) return;
  appendStreamEntry('sys', 'system', 'Connection closed');
  responseStatusEl.innerHTML = `<span class="stream-status"><span class="dot disconnected"></span> Closed</span>`;
  setStreamUI(false);
  streamConnectionId = null; streamType = null;
});

// === WebSocket event listeners ===

window.api.onWsOpen((d) => {
  if (d.id !== streamConnectionId) return;
  responseStatusEl.innerHTML = `<span class="stream-status"><span class="dot connected"></span> Connected</span>`;
  appendStreamEntry('sys', 'system', 'WebSocket connected');
});

window.api.onWsMessage((d) => {
  if (d.id !== streamConnectionId) return;
  appendStreamEntry('in', d.isBinary ? 'binary' : 'text', d.data);
});

window.api.onWsError((d) => {
  if (d.id !== streamConnectionId) return;
  appendStreamEntry('sys', 'error', d.error, true);
  responseStatusEl.innerHTML = `<span class="stream-status"><span class="dot disconnected"></span> Error</span>`;
  setStreamUI(false);
  streamConnectionId = null; streamType = null;
});

window.api.onWsClose((d) => {
  if (d.id !== streamConnectionId) return;
  appendStreamEntry('sys', 'system', `Connection closed (code: ${d.code}${d.reason ? ', reason: ' + d.reason : ''})`);
  responseStatusEl.innerHTML = `<span class="stream-status"><span class="dot disconnected"></span> Closed</span>`;
  setStreamUI(false);
  streamConnectionId = null; streamType = null;
});

// === Sidebar buttons ===

document.getElementById('back-btn').addEventListener('click', () => { window.location.href = 'index.html'; });

document.getElementById('add-request-btn').addEventListener('click', async () => {
  const name = await showPrompt('Request name:', 'New Request');
  if (!name) return;
  const req = { id: generateId(), type: 'request', name, method: 'GET', url: '', headers: [], body: '', bodyType: 'text' };
  collection.items.push(req); await save(); renderTree(); selectRequest(req.id);
});

document.getElementById('add-folder-btn').addEventListener('click', async () => {
  const name = await showPrompt('Folder name:', 'New Folder');
  if (!name) return;
  collection.items.push({ id: generateId(), type: 'folder', name, children: [], collapsed: false });
  await save(); renderTree();
});

// === Keyboard shortcuts ===

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') document.getElementById('send-btn').click();
});

// === Resizable panels ===

function initResize(handleEl, getTarget, axis) {
  handleEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handleEl.classList.add('active');
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    const target = getTarget();
    const startPos = axis === 'x' ? e.clientX : e.clientY;
    const startSize = axis === 'x' ? target.offsetWidth : target.offsetHeight;

    function onMove(ev) {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - startPos;
      const newSize = Math.max(0, startSize + delta);
      if (axis === 'x') {
        target.style.width = newSize + 'px';
        target.style.flex = '0 0 auto';
      } else {
        target.style.height = newSize + 'px';
        target.style.flex = '0 0 auto';
      }
    }

    function onUp() {
      handleEl.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

const sidebarEl = document.querySelector('.sidebar');
const sidebarHandle = document.getElementById('sidebar-resize');
initResize(sidebarHandle, () => sidebarEl, 'x');

const requestPane = document.getElementById('request-pane');
const paneHandle = document.getElementById('pane-resize');

function getPaneAxis() {
  return window.matchMedia('(min-aspect-ratio: 1/1)').matches ? 'x' : 'y';
}

paneHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const axis = getPaneAxis();
  paneHandle.classList.add('active');
  document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
  document.body.style.userSelect = 'none';

  const startPos = axis === 'x' ? e.clientX : e.clientY;
  const startSize = axis === 'x' ? requestPane.offsetWidth : requestPane.offsetHeight;

  function onMove(ev) {
    const delta = (axis === 'x' ? ev.clientX : ev.clientY) - startPos;
    const newSize = Math.max(0, startSize + delta);
    if (axis === 'x') {
      requestPane.style.width = newSize + 'px';
      requestPane.style.height = '';
    } else {
      requestPane.style.height = newSize + 'px';
      requestPane.style.width = '';
    }
    requestPane.style.flex = '0 0 auto';
  }

  function onUp() {
    paneHandle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// Reset pane sizes on layout change
window.matchMedia('(min-aspect-ratio: 1/1)').addEventListener('change', () => {
  requestPane.style.width = '';
  requestPane.style.height = '';
  requestPane.style.flex = '';
});

// === Init ===

window.addEventListener('beforeunload', () => { if (streamConnectionId) disconnectStream(); });

load();
