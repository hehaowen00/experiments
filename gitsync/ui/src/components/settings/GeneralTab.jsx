import { Show } from 'solid-js';
import { applyEditorFontSize, applyUiFontSize } from '../../index';
import t from '../../locale';
import { applyTheme, getThemeList } from '../../themes';
import Select from '../../lib/Select';

export default function GeneralTab(props) {
  return (
    <>
      <div class="settings-section">
        <div class="settings-label">{t.modal.themeLabel}</div>
        <Select
          value={props.selectedTheme()}
          options={getThemeList().map((theme) => ({
            value: theme.id,
            label: theme.name,
          }))}
          onChange={(value) => {
            applyTheme(value);
            props.setSelectedTheme(value);
          }}
          class="select-full"
        />
      </div>
      <div class="settings-section">
        <div class="settings-label">
          Diff Method
          <Show when={props.difftAvailable() !== null}>
            <span class={`settings-hint ${props.difftAvailable() ? 'settings-hint-ok' : 'settings-hint-warn'}`}>
              {props.difftAvailable() ? 'difftastic available' : 'difftastic not found'}
            </span>
          </Show>
        </div>
        <Select
          value={props.diffMethod()}
          options={[
            { value: 'auto', label: 'Auto (difftastic if available)' },
            { value: 'structural', label: 'Structural (difftastic)' },
            { value: 'standard', label: 'Standard (git diff)' },
          ]}
          onChange={(value) => {
            props.setDiffMethod(value);
            window.api.setSetting('diffMethod', value);
            window.dispatchEvent(new CustomEvent('diffmethod-changed', { detail: value }));
          }}
          class="select-full"
        />
      </div>
      <div class="settings-row">
        <div class="settings-section">
          <div class="settings-label">{t.modal.uiFontSizeLabel}</div>
          <Select
            value={props.uiFontSize()}
            options={[10, 11, 12, 13, 14, 15, 16].map((s) => ({
              value: s,
              label: `${s}px`,
            }))}
            onChange={(value) => {
              props.setUiFontSize(parseInt(value));
              window.api.setSetting('uiFontSize', value);
              applyUiFontSize(value);
            }}
            class="select-full"
          />
        </div>
        <div class="settings-section">
          <div class="settings-label">{t.modal.editorFontSizeLabel}</div>
          <Select
            value={props.editorFontSize()}
            options={[10, 11, 12, 13, 14, 15, 16].map((s) => ({
              value: s,
              label: `${s}px`,
            }))}
            onChange={(value) => {
              props.setEditorFontSize(parseInt(value));
              window.api.setSetting('editorFontSize', value);
              applyEditorFontSize(value);
            }}
            class="select-full"
          />
        </div>
      </div>
    </>
  );
}
