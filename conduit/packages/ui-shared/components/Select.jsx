import { createSignal, For, Show, onCleanup, onMount } from 'solid-js';

/**
 * Custom Select component replacing native <select>.
 *
 * @param {Object} props
 * @param {string} props.value - Current value
 * @param {{ value: string, label: string, color?: string }[]} props.options
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.class] - Additional CSS classes
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 */
export default function Select(props) {
  const [open, setOpen] = createSignal(false);
  const [focusIdx, setFocusIdx] = createSignal(-1);
  let rootRef;
  let listRef;

  const selected = () => props.options.find((o) => o.value === props.value);

  function toggle() {
    if (props.disabled) return;
    if (open()) {
      close();
    } else {
      setOpen(true);
      setFocusIdx(props.options.findIndex((o) => o.value === props.value));
    }
  }

  function close() {
    setOpen(false);
    setFocusIdx(-1);
  }

  function pick(value) {
    props.onChange(value);
    close();
  }

  function onKeyDown(e) {
    if (!open()) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        toggle();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, props.options.length - 1));
        scrollFocused();
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
        scrollFocused();
        break;
      case 'Enter':
        e.preventDefault();
        if (focusIdx() >= 0) pick(props.options[focusIdx()].value);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  }

  function scrollFocused() {
    requestAnimationFrame(() => {
      const el = listRef?.querySelector('.select-option.focused');
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  function onClickOutside(e) {
    if (open() && rootRef && !rootRef.contains(e.target)) {
      close();
    }
  }

  onMount(() => document.addEventListener('mousedown', onClickOutside));
  onCleanup(() => document.removeEventListener('mousedown', onClickOutside));

  return (
    <div
      ref={rootRef}
      class={`select-root ${props.class || ''} ${open() ? 'open' : ''} ${props.disabled ? 'disabled' : ''}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div class="select-trigger" onClick={toggle}>
        <span
          class="select-value"
          style={selected()?.color ? { color: selected().color } : undefined}
        >
          {selected()?.label || props.placeholder || 'Select...'}
        </span>
        <span class="select-arrow">{open() ? '\u25B4' : '\u25BE'}</span>
      </div>
      <Show when={open()}>
        <div class="select-dropdown" ref={listRef}>
          <For each={props.options}>
            {(opt, i) => (
              <div
                class={`select-option ${opt.value === props.value ? 'selected' : ''} ${i() === focusIdx() ? 'focused' : ''}`}
                style={opt.color ? { color: opt.color } : undefined}
                onMouseEnter={() => setFocusIdx(i())}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(opt.value);
                }}
              >
                {opt.label}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
