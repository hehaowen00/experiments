import { For, Show } from 'solid-js';
import Icon from './Icon';

export default function CategoryList(props) {
  // props: categories, items, renderItem, getItemsInCategory, getUncategorizedItems,
  //        onToggleCollapse, onRenameCategory, onRemoveCategory,
  //        onCategoryDragOver, onCategoryDragLeave, onCategoryDrop,
  //        emptyMessage, dropHint, categoryExtras

  return (
    <div class="landing-content">
      <Show when={props.items.length === 0 && props.categories.length === 0}>
        <div class="empty-state">{props.emptyMessage}</div>
      </Show>

      <For each={props.categories}>
        {(cat) => {
          const catItems = () => props.getItemsInCategory(cat.id);
          return (
            <div
              class="landing-section landing-category"
              classList={props.categoryClassList?.(cat)}
              data-cat-id={cat.id}
              onDragOver={(e) => {
                props.onCategoryDragOver?.(e, cat);
                props.onCategorySectionDragOver?.(e);
              }}
              onDragLeave={(e) => props.onCategoryDragLeave?.(e)}
              onDrop={(e) => {
                props.onCategoryDrop?.(e, cat.id);
                props.onCategorySectionDrop?.(e, cat.id);
              }}
            >
              <div
                class="landing-section-header category-header"
                onClick={() => props.onToggleCollapse?.(cat.id, cat.collapsed)}
              >
                {props.categoryExtras?.(cat)}
                <Icon name={cat.collapsed ? 'fa-solid fa-caret-right' : 'fa-solid fa-caret-down'} />
                <span class="category-name">{cat.name}</span>
                <div class="category-actions">
                  <button class="btn btn-ghost btn-sm" onClick={(e) => props.onRenameCategory?.(e, cat.id, cat.name)} title="Rename category">
                    <Icon name="fa-solid fa-pen" /> Rename
                  </button>
                  <button class="btn btn-danger btn-sm" onClick={(e) => props.onRemoveCategory?.(e, cat.id, cat.name)} title="Delete category">
                    <Icon name="fa-solid fa-trash" /> Delete
                  </button>
                </div>
                <span class="category-count">{catItems().length}</span>
              </div>
              <Show when={!cat.collapsed}>
                <div class="collection-list">
                  <Show when={catItems().length === 0}>
                    <div class="empty-category">{props.dropHint || 'Drop items here'}</div>
                  </Show>
                  <For each={catItems()}>
                    {(item) => props.renderItem(item)}
                  </For>
                </div>
              </Show>
            </div>
          );
        }}
      </For>

      <Show when={props.categories.length > 0}>
        <div
          class="landing-section"
          onDragOver={(e) => props.onCategoryDragOver?.(e, null)}
          onDragLeave={(e) => props.onCategoryDragLeave?.(e)}
          onDrop={(e) => props.onCategoryDrop?.(e, null)}
        >
          <div class="landing-section-header">Uncategorized</div>
          <div class="collection-list">
            <Show when={props.getUncategorizedItems().length === 0}>
              <div class="empty-category">{props.dropHint || 'Drop items here'}</div>
            </Show>
            <For each={props.getUncategorizedItems()}>
              {(item) => props.renderItem(item)}
            </For>
          </div>
        </div>
      </Show>
      <Show when={props.categories.length === 0}>
        <div class="collection-list">
          <For each={props.getUncategorizedItems()}>
            {(item) => props.renderItem(item)}
          </For>
        </div>
      </Show>
    </div>
  );
}
