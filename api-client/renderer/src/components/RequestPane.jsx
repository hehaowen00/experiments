import { createSignal, createEffect, Show, For } from 'solid-js';
import { esc, formatBytes, detectFormat } from '../helpers';
import { highlightFlat } from '../highlight';

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

  return (
    <div class="request-pane" id="request-pane">
      <div class="request-body-section">
        <div class="section-tabs">
          <button class={`section-tab ${activeTab() === 'headers' ? 'active' : ''}`} onClick={() => setActiveTab('headers')}>Headers</button>
          <button class={`section-tab ${activeTab() === 'body' ? 'active' : ''}`} onClick={() => setActiveTab('body')}>Body</button>
        </div>

        {/* Headers tab */}
        <Show when={activeTab() === 'headers'}>
          <div class="headers-table">
            <For each={props.headers}>
              {(h, i) => (
                <div class="header-row">
                  <input type="checkbox" checked={h.enabled} onChange={(e) => props.onHeaderChange(i(), 'enabled', e.target.checked)} />
                  <input type="text" placeholder="Header name" value={h.key} onInput={(e) => props.onHeaderChange(i(), 'key', e.target.value)} />
                  <input type="text" placeholder="Value" value={h.value} onInput={(e) => props.onHeaderChange(i(), 'value', e.target.value)} />
                  <button class="btn btn-danger btn-sm" onClick={() => props.onRemoveHeader(i())}>&times;</button>
                </div>
              )}
            </For>
          </div>
          <button class="btn btn-ghost btn-sm" onClick={props.onAddHeader}>+ Add Header</button>
        </Show>

        {/* Body tab */}
        <Show when={activeTab() === 'body'}>
          <div class="body-type-bar">
            <select class="body-type-select" value={props.bodyType} onChange={(e) => props.onBodyTypeChange(e.target.value)}>
              <option value="text">Text</option>
              <option value="file">File</option>
              <option value="form">Form Data</option>
            </select>
            <select class="body-type-select" value={props.contentType} onChange={(e) => props.onContentTypeChange(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="json">JSON</option>
              <option value="xml">XML</option>
              <option value="html">HTML</option>
              <option value="text">Plain Text</option>
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
                  placeholder="Request body (JSON, XML, text...)"
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
              <button class="btn btn-ghost" onClick={props.onPickFile}>Choose File</button>
              <div class="file-info">{props.file ? `${props.file.name} (${formatBytes(props.file.size)})` : 'No file selected'}</div>
              <Show when={props.file}>
                <button class="btn btn-danger btn-sm" onClick={props.onClearFile}>Clear</button>
              </Show>
            </div>
          </Show>

          {/* Form body */}
          <Show when={props.bodyType === 'form'}>
            <div class="form-fields">
              <For each={props.formFields}>
                {(f, i) => (
                  <div class="form-field-row">
                    <input type="text" placeholder="Name" value={f.key} onInput={(e) => props.onFormFieldChange(i(), 'key', e.target.value)} />
                    <select value={f.type} onChange={(e) => props.onFormFieldChange(i(), 'type', e.target.value)}>
                      <option value="text">Text</option>
                      <option value="file">File</option>
                    </select>
                    <Show when={f.type === 'text'} fallback={
                      <button class="btn btn-ghost btn-sm form-pick-file" onClick={() => props.onFormPickFile(i())}>{f.fileName || 'Choose...'}</button>
                    }>
                      <input type="text" placeholder="Value" value={f.value} onInput={(e) => props.onFormFieldChange(i(), 'value', e.target.value)} />
                    </Show>
                    <button class="btn btn-danger btn-sm" onClick={() => props.onRemoveFormField(i())}>&times;</button>
                  </div>
                )}
              </For>
            </div>
            <button class="btn btn-ghost btn-sm" onClick={props.onAddFormField}>+ Add Field</button>
          </Show>
        </Show>
      </div>
    </div>
  );
}
