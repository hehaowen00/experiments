import { For, Show, createSignal } from 'solid-js';

export default function Variables(props) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="variables-section">
      <div class="variables-header" onClick={() => setExpanded(!expanded())}>
        <span class="variables-toggle">{expanded() ? '\u25BC' : '\u25B6'}</span>
        <span class="variables-title">Variables</span>
        <span class="variables-count">{props.variables.filter(v => v.key).length}</span>
      </div>
      <Show when={expanded()}>
        <div class="variables-body">
          <For each={props.variables}>
            {(v, i) => (
              <div class="variable-row">
                <input
                  type="text"
                  placeholder="name"
                  value={v.key}
                  onInput={(e) => props.onChange(i(), 'key', e.target.value)}
                />
                <input
                  type="text"
                  placeholder="value"
                  value={v.value}
                  onInput={(e) => props.onChange(i(), 'value', e.target.value)}
                />
                <button class="btn btn-danger btn-sm" onClick={() => props.onRemove(i())}>&times;</button>
              </div>
            )}
          </For>
          <button class="btn btn-ghost btn-sm" onClick={props.onAdd}>+ Add Variable</button>
        </div>
      </Show>
    </div>
  );
}
