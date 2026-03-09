import { createContext, onCleanup, onMount, useContext } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { showConfirm, showPrompt, showTextarea } from '../components/Modal';
import {
  buildUrlWithParams,
  findItem,
  findParentArray,
  generateKSUID,
  isDescendant,
  parseCurl,
  removeItem,
  resolveVariables,
} from '../helpers';
import t from '../locale';

const CollectionContext = createContext();
export const useCollection = () => useContext(CollectionContext);

const EMPTY_HEADER = { key: '', value: '', enabled: true };
const EMPTY_PARAM = { key: '', value: '', enabled: true };
const EMPTY_VARIABLE = { key: '', value: '' };
const EMPTY_FORM_FIELD = {
  key: '',
  value: '',
  type: 'text',
  filePath: '',
  fileName: '',
  fileSize: 0,
};

export function CollectionProvider(props) {
  const [state, setState] = createStore({
    collection: null,
    activeRequestId: null,
    sidebarOpen: true,

    protocol: 'http',
    method: 'GET',
    url: '',
    body: '',
    headers: [{ ...EMPTY_HEADER }],
    params: [{ ...EMPTY_PARAM }],
    bodyType: 'text',
    contentType: 'auto',
    file: null,
    formFields: [{ ...EMPTY_FORM_FIELD }],
    variables: [{ ...EMPTY_VARIABLE }],

    response: null,
    sending: false,
    responsePaneVisible: false,
    defaultTab: 'body',

    streamConnectionId: null,
    streamType: null,
    streamConnected: false,
    streamStatus: '',
    streamTime: 0,
    streamMessages: [],
    wsInput: '',
    wsFrameType: 'text',
  });

  // Non-reactive internal state
  let autoSaveTimer = null;
  let dragItemId = null;
  let wsStartTime = null;
  let wsTimeline = [];
  let streamRequestId = null;
  let stashedStream = null;
  let wsResponseHeaders = {};

  // --- Helpers ---

  function setResponse(valueOrFn) {
    if (typeof valueOrFn === 'function') {
      const newVal = valueOrFn(state.response);
      setState('response', newVal != null ? reconcile(newVal) : null);
    } else {
      setState('response', valueOrFn != null ? reconcile(valueOrFn) : null);
    }
  }

  async function save() {
    if (state.collection)
      await window.api.saveCollection(
        JSON.parse(JSON.stringify(state.collection)),
      );
  }

  function scheduleAutoSave() {
    if (!state.activeRequestId) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (!state.collection) return;

      const item = findItem(state.collection.items, state.activeRequestId);
      if (!item) {
        return;
      }

      setState(
        'collection',
        produce((col) => {
          const it = findItem(col.items, state.activeRequestId);
          if (!it) {
            return;
          }
          it.method = state.protocol === 'ws' ? 'WS' : state.method;
          it.url = state.url;
          it.headers = state.headers.filter((h) => h.key);
          it.params = state.params.filter((p) => p.key);
          it.bodyType = state.bodyType;
          it.contentType = state.contentType;
          it.body = state.body;
          it.bodyFile = state.file;
          it.bodyForm = state.formFields.filter((f) => f.key);
          it.variables = state.variables.filter((v) => v.key);
        }),
      );
      save();
    }, 500);
  }

  function updateField(field, value) {
    setState(field, value);
    scheduleAutoSave();
  }

  function getVariables() {
    return state.variables.filter((v) => v.key);
  }

  // --- Request Selection ---

  async function selectRequest(id) {
    if (state.streamConnectionId && streamRequestId && streamRequestId !== id) {
      stashedStream = {
        requestId: streamRequestId,
        connectionId: state.streamConnectionId,
        type: state.streamType,
        connected: state.streamConnected,
        status: state.streamStatus,
        time: state.streamTime,
        messages: [...state.streamMessages],
        response: state.response,
        wsStartTime,
        wsTimeline: [...wsTimeline],
        wsResponseHeaders: { ...wsResponseHeaders },
      };
    }

    setState({
      response: null,
      sending: false,
      defaultTab: null,
      activeRequestId: id,
    });

    const item = findItem(state.collection.items, id);
    if (!item || item.type === 'folder') return;

    const m = item.method || 'GET';
    setState({
      protocol: m === 'WS' ? 'ws' : 'http',
      method: m,
      url: item.url || '',
      body: item.body || '',
      headers:
        item.headers?.length > 0
          ? item.headers.map((h) => ({ ...h }))
          : [{ ...EMPTY_HEADER }],
      params:
        item.params?.length > 0
          ? item.params.map((p) => ({ ...p }))
          : [{ ...EMPTY_PARAM }],
      bodyType: item.bodyType || 'text',
      contentType: item.contentType || 'auto',
      file: item.bodyFile || null,
      formFields:
        item.bodyForm?.length > 0
          ? item.bodyForm.map((f) => ({ ...f }))
          : [{ ...EMPTY_FORM_FIELD }],
      variables:
        item.variables?.length > 0
          ? item.variables.map((v) => ({ ...v }))
          : [{ ...EMPTY_VARIABLE }],
    });

    if (stashedStream && stashedStream.requestId === id) {
      setState({
        streamConnectionId: stashedStream.connectionId,
        streamType: stashedStream.type,
        streamConnected: stashedStream.connected,
        streamStatus: stashedStream.status,
        streamTime: stashedStream.time,
        streamMessages: stashedStream.messages,
        defaultTab: 'messages',
        responsePaneVisible: true,
      });
      setResponse(stashedStream.response);
      wsStartTime = stashedStream.wsStartTime;
      wsTimeline = stashedStream.wsTimeline;
      wsResponseHeaders = stashedStream.wsResponseHeaders;
      stashedStream = null;
      return;
    }

    setState({
      streamMessages: [],
      streamStatus: '',
      streamType: null,
      streamConnected: false,
    });

    const lastResp = await window.api.getLatestResponse(id);
    setResponse(lastResp || null);
    if (lastResp?.messages?.length > 0) {
      setState('streamMessages', lastResp.messages);
    }
    setState({
      defaultTab: lastResp?.requestMethod === 'WS' ? 'messages' : 'body',
      responsePaneVisible: true,
    });
  }

  function clearEditor() {
    setState({
      protocol: 'http',
      method: 'GET',
      url: '',
      body: '',
      headers: [{ ...EMPTY_HEADER }],
      params: [{ ...EMPTY_PARAM }],
      bodyType: 'text',
      contentType: 'auto',
      file: null,
      formFields: [{ ...EMPTY_FORM_FIELD }],
      variables: [{ ...EMPTY_VARIABLE }],
      response: null,
      sending: false,
    });
  }

  // --- Header management ---

  function onHeaderChange(idx, field, value) {
    setState(
      'headers',
      idx,
      field,
      field === 'key' ? value.toLowerCase() : value,
    );
    scheduleAutoSave();
  }

  function removeHeader(idx) {
    setState(
      'headers',
      produce((h) => {
        h.splice(idx, 1);
        if (h.length === 0) h.push({ ...EMPTY_HEADER });
      }),
    );
    scheduleAutoSave();
  }

  function addHeader() {
    setState('headers', (h) => [...h, { ...EMPTY_HEADER }]);
  }

  function reorderHeaders(from, to) {
    setState(
      'headers',
      produce((h) => {
        const [item] = h.splice(from, 1);
        h.splice(to, 0, item);
      }),
    );
    scheduleAutoSave();
  }

  const contentTypeMimeMap = {
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    text: 'text/plain',
  };

  function syncContentTypeHeader(ct) {
    const mime = contentTypeMimeMap[ct];
    setState(
      'headers',
      produce((headers) => {
        const idx = headers.findIndex((h) => h.key === 'content-type');
        if (!mime || ct === 'auto') {
          if (idx >= 0) headers.splice(idx, 1);
          if (headers.length === 0) headers.push({ ...EMPTY_HEADER });
        } else if (idx >= 0) {
          headers[idx] = { ...headers[idx], value: mime, enabled: true };
        } else {
          headers.push({ key: 'content-type', value: mime, enabled: true });
        }
      }),
    );
  }

  // --- Param management ---

  function onParamChange(idx, field, value) {
    setState('params', idx, field, value);
    scheduleAutoSave();
  }

  function removeParam(idx) {
    setState(
      'params',
      produce((p) => {
        p.splice(idx, 1);
        if (p.length === 0) p.push({ ...EMPTY_PARAM });
      }),
    );
    scheduleAutoSave();
  }

  function addParam() {
    setState('params', (p) => [...p, { ...EMPTY_PARAM }]);
  }

  function reorderParams(from, to) {
    setState(
      'params',
      produce((p) => {
        const [item] = p.splice(from, 1);
        p.splice(to, 0, item);
      }),
    );
    scheduleAutoSave();
  }

  // --- Variable management ---

  function onVariableChange(idx, field, value) {
    setState('variables', idx, field, value);
    scheduleAutoSave();
  }

  function removeVariable(idx) {
    setState(
      'variables',
      produce((v) => {
        v.splice(idx, 1);
        if (v.length === 0) v.push({ ...EMPTY_VARIABLE });
      }),
    );
    scheduleAutoSave();
  }

  function addVariable() {
    setState('variables', (v) => [...v, { ...EMPTY_VARIABLE }]);
  }

  function reorderVariables(from, to) {
    setState(
      'variables',
      produce((v) => {
        const [item] = v.splice(from, 1);
        v.splice(to, 0, item);
      }),
    );
    scheduleAutoSave();
  }

  // --- Form field management ---

  function onFormFieldChange(idx, field, value) {
    setState('formFields', idx, field, value);
    scheduleAutoSave();
  }

  function removeFormField(idx) {
    setState(
      'formFields',
      produce((f) => {
        f.splice(idx, 1);
        if (f.length === 0) f.push({ ...EMPTY_FORM_FIELD });
      }),
    );
    scheduleAutoSave();
  }

  function addFormField() {
    setState('formFields', (f) => [...f, { ...EMPTY_FORM_FIELD }]);
  }

  function reorderFormFields(from, to) {
    setState(
      'formFields',
      produce((f) => {
        const [item] = f.splice(from, 1);
        f.splice(to, 0, item);
      }),
    );
    scheduleAutoSave();
  }

  async function pickFormFile(idx) {
    const f = await window.api.pickFile();
    if (f) {
      setState('formFields', idx, {
        filePath: f.path,
        fileName: f.name,
        fileSize: f.size,
      });
      scheduleAutoSave();
    }
  }

  async function pickFile() {
    const f = await window.api.pickFile();
    if (f) {
      setState('file', f);
      scheduleAutoSave();
    }
  }

  function clearFile() {
    setState('file', null);
    scheduleAutoSave();
  }

  // --- URL handling ---

  function handleUrlPaste(e) {
    const pasted = e.clipboardData.getData('text');
    if (!pasted) return;
    try {
      const urlObj = new URL(pasted);
      const entries = [...urlObj.searchParams.entries()];
      if (entries.length === 0) return;
      e.preventDefault();
      setState('url', pasted.split('?')[0]);
      const newParams = entries.map(([key, value]) => ({
        key,
        value,
        enabled: true,
      }));
      setState('params', (prev) => {
        const existing = prev.filter((p) => p.key);
        return [...existing, ...newParams, { ...EMPTY_PARAM }];
      });
      scheduleAutoSave();
    } catch {}
  }

  async function importCurl() {
    const input = await showTextarea(t.collection.importCurlModal.title);
    if (!input) {
      return;
    }

    const parsed = parseCurl(input);
    if (!parsed) {
      return;
    }

    setState({ protocol: 'http', method: parsed.method, url: parsed.url });
    if (parsed.body) setState('body', parsed.body);
    if (parsed.headers.length > 0)
      setState('headers', [...parsed.headers, { ...EMPTY_HEADER }]);
    if (parsed.params.length > 0)
      setState('params', [...parsed.params, { ...EMPTY_PARAM }]);
    scheduleAutoSave();
  }

  // --- Tree operations ---

  async function handleRename(id) {
    const item = findItem(state.collection.items, id);
    if (!item) return;
    const n = await showPrompt(t.sidebar.renameModal.title, item.name);
    if (n && n.trim()) {
      setState(
        'collection',
        produce((col) => {
          findItem(col.items, id).name = n.trim();
        }),
      );
      save();
    }
  }

  async function handleDelete(id) {
    const item = findItem(state.collection.items, id);
    if (!item) return;
    if (await showConfirm(t.collection.deleteItemModal.title(item.name))) {
      setState(
        'collection',
        produce((col) => {
          removeItem(col.items, id);
        }),
      );
      if (state.activeRequestId === id) {
        setState('activeRequestId', null);
        clearEditor();
      }
      save();
    }
  }

  function toggleFolder(id) {
    setState(
      'collection',
      produce((col) => {
        const folder = findItem(col.items, id);
        if (folder) folder.collapsed = !folder.collapsed;
      }),
    );
    save();
  }

  async function addToFolder(folderId) {
    if (!findItem(state.collection.items, folderId)) return;
    const name = await showPrompt(
      t.collection.addRequestModal.title,
      '',
      '',
      t.collection.addRequestModal.placeholder,
    );
    if (!name) return;
    const req = {
      id: generateKSUID(),
      type: 'request',
      name,
      method: 'GET',
      url: '',
      headers: [],
      body: '',
      bodyType: 'text',
    };
    setState(
      'collection',
      produce((col) => {
        const f = findItem(col.items, folderId);
        f.children = f.children || [];
        f.children.push(req);
      }),
    );
    await save();
    selectRequest(req.id);
  }

  async function addRequest() {
    const name = await showPrompt(
      t.collection.addRequestModal.title,
      '',
      '',
      t.collection.addRequestModal.placeholder,
    );
    if (!name) return;
    const req = {
      id: generateKSUID(),
      type: 'request',
      name,
      method: 'GET',
      url: '',
      headers: [],
      body: '',
      bodyType: 'text',
    };
    setState(
      'collection',
      produce((col) => {
        col.items.push(req);
      }),
    );
    await save();
    selectRequest(req.id);
  }

  async function addFolder() {
    const name = await showPrompt(
      t.collection.addFolderModal.title,
      '',
      '',
      t.collection.addFolderModal.placeholder,
    );
    if (!name) return;
    setState(
      'collection',
      produce((col) => {
        col.items.push({
          id: generateKSUID(),
          type: 'folder',
          name,
          children: [],
          collapsed: false,
        });
      }),
    );
    save();
  }

  async function importRequests() {
    const result = await window.api.importRequests();
    if (!result) return;
    if (result.error) return alert(result.error);
    setState(
      'collection',
      produce((col) => {
        col.items.push(...result.items);
      }),
    );
    save();
  }

  async function renameCollection() {
    const name = await showPrompt(
      t.landing.renameCollectionModal.title,
      state.collection.name,
    );
    if (name && name.trim()) {
      setState('collection', 'name', name.trim());
      document.title = `${t.app.name} - ${name.trim()}`;
      save();
    }
  }

  // --- Drag and drop ---

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
    el.classList.remove(
      'drag-over-above',
      'drag-over-below',
      'drag-over-inside',
    );
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
    e.currentTarget.classList.remove(
      'drag-over-above',
      'drag-over-below',
      'drag-over-inside',
    );
  }

  async function onDrop(e, targetId) {
    e.preventDefault();
    const el = e.currentTarget;
    if (!dragItemId || targetId === dragItemId) return;
    if (isDescendant(state.collection.items, dragItemId, targetId)) return;

    const zone = el.classList.contains('drag-over-above')
      ? 'above'
      : el.classList.contains('drag-over-below')
        ? 'below'
        : el.classList.contains('drag-over-inside')
          ? 'inside'
          : null;
    el.classList.remove(
      'drag-over-above',
      'drag-over-below',
      'drag-over-inside',
    );
    if (!zone) return;

    const capturedDragId = dragItemId;
    dragItemId = null;

    setState(
      'collection',
      produce((col) => {
        const dragItem = findItem(col.items, capturedDragId);
        if (!dragItem) return;
        removeItem(col.items, capturedDragId);
        if (zone === 'inside') {
          const folder = findItem(col.items, targetId);
          if (folder && folder.type === 'folder') {
            folder.children = folder.children || [];
            folder.children.push(dragItem);
            folder.collapsed = false;
          }
        } else {
          const parent = findParentArray(col.items, targetId);
          if (parent) {
            const insertIdx =
              zone === 'above' ? parent.index : parent.index + 1;
            parent.arr.splice(insertIdx, 0, dragItem);
          }
        }
      }),
    );
    await save();
  }

  // --- Streaming ---

  function appendStreamMessage(dir, type, msgBody, isError = false) {
    const time = new Date().toLocaleTimeString();
    setState('streamMessages', (m) => [
      ...m,
      { dir, type, body: msgBody, time, isError },
    ]);
  }

  function appendWsTimeline(type, text) {
    const elapsed = wsStartTime ? Date.now() - wsStartTime : 0;
    wsTimeline.push({ t: elapsed, type, text });
    setResponse((prev) =>
      prev ? { ...prev, timeline: [...wsTimeline], time: elapsed } : prev,
    );
  }

  function stashAppendMessage(dir, type, body, isError = false) {
    if (!stashedStream) return;
    const time = new Date().toLocaleTimeString();
    stashedStream.messages = [
      ...stashedStream.messages,
      { dir, type, body, time, isError },
    ];
  }

  function stashAppendTimeline(type, text) {
    if (!stashedStream) return;
    const elapsed = stashedStream.wsStartTime
      ? Date.now() - stashedStream.wsStartTime
      : 0;
    stashedStream.wsTimeline.push({ t: elapsed, type, text });
  }

  async function disconnectStream() {
    if (stashedStream) {
      await window.api.wsDisconnect(stashedStream.connectionId);
      stashAppendTimeline('info', 'Disconnected by user');
      const duration = stashedStream.wsStartTime
        ? Date.now() - stashedStream.wsStartTime
        : 0;
      await window.api.saveResponse({
        request_id: stashedStream.requestId,
        collection_id: props.id,
        status: 200,
        status_text: 'OK',
        response_headers: stashedStream.wsResponseHeaders || {},
        response_body: null,
        timeline: stashedStream.wsTimeline,
        time_ms: duration,
        request_method: 'WS',
        request_url: '',
        request_headers: [],
        request_body: '',
        content_type: '',
        error: null,
        messages: stashedStream.messages,
      });
      stashedStream = null;
    }

    const connId = state.streamConnectionId;
    if (connId) {
      const wasWs = state.streamType === 'ws';
      if (state.streamType === 'sse') await window.api.sseDisconnect(connId);
      else if (wasWs) await window.api.wsDisconnect(connId);
      if (wasWs) {
        appendWsTimeline('info', 'Disconnected by user');
        await saveWsHistory();
      }
      streamRequestId = null;
      setState({
        streamConnectionId: null,
        streamType: null,
        streamConnected: false,
        streamStatus: '',
      });
    }
  }

  async function saveWsHistory(error = null) {
    if (!state.activeRequestId) return;
    const duration = wsStartTime ? Date.now() - wsStartTime : 0;
    await window.api.saveResponse({
      request_id: state.activeRequestId,
      collection_id: props.id,
      status: error ? null : 200,
      status_text: error ? null : 'OK',
      response_headers: wsResponseHeaders,
      response_body: null,
      timeline: wsTimeline,
      time_ms: duration,
      request_method: 'WS',
      request_url: state.url,
      request_headers: JSON.parse(
        JSON.stringify(state.headers.filter((h) => h.key)),
      ),
      request_body: '',
      content_type: '',
      error: error || null,
      messages: JSON.parse(JSON.stringify(state.streamMessages)),
    });
    setResponse((prev) => (prev ? { ...prev } : prev));
  }

  // --- Send request ---

  async function ensureActiveRequest(m, u) {
    if (!state.activeRequestId) {
      const req = {
        id: generateKSUID(),
        type: 'request',
        name: u.replace(/^(?:wss?|https?):\/\//, '').slice(0, 40),
        method: m,
        url: u,
        headers: state.headers.filter((h) => h.key),
        body: state.body,
        bodyType: state.bodyType,
      };
      setState(
        'collection',
        produce((col) => {
          col.items.push(req);
        }),
      );
      setState('activeRequestId', req.id);
      await save();
    }
  }

  async function sendRequest() {
    const m = state.protocol === 'ws' ? 'WS' : state.method;
    const rawUrl = state.url.trim();
    if (!rawUrl) return;
    const vars = getVariables();
    const u = buildUrlWithParams(resolveVariables(rawUrl, vars), state.params);
    if (state.streamConnectionId) await disconnectStream();
    await ensureActiveRequest(m, u);
    setState('responsePaneVisible', true);
    if (m === 'WS') await startWs(u);
    else await sendHttpRequest(m, u);
  }

  async function sendHttpRequest(m, u) {
    setState({ sending: true, streamMessages: [], streamStatus: '' });
    const vars = getVariables();
    const sendOpts = JSON.parse(
      JSON.stringify({
        method: m,
        url: u,
        headers: state.headers
          .filter((h) => h.key)
          .map((h) => ({
            key: resolveVariables(h.key, vars),
            value: resolveVariables(h.value, vars),
            enabled: h.enabled,
          })),
        bodyType: state.bodyType,
        body: resolveVariables(state.body, vars),
        filePath: state.file?.path || null,
        formFields: state.formFields
          .filter((f) => f.key)
          .map((f) => ({
            key: resolveVariables(f.key, vars),
            value: resolveVariables(f.value, vars),
            type: f.type,
            filePath: f.filePath,
            fileName: f.fileName,
            fileMimeType: '',
          })),
        _requestId: state.activeRequestId,
      }),
    );

    const result = await window.api.sendRequest(sendOpts);

    if (result.sse) {
      setState({
        streamConnectionId: result.sseId,
        streamType: 'sse',
        streamMessages: [],
        streamStatus: `<span class="stream-status"><span class="dot connected"></span> SSE ${result.status}</span>`,
        streamTime: result.time,
        streamConnected: true,
        sending: false,
      });
      setResponse({
        headers: result.headers,
        timeline: result.timeline,
        time: result.time,
      });
      return;
    }

    await window.api.saveResponse({
      request_id: state.activeRequestId,
      collection_id: props.id,
      status: result.status || null,
      status_text: result.statusText || null,
      response_headers: result.headers || {},
      response_body: result.body || null,
      timeline: result.timeline || [],
      time_ms: result.time,
      request_method: m,
      request_url: u,
      request_headers: JSON.parse(
        JSON.stringify(state.headers.filter((h) => h.key)),
      ),
      request_body: state.body,
      content_type: result.contentType || '',
      error: result.error || null,
    });

    setState('sending', false);
    setResponse(result);
  }

  async function startWs(u) {
    let wsUrl = u;
    if (wsUrl.startsWith('http://')) wsUrl = 'ws://' + wsUrl.slice(7);
    else if (wsUrl.startsWith('https://')) wsUrl = 'wss://' + wsUrl.slice(8);
    else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://'))
      wsUrl = 'ws://' + wsUrl;

    const connId = generateKSUID();
    wsStartTime = Date.now();
    wsTimeline = [];
    streamRequestId = state.activeRequestId;
    stashedStream = null;
    wsResponseHeaders = {};

    setState({
      streamConnectionId: connId,
      streamType: 'ws',
      streamMessages: [],
      streamStatus:
        '<span class="stream-status"><span class="dot connected"></span> Connecting...</span>',
      streamConnected: false,
      sending: false,
    });
    setResponse({ status: null, statusText: '', headers: {}, timeline: [] });

    appendWsTimeline('info', `Connecting to ${wsUrl}`);
    appendStreamMessage('sys', 'system', `Connecting to ${wsUrl}...`);

    await window.api.wsConnect({
      id: connId,
      url: wsUrl,
      headers: JSON.parse(JSON.stringify(state.headers.filter((h) => h.key))),
    });
  }

  async function wsSend() {
    const msg = state.wsInput;
    const ft = state.wsFrameType;
    if (
      (!msg && ft !== 'ping' && ft !== 'pong') ||
      !state.streamConnectionId ||
      state.streamType !== 'ws'
    )
      return;
    await window.api.wsSend({
      id: state.streamConnectionId,
      data: msg,
      frameType: ft,
    });
    appendWsTimeline('req-header', `${ft} (${msg.length} bytes)`);
    appendStreamMessage('out', ft, msg || `[${ft}]`);
    setState('wsInput', '');
  }

  // --- Event listeners ---

  function setupEventListeners() {
    function isActiveConn(id) {
      return id === state.streamConnectionId;
    }
    function isStashedConn(id) {
      return stashedStream && id === stashedStream.connectionId;
    }

    window.api.onSseOpen((d) => {
      if (d.id !== state.streamConnectionId) return;
      setState({
        streamStatus:
          '<span class="stream-status"><span class="dot connected"></span> Connected</span>',
        streamConnected: true,
      });
      appendStreamMessage(
        'sys',
        'system',
        `Connected \u2014 ${d.status} ${d.statusText}`,
      );
    });

    window.api.onSseEvent((d) => {
      if (d.id !== state.streamConnectionId) return;
      appendStreamMessage(
        'in',
        d.event.type !== 'message' ? d.event.type : 'data',
        d.event.data,
      );
    });

    window.api.onSseClose((d) => {
      if (d.id !== state.streamConnectionId) return;
      appendStreamMessage('sys', 'system', 'Connection closed');
      setState({
        streamStatus:
          '<span class="stream-status"><span class="dot disconnected"></span> Closed</span>',
        streamConnectionId: null,
        streamType: null,
        streamConnected: false,
      });
    });

    window.api.onSseError((d) => {
      if (d.id !== state.streamConnectionId) return;
      appendStreamMessage('sys', 'error', d.error, true);
      setState({
        streamStatus:
          '<span class="stream-status"><span class="dot disconnected"></span> Error</span>',
        streamConnectionId: null,
        streamType: null,
        streamConnected: false,
      });
    });

    window.api.onWsOpen((d) => {
      if (isStashedConn(d.id)) {
        stashedStream.connected = true;
        stashedStream.status =
          '<span class="stream-status"><span class="dot connected"></span> Connected</span>';
        stashedStream.wsResponseHeaders = d.headers || {};
        stashAppendTimeline(
          'res-status',
          'WebSocket connected \u2014 101 Switching Protocols',
        );
        stashAppendMessage('sys', 'system', 'WebSocket connected');
        stashedStream.response = {
          ...stashedStream.response,
          status: 200,
          statusText: 'OK',
          headers: stashedStream.wsResponseHeaders,
        };
        return;
      }
      if (!isActiveConn(d.id)) return;
      wsResponseHeaders = d.headers || {};
      setState({
        streamStatus:
          '<span class="stream-status"><span class="dot connected"></span> Connected</span>',
        streamConnected: true,
      });
      appendWsTimeline(
        'res-status',
        'WebSocket connected \u2014 101 Switching Protocols',
      );
      setResponse((prev) => ({
        ...prev,
        status: 200,
        statusText: 'OK',
        headers: wsResponseHeaders,
      }));
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
      if (isStashedConn(d.id)) {
        stashAppendTimeline('res-header', 'ping');
        stashAppendMessage('sys', 'ping', 'Ping');
        return;
      }
      if (!isActiveConn(d.id)) return;
      appendWsTimeline('res-header', 'ping');
      appendStreamMessage('sys', 'ping', 'Ping');
    });

    window.api.onWsPong((d) => {
      const type = d.auto ? 'req-header' : 'res-header';
      const label = d.auto ? 'pong (auto-reply)' : 'pong';
      if (isStashedConn(d.id)) {
        stashAppendTimeline(type, label);
        stashAppendMessage('sys', 'pong', label);
        return;
      }
      if (!isActiveConn(d.id)) return;
      appendWsTimeline(type, label);
      appendStreamMessage('sys', 'pong', label);
    });

    window.api.onWsClose((d) => {
      if (isStashedConn(d.id)) {
        const closeInfo = d.code
          ? `code: ${d.code}${d.reason ? ', reason: ' + d.reason : ''}`
          : 'no status';
        stashAppendTimeline('info', `Connection closed (${closeInfo})`);
        stashAppendMessage('sys', 'system', `Connection closed (${closeInfo})`);
        stashedStream.connected = false;
        stashedStream.status =
          '<span class="stream-status"><span class="dot disconnected"></span> Closed</span>';
        const duration = stashedStream.wsStartTime
          ? Date.now() - stashedStream.wsStartTime
          : 0;
        window.api.saveResponse({
          request_id: stashedStream.requestId,
          collection_id: props.id,
          status: 200,
          status_text: 'OK',
          response_headers: stashedStream.wsResponseHeaders,
          response_body: null,
          timeline: stashedStream.wsTimeline,
          time_ms: duration,
          request_method: 'WS',
          request_url: '',
          request_headers: [],
          request_body: '',
          content_type: '',
          error: null,
          messages: stashedStream.messages,
        });
        stashedStream = null;
        return;
      }
      if (!isActiveConn(d.id)) return;
      const closeInfo = d.code
        ? `code: ${d.code}${d.reason ? ', reason: ' + d.reason : ''}`
        : 'no status';
      appendWsTimeline('info', `Connection closed (${closeInfo})`);
      appendStreamMessage('sys', 'system', `Connection closed (${closeInfo})`);
      setState(
        'streamStatus',
        '<span class="stream-status"><span class="dot disconnected"></span> Closed</span>',
      );
      saveWsHistory();
      setState({
        streamConnectionId: null,
        streamType: null,
        streamConnected: false,
      });
    });

    window.api.onWsError((d) => {
      if (isStashedConn(d.id)) {
        stashAppendTimeline('error', d.error);
        stashAppendMessage('sys', 'error', d.error, true);
        stashedStream.connected = false;
        stashedStream.status =
          '<span class="stream-status"><span class="dot disconnected"></span> Error</span>';
        const duration = stashedStream.wsStartTime
          ? Date.now() - stashedStream.wsStartTime
          : 0;
        window.api.saveResponse({
          request_id: stashedStream.requestId,
          collection_id: props.id,
          status: null,
          status_text: null,
          response_headers: stashedStream.wsResponseHeaders,
          response_body: null,
          timeline: stashedStream.wsTimeline,
          time_ms: duration,
          request_method: 'WS',
          request_url: '',
          request_headers: [],
          request_body: '',
          content_type: '',
          error: d.error,
          messages: stashedStream.messages,
        });
        stashedStream = null;
        return;
      }
      if (!isActiveConn(d.id)) return;
      appendWsTimeline('error', d.error);
      appendStreamMessage('sys', 'error', d.error, true);
      setState(
        'streamStatus',
        '<span class="stream-status"><span class="dot disconnected"></span> Error</span>',
      );
      saveWsHistory(d.error);
      setState({
        streamConnectionId: null,
        streamType: null,
        streamConnected: false,
      });
    });
  }

  // --- Lifecycle ---

  onMount(async () => {
    const c = await window.api.loadCollection(props.id);
    if (!c) {
      props.onBack();
      return;
    }
    setState({
      collection: c,
      variables: [{ ...EMPTY_VARIABLE }],
    });
    document.title = `${t.app.name} - ${c.name}`;
    setupEventListeners();
  });

  const mql = window.matchMedia('(max-aspect-ratio: 1/1)');
  function onLayoutChange(e) {
    if (e.matches) setState('sidebarOpen', false);
  }
  onMount(() => {
    mql.addEventListener('change', onLayoutChange);
    if (mql.matches) setState('sidebarOpen', false);
  });
  onCleanup(() => {
    mql.removeEventListener('change', onLayoutChange);
    if (state.streamConnectionId) disconnectStream();
  });

  const actions = {
    onBack: props.onBack,
    selectRequest,
    clearEditor,
    sendRequest,
    disconnectStream,
    wsSend,
    updateField,
    syncContentTypeHeader,
    handleUrlPaste,
    importCurl,
    onHeaderChange,
    removeHeader,
    addHeader,
    reorderHeaders,
    onParamChange,
    removeParam,
    addParam,
    reorderParams,
    onVariableChange,
    removeVariable,
    addVariable,
    reorderVariables,
    onFormFieldChange,
    removeFormField,
    addFormField,
    reorderFormFields,
    pickFormFile,
    pickFile,
    clearFile,
    handleRename,
    handleDelete,
    toggleFolder,
    addToFolder,
    addRequest,
    addFolder,
    importRequests,
    renameCollection,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    appendStreamMessage,
    setResponse,
    setSidebarOpen: (v) => setState('sidebarOpen', v),
  };

  return (
    <CollectionContext.Provider value={[state, actions]}>
      {props.children}
    </CollectionContext.Provider>
  );
}
