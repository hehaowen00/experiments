import { createSignal, Index, Show } from 'solid-js';
import { Icon, Select, t } from '@conduit/ui-shared';
import {
  buildUrlWithParams,
  detectFormat,
  formatBytes,
  resolveVariables,
} from '../helpers';
import { useCollection } from '../store/collection';
import CodeEditor from './CodeEditor';

function useDragReorder(onReorder) {
  let dragIdx = null;

  function onDragStart(e, i) {
    dragIdx = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
    e.currentTarget.classList.add('dragging');
  }

  function onDragOver(e, i) {
    if (dragIdx === null || dragIdx === i) {
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const el = e.currentTarget;
    el.classList.remove('kv-drag-above', 'kv-drag-below');

    const rect = el.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    el.classList.add(e.clientY < mid ? 'kv-drag-above' : 'kv-drag-below');
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('kv-drag-above', 'kv-drag-below');
  }

  function onDrop(e, i) {
    e.preventDefault();
    e.currentTarget.classList.remove('kv-drag-above', 'kv-drag-below');

    if (dragIdx === null || dragIdx === i) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;

    let to = i;
    if (e.clientY >= mid && dragIdx < i) {
      to = i;
    } else if (e.clientY >= mid && dragIdx > i) {
      to = i + 1;
    } else if (e.clientY < mid && dragIdx > i) {
      to = i;
    } else if (e.clientY < mid && dragIdx < i) {
      to = i - 1;
    }

    if (dragIdx !== to) {
      onReorder(dragIdx, to);
    }
    dragIdx = null;
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragIdx = null;
  }

  return { onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd };
}

function UrlPreview() {
  const [state] = useCollection();
  const [copied, setCopied] = createSignal(false);

  const previewUrl = () => {
    const resolved = resolveVariables(
      state.url || '',
      state.variables.filter((v) => v.key),
    );
    return buildUrlWithParams(resolved, state.params);
  };

  function copy() {
    navigator.clipboard.writeText(previewUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div class="url-preview">
      <div class="url-preview-row">
        <span class="url-preview-value">
          {previewUrl() || t.requestPane.urlPreview.noUrl}
        </span>
        <button class="btn btn-ghost btn-sm" onClick={copy}>
          {copied() ? (
            <>
              <Icon name="fa-solid fa-check" />{' '}
            </>
          ) : (
            <>
              <Icon name="fa-regular fa-copy" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function RequestTabs(props) {
  const isActive = (tab) => (props.activeTab() === tab ? 'active' : '');

  const tabs = t.requestPane.tabs;

  const tabItems = [
    { id: 'headers', label: tabs.headers },
    { id: 'params', label: tabs.params },
    { id: 'variables', label: tabs.variables },
    { id: 'body', label: tabs.body },
  ];

  return (
    <div class="section-tabs">
      <For each={tabItems}>
        {(item) => (
          <button
            class={`section-tab ${isActive(item.id)}`}
            onClick={() => props.setActiveTab(item.id)}
          >
            {item.label}
          </button>
        )}
      </For>
    </div>
  );
}

function ParamsTab(props) {
  const [state, actions] = useCollection();
  const paramDrag = useDragReorder((from, to) =>
    actions.reorderParams(from, to),
  );

  const enableAll = () => {
    state.params.forEach((_, i) => actions.onParamChange(i, 'enabled', true));
  };
  const disableAll = () => {
    state.params.forEach((_, i) => actions.onParamChange(i, 'enabled', false));
  };

  return (
    <Show when={props.activeTab() === 'params'}>
      <div class="headers-table">
        <UrlPreview />
        <div class="kv-bulk-actions">
          <button class="btn btn-ghost btn-sm" onClick={actions.addParam}>
            {t.requestPane.addParameterButton}
          </button>
          <div class="kv-bulk-spacer" />
          <button class="btn btn-ghost btn-sm" onClick={enableAll}>
            {t.requestPane.enableAllButton}
          </button>
          <button class="btn btn-ghost btn-sm" onClick={disableAll}>
            {t.requestPane.disableAllButton}
          </button>
        </div>
        <Index each={state.params}>
          {(p, i) => (
            <div
              class="header-row"
              draggable="true"
              onDragStart={(e) => paramDrag.onDragStart(e, i)}
              onDragOver={(e) => paramDrag.onDragOver(e, i)}
              onDragLeave={paramDrag.onDragLeave}
              onDrop={(e) => paramDrag.onDrop(e, i)}
              onDragEnd={paramDrag.onDragEnd}
            >
              <span class="drag-handle">
                <Icon name="fa-solid fa-grip-vertical" />
              </span>
              <input
                type="checkbox"
                checked={p().enabled}
                onChange={(e) =>
                  actions.onParamChange(i, 'enabled', e.target.checked)
                }
              />
              <input
                type="text"
                placeholder={t.requestPane.paramNamePlaceholder}
                value={p().key}
                onInput={(e) => actions.onParamChange(i, 'key', e.target.value)}
              />
              <input
                type="text"
                placeholder={t.requestPane.valuePlaceholder}
                value={p().value}
                onInput={(e) =>
                  actions.onParamChange(i, 'value', e.target.value)
                }
              />
              <button
                class="btn btn-danger btn-sm"
                onClick={() => actions.removeParam(i)}
              >
                <Icon name="fa-solid fa-xmark" />
              </button>
            </div>
          )}
        </Index>
      </div>
    </Show>
  );
}

function HeadersTab(props) {
  const [state, actions] = useCollection();
  const headerDrag = useDragReorder((from, to) =>
    actions.reorderHeaders(from, to),
  );

  const enableAll = () => {
    state.headers.forEach((_, i) => actions.onHeaderChange(i, 'enabled', true));
  };
  const disableAll = () => {
    state.headers.forEach((_, i) =>
      actions.onHeaderChange(i, 'enabled', false),
    );
  };
  const toggle = (i) => (e) =>
    actions.onHeaderChange(i, 'enabled', e.target.checked);
  const updateInput = (i) => (e) => {
    e.target.value = e.target.value.toLowerCase();
    actions.onHeaderChange(i, 'key', e.target.value);
  };

  return (
    <Show when={props.activeTab() === 'headers'}>
      <div class="headers-table">
        <div class="kv-bulk-actions">
          <button class="btn btn-ghost btn-sm" onClick={actions.addHeader}>
            {t.requestPane.addHeaderButton}
          </button>
          <div class="kv-bulk-spacer" />
          <button class="btn btn-ghost btn-sm" onClick={enableAll}>
            {t.requestPane.enableAllButton}
          </button>
          <button class="btn btn-ghost btn-sm" onClick={disableAll}>
            {t.requestPane.disableAllButton}
          </button>
        </div>
        <Index each={state.headers}>
          {(h, i) => (
            <div
              class="header-row"
              draggable="true"
              onDragStart={(e) => headerDrag.onDragStart(e, i)}
              onDragOver={(e) => headerDrag.onDragOver(e, i)}
              onDragLeave={headerDrag.onDragLeave}
              onDrop={(e) => headerDrag.onDrop(e, i)}
              onDragEnd={headerDrag.onDragEnd}
            >
              <span class="drag-handle">
                <Icon name="fa-solid fa-grip-vertical" />
              </span>
              <input
                type="checkbox"
                checked={h().enabled}
                onChange={toggle(i)}
              />
              <input
                type="text"
                class="header-key"
                placeholder={t.requestPane.headerNamePlaceholder}
                value={h().key}
                onInput={updateInput(i)}
              />
              <input
                type="text"
                placeholder={t.requestPane.valuePlaceholder}
                value={h().value}
                onInput={(e) =>
                  actions.onHeaderChange(i, 'value', e.target.value)
                }
              />
              <button
                class="btn btn-danger btn-sm"
                onClick={() => actions.removeHeader(i)}
              >
                <Icon name="fa-solid fa-xmark" />
              </button>
            </div>
          )}
        </Index>
      </div>
    </Show>
  );
}

function VariablesTab(props) {
  const [state, actions] = useCollection();
  const variableDrag = useDragReorder((from, to) =>
    actions.reorderVariables(from, to),
  );
  const keyPlaceholder = t.requestPane.variableNamePlaceholder;
  const valuePlaceholder = t.requestPane.valuePlaceholder;

  return (
    <Show when={props.activeTab() === 'variables'}>
      <div class="headers-table">
        <UrlPreview />
        <div class="kv-bulk-actions">
          <button class="btn btn-ghost btn-sm" onClick={actions.addVariable}>
            {t.requestPane.addVariableButton}
          </button>
        </div>
        <Index each={state.variables}>
          {(v, i) => (
            <div
              class="header-row"
              draggable="true"
              onDragStart={(e) => variableDrag.onDragStart(e, i)}
              onDragOver={(e) => variableDrag.onDragOver(e, i)}
              onDragLeave={variableDrag.onDragLeave}
              onDrop={(e) => variableDrag.onDrop(e, i)}
              onDragEnd={variableDrag.onDragEnd}
            >
              <span class="drag-handle">
                <Icon name="fa-solid fa-grip-vertical" />
              </span>
              <input
                type="text"
                placeholder={keyPlaceholder}
                value={v().key}
                onInput={(e) =>
                  actions.onVariableChange(i, 'key', e.target.value)
                }
              />
              <input
                type="text"
                placeholder={valuePlaceholder}
                value={v().value}
                onInput={(e) =>
                  actions.onVariableChange(i, 'value', e.target.value)
                }
              />
              <button
                class="btn btn-danger btn-sm"
                onClick={() => actions.removeVariable(i)}
              >
                <Icon name="fa-solid fa-xmark" />
              </button>
            </div>
          )}
        </Index>
      </div>
    </Show>
  );
}

function BodyTab(props) {
  const [state, actions] = useCollection();
  const formDrag = useDragReorder((from, to) =>
    actions.reorderFormFields(from, to),
  );

  function getFormat() {
    if (state.contentType !== 'auto') {
      return state.contentType;
    }

    return detectFormat(state.body);
  }

  const optionItems = [
    { value: 'auto', label: t.requestPane.contentTypes.auto },
    { value: 'json', label: t.requestPane.contentTypes.json },
    { value: 'xml', label: t.requestPane.contentTypes.xml },
    { value: 'html', label: t.requestPane.contentTypes.html },
    { value: 'text', label: t.requestPane.contentTypes.text },
  ];

  return (
    <Show when={props.activeTab() === 'body'}>
      <div class="body-type-bar">
        <Select
          class="select-sm"
          value={state.bodyType}
          options={[
            { value: 'text', label: t.requestPane.bodyTypes.text },
            { value: 'file', label: t.requestPane.bodyTypes.file },
            { value: 'form', label: t.requestPane.bodyTypes.form },
          ]}
          onChange={(value) => actions.updateField('bodyType', value)}
        />
        <Select
          class="select-sm"
          value={state.contentType}
          options={optionItems}
          onChange={(value) => {
            actions.updateField('contentType', value);
            actions.syncContentTypeHeader(value);
          }}
        />
      </div>

      <Show when={state.bodyType === 'text'}>
        <CodeEditor
          value={state.body}
          onInput={(v) => actions.updateField('body', v)}
          format={getFormat()}
          placeholder={t.requestPane.bodyPlaceholder}
        />
      </Show>

      <Show when={state.bodyType === 'file'}>
        <div class="file-upload-area">
          <button class="btn btn-ghost" onClick={actions.pickFile}>
            {t.requestPane.chooseFileButton}
          </button>
          <div class="file-info">
            {state.file
              ? `${state.file.name} (${formatBytes(state.file.size)})`
              : t.requestPane.noFileSelected}
          </div>
          <Show when={state.file}>
            <button class="btn btn-danger btn-sm" onClick={actions.clearFile}>
              {t.requestPane.clearButton}
            </button>
          </Show>
        </div>
      </Show>

      <Show when={state.bodyType === 'form'}>
        <div class="form-fields">
          <Index each={state.formFields}>
            {(f, i) => (
              <div
                class="form-field-row"
                draggable="true"
                onDragStart={(e) => formDrag.onDragStart(e, i)}
                onDragOver={(e) => formDrag.onDragOver(e, i)}
                onDragLeave={formDrag.onDragLeave}
                onDrop={(e) => formDrag.onDrop(e, i)}
                onDragEnd={formDrag.onDragEnd}
              >
                <span class="drag-handle">
                  <Icon name="fa-solid fa-grip-vertical" />
                </span>
                <input
                  type="text"
                  placeholder={t.requestPane.namePlaceholder}
                  value={f().key}
                  onInput={(e) =>
                    actions.onFormFieldChange(i, 'key', e.target.value)
                  }
                />
                <Select
                  class="select-sm"
                  value={f().type}
                  options={[
                    { value: 'text', label: t.requestPane.formFieldTypes.text },
                    { value: 'file', label: t.requestPane.formFieldTypes.file },
                  ]}
                  onChange={(value) =>
                    actions.onFormFieldChange(i, 'type', value)
                  }
                />
                <Show
                  when={f().type === 'text'}
                  fallback={
                    <button
                      class="btn btn-ghost btn-sm form-pick-file"
                      onClick={() => actions.pickFormFile(i)}
                    >
                      {f().fileName || t.requestPane.chooseButton}
                    </button>
                  }
                >
                  <input
                    type="text"
                    placeholder={t.requestPane.valuePlaceholder}
                    value={f().value}
                    onInput={(e) =>
                      actions.onFormFieldChange(i, 'value', e.target.value)
                    }
                  />
                </Show>
                <button
                  class="btn btn-danger btn-sm"
                  onClick={() => actions.removeFormField(i)}
                >
                  <Icon name="fa-solid fa-xmark" />
                </button>
              </div>
            )}
          </Index>
        </div>
        <button class="btn btn-ghost btn-sm" onClick={actions.addFormField}>
          {t.requestPane.addFieldButton}
        </button>
      </Show>
    </Show>
  );
}

export default function RequestPane() {
  const [activeTab, setActiveTab] = createSignal('headers');

  return (
    <div class="request-pane" id="request-pane">
      <div class="request-body-section">
        <RequestTabs activeTab={activeTab} setActiveTab={setActiveTab} />
        <ParamsTab activeTab={activeTab} />
        <HeadersTab activeTab={activeTab} />
        <BodyTab activeTab={activeTab} />
        <VariablesTab activeTab={activeTab} />
      </div>
    </div>
  );
}
