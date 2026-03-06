import { createSignal, createEffect, Show, For } from 'solid-js';
import t from '../locale';
import Icon from './Icon';
import { applyTheme, getStoredThemeId, getThemeList } from '../themes';
import { applyUiFontSize, applyEditorFontSize } from '../index';

let modalResolve = null;
const [modalVisible, setModalVisible] = createSignal(false);
const [modalTitle, setModalTitle] = createSignal('');
const [modalValue, setModalValue] = createSignal('');
const [modalDescription, setModalDescription] = createSignal('');
const [modalType, setModalType] = createSignal('prompt'); // 'prompt' | 'confirm'

export function showPrompt(title, defaultValue = '', description = '') {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle(title);
    setModalDescription(description);
    setModalValue(defaultValue);
    setModalType('prompt');
    setModalVisible(true);
  });
}

export function showConfirm(title, description = '') {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle(title);
    setModalDescription(description);
    setModalType('confirm');
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
  if (modalResolve) { modalResolve(result); modalResolve = null; }
}

export default function Modal() {
  let inputRef;

  const [selectedTheme, setSelectedTheme] = createSignal(getStoredThemeId());
  const [uiFontSize, setUiFontSize] = createSignal(12);
  const [editorFontSize, setEditorFontSize] = createSignal(13);

  // Load font size settings from DB when settings modal opens
  createEffect(() => {
    if (modalVisible() && modalType() === 'settings') {
      window.api.getAllSettings().then((s) => {
        if (s.uiFontSize) setUiFontSize(parseInt(s.uiFontSize));
        if (s.editorFontSize) setEditorFontSize(parseInt(s.editorFontSize));
      });
    }
  });

  function onKeyDown(e) {
    if (e.key === 'Enter' && modalType() !== 'textarea' && modalType() !== 'settings') close(modalType() === 'prompt' ? modalValue() : true);
    if (e.key === 'Escape') close(modalType() === 'prompt' || modalType() === 'textarea' ? null : modalType() === 'settings' ? null : false);
  }

  return (
    <Show when={modalVisible()}>
      <div class="modal-overlay visible" onKeyDown={onKeyDown}>
        <div class="modal">
          <div class="modal-title-row">
            <div class="modal-title">{modalTitle()}</div>
            <Show when={modalType() === 'settings'}>
              <button class="btn btn-ghost btn-sm modal-close-btn" onClick={() => close(null)}><Icon name="fa-solid fa-xmark" /></button>
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
              <select class="settings-select" value={selectedTheme()} onChange={(e) => { applyTheme(e.target.value); setSelectedTheme(e.target.value); }}>
                <For each={getThemeList()}>
                  {(theme) => <option value={theme.id}>{theme.name}</option>}
                </For>
              </select>
            </div>
            <div class="settings-row">
              <div class="settings-section">
                <div class="settings-label">{t.modal.uiFontSizeLabel}</div>
                <select class="settings-select" value={uiFontSize()} onChange={(e) => {
                  const v = e.target.value;
                  setUiFontSize(parseInt(v));
                  window.api.setSetting('uiFontSize', v);
                  applyUiFontSize(v);
                }}>
                  <For each={[10, 11, 12, 13, 14, 15, 16]}>
                    {(s) => <option value={s}>{s}px</option>}
                  </For>
                </select>
              </div>
              <div class="settings-section">
                <div class="settings-label">{t.modal.editorFontSizeLabel}</div>
                <select class="settings-select" value={editorFontSize()} onChange={(e) => {
                  const v = e.target.value;
                  setEditorFontSize(parseInt(v));
                  window.api.setSetting('editorFontSize', v);
                  applyEditorFontSize(v);
                }}>
                  <For each={[10, 11, 12, 13, 14, 15, 16]}>
                    {(s) => <option value={s}>{s}px</option>}
                  </For>
                </select>
              </div>
            </div>
          </Show>
          <Show when={modalType() !== 'settings'}>
            <div class="modal-buttons">
              <button class="btn btn-ghost" onClick={() => close(modalType() === 'prompt' ? null : false)}>{t.modal.cancelButton}</button>
              <Show when={modalType() === 'prompt' || modalType() === 'textarea'}>
                <button class="btn btn-primary" onClick={() => close(modalValue())}>{t.modal.okButton}</button>
              </Show>
              <Show when={modalType() === 'confirm'}>
                <button class="btn btn-danger" onClick={() => close(true)}>{t.modal.deleteButton}</button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
