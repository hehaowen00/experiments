import { For, Show, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import Icon from '../lib/Icon';

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif',
]);

export function isImageFile(filepath) {
  if (!filepath) return false;
  const ext = filepath.split('.').pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

function dataUrlToObjectUrl(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}

export function ImagePreview(props) {
  const [src, setSrc] = createSignal(null);
  const [error, setError] = createSignal(null);

  onMount(async () => {
    const result = await window.api.gitImageBlob(
      props.repoPath,
      props.filepath,
      props.gitRef || null,
    );
    if (result.error) setError(result.error);
    else setSrc(dataUrlToObjectUrl(result.data));
  });

  onCleanup(() => {
    const url = src();
    if (url) URL.revokeObjectURL(url);
  });

  return (
    <div class="git-image-preview">
      <Show when={error()}>
        <div class="git-empty">{error()}</div>
      </Show>
      <Show when={src()}>
        <img src={src()} alt={props.filepath} class="git-image-preview-img" />
      </Show>
      <Show when={!src() && !error()}>
        <div class="git-empty">Loading image...</div>
      </Show>
    </div>
  );
}

export function parseDiffFiles(rawDiff) {
  if (!rawDiff) return [];
  const files = [];
  const chunks = rawDiff.split(/^(?=diff --git )/m);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const headerMatch = chunk.match(/^diff --git a\/(.*?) b\/(.*)$/m);
    let filename = headerMatch ? headerMatch[2] : 'unknown';
    let additions = 0, deletions = 0;
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
    files.push({ filename, diff: chunk, additions, deletions });
  }
  return files;
}

function isHeaderLine(line) {
  return line.startsWith('diff ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity') || line.startsWith('rename') || line.startsWith('old mode') || line.startsWith('new mode');
}

export function parseDiffLines(raw) {
  const lines = raw.split('\n');
  const result = [];
  let oldNum = 0, newNum = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldNum = parseInt(m[1]); newNum = parseInt(m[2]); }
      result.push({ cls: 'git-diff-line git-diff-hunk', text: line, oldN: '', newN: '', hunk: true });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      result.push({ cls: 'git-diff-line git-diff-add', text: line, oldN: '', newN: newNum });
      newNum++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      result.push({ cls: 'git-diff-line git-diff-del', text: line, oldN: oldNum, newN: '' });
      oldNum++;
    } else if (isHeaderLine(line)) {
      continue;
    } else {
      result.push({ cls: 'git-diff-line', text: line, oldN: oldNum, newN: newNum });
      oldNum++;
      newNum++;
    }
  }
  return result;
}

/**
 * Incremental diff parser — only parses up to `maxLines` from raw input,
 * returning parsed lines and state needed to resume parsing.
 */
export function parseDiffLinesIncremental(raw, maxLines, prev) {
  const lines = prev ? prev.rawLines : raw.split('\n');
  const result = prev ? prev.parsed.slice() : [];
  let oldNum = prev ? prev.oldNum : 0;
  let newNum = prev ? prev.newNum : 0;
  let i = prev ? prev.nextIndex : 0;

  while (i < lines.length && result.length < maxLines) {
    const line = lines[i++];
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldNum = parseInt(m[1]); newNum = parseInt(m[2]); }
      result.push({ cls: 'git-diff-line git-diff-hunk', text: line, oldN: '', newN: '', hunk: true });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      result.push({ cls: 'git-diff-line git-diff-add', text: line, oldN: '', newN: newNum });
      newNum++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      result.push({ cls: 'git-diff-line git-diff-del', text: line, oldN: oldNum, newN: '' });
      oldNum++;
    } else if (isHeaderLine(line)) {
      continue;
    } else {
      result.push({ cls: 'git-diff-line', text: line, oldN: oldNum, newN: newNum });
      oldNum++;
      newNum++;
    }
  }

  return {
    parsed: result,
    rawLines: lines,
    nextIndex: i,
    oldNum,
    newNum,
    done: i >= lines.length,
    totalRawLines: lines.length,
  };
}

// Parse hunks as separate groups with their raw text preserved
export function parseDiffHunks(raw) {
  const lines = raw.split('\n');
  const hunks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { headerLine: line, rawLines: [line], parsedLines: [] };
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      current.oldStart = m ? parseInt(m[1]) : 0;
      current.newStart = m ? parseInt(m[2]) : 0;
      current.oldNum = current.oldStart;
      current.newNum = current.newStart;
      current.parsedLines.push({ cls: 'git-diff-line git-diff-hunk', text: line, oldN: '', newN: '', hunk: true });
    } else if (current) {
      if (isHeaderLine(line)) {
        continue;
      }
      current.rawLines.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        current.parsedLines.push({ cls: 'git-diff-line git-diff-add', text: line, oldN: '', newN: current.newNum });
        current.newNum++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        current.parsedLines.push({ cls: 'git-diff-line git-diff-del', text: line, oldN: current.oldNum, newN: '' });
        current.oldNum++;
      } else {
        current.parsedLines.push({ cls: 'git-diff-line', text: line, oldN: current.oldNum, newN: current.newNum });
        current.oldNum++;
        current.newNum++;
      }
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

