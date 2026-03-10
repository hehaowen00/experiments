let homeDir = '';

export function initHomeDir() {
  return window.api.homeDir().then(d => { homeDir = d; });
}

export function shortenPath(p) {
  if (homeDir && p.startsWith(homeDir)) return '~' + p.slice(homeDir.length);
  return p;
}
