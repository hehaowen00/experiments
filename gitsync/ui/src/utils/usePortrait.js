import { createSignal, onCleanup, onMount } from 'solid-js';

const mq = window.matchMedia('(max-aspect-ratio: 1/1)');

export function usePortrait() {
  const [portrait, setPortrait] = createSignal(mq.matches);

  function onChange(e) {
    setPortrait(e.matches);
  }

  onMount(() => mq.addEventListener('change', onChange));
  onCleanup(() => mq.removeEventListener('change', onChange));

  return portrait;
}