export function DiffLine(props) {
  const prefix = () => props.line.text ? props.line.text[0] : '';
  const content = () => props.line.text ? props.line.text.substring(1) : '';
  return (
    <div class={props.line.cls}>
      <span class="git-diff-ln">{props.line.oldN}</span>
      <span class="git-diff-ln">{props.line.newN}</span>
      {props.line.hunk
        ? <span class="git-diff-hunk-text">{props.line.text}</span>
        : <>
            <span class="git-diff-prefix">{prefix()}</span>
            <span class="git-diff-text">{content()}</span>
          </>
      }
    </div>
  );
}

const DIFF_LINE_LIMIT = 500;
const DIFF_LINE_CHUNK = 1000;

export function DiffLines(props) {
  const [parseState, setParseState] = createSignal(null);

  // Reset when raw input changes, parse initial chunk
  const initial = createMemo(() => {
    setParseState(null);
    return parseDiffLinesIncremental(props.raw, DIFF_LINE_LIMIT, null);
  });

  const current = () => parseState() || initial();

  function showMore() {
    const cur = current();
    const next = parseDiffLinesIncremental(
      props.raw,
      cur.parsed.length + DIFF_LINE_CHUNK,
      cur,
    );
    setParseState(next);
  }

  return (
    <>
      <For each={current().parsed}>{(l) => <DiffLine line={l} />}</For>
      <Show when={!current().done}>
        <div class="git-diff-truncated" onClick={showMore}>
          Show more lines
        </div>
      </Show>
    </>
  );
}

export function DiffHunks(props) {
  const hunks = createMemo(() => parseDiffHunks(props.raw));

  return (
    <For each={hunks()}>{(hunk, idx) => (
      <div class="git-diff-hunk-group">
        <div class="git-diff-hunk-actions">
          <Show when={props.onStageHunk}>
            <button
              class="btn btn-ghost btn-xs git-hunk-btn"
              onClick={() => props.onStageHunk(idx())}
              title="Stage hunk"
            >
              <Icon name="fa-solid fa-plus" />
            </button>
          </Show>
          <Show when={props.onUnstageHunk}>
            <button
              class="btn btn-ghost btn-xs git-hunk-btn"
              onClick={() => props.onUnstageHunk(idx())}
              title="Unstage hunk"
            >
              <Icon name="fa-solid fa-minus" />
            </button>
          </Show>
          <Show when={props.onDiscardHunk}>
            <button
              class="btn btn-ghost btn-xs btn-danger-hover git-hunk-btn"
              onClick={() => props.onDiscardHunk(idx())}
              title="Discard hunk"
            >
              <Icon name="fa-solid fa-trash" />
            </button>
          </Show>
        </div>
        <For each={hunk.parsedLines}>{(l) => <DiffLine line={l} />}</For>
      </div>
    )}</For>
  );
}

export function DiffContent(props) {
  return (
    <pre class={`git-diff-content ${props.class || ''}`}>
      <div class="git-diff-inner">
        <DiffLines raw={props.raw} />
      </div>
    </pre>
  );
}

const ANSI_COLORS = {
  '30': 'color:var(--text-dim)', '31': 'color:var(--danger)', '32': 'color:var(--success)',
  '33': 'color:var(--warning)', '34': 'color:var(--accent)', '35': 'color:#c678dd',
  '36': 'color:#56b6c2', '37': 'color:var(--text)',
  '90': 'color:var(--text-dim)', '91': 'color:var(--danger)', '92': 'color:var(--success)',
  '93': 'color:var(--warning)', '94': 'color:var(--accent)', '95': 'color:#c678dd',
  '96': 'color:#56b6c2', '97': 'color:var(--text)',
};

function ansiToHtml(text) {
  let html = '';
  let i = 0;
  let open = false;
  while (i < text.length) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      const end = text.indexOf('m', i + 2);
      if (end === -1) { html += text[i]; i++; continue; }
      const codes = text.substring(i + 2, end).split(';');
      i = end + 1;
      if (codes.includes('0') || codes[0] === '') {
        if (open) { html += '</span>'; open = false; }
        continue;
      }
      const styles = [];
      for (const code of codes) {
        if (code === '1') styles.push('font-weight:bold');
        else if (code === '2') styles.push('opacity:0.7');
        else if (code === '4') styles.push('text-decoration:underline');
        else if (ANSI_COLORS[code]) styles.push(ANSI_COLORS[code]);
      }
      if (styles.length) {
        if (open) html += '</span>';
        html += `<span style="${styles.join(';')}">`;
        open = true;
      }
    } else if (text[i] === '<') {
      html += '&lt;'; i++;
    } else if (text[i] === '>') {
      html += '&gt;'; i++;
    } else if (text[i] === '&') {
      html += '&amp;'; i++;
    } else {
      html += text[i]; i++;
    }
  }
  if (open) html += '</span>';
  return html;
}

export function DiffStructural(props) {
  const html = createMemo(() => ansiToHtml(props.raw || ''));
  return <div class="git-diff-structural" innerHTML={html()} />;
}
