import { For, Show } from 'solid-js';
import Icon from '../../lib/Icon';

export default function IdentitiesTab(props) {
  return (
    <div class="settings-section">
      <div class="settings-identities-list">
        <For each={props.identities}>
          {(id) => (
            <div class="settings-identity-row">
              <div class="settings-identity-info">
                <span class="settings-identity-name">{id.name}</span>
                <span class="settings-identity-email">{id.email}</span>
              </div>
              <div class="settings-identity-actions">
                <button
                  class="btn btn-ghost btn-xs"
                  onClick={() => props.startEditIdentity(id.id)}
                  title="Edit"
                >
                  <Icon name="fa-solid fa-pen" />
                </button>
                <button
                  class="btn btn-ghost btn-xs"
                  onClick={() => props.deleteIdentity(id.id)}
                  title="Delete"
                >
                  <Icon name="fa-solid fa-trash" />
                </button>
              </div>
            </div>
          )}
        </For>
      </div>
      <div class="settings-identity-form">
        <input
          type="text"
          class="settings-identity-input"
          placeholder="Name"
          value={props.identityName()}
          onInput={(e) => props.setIdentityName(e.target.value)}
        />
        <input
          type="text"
          class="settings-identity-input"
          placeholder="Email"
          value={props.identityEmail()}
          onInput={(e) => props.setIdentityEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.saveIdentity();
          }}
        />
        <button
          class="btn btn-primary btn-xs"
          onClick={props.saveIdentity}
          disabled={
            !props.identityName().trim() || !props.identityEmail().trim()
          }
        >
          {props.editingIdentity() ? 'Update' : 'Add'}
        </button>
        <Show when={props.editingIdentity()}>
          <button
            class="btn btn-ghost btn-xs"
            onClick={props.resetIdentityForm}
          >
            Cancel
          </button>
        </Show>
      </div>
      <div class="settings-identity-import">
        <button
          class="btn btn-ghost btn-xs"
          onClick={props.importGlobalIdentity}
          title="Import from git global config"
        >
          <Icon name="fa-solid fa-globe" /> Import Global
        </button>
        <button
          class="btn btn-ghost btn-xs"
          onClick={props.importRepoIdentities}
          title="Import from all saved repos' local git config"
        >
          <Icon name="fa-solid fa-folder-open" /> Import from Repos
        </button>
      </div>
    </div>
  );
}
