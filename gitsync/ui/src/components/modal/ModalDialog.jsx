import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import Icon from '../../lib/Icon';
import { getStoredThemeId } from '../../themes';
import t from '../../locale';
import GeneralTab from '../settings/GeneralTab';
import IdentitiesTab from '../settings/IdentitiesTab';
import P2PTab from '../settings/P2PTab';
import {
  modalVisible,
  modalTitle,
  modalValue,
  setModalValue,
  modalPlaceholder,
  modalDescription,
  modalType,
  modalConfirmLabel,
  modalConfirmStyle,
  modalExpectedName,
  modalChoices,
  close,
} from './state';

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
              <button class="btn btn-ghost btn-sm modal-close-btn" onClick={() => close(null)} title="Close settings">
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
                if (modalType() === 'alert') navigator.clipboard.writeText(modalDescription());
              }}
            >
              {modalDescription()}
            </div>
          </Show>
          <Show when={modalType() === 'prompt'}>
            <input ref={inputRef} type="text" class="modal-input" value={modalValue()} onInput={(e) => setModalValue(e.target.value)} placeholder={modalPlaceholder()} onKeyDown={onKeyDown} autofocus />
          </Show>
          <Show when={modalType() === 'textarea'}>
            <textarea class="modal-input modal-textarea" value={modalValue()} onInput={(e) => setModalValue(e.target.value)} placeholder={t.modal.curlPlaceholder} rows={6} autofocus />
          </Show>
          <Show when={modalType() === 'settings'}>
            <div class="settings-tabs">
              <button class={`settings-tab ${settingsTab() === 'general' ? 'active' : ''}`} onClick={() => setSettingsTab('general')}>General</button>
              <button class={`settings-tab ${settingsTab() === 'identities' ? 'active' : ''}`} onClick={() => setSettingsTab('identities')}>Identities</button>
              <button class={`settings-tab ${settingsTab() === 'p2p' ? 'active' : ''}`} onClick={() => setSettingsTab('p2p')}>P2P</button>
            </div>
            <div class="settings-tab-content">
              <Show when={settingsTab() === 'general'}>
                <GeneralTab selectedTheme={selectedTheme} setSelectedTheme={setSelectedTheme} uiFontSize={uiFontSize} setUiFontSize={setUiFontSize} editorFontSize={editorFontSize} setEditorFontSize={setEditorFontSize} />
              </Show>
              <Show when={settingsTab() === 'identities'}>
                <IdentitiesTab identities={identities} editingIdentity={editingIdentity} identityName={identityName} setIdentityName={setIdentityName} identityEmail={identityEmail} setIdentityEmail={setIdentityEmail} saveIdentity={saveIdentity} startEditIdentity={startEditIdentity} deleteIdentity={deleteIdentity} resetIdentityForm={resetIdentityForm} importGlobalIdentity={importGlobalIdentity} importRepoIdentities={importRepoIdentities} />
              </Show>
              <Show when={settingsTab() === 'p2p'}>
                <P2PTab p2pIdentity={p2pIdentity} setP2pIdentity={setP2pIdentity} p2pDisplayName={p2pDisplayName} setP2pDisplayName={setP2pDisplayName} />
              </Show>
            </div>
          </Show>
          <Show when={modalType() === 'alert'}>
            <div class="modal-buttons">
              <button class="btn btn-primary" onClick={() => close(null)} autofocus>{t.modal.okButton}</button>
            </div>
          </Show>
          <Show when={modalType() !== 'settings' && modalType() !== 'alert' && modalType() !== 'confirm-type' && modalType() !== 'choice'}>
            <div class="modal-buttons">
              <button class="btn btn-ghost" onClick={() => close(modalType() === 'prompt' ? null : false)}>{t.modal.cancelButton}</button>
              <Show when={modalType() === 'prompt' || modalType() === 'textarea'}>
                <button class="btn btn-primary" onClick={() => close(modalValue())}>{t.modal.okButton}</button>
              </Show>
              <Show when={modalType() === 'confirm'}>
                <button class={`btn btn-${modalConfirmStyle()}`} onClick={() => close(true)}>{modalConfirmLabel() || t.modal.deleteButton}</button>
              </Show>
            </div>
          </Show>
          <Show when={modalType() === 'confirm-type'}>
            <div class="modal-confirm-type-hint">Type <strong>{modalExpectedName()}</strong> to confirm</div>
            <input type="text" class="modal-input" value={modalValue()} onInput={(e) => setModalValue(e.target.value)} placeholder={modalExpectedName()} onKeyDown={onKeyDown} autofocus />
            <div class="modal-buttons">
              <button class="btn btn-ghost" onClick={() => close(false)}>{t.modal.cancelButton}</button>
              <button class="btn btn-danger" disabled={modalValue() !== modalExpectedName()} onClick={() => close(true)}>{t.modal.deleteButton}</button>
            </div>
          </Show>
          <Show when={modalType() === 'choice'}>
            <div class="modal-choices">
              <For each={modalChoices()}>{(choice) => (
                <button class={`btn ${choice.style === 'danger' ? 'btn-danger' : 'btn-ghost'} modal-choice-btn`} onClick={() => close(choice.value)}>
                  <span class="modal-choice-label">{choice.label}</span>
                  <Show when={choice.description}>
                    <span class="modal-choice-desc">{choice.description}</span>
                  </Show>
                </button>
              )}</For>
            </div>
            <button class="btn btn-ghost modal-choice-cancel" onClick={() => close(null)}>{t.modal.cancelButton}</button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
