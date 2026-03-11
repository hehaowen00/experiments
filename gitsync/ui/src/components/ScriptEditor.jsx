import { EditorState } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
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
    padding: '6px 0',
    caretColor: 'var(--text)',
  },
  '.cm-line': {
    padding: '0 8px',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--surface2)',
    color: 'var(--text-dim)',
    border: 'none',
    borderRight: '1px solid var(--border)',
    minWidth: '32px',
  },
  '.cm-gutter.cm-lineNumbers .cm-gutterElement': {
    padding: '0 6px',
    minWidth: '24px',
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
  { tag: tags.comment, color: 'var(--text-dim)', fontStyle: 'italic' },
  { tag: tags.string, color: '#a6d189' },
  { tag: tags.keyword, color: '#e78284' },
  { tag: tags.number, color: '#ef9f76' },
]);

export default function ScriptEditor(props) {
  let containerRef;
  let view;
  let ignoreNextUpdate = false;

  onMount(() => {
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        ignoreNextUpdate = true;
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
      ],
    });

    view = new EditorView({ state, parent: containerRef });
  });

  createEffect(() => {
    const val = props.value ?? '';
    if (!view) return;
    if (ignoreNextUpdate) {
      ignoreNextUpdate = false;
      return;
    }
    const current = view.state.doc.toString();
    if (val !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: val },
      });
    }
  });

  onCleanup(() => {
    if (view) view.destroy();
  });

  return <div class="cm-editor-wrapper" ref={containerRef} />;
}
