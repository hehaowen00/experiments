import { createSignal, For, Show } from 'solid-js';
import './drop.css';

function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}

export default function DropUpload() {
  const [files, setFiles] = createSignal([]);
  const [shared, setShared] = createSignal([]);
  const [dragover, setDragover] = createSignal(false);

  let fileInput;

  async function loadShared() {
    try {
      const res = await fetch('/files');
      const list = await res.json();
      setShared(list);
    } catch {}
  }

  loadShared();

  function addFile(file) {
    const entry = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      status: 'pending',
      message: 'Uploading...',
    };
    setFiles((prev) => [entry, ...prev]);
    uploadFile(file, entry.id);
  }

  async function uploadFile(file, id) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (json.ok) {
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'ok', message: 'Accepted' } : f)),
        );
      } else {
        const msg = json.error === 'Rejected' ? 'Rejected' : json.error || 'Failed';
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'error', message: msg } : f)),
        );
      }
    } catch {
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: 'error', message: 'Error' } : f)),
      );
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragover(false);
    for (const file of e.dataTransfer.files) {
      addFile(file);
    }
  }

  function handleFileInput() {
    for (const file of fileInput.files) {
      addFile(file);
    }
    fileInput.value = '';
  }

  return (
    <div class="container">
      <h1>Conduit Drop</h1>
      <div
        class="drop-zone"
        classList={{ dragover: dragover() }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={handleDrop}
      >
        <div class="icon">&#128449;</div>
        <p>Drag & drop files here</p>
        <button class="btn" onClick={() => fileInput.click()}>
          Choose Files
        </button>
        <input type="file" ref={fileInput} multiple hidden onInput={handleFileInput} />
      </div>
      <Show when={files().length > 0}>
        <div class="file-list">
          <For each={files()}>
            {(f) => (
              <div class="file-item">
                <span class="file-name">{f.name}</span>
                <span class="file-size">{formatSize(f.size)}</span>
                <span class={`file-status ${f.status}`}>{f.message}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={shared().length > 0}>
        <h2>Available Downloads</h2>
        <div class="file-list">
          <For each={shared()}>
            {(f) => (
              <a class="file-item file-download" href={f.url} download>
                <span class="file-name">{f.name}</span>
                <span class="file-size">{formatSize(f.size)}</span>
                <span class="file-status ok">&#8595; Download</span>
              </a>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
