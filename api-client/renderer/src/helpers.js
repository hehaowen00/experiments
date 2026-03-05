export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
