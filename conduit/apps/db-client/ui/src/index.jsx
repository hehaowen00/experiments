import { render } from 'solid-js/web';
import App from './App';
import { applyTheme, getStoredThemeId, applyUiFontSize, applyEditorFontSize } from '@conduit/ui-shared';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

applyTheme(getStoredThemeId());

window.api.getAllSettings().then((s) => {
  if (s.uiFontSize) applyUiFontSize(s.uiFontSize);
  if (s.editorFontSize) applyEditorFontSize(s.editorFontSize);
});

render(() => <App />, document.getElementById('app'));
