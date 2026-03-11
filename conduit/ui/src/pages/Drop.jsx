import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import QRCode from 'qrcode';
import Icon from '../components/Icon';

export default function Drop(props) {
  const [state, setState] = createStore({
    running: false,
    port: 9000,
    savePath: '',
    ips: [],
    pending: [],
    files: [],
    error: '',
  });

  const serverId = 'drop-main';
  const [qrDataUrl, setQrDataUrl] = createSignal('');

  onMount(async () => {
    const home = await window.api.homeDir();
    setState('savePath', home + '/Downloads');

    window.api.onDropStarted(async (d) => {
      if (d.id !== serverId) return;
      setState({ running: true, ips: d.ips, port: d.port, error: '' });
      const ip = d.ips.length > 0 ? d.ips[0] : 'localhost';
      const url = `http://${ip}:${d.port}`;
      try {
        const dataUrl = await QRCode.toDataURL(url, { width: 200, margin: 2, color: { dark: '#ffffffee', light: '#00000000' } });
        setQrDataUrl(dataUrl);
      } catch (_) {}
    });
    window.api.onDropStopped((d) => {
      if (d.id !== serverId) return;
      setState({ running: false, ips: [], pending: [], error: '' });
      setQrDataUrl('');
    });
    window.api.onDropPending((d) => {
      if (d.id !== serverId) return;
      setState('pending', (prev) => [
        { fileId: d.fileId, name: d.name, size: d.size, time: d.time },
        ...prev,
      ]);
    });
    window.api.onDropAccepted((d) => {
      if (d.id !== serverId) return;
      setState('pending', (prev) => prev.filter((p) => p.fileId !== d.file.id));
      setState('files', (prev) => [d.file, ...prev]);
    });
    window.api.onDropRejected((d) => {
      if (d.id !== serverId) return;
      setState('pending', (prev) => prev.filter((p) => p.fileId !== d.fileId));
    });
    window.api.onDropError((d) => {
      if (d.id !== serverId) return;
      setState({ running: false, error: d.error });
    });
  });

  async function start() {
    setState('error', '');
    await window.api.dropStart({
      id: serverId,
      port: state.port,
      savePath: state.savePath,
    });
  }

  async function stop() {
    await window.api.dropStop(serverId);
  }

  async function pickFolder() {
    const folder = await window.api.dropPickFolder();
    if (folder) setState('savePath', folder);
  }

  function accept(fileId) {
    window.api.dropAccept(fileId);
  }

  function reject(fileId) {
    window.api.dropReject(fileId);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(1) + ' GB';
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString();
  }

  return (
    <div class="landing-main" style={props.style}>
      <div class="drop-tool">
        <div class="drop-config">
          <div class="drop-config-row">
            <label>Port</label>
            <input
              type="number"
              value={state.port}
              onInput={(e) => setState('port', parseInt(e.target.value) || 9000)}
              disabled={state.running}
            />
          </div>
          <div class="drop-config-row">
            <label>Save to</label>
            <div class="drop-path-picker">
              <span class="drop-path-display" title={state.savePath}>
                {state.savePath}
              </span>
              <button
                class="btn btn-ghost btn-sm"
                onClick={pickFolder}
                disabled={state.running}
              >
                Browse
              </button>
            </div>
          </div>
          <div class="drop-config-row">
            <Show
              when={state.running}
              fallback={
                <button class="btn btn-primary btn-sm" onClick={start}>
                  <Icon name="fa-solid fa-play" /> Start Server
                </button>
              }
            >
              <button class="btn btn-sm drop-btn-stop" onClick={stop}>
                <Icon name="fa-solid fa-stop" /> Stop Server
              </button>
            </Show>
          </div>
          <Show when={state.error}>
            <div class="drop-error">{state.error}</div>
          </Show>
        </div>

        <Show when={state.running}>
          <div class="drop-status">
            <div class="drop-status-label">Server running on:</div>
            <For each={state.ips}>
              {(ip) => (
                <div class="drop-url">
                  http://{ip}:{state.port}
                </div>
              )}
            </For>
            <Show when={state.ips.length === 0}>
              <div class="drop-url">http://localhost:{state.port}</div>
            </Show>
            <Show when={qrDataUrl()}>
              <div class="drop-qr">
                <img src={qrDataUrl()} alt="QR Code" />
              </div>
            </Show>
          </div>
        </Show>

        <Show when={state.pending.length > 0}>
          <div class="drop-files">
            <div class="drop-files-header">
              Pending ({state.pending.length})
            </div>
            <For each={state.pending}>
              {(f) => (
                <div class="drop-file-item drop-file-pending">
                  <div class="drop-file-info">
                    <span class="drop-file-name">{f.name}</span>
                    <span class="drop-file-meta">
                      {formatSize(f.size)} &middot; {formatTime(f.time)}
                    </span>
                  </div>
                  <div class="drop-file-actions">
                    <button
                      class="btn btn-sm drop-btn-accept"
                      onClick={() => accept(f.fileId)}
                      title="Accept"
                    >
                      <Icon name="fa-solid fa-check" />
                    </button>
                    <button
                      class="btn btn-sm drop-btn-reject"
                      onClick={() => reject(f.fileId)}
                      title="Reject"
                    >
                      <Icon name="fa-solid fa-xmark" />
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="drop-files">
          <div class="drop-files-header">
            Received Files ({state.files.length})
          </div>
          <Show when={state.files.length === 0 && state.pending.length === 0}>
            <div class="drop-empty">
              {state.running
                ? 'Waiting for files...'
                : 'Start the server to receive files.'}
            </div>
          </Show>
          <For each={state.files}>
            {(f) => (
              <div class="drop-file-item">
                <div class="drop-file-info">
                  <span class="drop-file-name">{f.name}</span>
                  <span class="drop-file-meta">
                    {formatSize(f.size)} &middot; {formatTime(f.time)}
                  </span>
                </div>
                <Icon name="fa-solid fa-check" />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
