import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { applyEditorFontSize, applyUiFontSize } from '../fonts';
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

  // Load font size settings from DB when settings modal opens
  createEffect(() => {
    if (modalVisible() && modalType() === 'settings') {
      setSettingsTab('general');
      window.api.getAllSettings().then((s) => {
        if (s.uiFontSize) setUiFontSize(parseInt(s.uiFontSize));
        if (s.editorFontSize) setEditorFontSize(parseInt(s.editorFontSize));
      });
    }
  });

  // Focus the text input when a prompt / confirm-type / textarea modal opens
  createEffect(() => {
    const type = modalType();
    if (!modalVisible()) return;
    if (type !== 'prompt' && type !== 'confirm-type' && type !== 'textarea') return;
    queueMicrotask(() => {
      if (!inputRef) return;
      inputRef.focus();
      if (typeof inputRef.select === 'function') inputRef.select();
    });
  });

  function cancelModal() {
    if (!modalVisible()) return;
    const type = modalType();
    if (type === 'confirm' || type === 'confirm-type') close(false);
    else close(null);
  }

  function onGlobalKeyDown(e) {
    if (e.key === 'Escape' && modalVisible()) {
      e.preventDefault();
      e.stopPropagation();
      cancelModal();
    }
  }

  onMount(() => document.addEventListener('keydown', onGlobalKeyDown, true));
  onCleanup(() => document.removeEventListener('keydown', onGlobalKeyDown, true));

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      if (modalType() === 'alert') close(null);
      else if (modalType() === 'confirm-type') {
        if (modalValue() === modalExpectedName()) close(true);
      } else if (modalType() !== 'textarea' && modalType() !== 'settings')
        close(modalType() === 'prompt' ? modalValue() : true);
    }
  }

  return (
    <Show when={modalVisible()}>
      <div class="modal-overlay visible" onKeyDown={onKeyDown}>
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
              ref={inputRef}
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
              <button
                class={`settings-tab ${settingsTab() === 'general' ? 'active' : ''}`}
                onClick={() => setSettingsTab('general')}
              >
                General
              </button>
            </div>
            <div class="settings-tab-content">
              <Show when={settingsTab() === 'general'}>
                <div class="settings-section">
                  <div class="settings-label">{t.modal.themeLabel}</div>
                  <Select
                    class="select-full"
                    value={selectedTheme()}
                    options={getThemeList().map((theme) => ({ value: theme.id, label: theme.name }))}
                    onChange={(value) => {
                      applyTheme(value);
                      setSelectedTheme(value);
                    }}
                  />
                </div>
                <div class="settings-row">
                  <div class="settings-section">
                    <div class="settings-label">{t.modal.uiFontSizeLabel}</div>
                    <Select
                      class="select-full"
                      value={String(uiFontSize())}
                      options={[10, 11, 12, 13, 14, 15, 16].map((s) => ({ value: String(s), label: `${s}px` }))}
                      onChange={(value) => {
                        setUiFontSize(parseInt(value));
                        window.api.setSetting('uiFontSize', value);
                        applyUiFontSize(value);
                      }}
                    />
                  </div>
                  <div class="settings-section">
                    <div class="settings-label">{t.modal.editorFontSizeLabel}</div>
                    <Select
                      class="select-full"
                      value={String(editorFontSize())}
                      options={[10, 11, 12, 13, 14, 15, 16].map((s) => ({ value: String(s), label: `${s}px` }))}
                      onChange={(value) => {
                        setEditorFontSize(parseInt(value));
                        window.api.setSetting('editorFontSize', value);
                        applyEditorFontSize(value);
                      }}
                    />
                  </div>
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
              ref={inputRef}
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
