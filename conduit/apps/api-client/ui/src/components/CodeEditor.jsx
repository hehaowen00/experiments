import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { createEffect, onCleanup, onMount } from 'solid-js';

const theme = EditorView.theme({
  '&': {
    fontSize: 'var(--editor-font-size)',
    fontFamily: 'var(--mono)',
    backgroundColor: 'transparent',
    height: '100%',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'var(--mono)',
    lineHeight: '1.5',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '10px 0',
    caretColor: 'var(--text)',
  },
  '.cm-line': {
    padding: '0 10px',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--surface2)',
    color: 'var(--text-dim)',
    border: 'none',
    borderRight: '1px solid var(--border)',
    minWidth: '40px',
  },
  '.cm-gutter.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px',
    minWidth: '32px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--surface2) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor:
      'var(--accent-hover-bg, rgba(124, 92, 252, 0.2)) !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--text)',
  },
  '.cm-placeholder': {
    color: 'var(--text-dim)',
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: '#7dc4e4' },
  { tag: tags.string, color: '#a6d189' },
  { tag: tags.number, color: '#ef9f76' },
  { tag: tags.bool, color: '#e78284' },
  { tag: tags.null, color: '#e78284' },
  { tag: tags.keyword, color: '#e78284' },
  { tag: tags.punctuation, color: 'var(--text-dim)' },
  { tag: tags.brace, color: 'var(--text-dim)' },
  { tag: tags.squareBracket, color: 'var(--text-dim)' },
  { tag: tags.tagName, color: '#e78284' },
  { tag: tags.attributeName, color: '#ef9f76' },
  { tag: tags.attributeValue, color: '#a6d189' },
  { tag: tags.angleBracket, color: '#e78284' },
  { tag: tags.comment, color: 'var(--text-dim)', fontStyle: 'italic' },
  { tag: tags.content, color: 'var(--text)' },
]);

function getLangExtension(format) {
  if (format === 'json') return json();
  if (format === 'xml') return xml();
  if (format === 'html') return html();
  return [];
}

export default function CodeEditor(props) {
  let containerRef;
  let view;
  let programmatic = false;
  const langCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();

  onMount(() => {
    const langExt = getLangExtension(props.format);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !programmatic) {
        props.onInput?.(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: props.value || '',
      extensions: [
        theme,
        syntaxHighlighting(highlightStyle),
        lineNumbers(),
        updateListener,
        ...(props.placeholder ? [cmPlaceholder(props.placeholder)] : []),
        langCompartment.of(Array.isArray(langExt) ? langExt : [langExt]),
        readOnlyCompartment.of(props.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      ],
    });

    view = new EditorView({ state, parent: containerRef });
    props.ref?.({
      focus: () => view?.focus(),
      focusEnd: () => {
        if (!view) return;
        const end = view.state.doc.length;
        view.dispatch({ selection: { anchor: end } });
        view.focus();
      },
    });
  });

  // Sync external value changes
  createEffect(() => {
    const val = props.value ?? '';
    if (!view) return;
    const current = view.state.doc.toString();
    if (val !== current) {
      programmatic = true;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: val },
      });
      programmatic = false;
    }
  });

  // Reconfigure language when format changes
  createEffect(() => {
    const format = props.format;
    if (!view) return;
    const langExt = getLangExtension(format);
    view.dispatch({
      effects: langCompartment.reconfigure(
        Array.isArray(langExt) ? langExt : [langExt],
      ),
    });
  });

  onCleanup(() => {
    if (view) view.destroy();
  });

  return <div class="cm-editor-wrapper" ref={containerRef} />;
}
