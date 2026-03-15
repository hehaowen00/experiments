import { Show } from 'solid-js';

export default function P2PTab(props) {
  return (
    <div class="settings-section">
      <Show when={props.p2pIdentity()}>
        <div class="settings-label">Display Name</div>
        <div style={{ display: 'flex', gap: '6px', 'margin-bottom': '12px' }}>
          <input
            type="text"
            class="settings-identity-input"
            value={props.p2pDisplayName()}
            onInput={(e) => props.setP2pDisplayName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                window.api.p2pSetDisplayName(props.p2pDisplayName().trim());
                window.api.p2pGetIdentity().then(props.setP2pIdentity);
              }
            }}
            placeholder="Display name"
          />
          <button
            class="btn btn-primary btn-xs"
            onClick={() => {
              window.api.p2pSetDisplayName(props.p2pDisplayName().trim());
              window.api.p2pGetIdentity().then(props.setP2pIdentity);
            }}
            disabled={!props.p2pDisplayName().trim()}
          >
            Save
          </button>
        </div>
        <div class="settings-label">P2P Networking</div>
        <label
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={props.p2pIdentity()?.enabled}
            onChange={async () => {
              await window.api.p2pSetEnabled(!props.p2pIdentity().enabled);
              props.setP2pIdentity(await window.api.p2pGetIdentity());
            }}
          />
          <span>
            {props.p2pIdentity()?.enabled
              ? 'Enabled (discoverable on LAN)'
              : 'Disabled'}
          </span>
        </label>
      </Show>
    </div>
  );
}
