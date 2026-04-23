export function applyUiFontSize(px) {
  const n = parseInt(px);
  const s = document.documentElement.style;
  s.setProperty('--ui-font-size', n + 'px');
  s.setProperty('--ui-font-size-xs', n - 2 + 'px');
  s.setProperty('--ui-font-size-sm', n - 1 + 'px');
  s.setProperty('--ui-font-size-lg', n + 2 + 'px');
  s.setProperty('--ui-font-size-xl', n + 3 + 'px');
  s.setProperty('--ui-font-size-2xl', n * 2 + 4 + 'px');
}

export function applyEditorFontSize(px) {
  document.documentElement.style.setProperty(
    '--editor-font-size',
    parseInt(px) + 'px',
  );
}
