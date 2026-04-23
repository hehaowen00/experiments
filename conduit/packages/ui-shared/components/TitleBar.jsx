import Icon from './Icon';

export default function TitleBar() {
  return (
    <div class="titlebar-controls">
      <button class="titlebar-btn" onClick={() => window.api.windowMinimize()}>
        <Icon name="fa-solid fa-minus" />
      </button>
      <button class="titlebar-btn" onClick={() => window.api.windowMaximize()}>
        <Icon name="fa-regular fa-square" />
      </button>
      <button class="titlebar-btn titlebar-btn-close" onClick={() => window.api.windowClose()}>
        <Icon name="fa-solid fa-xmark" />
      </button>
    </div>
  );
}
