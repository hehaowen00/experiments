import { onMount, onCleanup, Show } from 'solid-js';
import Icon from './Icon';

export default function FormModal(props) {
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      props.onClose?.();
    }
  }
  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  return (
    <div class="modal-overlay visible" onClick={() => props.onClose?.()}>
      <div class={`modal ${props.size || 'modal-md'}`} onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <span>{props.title}</span>
          <button class="btn btn-ghost btn-sm" onClick={() => props.onClose?.()} title="Close">
            <Icon name="fa-solid fa-xmark" />
          </button>
        </div>
        <div class="modal-body">
          {props.children}
          <Show when={props.error}>
            <div class="modal-error">{props.error}</div>
          </Show>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onClick={() => props.onClose?.()}>Cancel</button>
          <button class="btn btn-primary" onClick={() => props.onSubmit?.()}>
            {props.submitLabel || 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FormField(props) {
  return (
    <div class={`modal-field ${props.inline ? 'modal-field-inline' : ''} ${props.class || ''}`} style={props.style}>
      <Show when={props.label}>
        <label>{props.label}</label>
      </Show>
      {props.children}
    </div>
  );
}
