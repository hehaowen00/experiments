import { createSignal, onMount, Show } from 'solid-js';
import Icon from './Icon';

export default function Titlebar(props) {
  const [isMac, setIsMac] = createSignal(true);

  onMount(async () => {
    const platform = await window.api.platform();
    setIsMac(platform === 'darwin');
  });

  return (
    <div class="titlebar">
      <Show when={isMac()}>
        <div class="titlebar-traffic-light-spacer" />
      </Show>
      <div class="titlebar-title">{props.title || 'GitSync'}</div>
      <div style={{ flex: 1 }} />
      <Show when={!isMac()}>
        <div class="titlebar-controls">
          <button
            class="titlebar-btn"
            onClick={() => window.api.windowMinimize()}
          >
            <Icon name="fa-solid fa-minus" />
          </button>
          <button
            class="titlebar-btn"
            onClick={() => window.api.windowMaximize()}
          >
            <Icon name="fa-regular fa-square" />
          </button>
          <button
            class="titlebar-btn titlebar-btn-close"
            onClick={() => window.api.windowClose()}
          >
            <Icon name="fa-solid fa-xmark" />
          </button>
        </div>
      </Show>
    </div>
  );
}
