import { createEffect, createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { applyEditorFontSize, applyUiFontSize } from '../index';
import t from '../locale';
import { applyTheme, getStoredThemeId, getThemeList } from '../themes';
import Icon from './Icon';

let modalResolve = null;
const [modalVisible, setModalVisible] = createSignal(false);
const [modalTitle, setModalTitle] = createSignal('');
const [modalValue, setModalValue] = createSignal('');
const [modalPlaceholder, setModalPlaceholder] = createSignal('');
const [modalDescription, setModalDescription] = createSignal('');
const [modalType, setModalType] = createSignal('prompt'); // 'prompt' | 'confirm'
const [modalConfirmLabel, setModalConfirmLabel] = createSignal('');
const [modalConfirmStyle, setModalConfirmStyle] = createSignal('danger'); // 'danger' | 'primary'
const [modalExpectedName, setModalExpectedName] = createSignal('');

export function showPrompt(
  title,
  defaultValue = '',
  description = '',
  placeholder = '',
) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle(title);
    setModalDescription(description);
    setModalPlaceholder(placeholder);
    setModalValue(defaultValue);
    setModalType('prompt');
    setModalVisible(true);
  });
}

export function showConfirm(title, description = '', opts = {}) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle(title);
    setModalDescription(description);
    setModalConfirmLabel(opts.confirmLabel || '');
    setModalConfirmStyle(opts.confirmStyle || 'danger');
    setModalType('confirm');
    setModalVisible(true);
  });
}

export function showConfirmTyped(title, expectedName, description = '') {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle(title);
    setModalDescription(description);
    setModalExpectedName(expectedName);
    setModalValue('');
    setModalType('confirm-type');
    setModalVisible(true);
  });
}

export function showTextarea(title, placeholder = '', description = '') {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle(title);
    setModalDescription(description);
    setModalValue('');
    setModalType('textarea');
    setModalPlaceholder(placeholder);
    setModalVisible(true);
  });
}

export function showAlert(title, description = '') {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle(title);
    setModalDescription(description);
    setModalType('alert');
    setModalVisible(true);
  });
}

export function showSettings() {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle(t.modal.settingsTitle);
    setModalDescription('');
    setModalType('settings');
    setModalVisible(true);
  });
}

