import { render } from 'solid-js/web';
import App from './App';
import { applyTheme, getStoredThemeId } from './themes';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

applyTheme(getStoredThemeId());

window.api.getAllSettings().then((s) => {
  if (s.uiFontSize) document.documentElement.style.setProperty('--ui-font-size', s.uiFontSize + 'px');
  if (s.editorFontSize) document.documentElement.style.setProperty('--editor-font-size', s.editorFontSize + 'px');
});

render(() => <App />, document.getElementById('app'));
