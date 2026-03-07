// KSUID: 4-byte timestamp (seconds since epoch) + 16-byte random, base62-encoded to 27 chars
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateKSUID() {
  const ts = Math.floor(Date.now() / 1000);
  const bytes = new Uint8Array(20);

  bytes[0] = (ts >> 24) & 0xff;
  bytes[1] = (ts >> 16) & 0xff;
  bytes[2] = (ts >> 8) & 0xff;
  bytes[3] = ts & 0xff;

  crypto.getRandomValues(bytes.subarray(4));

  // Convert to base62
  const digits = [];
  const num = Array.from(bytes);

  while (num.some(b => b > 0)) {
    let rem = 0;

    for (let i = 0; i < num.length; i++) {
      const val = rem * 256 + num[i];
      num[i] = Math.floor(val / 62);
      rem = val % 62;
    }

    digits.push(BASE62[rem]);
  }

  while (digits.length < 27) {
    digits.push('0');
  }

  return digits.reverse().join('');
}

export function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export function formatLastUsed(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'Z');
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function findItem(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.type === 'folder' && item.children) {
      const f = findItem(item.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function removeItem(items, id) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) { items.splice(i, 1); return true; }
    if (items[i].type === 'folder' && items[i].children) {
      if (removeItem(items[i].children, id)) return true;
    }
  }
  return false;
}

export function findParentArray(items, id) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return { arr: items, index: i };
    if (items[i].type === 'folder' && items[i].children) {
      const r = findParentArray(items[i].children, id);
      if (r) return r;
    }
  }
  return null;
}

export function isDescendant(items, ancestorId, descendantId) {
  const ancestor = findItem(items, ancestorId);
  if (!ancestor || ancestor.type !== 'folder') return false;
  return !!findItem(ancestor.children || [], descendantId);
}

export function detectFormat(str) {
  const t = str.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (t.startsWith('<')) return 'xml';
  return 'text';
}

export function contentTypeToFormat(ct) {
  if (!ct) return 'text';
  if (ct.includes('json')) return 'json';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('html')) return 'html';
  return 'text';
}

export function buildUrlWithParams(url, params) {
  const enabled = params.filter(p => p.enabled && p.key);
  if (enabled.length === 0) return url;
  const qs = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  return url + (url.includes('?') ? '&' : '?') + qs;
}

export function parseCurl(input) {
  const s = input.replace(/\\\n/g, ' ').trim();
  if (!s.startsWith('curl')) return null;

  const result = { method: 'GET', url: '', headers: [], body: '', params: [] };
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && s[i] === ' ') i++;
    if (i >= s.length) break;
    let token = '';
    const q = s[i];
    if (q === "'" || q === '"') {
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\' && q === '"') { i++; token += s[i] || ''; }
        else token += s[i];
        i++;
      }
      i++;
    } else {
      while (i < s.length && s[i] !== ' ') { token += s[i]; i++; }
    }
    tokens.push(token);
  }

  for (let t = 1; t < tokens.length; t++) {
    const arg = tokens[t];
    if (arg === '-X' || arg === '--request') {
      result.method = (tokens[++t] || 'GET').toUpperCase();
    } else if (arg === '-H' || arg === '--header') {
      const hdr = tokens[++t] || '';
      const ci = hdr.indexOf(':');
      if (ci > 0) result.headers.push({ key: hdr.slice(0, ci).trim().toLowerCase(), value: hdr.slice(ci + 1).trim(), enabled: true });
    } else if (arg === '-d' || arg === '--data' || arg === '--data-raw' || arg === '--data-binary') {
      result.body = tokens[++t] || '';
      if (result.method === 'GET') result.method = 'POST';
    } else if (!arg.startsWith('-') && !result.url) {
      result.url = arg;
    }
  }

  try {
    const urlObj = new URL(result.url);
    const entries = [...urlObj.searchParams.entries()];
    if (entries.length > 0) {
      result.params = entries.map(([key, value]) => ({ key, value, enabled: true }));
      result.url = result.url.split('?')[0];
    }
  } catch { }

  return result;
}

export function resolveVariables(str, variables) {
  if (!str || !variables) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    const v = variables.find(v => v.key === name);
    return v ? v.value : match;
  });
}
