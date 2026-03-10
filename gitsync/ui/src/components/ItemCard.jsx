import { For } from 'solid-js';

export default function ItemCard(props) {
  return (
    <div
      class={`collection-item ${props.item.pinned ? 'pinned' : ''}`}
      onClick={() => props.onOpen?.(props.item)}
      draggable="true"
      onDragStart={(e) => props.onDragStart?.(e, props.item.id)}
      onDragEnd={props.onDragEnd}
    >
      <span class="name">{props.name}</span>
      <span class={`last-used ${props.subtitleClass || ''}`}>{props.subtitle}</span>
      <div class="actions">
        <For each={props.actions}>
          {(action) => (
            <button
              class={`btn btn-sm ${action.danger ? 'btn-danger' : 'btn-ghost'}`}
              onClick={(e) => { e.stopPropagation(); action.onClick(e, props.item); }}
            >
              {action.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
