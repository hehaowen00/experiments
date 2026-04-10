import { Show } from 'solid-js';
import Icon from '../lib/Icon';

export default function Titlebar(props) {
  return (
    <div class="titlebar">
      <Show when={props.children} fallback={
        <>
          <div class="titlebar-title">{props.title || 'GitSync'}</div>
          <div style={{ flex: 1 }} />
        </>
      }>
        {props.children}
      </Show>
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
    </div>
  );
}
