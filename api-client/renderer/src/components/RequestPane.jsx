import { createSignal, For, Index, Show } from 'solid-js';
import { buildUrlWithParams, detectFormat, formatBytes, resolveVariables } from '../helpers';
import t from '../locale';
import { highlightFlat } from '../highlight';

function useDragReorder(onReorder) {
  let dragIdx = null;

  function onDragStart(e, i) {
    dragIdx = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
    e.currentTarget.classList.add('dragging');
  }

  function onDragOver(e, i) {
    if (dragIdx === null || dragIdx === i) return;
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
    if (dragIdx === null || dragIdx === i) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    let to = e.clientY < mid ? i : i;
    // If dropping below, and coming from above, adjust
    if (e.clientY >= mid && dragIdx < i) to = i;
    else if (e.clientY >= mid && dragIdx > i) to = i + 1;
    else if (e.clientY < mid && dragIdx > i) to = i;
    else if (e.clientY < mid && dragIdx < i) to = i - 1;
    if (dragIdx !== to) onReorder(dragIdx, to);
    dragIdx = null;
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragIdx = null;
  }

  return { onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd };
}

function UrlPreview(props) {
  const [copied, setCopied] = createSignal(false);
  const previewUrl = () => {
    const resolved = resolveVariables(props.url || '', props.variables || []);
    return buildUrlWithParams(resolved, props.params || []);
  };
  function copy() {
    navigator.clipboard.writeText(previewUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div class="url-preview">
      <span class="url-preview-label">{t.requestPane.urlPreview.label}</span>
      <div class="url-preview-row">
        <span class="url-preview-value">{previewUrl() || t.requestPane.urlPreview.noUrl}</span>
        <button class="btn btn-ghost btn-sm" onClick={copy}>{copied() ? t.requestPane.urlPreview.copiedButton : t.requestPane.urlPreview.copyButton}</button>
      </div>
    </div>
  );
}

export default function RequestPane(props) {
  let bodyRef;
  let lineNumbersRef;

  const [activeTab, setActiveTab] = createSignal('headers');

  function getFormat() {
    if (props.contentType !== 'auto') return props.contentType;
    return detectFormat(props.body);
  }

  function highlightHtml() {
    return highlightFlat(props.body, getFormat()) + '\n';
  }

  function lineCount() {
    const text = props.body;
    return text ? text.split('\n').length : 1;
  }

  function lineNumbers() {
    const nums = [];
    for (let i = 1; i <= lineCount(); i++) nums.push(i);
    return nums;
  }

  function onBodyScroll() {
    if (!bodyRef || !lineNumbersRef) return;
    const inner = bodyRef.parentElement;
    const pre = inner.querySelector('.code-highlight');
    if (pre) {
      pre.scrollTop = bodyRef.scrollTop;
      pre.scrollLeft = bodyRef.scrollLeft;
    }
    lineNumbersRef.scrollTop = bodyRef.scrollTop;
  }

  const headerDrag = useDragReorder((from, to) => props.onReorderHeaders(from, to));
  const paramDrag = useDragReorder((from, to) => props.onReorderParams(from, to));
  const variableDrag = useDragReorder((from, to) => props.onReorderVariables(from, to));
  const formDrag = useDragReorder((from, to) => props.onReorderFormFields(from, to));

  return (
    <div class="request-pane" id="request-pane">
      <div class="request-body-section">
        <div class="section-tabs">
          <button class={`section-tab ${activeTab() === 'headers' ? 'active' : ''}`} onClick={() => setActiveTab('headers')}>{t.requestPane.tabs.headers}</button>
          <button class={`section-tab ${activeTab() === 'params' ? 'active' : ''}`} onClick={() => setActiveTab('params')}>{t.requestPane.tabs.params}</button>
          <button class={`section-tab ${activeTab() === 'variables' ? 'active' : ''}`} onClick={() => setActiveTab('variables')}>{t.requestPane.tabs.variables}</button>
          <button class={`section-tab ${activeTab() === 'body' ? 'active' : ''}`} onClick={() => setActiveTab('body')}>{t.requestPane.tabs.body}</button>
        </div>

        {/* Params tab */}
        <Show when={activeTab() === 'params'}>
          <div class="headers-table">
            <UrlPreview url={props.url} params={props.params} variables={props.variables} />
            <Index each={props.params}>
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
                  <span class="drag-handle">&#8942;</span>
                  <input type="checkbox" checked={p().enabled} onChange={(e) => props.onParamChange(i, 'enabled', e.target.checked)} />
                  <input type="text" placeholder={t.requestPane.paramNamePlaceholder} value={p().key} onInput={(e) => props.onParamChange(i, 'key', e.target.value)} />
                  <input type="text" placeholder={t.requestPane.valuePlaceholder} value={p().value} onInput={(e) => props.onParamChange(i, 'value', e.target.value)} />
                  <button class="btn btn-danger btn-sm" onClick={() => props.onRemoveParam(i)}>&times;</button>
                </div>
              )}
            </Index>
          </div>
          <button class="btn btn-ghost btn-sm" onClick={props.onAddParam}>{t.requestPane.addParameterButton}</button>
        </Show>

        {/* Headers tab */}
        <Show when={activeTab() === 'headers'}>
          <div class="headers-table">
            <Index each={props.headers}>
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
                  <span class="drag-handle">&#8942;</span>
                  <input type="checkbox" checked={h().enabled} onChange={(e) => props.onHeaderChange(i, 'enabled', e.target.checked)} />
                  <input type="text" class="header-key" placeholder={t.requestPane.headerNamePlaceholder} value={h().key} onInput={(e) => { e.target.value = e.target.value.toLowerCase(); props.onHeaderChange(i, 'key', e.target.value); }} />
                  <input type="text" placeholder={t.requestPane.valuePlaceholder} value={h().value} onInput={(e) => props.onHeaderChange(i, 'value', e.target.value)} />
                  <button class="btn btn-danger btn-sm" onClick={() => props.onRemoveHeader(i)}>&times;</button>
                </div>
              )}
            </Index>
          </div>
          <button class="btn btn-ghost btn-sm" onClick={props.onAddHeader}>{t.requestPane.addHeaderButton}</button>
        </Show>

        {/* Body tab */}
        <Show when={activeTab() === 'body'}>
          <div class="body-type-bar">
            <select class="body-type-select" value={props.bodyType} onChange={(e) => props.onBodyTypeChange(e.target.value)}>
              <option value="text">{t.requestPane.bodyTypes.text}</option>
              <option value="file">{t.requestPane.bodyTypes.file}</option>
              <option value="form">{t.requestPane.bodyTypes.form}</option>
            </select>
            <select class="body-type-select" value={props.contentType} onChange={(e) => props.onContentTypeChange(e.target.value)}>
              <option value="auto">{t.requestPane.contentTypes.auto}</option>
              <option value="json">{t.requestPane.contentTypes.json}</option>
              <option value="xml">{t.requestPane.contentTypes.xml}</option>
              <option value="html">{t.requestPane.contentTypes.html}</option>
              <option value="text">{t.requestPane.contentTypes.text}</option>
            </select>
          </div>

          {/* Text body */}
          <Show when={props.bodyType === 'text'}>
            <div class="code-editor">
              <div class="line-numbers" ref={lineNumbersRef} aria-hidden="true">
                <For each={lineNumbers()}>{(n) => <span class="line-num">{n}</span>}</For>
              </div>
              <div class="code-editor-inner">
                <pre class="code-highlight" aria-hidden="true"><code innerHTML={highlightHtml()} /></pre>
                <textarea
                  ref={bodyRef}
                  class="code-input"
                  placeholder={t.requestPane.bodyPlaceholder}
                  spellcheck={false}
                  value={props.body}
                  onInput={(e) => props.onBodyChange(e.target.value)}
                  onScroll={onBodyScroll}
                />
              </div>
            </div>
          </Show>

          {/* File body */}
          <Show when={props.bodyType === 'file'}>
            <div class="file-upload-area">
              <button class="btn btn-ghost" onClick={props.onPickFile}>{t.requestPane.chooseFileButton}</button>
              <div class="file-info">{props.file ? `${props.file.name} (${formatBytes(props.file.size)})` : t.requestPane.noFileSelected}</div>
              <Show when={props.file}>
                <button class="btn btn-danger btn-sm" onClick={props.onClearFile}>{t.requestPane.clearButton}</button>
              </Show>
            </div>
          </Show>

          {/* Form body */}
          <Show when={props.bodyType === 'form'}>
            <div class="form-fields">
              <Index each={props.formFields}>
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
                    <span class="drag-handle">&#8942;</span>
                    <input type="text" placeholder={t.requestPane.namePlaceholder} value={f().key} onInput={(e) => props.onFormFieldChange(i, 'key', e.target.value)} />
                    <select value={f().type} onChange={(e) => props.onFormFieldChange(i, 'type', e.target.value)}>
                      <option value="text">{t.requestPane.formFieldTypes.text}</option>
                      <option value="file">{t.requestPane.formFieldTypes.file}</option>
                    </select>
                    <Show when={f().type === 'text'} fallback={
                      <button class="btn btn-ghost btn-sm form-pick-file" onClick={() => props.onFormPickFile(i)}>{f().fileName || t.requestPane.chooseButton}</button>
                    }>
                      <input type="text" placeholder={t.requestPane.valuePlaceholder} value={f().value} onInput={(e) => props.onFormFieldChange(i, 'value', e.target.value)} />
                    </Show>
                    <button class="btn btn-danger btn-sm" onClick={() => props.onRemoveFormField(i)}>&times;</button>
                  </div>
                )}
              </Index>
            </div>
            <button class="btn btn-ghost btn-sm" onClick={props.onAddFormField}>{t.requestPane.addFieldButton}</button>
          </Show>
        </Show>

        {/* Variables tab */}
        <Show when={activeTab() === 'variables'}>
          <div class="headers-table">
            <UrlPreview url={props.url} params={props.params} variables={props.variables} />
            <Index each={props.variables}>
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
                  <span class="drag-handle">&#8942;</span>
                  <input type="text" placeholder={t.requestPane.variableNamePlaceholder} value={v().key} onInput={(e) => props.onVariableChange(i, 'key', e.target.value)} />
                  <input type="text" placeholder={t.requestPane.valuePlaceholder} value={v().value} onInput={(e) => props.onVariableChange(i, 'value', e.target.value)} />
                  <button class="btn btn-danger btn-sm" onClick={() => props.onRemoveVariable(i)}>&times;</button>
                </div>
              )}
            </Index>
          </div>
          <button class="btn btn-ghost btn-sm" onClick={props.onAddVariable}>{t.requestPane.addVariableButton}</button>
        </Show>
      </div>
    </div>
  );
}
