import { render } from 'solid-js/web';
import App from './App';
import { applyTheme, getStoredThemeId } from './themes';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

applyTheme(getStoredThemeId());
render(() => <App />, document.getElementById('app'));
