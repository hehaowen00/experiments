import { For } from 'solid-js';

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

export function parseDiffLines(raw) {
  const lines = raw.split('\n');
  const result = [];
  let oldNum = 0, newNum = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldNum = parseInt(m[1]); newNum = parseInt(m[2]); }
      result.push({ cls: 'git-diff-line git-diff-hunk', text: line, oldN: '', newN: '' });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      result.push({ cls: 'git-diff-line git-diff-add', text: line, oldN: '', newN: newNum });
      newNum++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      result.push({ cls: 'git-diff-line git-diff-del', text: line, oldN: oldNum, newN: '' });
      oldNum++;
    } else if (line.startsWith('diff ')) {
      result.push({ cls: 'git-diff-line git-diff-header', text: line, oldN: '', newN: '' });
    } else if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity') || line.startsWith('rename') || line.startsWith('old mode') || line.startsWith('new mode')) {
      result.push({ cls: 'git-diff-line git-diff-header', text: line, oldN: '', newN: '' });
    } else {
      result.push({ cls: 'git-diff-line', text: line, oldN: oldNum, newN: newNum });
      oldNum++;
      newNum++;
    }
  }
  return result;
}

export function DiffLine(props) {
  return (
    <div class={props.line.cls}>
      <span class="git-diff-ln">{props.line.oldN}</span>
      <span class="git-diff-ln">{props.line.newN}</span>
      <span class="git-diff-text">{props.line.text}</span>
    </div>
  );
}

export function DiffContent(props) {
  return (
    <pre class={`git-diff-content ${props.class || ''}`}>
      <For each={parseDiffLines(props.raw)}>{(l) => <DiffLine line={l} />}</For>
    </pre>
  );
}
