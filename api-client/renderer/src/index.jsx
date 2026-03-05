import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import App from './App';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

render(() => <App />, document.getElementById('app'));
