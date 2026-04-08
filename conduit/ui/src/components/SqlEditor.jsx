import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  placeholder as cmPlaceholder,
  keymap,
} from '@codemirror/view';
import { toggleComment } from '@codemirror/commands';
import { sql, PostgreSQL, SQLite } from '@codemirror/lang-sql';
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
  { tag: tags.keyword, color: '#e78284' },
  { tag: tags.string, color: '#a6d189' },
  { tag: tags.number, color: '#ef9f76' },
  { tag: tags.bool, color: '#e78284' },
  { tag: tags.null, color: '#e78284' },
  { tag: tags.operator, color: '#ef9f76' },
  { tag: tags.punctuation, color: 'var(--text-dim)' },
  { tag: tags.brace, color: 'var(--text-dim)' },
  { tag: tags.paren, color: 'var(--text-dim)' },
  { tag: tags.squareBracket, color: 'var(--text-dim)' },
  { tag: tags.typeName, color: '#7dc4e4' },
  { tag: tags.propertyName, color: '#7dc4e4' },
  { tag: tags.comment, color: 'var(--text-dim)', fontStyle: 'italic' },
  { tag: tags.content, color: 'var(--text)' },
]);

export default function SqlEditor(props) {
  let containerRef;
  let view;
  let programmatic = false;

  onMount(() => {
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
        keymap.of([{ key: 'Mod-/', run: toggleComment }]),
        sql({ dialect: props.dialect === 'sqlite' ? SQLite : PostgreSQL }),
        ...(props.placeholder ? [cmPlaceholder(props.placeholder)] : []),
      ],
    });

    view = new EditorView({ state, parent: containerRef });
  });

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

  onCleanup(() => {
    if (view) view.destroy();
  });

  return <div class="cm-editor-wrapper" ref={containerRef} />;
}
