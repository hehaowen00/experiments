import Icon from './Icon';
import { useTabs, TAB_TYPES } from '../store/tabs';

const APPS = [
  { type: 'api', icon: TAB_TYPES.api.icon, label: TAB_TYPES.api.label },
  { type: 'db', icon: TAB_TYPES.db.icon, label: TAB_TYPES.db.label },
];

export default function NewTabPage(props) {
  const [, actions] = useTabs();

  function pick(type) {
    actions.replaceTab(props.tabId, type);
  }

  return (
    <div class="new-tab-page" style={props.style}>
      <div class="new-tab-grid">
        {APPS.map((app) => (
          <button class="new-tab-card" onClick={() => pick(app.type)}>
            <Icon name={app.icon} />
            <span>{app.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
