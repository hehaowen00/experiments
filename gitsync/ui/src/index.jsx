import { render } from 'solid-js/web';
import App from './App';
import { applyTheme, getStoredThemeId } from './themes';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

applyTheme(getStoredThemeId());

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

window.api.getAllSettings().then((s) => {
  if (s.uiFontSize) applyUiFontSize(s.uiFontSize);
  if (s.editorFontSize) applyEditorFontSize(s.editorFontSize);
});

render(() => <App />, document.getElementById('app'));

// Custom tooltip system — replaces native title tooltips with styled ones
(function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'custom-tooltip';
  document.body.appendChild(tip);
  let currentTarget = null;
  let showTimer = null;

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title]');
    if (!el || !el.title) return;
    // Store and remove native title to prevent browser tooltip
    el.dataset.tip = el.title;
    el.removeAttribute('title');
    currentTarget = el;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (currentTarget !== el) return;
      tip.textContent = el.dataset.tip;
      tip.classList.add('visible');
      const rect = el.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - tipRect.width / 2;
      let top = rect.bottom + 6;
      // Keep within viewport
      if (left < 4) left = 4;
      if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;
      if (top + tipRect.height > window.innerHeight - 4) top = rect.top - tipRect.height - 6;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }, 400);
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    // Restore the title attribute
    if (el.dataset.tip) {
      el.title = el.dataset.tip;
      delete el.dataset.tip;
    }
    clearTimeout(showTimer);
    currentTarget = null;
    tip.classList.remove('visible');
  });

  document.addEventListener('mousedown', () => {
    clearTimeout(showTimer);
    currentTarget = null;
    tip.classList.remove('visible');
  });
})();
