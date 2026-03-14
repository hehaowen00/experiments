import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { applyEditorFontSize, applyUiFontSize } from '../index';
import t from '../locale';
import { applyTheme, getStoredThemeId, getThemeList } from '../themes';
import Icon from './Icon';
import Select from './Select';

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

const [modalChoices, setModalChoices] = createSignal([]);

export function showChoice(title, description = '', choices = []) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle(title);
    setModalDescription(description);
    setModalChoices(choices);
    setModalType('choice');
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

  const [settingsTab, setSettingsTab] = createSignal('general');
  const [selectedTheme, setSelectedTheme] = createSignal(getStoredThemeId());
  const [uiFontSize, setUiFontSize] = createSignal(14);
  const [editorFontSize, setEditorFontSize] = createSignal(12);

  // Identity management
  const [identities, setIdentities] = createStore([]);
  const [editingIdentity, setEditingIdentity] = createSignal(null);
  const [identityName, setIdentityName] = createSignal('');
  const [identityEmail, setIdentityEmail] = createSignal('');

  // P2P settings
  const [p2pIdentity, setP2pIdentity] = createSignal(null);
  const [p2pDisplayName, setP2pDisplayName] = createSignal('');

  // Load settings and identities when settings modal opens
  createEffect(() => {
    if (modalVisible() && modalType() === 'settings') {
      setSettingsTab('general');
      window.api.getAllSettings().then((s) => {
        if (s.uiFontSize) setUiFontSize(parseInt(s.uiFontSize));
        if (s.editorFontSize) setEditorFontSize(parseInt(s.editorFontSize));
      });
      window.api.identityList().then((list) => setIdentities(list));
      window.api.p2pGetIdentity().then((id) => {
        setP2pIdentity(id);
        setP2pDisplayName(id.displayName);
      });
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
    if (!modalVisible()) return;
    if (e.key === 'Enter') {
      if (modalType() === 'alert') close(null);
      else if (modalType() === 'confirm-type') {
        if (modalValue() === modalExpectedName()) close(true);
      } else if (modalType() !== 'textarea' && modalType() !== 'settings' && modalType() !== 'choice')
        close(modalType() === 'prompt' ? modalValue() : true);
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
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
  }

  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  return (
    <Show when={modalVisible()}>
      <div class="modal-overlay visible">
        <div class={`modal${modalType() === 'settings' ? ' modal-settings' : ''}`}>
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
            <div
              class="modal-description"
              classList={{ 'modal-description-copyable': modalType() === 'alert' }}
              title={modalType() === 'alert' ? 'Click to copy' : ''}
              onClick={() => {
                if (modalType() === 'alert') {
                  navigator.clipboard.writeText(modalDescription());
                }
              }}
            >
              {modalDescription()}
            </div>
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
            <div class="settings-tabs">
              <button class={`settings-tab ${settingsTab() === 'general' ? 'active' : ''}`} onClick={() => setSettingsTab('general')}>General</button>
              <button class={`settings-tab ${settingsTab() === 'identities' ? 'active' : ''}`} onClick={() => setSettingsTab('identities')}>Identities</button>
              <button class={`settings-tab ${settingsTab() === 'p2p' ? 'active' : ''}`} onClick={() => setSettingsTab('p2p')}>P2P</button>
            </div>
            <div class="settings-tab-content">
              <Show when={settingsTab() === 'general'}>
                <div class="settings-section">
                  <div class="settings-label">{t.modal.themeLabel}</div>
                  <Select
                    value={selectedTheme()}
                    options={getThemeList().map((theme) => ({ value: theme.id, label: theme.name }))}
                    onChange={(value) => {
                      applyTheme(value);
                      setSelectedTheme(value);
                    }}
                    class="select-full"
                  />
                </div>
                <div class="settings-row">
                  <div class="settings-section">
                    <div class="settings-label">{t.modal.uiFontSizeLabel}</div>
                    <Select
                      value={uiFontSize()}
                      options={[10, 11, 12, 13, 14, 15, 16].map((s) => ({ value: s, label: `${s}px` }))}
                      onChange={(value) => {
                        setUiFontSize(parseInt(value));
                        window.api.setSetting('uiFontSize', value);
                        applyUiFontSize(value);
                      }}
                      class="select-full"
                    />
                  </div>
                  <div class="settings-section">
                    <div class="settings-label">{t.modal.editorFontSizeLabel}</div>
                    <Select
                      value={editorFontSize()}
                      options={[10, 11, 12, 13, 14, 15, 16].map((s) => ({ value: s, label: `${s}px` }))}
                      onChange={(value) => {
                        setEditorFontSize(parseInt(value));
                        window.api.setSetting('editorFontSize', value);
                        applyEditorFontSize(value);
                      }}
                      class="select-full"
                    />
                  </div>
                </div>
              </Show>
              <Show when={settingsTab() === 'identities'}>
                <div class="settings-section">
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
              <Show when={settingsTab() === 'p2p'}>
                <div class="settings-section">
                  <Show when={p2pIdentity()}>
                    <div class="settings-label">Display Name</div>
                    <div style={{ display: 'flex', gap: '6px', 'margin-bottom': '12px' }}>
                      <input
                        type="text"
                        class="settings-identity-input"
                        value={p2pDisplayName()}
                        onInput={(e) => setP2pDisplayName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            window.api.p2pSetDisplayName(p2pDisplayName().trim());
                            window.api.p2pGetIdentity().then(setP2pIdentity);
                          }
                        }}
                        placeholder="Display name"
                      />
                      <button
                        class="btn btn-primary btn-xs"
                        onClick={() => {
                          window.api.p2pSetDisplayName(p2pDisplayName().trim());
                          window.api.p2pGetIdentity().then(setP2pIdentity);
                        }}
                        disabled={!p2pDisplayName().trim()}
                      >
                        Save
                      </button>
                    </div>
                    <div class="settings-label">P2P Networking</div>
                    <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={p2pIdentity()?.enabled}
                        onChange={async () => {
                          await window.api.p2pSetEnabled(!p2pIdentity().enabled);
                          setP2pIdentity(await window.api.p2pGetIdentity());
                        }}
                      />
                      <span>{p2pIdentity()?.enabled ? 'Enabled (discoverable on LAN)' : 'Disabled'}</span>
                    </label>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={modalType() === 'alert'}>
            <div class="modal-buttons">
              <button class="btn btn-primary" onClick={() => close(null)} autofocus>
                {t.modal.okButton}
              </button>
            </div>
          </Show>
          <Show when={modalType() !== 'settings' && modalType() !== 'alert' && modalType() !== 'confirm-type' && modalType() !== 'choice'}>
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
          <Show when={modalType() === 'choice'}>
            <div class="modal-choices">
              <For each={modalChoices()}>{(choice) => (
                <button
                  class={`btn ${choice.style === 'danger' ? 'btn-danger' : 'btn-ghost'} modal-choice-btn`}
                  onClick={() => close(choice.value)}
                >
                  <span class="modal-choice-label">{choice.label}</span>
                  <Show when={choice.description}>
                    <span class="modal-choice-desc">{choice.description}</span>
                  </Show>
                </button>
              )}</For>
            </div>
            <button class="btn btn-ghost modal-choice-cancel" onClick={() => close(null)}>
              {t.modal.cancelButton}
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
