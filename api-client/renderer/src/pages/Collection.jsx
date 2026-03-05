import { createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { generateId, findItem, removeItem, findParentArray, isDescendant } from '../helpers';
import { showPrompt, showConfirm } from '../components/Modal';
import Modal from '../components/Modal';
import Sidebar from '../components/Sidebar';
import RequestPane from '../components/RequestPane';
import ResponsePane from '../components/ResponsePane';

export default function Collection(props) {
  const [collection, setCollection] = createSignal(null);
  const [activeRequestId, setActiveRequestId] = createSignal(null);
  const [method, setMethod] = createSignal('GET');
  const [url, setUrl] = createSignal('');
  const [body, setBody] = createSignal('');
  const [headers, setHeaders] = createSignal([{ key: '', value: '', enabled: true }]);
  const [bodyType, setBodyType] = createSignal('text');
  const [contentType, setContentType] = createSignal('auto');
  const [file, setFile] = createSignal(null);
  const [formFields, setFormFields] = createSignal([{ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }]);
  const [response, setResponse] = createSignal(null);
  const [sending, setSending] = createSignal(false);
  const [responsePaneVisible, setResponsePaneVisible] = createSignal(false);

  // Streaming state
  const [streamConnectionId, setStreamConnectionId] = createSignal(null);
  const [streamType, setStreamType] = createSignal(null);
  const [streamConnected, setStreamConnected] = createSignal(false);
  const [streamStatus, setStreamStatus] = createSignal('');
  const [streamTime, setStreamTime] = createSignal(0);
  const [streamMessages, setStreamMessages] = createSignal([]);
  const [wsInput, setWsInput] = createSignal('');

  let autoSaveTimer = null;
  let dragItemId = null;

  // Load collection
  onMount(async () => {
    const c = await window.api.loadCollection(props.id);
    if (!c) { props.onBack(); return; }
    setCollection(c);
    document.title = `${c.name} - API Client`;
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
      item.method = method();
      item.url = url();
      item.headers = headers().filter(h => h.key);
      item.bodyType = bodyType();
      item.contentType = contentType();
      item.body = body();
      item.bodyFile = file();
      item.bodyForm = formFields().filter(f => f.key);
      setCollection({ ...c });
      save();
    }, 500);
  }

  // Select a request
  async function selectRequest(id) {
    if (streamConnectionId()) await disconnectStream();
    setActiveRequestId(id);
    const c = collection();
    const item = findItem(c.items, id);
    if (!item || item.type === 'folder') return;

    setMethod(item.method || 'GET');
    setUrl(item.url || '');
    setBody(item.body || '');
    setHeaders(item.headers?.length > 0 ? item.headers.map(h => ({ ...h })) : [{ key: '', value: '', enabled: true }]);
    setBodyType(item.bodyType || 'text');
    setContentType(item.contentType || 'auto');
    setFile(item.bodyFile || null);
    setFormFields(item.bodyForm?.length > 0 ? item.bodyForm.map(f => ({ ...f })) : [{ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }]);
    setResponsePaneVisible(true);

    const lastResp = await window.api.getLatestResponse(id);
    if (lastResp) setResponse(lastResp);
    else { setResponse(null); setSending(false); }
  }

  function clearEditor() {
    setMethod('GET');
    setUrl('');
    setBody('');
    setHeaders([{ key: '', value: '', enabled: true }]);
    setBodyType('text');
    setContentType('auto');
    setFile(null);
    setFormFields([{ key: '', value: '', type: 'text', filePath: '', fileName: '', fileSize: 0 }]);
    setResponse(null);
    setSending(false);
  }

  // Tree actions
  async function handleRename(id) {
    const c = collection();
    const item = findItem(c.items, id);
    if (!item) return;
    const n = await showPrompt('Rename:', item.name);
    if (n && n.trim()) {
      item.name = n.trim();
      setCollection({ ...c });
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
      setCollection({ ...c });
      save();
    }
  }

  function toggleFolder(id) {
    const c = collection();
    const folder = findItem(c.items, id);
    if (folder) {
      folder.collapsed = !folder.collapsed;
      setCollection({ ...c });
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
    setCollection({ ...c });
    await save();
    selectRequest(req.id);
  }

  async function addRequest() {
    const name = await showPrompt('Request name:', 'New Request');
    if (!name) return;
    const c = collection();
    const req = { id: generateId(), type: 'request', name, method: 'GET', url: '', headers: [], body: '', bodyType: 'text' };
    c.items.push(req);
    setCollection({ ...c });
    await save();
    selectRequest(req.id);
  }

  async function addFolder() {
    const name = await showPrompt('Folder name:', 'New Folder');
    if (!name) return;
    const c = collection();
    c.items.push({ id: generateId(), type: 'folder', name, children: [], collapsed: false });
    setCollection({ ...c });
    save();
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
    setCollection({ ...c });
    await save();
  }

  // Header management
  function onHeaderChange(idx, field, value) {
    setHeaders(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
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

  async function disconnectStream() {
    const connId = streamConnectionId();
    if (connId) {
      if (streamType() === 'sse') await window.api.sseDisconnect(connId);
      else if (streamType() === 'ws') await window.api.wsDisconnect(connId);
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

    window.api.onWsOpen((d) => {
      if (d.id !== streamConnectionId()) return;
      setStreamStatus(`<span class="stream-status"><span class="dot connected"></span> Connected</span>`);
      setStreamConnected(true);
      appendStreamMessage('sys', 'system', 'WebSocket connected');
    });

    window.api.onWsMessage((d) => {
      if (d.id !== streamConnectionId()) return;
      appendStreamMessage('in', d.isBinary ? 'binary' : 'text', d.data);
    });

    window.api.onWsClose((d) => {
      if (d.id !== streamConnectionId()) return;
      appendStreamMessage('sys', 'system', `Connection closed (code: ${d.code}${d.reason ? ', reason: ' + d.reason : ''})`);
      setStreamStatus(`<span class="stream-status"><span class="dot disconnected"></span> Closed</span>`);
      setStreamConnectionId(null); setStreamType(null); setStreamConnected(false);
    });

    window.api.onWsError((d) => {
      if (d.id !== streamConnectionId()) return;
      appendStreamMessage('sys', 'error', d.error, true);
      setStreamStatus(`<span class="stream-status"><span class="dot disconnected"></span> Error</span>`);
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
      setCollection({ ...c });
      await save();
    }
  }

  async function sendRequest() {
    let m = method();
    const u = url().trim();
    if (!u) return;

    if (m !== 'WS' && (u.startsWith('ws://') || u.startsWith('wss://'))) {
      m = 'WS';
      setMethod('WS');
    }

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
    setResponse(null);
    setStreamMessages([]);
    setStreamStatus('');

    const sendOpts = {
      method: m, url: u,
      headers: headers().filter(h => h.key),
      bodyType: bodyType(),
      body: body(),
      filePath: file()?.path || null,
      formFields: formFields().filter(f => f.key).map(f => ({
        key: f.key, value: f.value, type: f.type,
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

  async function startWs(u) {
    let wsUrl = u;
    if (wsUrl.startsWith('http://')) wsUrl = 'ws://' + wsUrl.slice(7);
    else if (wsUrl.startsWith('https://')) wsUrl = 'wss://' + wsUrl.slice(8);
    else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) wsUrl = 'ws://' + wsUrl;

    const connId = generateId();
    setStreamConnectionId(connId);
    setStreamType('ws');
    setStreamMessages([]);
    setStreamStatus('<span class="stream-status"><span class="dot connected"></span> Connecting...</span>');
    setStreamConnected(false);
    setSending(false);
    setResponse({ headers: {}, timeline: [] });

    appendStreamMessage('sys', 'system', `Connecting to ${wsUrl}...`);

    await window.api.wsConnect({
      id: connId, url: wsUrl,
      headers: headers().filter(h => h.key),
    });
  }

  async function wsSend() {
    const msg = wsInput();
    if (!msg || !streamConnectionId() || streamType() !== 'ws') return;
    await window.api.wsSend({ id: streamConnectionId(), data: msg });
    appendStreamMessage('out', 'sent', msg);
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
  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown);
    if (streamConnectionId()) disconnectStream();
  });

  return (
    <div class="collection-view">
      {collection() && (
        <>
          <Sidebar
            name={collection().name}
            items={collection().items}
            activeId={activeRequestId()}
            onBack={props.onBack}
            onSelect={selectRequest}
            onRename={handleRename}
            onDelete={handleDelete}
            onToggleFolder={toggleFolder}
            onAddToFolder={addToFolder}
            onAddRequest={addRequest}
            onAddFolder={addFolder}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          />
          <div class="resize-handle resize-handle-sidebar" onMouseDown={initSidebarResize} />
          <div class="main-panel">
            <div class="request-bar">
              <select class="method-select" value={method()} onChange={(e) => { setMethod(e.target.value); scheduleAutoSave(); }}>
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
                <option>DELETE</option>
                <option>HEAD</option>
                <option>OPTIONS</option>
                <option>WS</option>
              </select>
              <input
                type="text"
                class="url-input"
                placeholder="Enter URL..."
                value={url()}
                onInput={(e) => { setUrl(e.target.value); scheduleAutoSave(); }}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendRequest(); }}
              />
              {streamConnectionId() ? (
                <button class="btn btn-danger" onClick={() => {
                  appendStreamMessage('sys', 'system', 'Disconnected by user');
                  disconnectStream();
                }}>Disconnect</button>
              ) : (
                <button class="btn btn-primary" onClick={sendRequest}>Send</button>
              )}
            </div>
            <div class="request-response-split">
              <RequestPane
                headers={headers()}
                body={body()}
                bodyType={bodyType()}
                contentType={contentType()}
                file={file()}
                formFields={formFields()}
                onHeaderChange={onHeaderChange}
                onRemoveHeader={removeHeader}
                onAddHeader={addHeader}
                onBodyChange={(v) => { setBody(v); scheduleAutoSave(); }}
                onBodyTypeChange={(v) => { setBodyType(v); scheduleAutoSave(); }}
                onContentTypeChange={(v) => { setContentType(v); scheduleAutoSave(); }}
                onPickFile={pickFile}
                onClearFile={clearFile}
                onFormFieldChange={onFormFieldChange}
                onRemoveFormField={removeFormField}
                onAddFormField={addFormField}
                onFormPickFile={pickFormFile}
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
                streamStatus={streamStatus()}
                streamTime={streamTime()}
                streamType={streamType()}
                streamConnected={streamConnected()}
                streamMessages={streamMessages()}
                wsInput={wsInput()}
                onWsInputChange={setWsInput}
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
