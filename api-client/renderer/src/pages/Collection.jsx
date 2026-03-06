import { createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { generateId, findItem, removeItem, findParentArray, isDescendant, resolveVariables, buildUrlWithParams, parseCurl } from '../helpers';
import { showPrompt, showConfirm, showTextarea } from '../components/Modal';
import Modal from '../components/Modal';
import Sidebar from '../components/Sidebar';
import Variables from '../components/Variables';
import RequestPane from '../components/RequestPane';
import ResponsePane from '../components/ResponsePane';
import Icon from '../components/Icon';
import t from '../locale';

export default function Collection(props) {
  const [collection, setCollection] = createSignal(null);
  const [activeRequestId, setActiveRequestId] = createSignal(null);
  const [protocol, setProtocol] = createSignal('http');
  const [method, setMethod] = createSignal('GET');
  const [url, setUrl] = createSignal('');
  const [body, setBody] = createSignal('');
  const [headers, setHeaders] = createSignal([{ key: '', value: '', enabled: true }]);
  const [params, setParams] = createSignal([{ key: '', value: '', enabled: true }]);
  const [bodyType, setBodyType] = createSignal('text');
  const [contentType, setContentType] = createSignal('auto');
  const [file, setFile] = createSignal(null);
  const [formFields, setFormFields] = createSignal([{ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }]);
  const [response, setResponse] = createSignal(null);
  const [sending, setSending] = createSignal(false);
  const [responsePaneVisible, setResponsePaneVisible] = createSignal(false);
  const [defaultTab, setDefaultTab] = createSignal('body');
  const [sidebarOpen, setSidebarOpen] = createSignal(true);

  // Streaming state
  const [streamConnectionId, setStreamConnectionId] = createSignal(null);
  const [streamType, setStreamType] = createSignal(null);
  const [streamConnected, setStreamConnected] = createSignal(false);
  const [streamStatus, setStreamStatus] = createSignal('');
  const [streamTime, setStreamTime] = createSignal(0);
  const [streamMessages, setStreamMessages] = createSignal([]);
  const [wsInput, setWsInput] = createSignal('');
  const [wsFrameType, setWsFrameType] = createSignal('text');

  let wsStartTime = null;
  let wsTimeline = [];

  // Track which request owns the active stream
  let streamRequestId = null;
  // Stashed stream state when switching away from a connected request
  let stashedStream = null;

  const [variables, setVariables] = createSignal([{ key: '', value: '' }]);

  let autoSaveTimer = null;
  let dragItemId = null;

  // Load collection
  onMount(async () => {
    const c = await window.api.loadCollection(props.id);
    if (!c) { props.onBack(); return; }
    setCollection(c);
    setVariables([{ key: '', value: '' }]);
    document.title = `${t.app.name} - ${c.name}`;
  });

  async function save() {
    const c = collection();
    if (c) await window.api.saveCollection(c);
  }

  function scheduleAutoSave() {
    if (!activeRequestId()) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      const c = collection();
      if (!c) return;
      const item = findItem(c.items, activeRequestId());
      if (!item) return;
      item.method = protocol() === 'ws' ? 'WS' : method();
      item.url = url();
      item.headers = headers().filter(h => h.key);
      item.params = params().filter(p => p.key);
      item.bodyType = bodyType();
      item.contentType = contentType();
      item.body = body();
      item.bodyFile = file();
      item.bodyForm = formFields().filter(f => f.key);
      item.variables = variables().filter(v => v.key);
      setCollection({ ...c, items: structuredClone(c.items) });
      save();
    }, 500);
  }

  // Variable management
  function onVariableChange(idx, field, value) {
    setVariables(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    saveVariables();
  }

  function removeVariable(idx) {
    setVariables(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      if (next.length === 0) next.push({ key: '', value: '' });
      return next;
    });
    saveVariables();
  }

  function addVariable() {
    setVariables(prev => [...prev, { key: '', value: '' }]);
  }

  function reorderVariables(from, to) {
    setVariables(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    saveVariables();
  }

  function saveVariables() {
    scheduleAutoSave();
  }

  function getVariables() {
    return variables().filter(v => v.key);
  }

  // Select a request
  async function selectRequest(id) {
    // Stash active stream if switching away from the connected request
    if (streamConnectionId() && streamRequestId && streamRequestId !== id) {
      stashedStream = {
        requestId: streamRequestId,
        connectionId: streamConnectionId(),
        type: streamType(),
        connected: streamConnected(),
        status: streamStatus(),
        time: streamTime(),
        messages: streamMessages(),
        response: response(),
        wsStartTime,
        wsTimeline: [...wsTimeline],
        wsResponseHeaders: { ...wsResponseHeaders },
      };
    }

    setResponse(null);
    setSending(false);
    setDefaultTab(null);
    setActiveRequestId(id);
    const c = collection();
    const item = findItem(c.items, id);
    if (!item || item.type === 'folder') return;

    const m = item.method || 'GET';
    setProtocol(m === 'WS' ? 'ws' : 'http');
    setMethod(m);
    setUrl(item.url || '');
    setBody(item.body || '');
    setHeaders(item.headers?.length > 0 ? item.headers.map(h => ({ ...h })) : [{ key: '', value: '', enabled: true }]);
    setParams(item.params?.length > 0 ? item.params.map(p => ({ ...p })) : [{ key: '', value: '', enabled: true }]);
    setBodyType(item.bodyType || 'text');
    setContentType(item.contentType || 'auto');
    setFile(item.bodyFile || null);
    setFormFields(item.bodyForm?.length > 0 ? item.bodyForm.map(f => ({ ...f })) : [{ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }]);
    setVariables(item.variables?.length > 0 ? item.variables.map(v => ({ ...v })) : [{ key: '', value: '' }]);

    // Restore stashed stream if switching back to the connected request
    if (stashedStream && stashedStream.requestId === id) {
      setStreamConnectionId(stashedStream.connectionId);
      setStreamType(stashedStream.type);
      setStreamConnected(stashedStream.connected);
      setStreamStatus(stashedStream.status);
      setStreamTime(stashedStream.time);
      setStreamMessages(stashedStream.messages);
      setResponse(stashedStream.response);
      wsStartTime = stashedStream.wsStartTime;
      wsTimeline = stashedStream.wsTimeline;
      wsResponseHeaders = stashedStream.wsResponseHeaders;
      stashedStream = null;
      setDefaultTab('messages');
      setResponsePaneVisible(true);
      return;
    }

    // Clear stream state for non-stream requests
    setStreamMessages([]);
    setStreamStatus('');
    setStreamType(null);
    setStreamConnected(false);

    const lastResp = await window.api.getLatestResponse(id);
    setResponse(lastResp || null);
    if (lastResp?.messages?.length > 0) {
      setStreamMessages(lastResp.messages);
    }
    setDefaultTab(lastResp?.requestMethod === 'WS' ? 'messages' : 'body');
    setResponsePaneVisible(true);
  }

  function clearEditor() {
    setProtocol('http');
    setMethod('GET');
    setUrl('');
    setBody('');
    setHeaders([{ key: '', value: '', enabled: true }]);
    setParams([{ key: '', value: '', enabled: true }]);
    setBodyType('text');
    setContentType('auto');
    setFile(null);
    setFormFields([{ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }]);
    setVariables([{ key: '', value: '' }]);
    setResponse(null);
    setSending(false);
  }

  // Tree actions
  async function handleRename(id) {
    const c = collection();
    const item = findItem(c.items, id);
    if (!item) return;
    const n = await showPrompt(t.sidebar.renameModal.title, item.name);
    if (n && n.trim()) {
      item.name = n.trim();
      setCollection({ ...c, items: structuredClone(c.items) });
      save();
    }
  }

  async function handleDelete(id) {
    const c = collection();
    const item = findItem(c.items, id);
    if (!item) return;
    if (await showConfirm(`Delete "${item.name}"?`)) {
      removeItem(c.items, id);
      if (activeRequestId() === id) { setActiveRequestId(null); clearEditor(); }
      setCollection({ ...c, items: structuredClone(c.items) });
      save();
    }
  }

  function toggleFolder(id) {
    const c = collection();
    const folder = findItem(c.items, id);
    if (folder) {
      folder.collapsed = !folder.collapsed;
      setCollection({ ...c, items: structuredClone(c.items) });
      save();
    }
  }

  async function addToFolder(folderId) {
    const c = collection();
    const folder = findItem(c.items, folderId);
    if (!folder) return;
    const name = await showPrompt('Request name:', 'New Request');
    if (!name) return;
    const req = { id: generateId(), type: 'request', name, method: 'GET', url: '', headers: [], body: '', bodyType: 'text' };
    folder.children = folder.children || [];
    folder.children.push(req);
    setCollection({ ...c, items: structuredClone(c.items) });
    await save();
    selectRequest(req.id);
  }

  async function addRequest() {
    const name = await showPrompt('Request name:', 'New Request');
    if (!name) return;
    const c = collection();
    const req = { id: generateId(), type: 'request', name, method: 'GET', url: '', headers: [], body: '', bodyType: 'text' };
    c.items.push(req);
    setCollection({ ...c, items: structuredClone(c.items) });
    await save();
    selectRequest(req.id);
  }

  async function addFolder() {
    const name = await showPrompt('Folder name:', 'New Folder');
    if (!name) return;
    const c = collection();
    c.items.push({ id: generateId(), type: 'folder', name, children: [], collapsed: false });
    setCollection({ ...c, items: structuredClone(c.items) });
    save();
  }

  async function importRequests() {
    const result = await window.api.importRequests();
    if (!result) return;
    if (result.error) return alert(result.error);
    const c = collection();
    c.items.push(...result.items);
    setCollection({ ...c, items: structuredClone(c.items) });
    save();
  }

  async function renameCollection() {
    const c = collection();
    const name = await showPrompt(t.landing.renameCollectionModal.title, c.name);
    if (name && name.trim()) {
      c.name = name.trim();
      setCollection({ ...c, items: structuredClone(c.items) });
      document.title = `${t.app.name} - ${c.name}`;
      save();
    }
  }

  // Drag and drop
  function onDragStart(e, id) {
    dragItemId = id;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }

  function onDragOver(e, targetId, isFolder) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (targetId === dragItemId) return;

    const el = e.currentTarget;
    el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;

    if (isFolder) {
      if (ratio < 0.25) el.classList.add('drag-over-above');
      else if (ratio > 0.75) el.classList.add('drag-over-below');
      else el.classList.add('drag-over-inside');
    } else {
      if (ratio < 0.5) el.classList.add('drag-over-above');
      else el.classList.add('drag-over-below');
    }
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  }

  async function onDrop(e, targetId) {
    e.preventDefault();
    const el = e.currentTarget;
    if (!dragItemId || targetId === dragItemId) return;

    const c = collection();
    if (isDescendant(c.items, dragItemId, targetId)) return;

    const zone = el.classList.contains('drag-over-above') ? 'above'
      : el.classList.contains('drag-over-below') ? 'below'
      : el.classList.contains('drag-over-inside') ? 'inside'
      : null;

    el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
    if (!zone) return;

    const dragItem = findItem(c.items, dragItemId);
    if (!dragItem) return;
    removeItem(c.items, dragItemId);

    if (zone === 'inside') {
      const folder = findItem(c.items, targetId);
      if (folder && folder.type === 'folder') {
        folder.children = folder.children || [];
        folder.children.push(dragItem);
        folder.collapsed = false;
      }
    } else {
      const parent = findParentArray(c.items, targetId);
      if (parent) {
        const insertIdx = zone === 'above' ? parent.index : parent.index + 1;
        parent.arr.splice(insertIdx, 0, dragItem);
      }
    }

    dragItemId = null;
    setCollection({ ...c, items: structuredClone(c.items) });
    await save();
  }

  // Header management
  function onHeaderChange(idx, field, value) {
    setHeaders(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: field === 'key' ? value.toLowerCase() : value };
      return next;
    });
    scheduleAutoSave();
  }

  function removeHeader(idx) {
    setHeaders(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      if (next.length === 0) next.push({ key: '', value: '', enabled: true });
      return next;
    });
    scheduleAutoSave();
  }

  function addHeader() {
    setHeaders(prev => [...prev, { key: '', value: '', enabled: true }]);
  }

  const contentTypeMimeMap = {
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    text: 'text/plain',
  };

  function syncContentTypeHeader(ct) {
    const mime = contentTypeMimeMap[ct];
    setHeaders(prev => {
      const next = [...prev];
      const idx = next.findIndex(h => h.key === 'content-type');
      if (!mime || ct === 'auto') {
        if (idx >= 0) next.splice(idx, 1);
        if (next.length === 0) next.push({ key: '', value: '', enabled: true });
      } else if (idx >= 0) {
        next[idx] = { ...next[idx], value: mime, enabled: true };
      } else {
        next.push({ key: 'content-type', value: mime, enabled: true });
      }
      return next;
    });
  }

  function reorderHeaders(from, to) {
    setHeaders(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    scheduleAutoSave();
  }

  // Param management
  function onParamChange(idx, field, value) {
    setParams(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    scheduleAutoSave();
  }

  function removeParam(idx) {
    setParams(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      if (next.length === 0) next.push({ key: '', value: '', enabled: true });
      return next;
    });
    scheduleAutoSave();
  }

  function addParam() {
    setParams(prev => [...prev, { key: '', value: '', enabled: true }]);
  }

  function reorderParams(from, to) {
    setParams(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    scheduleAutoSave();
  }

  function handleUrlPaste(e) {
    const pasted = e.clipboardData.getData('text');
    if (!pasted) return;
    try {
      const urlObj = new URL(pasted);
      const entries = [...urlObj.searchParams.entries()];
      if (entries.length === 0) return;
      e.preventDefault();
      const baseUrl = pasted.split('?')[0];
      setUrl(baseUrl);
      const newParams = entries.map(([key, value]) => ({ key, value, enabled: true }));
      setParams(prev => {
        const existing = prev.filter(p => p.key);
        const combined = [...existing, ...newParams, { key: '', value: '', enabled: true }];
        return combined;
      });
      scheduleAutoSave();
    } catch {
      // not a valid URL, let default paste happen
    }
  }

  async function importCurl() {
    const input = await showTextarea(t.collection.importCurlModal.title);
    if (!input) return;
    const parsed = parseCurl(input);
    if (!parsed) return;
    setProtocol('http');
    setMethod(parsed.method);
    setUrl(parsed.url);
    if (parsed.body) setBody(parsed.body);
    if (parsed.headers.length > 0) setHeaders([...parsed.headers, { key: '', value: '', enabled: true }]);
    if (parsed.params.length > 0) setParams([...parsed.params, { key: '', value: '', enabled: true }]);
    scheduleAutoSave();
  }

  // Form field management
  function onFormFieldChange(idx, field, value) {
    setFormFields(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    scheduleAutoSave();
  }

  function removeFormField(idx) {
    setFormFields(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      if (next.length === 0) next.push({ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 });
      return next;
    });
    scheduleAutoSave();
  }

  function addFormField() {
    setFormFields(prev => [...prev, { key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }]);
  }

  function reorderFormFields(from, to) {
    setFormFields(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    scheduleAutoSave();
  }

  async function pickFormFile(idx) {
    const f = await window.api.pickFile();
    if (f) {
      setFormFields(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], filePath: f.path, fileName: f.name, fileSize: f.size };
        return next;
      });
      scheduleAutoSave();
    }
  }

  async function pickFile() {
    const f = await window.api.pickFile();
    if (f) { setFile(f); scheduleAutoSave(); }
  }

  function clearFile() { setFile(null); scheduleAutoSave(); }

  // Streaming
  function appendStreamMessage(dir, type, msgBody, isError = false) {
    const time = new Date().toLocaleTimeString();
    setStreamMessages(prev => [...prev, { dir, type, body: msgBody, time, isError }]);
  }

  function appendWsTimeline(type, text) {
    const t = wsStartTime ? Date.now() - wsStartTime : 0;
    wsTimeline.push({ t, type, text });
    setResponse(prev => prev ? { ...prev, timeline: [...wsTimeline], time: t } : prev);
  }

  function stashAppendMessage(dir, type, body, isError = false) {
    if (!stashedStream) return;
    const time = new Date().toLocaleTimeString();
    stashedStream.messages = [...stashedStream.messages, { dir, type, body, time, isError }];
  }
  function stashAppendTimeline(type, text) {
    if (!stashedStream) return;
    const t = stashedStream.wsStartTime ? Date.now() - stashedStream.wsStartTime : 0;
    stashedStream.wsTimeline.push({ t, type, text });
  }

  async function disconnectStream() {
    // Disconnect stashed stream if any
    if (stashedStream) {
      await window.api.wsDisconnect(stashedStream.connectionId);
      stashAppendTimeline('info', 'Disconnected by user');
      const duration = stashedStream.wsStartTime ? Date.now() - stashedStream.wsStartTime : 0;
      await window.api.saveResponse({
        request_id: stashedStream.requestId, collection_id: props.id,
        status: 200, status_text: 'OK',
        response_headers: stashedStream.wsResponseHeaders || {}, response_body: null,
        timeline: stashedStream.wsTimeline, time_ms: duration,
        request_method: 'WS', request_url: '',
        request_headers: [], request_body: '',
        content_type: '', error: null,
        messages: stashedStream.messages,
      });
      stashedStream = null;
    }

    const connId = streamConnectionId();
    if (connId) {
      const wasWs = streamType() === 'ws';
      if (streamType() === 'sse') await window.api.sseDisconnect(connId);
      else if (wasWs) await window.api.wsDisconnect(connId);
      if (wasWs) {
        appendWsTimeline('info', 'Disconnected by user');
        await saveWsHistory();
      }
      streamRequestId = null;
      setStreamConnectionId(null);
      setStreamType(null);
      setStreamConnected(false);
      setStreamStatus('');
    }
  }

  // SSE/WS event listeners
  onMount(() => {
    window.api.onSseOpen((d) => {
      if (d.id !== streamConnectionId()) return;
      setStreamStatus(`<span class="stream-status"><span class="dot connected"></span> Connected</span>`);
      setStreamConnected(true);
      appendStreamMessage('sys', 'system', `Connected — ${d.status} ${d.statusText}`);
    });

    window.api.onSseEvent((d) => {
      if (d.id !== streamConnectionId()) return;
      const label = d.event.type !== 'message' ? d.event.type : 'data';
      appendStreamMessage('in', label, d.event.data);
    });

    window.api.onSseClose((d) => {
      if (d.id !== streamConnectionId()) return;
      appendStreamMessage('sys', 'system', 'Connection closed');
      setStreamStatus(`<span class="stream-status"><span class="dot disconnected"></span> Closed</span>`);
      setStreamConnectionId(null); setStreamType(null); setStreamConnected(false);
    });

    window.api.onSseError((d) => {
      if (d.id !== streamConnectionId()) return;
      appendStreamMessage('sys', 'error', d.error, true);
      setStreamStatus(`<span class="stream-status"><span class="dot disconnected"></span> Error</span>`);
      setStreamConnectionId(null); setStreamType(null); setStreamConnected(false);
    });

    function isActiveConn(id) { return id === streamConnectionId(); }
    function isStashedConn(id) { return stashedStream && id === stashedStream.connectionId; }

    window.api.onWsOpen((d) => {
      if (isStashedConn(d.id)) {
        stashedStream.connected = true;
        stashedStream.status = '<span class="stream-status"><span class="dot connected"></span> Connected</span>';
        stashedStream.wsResponseHeaders = d.headers || {};
        stashAppendTimeline('res-status', 'WebSocket connected — 101 Switching Protocols');
        stashAppendMessage('sys', 'system', 'WebSocket connected');
        stashedStream.response = { ...stashedStream.response, status: 200, statusText: 'OK', headers: stashedStream.wsResponseHeaders };
        return;
      }
      if (!isActiveConn(d.id)) return;
      setStreamStatus(`<span class="stream-status"><span class="dot connected"></span> Connected</span>`);
      setStreamConnected(true);
      wsResponseHeaders = d.headers || {};
      appendWsTimeline('res-status', 'WebSocket connected — 101 Switching Protocols');
      setResponse(prev => ({ ...prev, status: 200, statusText: 'OK', headers: wsResponseHeaders }));
      appendStreamMessage('sys', 'system', 'WebSocket connected');
    });

    window.api.onWsMessage((d) => {
      if (isStashedConn(d.id)) {
        const label = d.isBinary ? 'binary' : 'text';
        stashAppendTimeline('res-header', `${label} (${d.data.length} bytes)`);
        stashAppendMessage('in', label, d.data);
        return;
      }
      if (!isActiveConn(d.id)) return;
      const label = d.isBinary ? 'binary' : 'text';
      appendWsTimeline('res-header', `${label} (${d.data.length} bytes)`);
      appendStreamMessage('in', label, d.data);
    });

    window.api.onWsPing((d) => {
      if (isStashedConn(d.id)) { stashAppendTimeline('res-header', 'ping'); stashAppendMessage('sys', 'ping', 'Ping'); return; }
      if (!isActiveConn(d.id)) return;
      appendWsTimeline('res-header', 'ping');
      appendStreamMessage('sys', 'ping', 'Ping');
    });

    window.api.onWsPong((d) => {
      const type = d.auto ? 'req-header' : 'res-header';
      const label = d.auto ? 'pong (auto-reply)' : 'pong';
      if (isStashedConn(d.id)) { stashAppendTimeline(type, label); stashAppendMessage('sys', 'pong', label); return; }
      if (!isActiveConn(d.id)) return;
      appendWsTimeline(type, label);
      appendStreamMessage('sys', 'pong', label);
    });

    window.api.onWsClose((d) => {
      if (isStashedConn(d.id)) {
        const closeInfo = d.code ? `code: ${d.code}${d.reason ? ', reason: ' + d.reason : ''}` : 'no status';
        stashAppendTimeline('info', `Connection closed (${closeInfo})`);
        stashAppendMessage('sys', 'system', `Connection closed (${closeInfo})`);
        stashedStream.connected = false;
        stashedStream.status = '<span class="stream-status"><span class="dot disconnected"></span> Closed</span>';
        // Save history for stashed connection
        const duration = stashedStream.wsStartTime ? Date.now() - stashedStream.wsStartTime : 0;
        window.api.saveResponse({
          request_id: stashedStream.requestId, collection_id: props.id,
          status: 200, status_text: 'OK',
          response_headers: stashedStream.wsResponseHeaders, response_body: null,
          timeline: stashedStream.wsTimeline, time_ms: duration,
          request_method: 'WS', request_url: '',
          request_headers: [], request_body: '',
          content_type: '', error: null,
          messages: stashedStream.messages,
        });
        stashedStream = null;
        return;
      }
      if (!isActiveConn(d.id)) return;
      const closeInfo = d.code ? `code: ${d.code}${d.reason ? ', reason: ' + d.reason : ''}` : 'no status';
      appendWsTimeline('info', `Connection closed (${closeInfo})`);
      appendStreamMessage('sys', 'system', `Connection closed (${closeInfo})`);
      setStreamStatus(`<span class="stream-status"><span class="dot disconnected"></span> Closed</span>`);
      saveWsHistory();
      setStreamConnectionId(null); setStreamType(null); setStreamConnected(false);
    });

    window.api.onWsError((d) => {
      if (isStashedConn(d.id)) {
        stashAppendTimeline('error', d.error);
        stashAppendMessage('sys', 'error', d.error, true);
        stashedStream.connected = false;
        stashedStream.status = '<span class="stream-status"><span class="dot disconnected"></span> Error</span>';
        const duration = stashedStream.wsStartTime ? Date.now() - stashedStream.wsStartTime : 0;
        window.api.saveResponse({
          request_id: stashedStream.requestId, collection_id: props.id,
          status: null, status_text: null,
          response_headers: stashedStream.wsResponseHeaders, response_body: null,
          timeline: stashedStream.wsTimeline, time_ms: duration,
          request_method: 'WS', request_url: '',
          request_headers: [], request_body: '',
          content_type: '', error: d.error,
          messages: stashedStream.messages,
        });
        stashedStream = null;
        return;
      }
      if (!isActiveConn(d.id)) return;
      appendWsTimeline('error', d.error);
      appendStreamMessage('sys', 'error', d.error, true);
      setStreamStatus(`<span class="stream-status"><span class="dot disconnected"></span> Error</span>`);
      saveWsHistory(d.error);
      setStreamConnectionId(null); setStreamType(null); setStreamConnected(false);
    });
  });

  // Send request
  async function ensureActiveRequest(m, u) {
    if (!activeRequestId()) {
      const c = collection();
      const req = { id: generateId(), type: 'request', name: u.replace(/^(?:wss?|https?):\/\//, '').slice(0, 40), method: m, url: u, headers: headers().filter(h => h.key), body: body(), bodyType: bodyType() };
      c.items.push(req);
      setActiveRequestId(req.id);
      setCollection({ ...c, items: structuredClone(c.items) });
      await save();
    }
  }

  async function sendRequest() {
    const m = protocol() === 'ws' ? 'WS' : method();
    const rawUrl = url().trim();
    if (!rawUrl) return;

    const vars = getVariables();
    const u = buildUrlWithParams(resolveVariables(rawUrl, vars), params());

    if (streamConnectionId()) await disconnectStream();
    await ensureActiveRequest(m, u);
    setResponsePaneVisible(true);

    if (m === 'WS') {
      await startWs(u);
    } else {
      await sendHttpRequest(m, u);
    }
  }

  async function sendHttpRequest(m, u) {
    setSending(true);
    setStreamMessages([]);
    setStreamStatus('');

    const vars = getVariables();
    const sendOpts = {
      method: m, url: u,
      headers: headers().filter(h => h.key).map(h => ({
        ...h,
        key: resolveVariables(h.key, vars),
        value: resolveVariables(h.value, vars),
      })),
      bodyType: bodyType(),
      body: resolveVariables(body(), vars),
      filePath: file()?.path || null,
      formFields: formFields().filter(f => f.key).map(f => ({
        key: resolveVariables(f.key, vars), value: resolveVariables(f.value, vars), type: f.type,
        filePath: f.filePath, fileName: f.fileName, fileMimeType: '',
      })),
      _requestId: activeRequestId(),
    };

    const result = await window.api.sendRequest(sendOpts);

    if (result.sse) {
      setStreamConnectionId(result.sseId);
      setStreamType('sse');
      setStreamMessages([]);
      setStreamStatus(`<span class="stream-status"><span class="dot connected"></span> SSE ${result.status}</span>`);
      setStreamTime(result.time);
      setStreamConnected(true);
      setSending(false);
      setResponse({ headers: result.headers, timeline: result.timeline, time: result.time });
      return;
    }

    await window.api.saveResponse({
      request_id: activeRequestId(), collection_id: props.id,
      status: result.status || null, status_text: result.statusText || null,
      response_headers: result.headers || {}, response_body: result.body || null,
      timeline: result.timeline || [], time_ms: result.time,
      request_method: m, request_url: u,
      request_headers: headers().filter(h => h.key), request_body: body(),
      content_type: result.contentType || '', error: result.error || null,
    });

    setSending(false);
    setResponse(result);
  }

  let wsResponseHeaders = {};

  async function saveWsHistory(error = null) {
    if (!activeRequestId()) return;
    const duration = wsStartTime ? Date.now() - wsStartTime : 0;
    await window.api.saveResponse({
      request_id: activeRequestId(), collection_id: props.id,
      status: error ? null : 200, status_text: error ? null : 'OK',
      response_headers: wsResponseHeaders, response_body: null,
      timeline: wsTimeline, time_ms: duration,
      request_method: 'WS', request_url: url(),
      request_headers: headers().filter(h => h.key), request_body: '',
      content_type: '', error: error || null,
      messages: streamMessages(),
    });
    // Trigger history reload in ResponsePane
    setResponse(prev => prev ? { ...prev } : prev);
  }

  async function startWs(u) {
    let wsUrl = u;
    if (wsUrl.startsWith('http://')) wsUrl = 'ws://' + wsUrl.slice(7);
    else if (wsUrl.startsWith('https://')) wsUrl = 'wss://' + wsUrl.slice(8);
    else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) wsUrl = 'ws://' + wsUrl;

    const connId = generateId();
    wsStartTime = Date.now();
    wsTimeline = [];
    streamRequestId = activeRequestId();
    stashedStream = null;
    setStreamConnectionId(connId);
    setStreamType('ws');
    setStreamMessages([]);
    setStreamStatus('<span class="stream-status"><span class="dot connected"></span> Connecting...</span>');
    setStreamConnected(false);
    setSending(false);
    setResponse({ status: null, statusText: '', headers: {}, timeline: [] });

    appendWsTimeline('info', `Connecting to ${wsUrl}`);
    appendStreamMessage('sys', 'system', `Connecting to ${wsUrl}...`);

    await window.api.wsConnect({
      id: connId, url: wsUrl,
      headers: headers().filter(h => h.key),
    });
  }

  async function wsSend() {
    const msg = wsInput();
    const ft = wsFrameType();
    if ((!msg && ft !== 'ping' && ft !== 'pong') || !streamConnectionId() || streamType() !== 'ws') return;
    await window.api.wsSend({ id: streamConnectionId(), data: msg, frameType: ft });
    appendWsTimeline('req-header', `${ft} (${msg.length} bytes)`);
    appendStreamMessage('out', ft, msg || `[${ft}]`);
    setWsInput('');
  }

  // Resize handlers
  let sidebarRef, requestPaneRef;

  function initSidebarResize(e) {
    e.preventDefault();
    const sidebar = e.target.previousElementSibling;
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.target.classList.add('active');

    function onMove(ev) {
      sidebar.style.width = Math.max(0, startW + ev.clientX - startX) + 'px';
      sidebar.style.flex = '0 0 auto';
    }
    function onUp() {
      e.target.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function initPaneResize(e) {
    e.preventDefault();
    const pane = e.target.previousElementSibling;
    const isHorizontal = window.matchMedia('(min-aspect-ratio: 1/1)').matches;
    const startPos = isHorizontal ? e.clientX : e.clientY;
    const startSize = isHorizontal ? pane.offsetWidth : pane.offsetHeight;
    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    e.target.classList.add('active');

    function onMove(ev) {
      const delta = (isHorizontal ? ev.clientX : ev.clientY) - startPos;
      const newSize = Math.max(0, startSize + delta);
      if (isHorizontal) { pane.style.width = newSize + 'px'; pane.style.height = ''; }
      else { pane.style.height = newSize + 'px'; pane.style.width = ''; }
      pane.style.flex = '0 0 auto';
    }
    function onUp() {
      e.target.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Keyboard shortcut
  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendRequest();
  }
  const mql = window.matchMedia('(max-aspect-ratio: 1/1)');
  function onLayoutChange(e) { if (e.matches) setSidebarOpen(false); }
  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    mql.addEventListener('change', onLayoutChange);
    if (mql.matches) setSidebarOpen(false);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown);
    mql.removeEventListener('change', onLayoutChange);
    if (streamConnectionId()) disconnectStream();
  });

  return (
    <div class={`collection-view ${sidebarOpen() ? 'sidebar-open' : 'sidebar-closed'}`}>
      {collection() && (
        <>
          {sidebarOpen() && (
            <>
              <Sidebar
                name={collection().name}
                items={collection().items}
                activeId={activeRequestId()}
                onBack={props.onBack}
                onToggleSidebar={() => setSidebarOpen(false)}
                onSelect={(id) => { selectRequest(id); setSidebarOpen(window.matchMedia('(min-aspect-ratio: 1/1)').matches); }}
                onRename={handleRename}
                onDelete={handleDelete}
                onToggleFolder={toggleFolder}
                onAddToFolder={addToFolder}
                onAddRequest={addRequest}
                onAddFolder={addFolder}
                onImportRequests={importRequests}
                onRenameCollection={renameCollection}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              />
              <div class="resize-handle resize-handle-sidebar" onMouseDown={initSidebarResize} />
            </>
          )}
          <div class="main-panel">
            <div class="request-bar">
              <button class="btn btn-ghost" onClick={() => setSidebarOpen(!sidebarOpen())} title="Toggle sidebar"><Icon name="fa-solid fa-bars" /></button>
              <select class="protocol-select" value={protocol()} onChange={(e) => { setProtocol(e.target.value); scheduleAutoSave(); }}>
                <option value="http">{t.collection.protocols.http}</option>
                <option value="ws">{t.collection.protocols.ws}</option>
              </select>
              {protocol() === 'http' && (
                <select class="method-select" value={method()} onChange={(e) => { setMethod(e.target.value); scheduleAutoSave(); }}>
                  <option>GET</option>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>PATCH</option>
                  <option>DELETE</option>
                  <option>HEAD</option>
                  <option>OPTIONS</option>
                </select>
              )}
              <input
                type="text"
                class="url-input"
                placeholder={t.collection.urlPlaceholder}
                value={url()}
                onInput={(e) => { setUrl(e.target.value); scheduleAutoSave(); }}
                onPaste={handleUrlPaste}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendRequest(); }}
              />
              <button class="btn btn-ghost" onClick={importCurl} title={t.collection.curlButtonTitle}><Icon name="fa-solid fa-terminal" /></button>
              {streamConnectionId() ? (
                <button class="btn btn-danger" onClick={() => {
                  appendStreamMessage('sys', 'system', t.collection.disconnectedByUser);
                  disconnectStream();
                }}><Icon name="fa-solid fa-plug-circle-xmark" /></button>
              ) : (
                <button class="btn btn-primary" onClick={sendRequest}><Icon name="fa-solid fa-paper-plane" /></button>
              )}
            </div>
            <div class="request-response-split">
              <RequestPane
                url={url()}
                headers={headers()}
                body={body()}
                bodyType={bodyType()}
                contentType={contentType()}
                file={file()}
                formFields={formFields()}
                params={params()}
                onHeaderChange={onHeaderChange}
                onRemoveHeader={removeHeader}
                onAddHeader={addHeader}
                onReorderHeaders={reorderHeaders}
                onParamChange={onParamChange}
                onRemoveParam={removeParam}
                onAddParam={addParam}
                onReorderParams={reorderParams}
                onBodyChange={(v) => { setBody(v); scheduleAutoSave(); }}
                onBodyTypeChange={(v) => { setBodyType(v); scheduleAutoSave(); }}
                onContentTypeChange={(v) => { setContentType(v); syncContentTypeHeader(v); scheduleAutoSave(); }}
                onPickFile={pickFile}
                onClearFile={clearFile}
                onFormFieldChange={onFormFieldChange}
                onRemoveFormField={removeFormField}
                onAddFormField={addFormField}
                onReorderFormFields={reorderFormFields}
                onFormPickFile={pickFormFile}
                variables={variables()}
                onVariableChange={onVariableChange}
                onRemoveVariable={removeVariable}
                onAddVariable={addVariable}
                onReorderVariables={reorderVariables}
              />
              <div
                class="resize-handle resize-handle-pane"
                style={{ display: responsePaneVisible() ? '' : 'none' }}
                onMouseDown={initPaneResize}
              />
              <ResponsePane
                visible={responsePaneVisible()}
                response={response()}
                sending={sending()}
                activeRequestId={activeRequestId()}
                defaultTab={defaultTab()}
                streamStatus={streamStatus()}
                streamTime={streamTime()}
                streamType={streamType()}
                streamConnected={streamConnected()}
                streamMessages={streamMessages()}
                wsInput={wsInput()}
                wsFrameType={wsFrameType()}
                onWsInputChange={setWsInput}
                onWsFrameTypeChange={setWsFrameType}
                onWsSend={wsSend}
                onShowResponse={setResponse}
              />
            </div>
          </div>
        </>
      )}
      <Modal />
    </div>
  );
}
