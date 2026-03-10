export function statusLabel(code) {
  const map = { 'M': 'Modified', 'A': 'Added', 'D': 'Deleted', 'R': 'Renamed', 'C': 'Copied', '?': 'Untracked', 'U': 'Conflict' };
  return map[code] || code;
}

export function statusClass(code) {
  const map = { 'M': 'git-modified', 'A': 'git-added', 'D': 'git-deleted', 'R': 'git-renamed', '?': 'git-untracked', 'U': 'git-conflict' };
  return map[code] || '';
}

export function stagedFiles(files) {
  return files.filter(f => f.index !== '?' && f.index !== ' ' && f.index !== '!');
}

export function unstagedFiles(files) {
  return files.filter(f => f.working !== ' ' && f.working !== '?' && f.working !== '!');
}

export function untrackedFiles(files) {
  return files.filter(f => f.index === '?');
}
