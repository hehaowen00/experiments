import { createSignal, Show } from 'solid-js';
import t from '../locale';

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

function close(result) {
  setModalVisible(false);
  if (modalResolve) { modalResolve(result); modalResolve = null; }
}

export default function Modal() {
  let inputRef;

  function onKeyDown(e) {
    if (e.key === 'Enter' && modalType() !== 'textarea') close(modalType() === 'prompt' ? modalValue() : true);
    if (e.key === 'Escape') close(modalType() === 'prompt' || modalType() === 'textarea' ? null : false);
  }

  return (
    <Show when={modalVisible()}>
      <div class="modal-overlay visible" onKeyDown={onKeyDown}>
        <div class="modal">
          <div class="modal-title">{modalTitle()}</div>
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
          <div class="modal-buttons">
            <button class="btn btn-ghost" onClick={() => close(modalType() === 'prompt' ? null : false)}>{t.modal.cancelButton}</button>
            <Show when={modalType() === 'prompt' || modalType() === 'textarea'}>
              <button class="btn btn-primary" onClick={() => close(modalValue())}>{t.modal.okButton}</button>
            </Show>
            <Show when={modalType() === 'confirm'}>
              <button class="btn btn-danger" onClick={() => close(true)}>{t.modal.deleteButton}</button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
