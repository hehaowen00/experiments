import { createSignal } from 'solid-js';
import t from '../../locale';

let modalResolve = null;
export const [modalVisible, setModalVisible] = createSignal(false);
export const [modalTitle, setModalTitle] = createSignal('');
export const [modalValue, setModalValue] = createSignal('');
export const [modalPlaceholder, setModalPlaceholder] = createSignal('');
export const [modalDescription, setModalDescription] = createSignal('');
export const [modalType, setModalType] = createSignal('prompt');
export const [modalConfirmLabel, setModalConfirmLabel] = createSignal('');
export const [modalConfirmStyle, setModalConfirmStyle] =
  createSignal('danger');
export const [modalExpectedName, setModalExpectedName] = createSignal('');
export const [modalChoices, setModalChoices] = createSignal([]);

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

export const [modalRemotes, setModalRemotes] = createSignal([]);
export const [modalSelectedRemote, setModalSelectedRemote] = createSignal('');
export const [modalForce, setModalForce] = createSignal(false);
export const [modalNewBranch, setModalNewBranch] = createSignal(false);
export const [modalNewBranchName, setModalNewBranchName] = createSignal('');
export const [modalPullStrategy, setModalPullStrategy] = createSignal('');

export function showPush(remotes, lastRemote, currentBranch) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle('Push to Remote');
    setModalDescription('');
    setModalRemotes(remotes);
    const defaultRemote = lastRemote && remotes.find((r) => r.name === lastRemote)
      ? lastRemote
      : remotes.length > 0
        ? remotes[0].name
        : '';
    setModalSelectedRemote(defaultRemote);
    setModalForce(false);
    setModalNewBranch(false);
    setModalNewBranchName(currentBranch || '');
    setModalType('push');
    setModalVisible(true);
  });
}

export function showPull(remotes, lastRemote) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    setModalTitle('Pull from Remote');
    setModalDescription('');
    setModalRemotes(remotes);
    const defaultRemote = lastRemote && remotes.find((r) => r.name === lastRemote)
      ? lastRemote
      : remotes.length > 0
        ? remotes[0].name
        : '';
    setModalSelectedRemote(defaultRemote);
    setModalPullStrategy('');
    setModalType('pull');
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

export function close(result) {
  setModalVisible(false);
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}
