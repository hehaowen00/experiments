import { createSignal, Show } from 'solid-js';

const [toastMsg, setToastMsg] = createSignal(null);
let toastTimer;

export function showToast(msg, duration = 1500) {
  clearTimeout(toastTimer);
  setToastMsg(msg);
  toastTimer = setTimeout(() => setToastMsg(null), duration);
}

export default function Toast() {
  return (
    <Show when={toastMsg()}>
      <div class="toast">{toastMsg()}</div>
    </Show>
  );
}
