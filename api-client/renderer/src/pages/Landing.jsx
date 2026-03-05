import { createSignal, onMount, For, Show } from 'solid-js';
import { formatLastUsed } from '../helpers';
import { showPrompt, showConfirm } from '../components/Modal';
import Modal from '../components/Modal';

export default function Landing(props) {
  const [collections, setCollections] = createSignal([]);
  const [newName, setNewName] = createSignal('');

  async function load() {
    setCollections(await window.api.listCollections());
  }

  onMount(load);

  async function create() {
    const name = newName().trim();
    if (!name) return;
    await window.api.createCollection(name);
    setNewName('');
    load();
  }

  async function rename(id, oldName) {
    const name = await showPrompt('Rename collection:', oldName);
    if (name && name.trim()) {
      await window.api.renameCollection(id, name.trim());
      load();
    }
  }

  async function remove(id, name) {
    if (await showConfirm(`Delete "${name}"? This cannot be undone.`)) {
      await window.api.deleteCollection(id);
      load();
    }
  }

  return (
    <div class="landing">
      <h1>API Client</h1>
      <p class="subtitle">Organize and send HTTP requests</p>
      <div class="toolbar">
        <input
          type="text"
          placeholder="New collection name..."
          value={newName()}
          onInput={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
        />
        <button class="btn btn-primary" onClick={create}>Create</button>
      </div>
      <div class="collection-list">
        <Show when={collections().length === 0}>
          <div class="empty-state">No collections yet. Create one to get started.</div>
        </Show>
        <For each={collections()}>
          {(c) => (
            <div class="collection-item" onClick={() => props.onOpen(c.id)}>
              <span class="name">{c.name}</span>
              <span class="last-used">{formatLastUsed(c.last_used)}</span>
              <div class="actions">
                <button class="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); rename(c.id, c.name); }}>Rename</button>
                <button class="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); remove(c.id, c.name); }}>Delete</button>
              </div>
            </div>
          )}
        </For>
      </div>
      <Modal />
    </div>
  );
}
