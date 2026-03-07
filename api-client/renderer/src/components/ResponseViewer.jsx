import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import {
  syntaxHighlighting,
  HighlightStyle,
  foldGutter,
} from '@codemirror/language';
import { SearchCursor } from '@codemirror/search';
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
    lineHeight: '1.8',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '0',
    caretColor: 'var(--text)',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-dim)',
    border: 'none',
    borderRight: '1px solid var(--border)',
    minWidth: '40px',
  },
  '.cm-gutter.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px',
    minWidth: '32px',
  },
  '.cm-gutter.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
    color: 'var(--text-dim)',
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
  '.cm-search-match': {
    backgroundColor: 'rgba(255, 200, 0, 0.3)',
    borderRadius: '2px',
  },
  '.cm-search-match-active': {
    backgroundColor: 'rgba(255, 150, 0, 0.5)',
    borderRadius: '2px',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    color: 'var(--text-dim)',
    padding: '0 6px',
    margin: '0 4px',
    fontFamily: 'var(--mono)',
    fontSize: '0.85em',
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

// Search highlight decorations via StateField
const setSearchHighlights = StateEffect.define();

const searchHighlightField = StateField.define({
  create() {
    return { decorations: Decoration.none, matches: [] };
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSearchHighlights)) return e.value;
    }
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field, (val) => val.decorations);
  },
});

const matchMark = Decoration.mark({ class: 'cm-search-match' });
const activeMatchMark = Decoration.mark({ class: 'cm-search-match-active' });

export default function ResponseViewer(props) {
  // props.value, props.format, props.onViewReady
  let containerRef;
  let view;
  const langCompartment = new Compartment();

  onMount(() => {
    const langExt = getLangExtension(props.format);

    const state = EditorState.create({
      doc: props.value || '',
      extensions: [
        theme,
        syntaxHighlighting(highlightStyle),
        lineNumbers(),
        foldGutter(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.domEventHandlers({
          keydown(e, v) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
              e.preventDefault();
              v.dispatch({
                selection: { anchor: 0, head: v.state.doc.length },
              });
              return true;
            }
          },
        }),
        searchHighlightField,
        langCompartment.of(Array.isArray(langExt) ? langExt : [langExt]),
      ],
    });

    view = new EditorView({ state, parent: containerRef });
    props.onViewReady?.(createViewAPI());
  });

  function createViewAPI() {
    return {
      searchText(query) {
        if (!view || !query) {
          this.clearSearch();
          return { count: 0 };
        }
        const doc = view.state.doc;
        const lower = query.toLowerCase();
        const ranges = [];
        const cursor = new SearchCursor(
          doc,
          query,
          0,
          doc.length,
          (a, b) => a.toLowerCase() === b.toLowerCase(),
        );
        while (!cursor.done) {
          cursor.next();
          if (cursor.done) break;
          ranges.push({ from: cursor.value.from, to: cursor.value.to });
        }
        if (ranges.length === 0) {
          this.clearSearch();
          return { count: 0 };
        }
        const decos = Decoration.set(
          ranges.map((r) => matchMark.range(r.from, r.to)),
        );
        view.dispatch({
          effects: setSearchHighlights.of({
            decorations: decos,
            matches: ranges,
          }),
        });
        return { count: ranges.length };
      },
      highlightMatch(idx) {
        if (!view) return;
        const { matches } = view.state.field(searchHighlightField);
        if (!matches.length) return;
        const safeIdx =
          ((idx % matches.length) + matches.length) % matches.length;
        const decos = Decoration.set(
          matches.map((r, i) =>
            (i === safeIdx ? activeMatchMark : matchMark).range(r.from, r.to),
          ),
        );
        view.dispatch({
          effects: setSearchHighlights.of({ decorations: decos, matches }),
          selection: { anchor: matches[safeIdx].from },
          scrollIntoView: true,
        });
      },
      clearSearch() {
        if (!view) return;
        view.dispatch({
          effects: setSearchHighlights.of({
            decorations: Decoration.none,
            matches: [],
          }),
        });
      },
      selectAll() {
        if (!view) return;
        view.dispatch({
          selection: { anchor: 0, head: view.state.doc.length },
        });
        view.focus();
      },
      getMatchCount() {
        if (!view) return 0;
        return view.state.field(searchHighlightField).matches.length;
      },
    };
  }

  // Update content when value changes
  createEffect(() => {
    const val = props.value ?? '';
    if (!view) return;
    const current = view.state.doc.toString();
    if (val !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: val },
      });
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

  return <div class="cm-response-viewer" ref={containerRef} />;
}