function close(result) {
  setModalVisible(false);
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

export default function Modal() {
  let inputRef;

  const [selectedTheme, setSelectedTheme] = createSignal(getStoredThemeId());
  const [uiFontSize, setUiFontSize] = createSignal(14);
  const [editorFontSize, setEditorFontSize] = createSignal(12);

  // Identity management
  const [identities, setIdentities] = createStore([]);
  const [editingIdentity, setEditingIdentity] = createSignal(null);
  const [identityName, setIdentityName] = createSignal('');
  const [identityEmail, setIdentityEmail] = createSignal('');

  // Load settings and identities when settings modal opens
  createEffect(() => {
    if (modalVisible() && modalType() === 'settings') {
      window.api.getAllSettings().then((s) => {
        if (s.uiFontSize) setUiFontSize(parseInt(s.uiFontSize));
        if (s.editorFontSize) setEditorFontSize(parseInt(s.editorFontSize));
      });
      window.api.identityList().then((list) => setIdentities(list));
    }
  });

  function resetIdentityForm() {
    setEditingIdentity(null);
    setIdentityName('');
    setIdentityEmail('');
  }

  async function saveIdentity() {
    const name = identityName().trim();
    const email = identityEmail().trim();
    if (!name || !email) return;
    if (editingIdentity()) {
      await window.api.identityUpdate(editingIdentity(), { name, email });
    } else {
      await window.api.identityCreate({ name, email });
    }
    const list = await window.api.identityList();
    setIdentities(list);
    resetIdentityForm();
  }

  function startEditIdentity(id) {
    const item = identities.find((i) => i.id === id);
    if (!item) return;
    setEditingIdentity(id);
    setIdentityName(item.name);
    setIdentityEmail(item.email);
  }

  async function deleteIdentity(id) {
    await window.api.identityDelete(id);
    const list = await window.api.identityList();
    setIdentities(list);
    if (editingIdentity() === id) resetIdentityForm();
  }

  async function importGlobalIdentity() {
    const global = await window.api.gitGetGlobalIdentity();
    if (!global.name && !global.email) return;
    await window.api.identityImport(global);
    setIdentities(await window.api.identityList());
  }

  async function importRepoIdentities() {
    const repos = await window.api.gitRepoList();
    for (const repo of repos) {
      const local = await window.api.gitGetLocalIdentity(repo.path);
      if (local.name && local.email) {
        await window.api.identityImport(local);
      }
    }
    setIdentities(await window.api.identityList());
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      if (modalType() === 'alert') close(null);
      else if (modalType() === 'confirm-type') {
        if (modalValue() === modalExpectedName()) close(true);
      } else if (modalType() !== 'textarea' && modalType() !== 'settings')
        close(modalType() === 'prompt' ? modalValue() : true);
    }
    if (e.key === 'Escape')
      close(
        modalType() === 'alert'
          ? null
          : modalType() === 'prompt' || modalType() === 'textarea'
            ? null
            : modalType() === 'settings'
              ? null
              : modalType() === 'confirm-type'
                ? false
                : false,
      );
  }

  return (
    <Show when={modalVisible()}>
      <div class="modal-overlay visible" onKeyDown={onKeyDown}>
        <div class="modal">
          <div class="modal-title-row">
            <div class="modal-title">{modalTitle()}</div>
            <Show when={modalType() === 'settings'}>
              <button
                class="btn btn-ghost btn-sm modal-close-btn"
                onClick={() => close(null)}
                title="Close settings"
              >
                <Icon name="fa-solid fa-xmark" />
              </button>
            </Show>
          </div>
          <Show when={modalDescription()}>
            <div class="modal-description">{modalDescription()}</div>
          </Show>
          <Show when={modalType() === 'prompt'}>
            <input
              ref={inputRef}
              type="text"
              class="modal-input"
              value={modalValue()}
              onInput={(e) => setModalValue(e.target.value)}
              placeholder={modalPlaceholder()}
              onKeyDown={onKeyDown}
              autofocus
            />
          </Show>
          <Show when={modalType() === 'textarea'}>
            <textarea
              class="modal-input modal-textarea"
              value={modalValue()}
              onInput={(e) => setModalValue(e.target.value)}
              placeholder={t.modal.curlPlaceholder}
              rows={6}
              autofocus
            />
          </Show>
          <Show when={modalType() === 'settings'}>
            <div class="settings-section">
              <div class="settings-label">{t.modal.themeLabel}</div>
              <select
                class="settings-select"
                value={selectedTheme()}
                onChange={(e) => {
                  applyTheme(e.target.value);
                  setSelectedTheme(e.target.value);
                }}
              >
                <For each={getThemeList()}>
                  {(theme) => <option value={theme.id}>{theme.name}</option>}
                </For>
              </select>
            </div>
            <div class="settings-row">
              <div class="settings-section">
                <div class="settings-label">{t.modal.uiFontSizeLabel}</div>
                <select
                  class="settings-select"
                  value={uiFontSize()}
                  onChange={(e) => {
                    const v = e.target.value;
                    setUiFontSize(parseInt(v));
                    window.api.setSetting('uiFontSize', v);
                    applyUiFontSize(v);
                  }}
                >
                  <For each={[10, 11, 12, 13, 14, 15, 16]}>
                    {(s) => <option value={s}>{s}px</option>}
                  </For>
                </select>
              </div>
              <div class="settings-section">
                <div class="settings-label">{t.modal.editorFontSizeLabel}</div>
                <select
                  class="settings-select"
                  value={editorFontSize()}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditorFontSize(parseInt(v));
                    window.api.setSetting('editorFontSize', v);
                    applyEditorFontSize(v);
                  }}
                >
                  <For each={[10, 11, 12, 13, 14, 15, 16]}>
                    {(s) => <option value={s}>{s}px</option>}
                  </For>
                </select>
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-label">Git Identities</div>
              <div class="settings-identities-list">
                <For each={identities}>{(id) => (
                  <div class="settings-identity-row">
                    <div class="settings-identity-info">
                      <span class="settings-identity-name">{id.name}</span>
                      <span class="settings-identity-email">{id.email}</span>
                    </div>
                    <div class="settings-identity-actions">
                      <button class="btn btn-ghost btn-xs" onClick={() => startEditIdentity(id.id)} title="Edit">
                        <Icon name="fa-solid fa-pen" />
                      </button>
                      <button class="btn btn-ghost btn-xs" onClick={() => deleteIdentity(id.id)} title="Delete">
                        <Icon name="fa-solid fa-trash" />
                      </button>
                    </div>
                  </div>
                )}</For>
              </div>
              <div class="settings-identity-form">
                <input
                  type="text"
                  class="settings-identity-input"
                  placeholder="Name"
                  value={identityName()}
                  onInput={(e) => setIdentityName(e.target.value)}
                />
                <input
                  type="text"
                  class="settings-identity-input"
                  placeholder="Email"
                  value={identityEmail()}
                  onInput={(e) => setIdentityEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveIdentity(); }}
                />
                <button class="btn btn-primary btn-xs" onClick={saveIdentity} disabled={!identityName().trim() || !identityEmail().trim()}>
                  {editingIdentity() ? 'Update' : 'Add'}
                </button>
                <Show when={editingIdentity()}>
                  <button class="btn btn-ghost btn-xs" onClick={resetIdentityForm}>Cancel</button>
                </Show>
              </div>
              <div class="settings-identity-import">
                <button class="btn btn-ghost btn-xs" onClick={importGlobalIdentity} title="Import from git global config">
                  <Icon name="fa-solid fa-globe" /> Import Global
                </button>
                <button class="btn btn-ghost btn-xs" onClick={importRepoIdentities} title="Import from all saved repos' local git config">
                  <Icon name="fa-solid fa-folder-open" /> Import from Repos
                </button>
              </div>
            </div>
          </Show>
          <Show when={modalType() === 'alert'}>
            <div class="modal-buttons">
              <button class="btn btn-primary" onClick={() => close(null)} autofocus>
                {t.modal.okButton}
              </button>
            </div>
          </Show>
          <Show when={modalType() !== 'settings' && modalType() !== 'alert' && modalType() !== 'confirm-type'}>
            <div class="modal-buttons">
              <button
                class="btn btn-ghost"
                onClick={() => close(modalType() === 'prompt' ? null : false)}
              >
                {t.modal.cancelButton}
              </button>
              <Show
                when={modalType() === 'prompt' || modalType() === 'textarea'}
              >
                <button
                  class="btn btn-primary"
                  onClick={() => close(modalValue())}
                >
                  {t.modal.okButton}
                </button>
              </Show>
              <Show when={modalType() === 'confirm'}>
                <button class={`btn btn-${modalConfirmStyle()}`} onClick={() => close(true)}>
                  {modalConfirmLabel() || t.modal.deleteButton}
                </button>
              </Show>
            </div>
          </Show>
          <Show when={modalType() === 'confirm-type'}>
            <div class="modal-confirm-type-hint">Type <strong>{modalExpectedName()}</strong> to confirm</div>
            <input
              type="text"
              class="modal-input"
              value={modalValue()}
              onInput={(e) => setModalValue(e.target.value)}
              placeholder={modalExpectedName()}
              onKeyDown={onKeyDown}
              autofocus
            />
            <div class="modal-buttons">
              <button class="btn btn-ghost" onClick={() => close(false)}>
                {t.modal.cancelButton}
              </button>
              <button
                class="btn btn-danger"
                disabled={modalValue() !== modalExpectedName()}
                onClick={() => close(true)}
              >
                {t.modal.deleteButton}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
