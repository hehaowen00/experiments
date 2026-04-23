import { createSignal, onCleanup, onMount } from 'solid-js';
import { Icon, Modal, showSettings, TitleBar } from '@conduit/ui-shared';
import DateTimeTool from './pages/DateTimeTool';
import Drop from './pages/Drop';
import RfcViewer from './pages/RfcViewer';

const TOOLS = [
  { id: 'rfc', icon: 'fa-solid fa-book', label: 'RFC Viewer' },
  { id: 'datetime', icon: 'fa-solid fa-clock', label: 'Date / Time' },
  { id: 'drop', icon: 'fa-solid fa-cloud-arrow-up', label: 'Drop' },
];

export default function App() {
  const [active, setActive] = createSignal('rfc');

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault();
      window.api.quit();
    }
  }
  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  return (
    <div class="app-shell">
      <div class="app-tabbar">
        <div class="app-tabs">
          {TOOLS.map((tool) => (
            <button
              class={`app-tab ${active() === tool.id ? 'active' : ''}`}
              onClick={() => setActive(tool.id)}
            >
              <Icon name={tool.icon} />
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
        <div class="app-tab-pinned">
          <button class="btn btn-ghost btn-xs app-tab-settings" onClick={() => showSettings()}>
            <Icon name="fa-solid fa-gear" />
          </button>
        </div>
        <TitleBar />
      </div>
      <RfcViewer style={{ display: active() === 'rfc' ? '' : 'none' }} />
      <DateTimeTool style={{ display: active() === 'datetime' ? '' : 'none' }} />
      <Drop style={{ display: active() === 'drop' ? '' : 'none' }} />
      <Modal />
    </div>
  );
}
