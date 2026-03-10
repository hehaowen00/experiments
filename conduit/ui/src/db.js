export const COLUMN_FORMATS = [
  { id: 'raw', label: 'Raw' },
  { id: 'epoch_s', label: 'Epoch (seconds)' },
  { id: 'epoch_ms', label: 'Epoch (milliseconds)' },
  { id: 'url', label: 'URL' },
  { id: 'json', label: 'JSON' },
  { id: 'boolean', label: 'Boolean' },
  { id: 'hex', label: 'Hex' },
  { id: 'filesize', label: 'File Size' },
  { id: 'array', label: 'Array' },
];

export function detectFormat(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trimStart();
  if ((trimmed[0] === '{' || trimmed[0] === '[') && trimmed.length > 1) {
    try { JSON.parse(trimmed); return 'json'; } catch { }
  }
  if (trimmed[0] === '<') return 'xml';
  return null;
}

export function prettifyJson(val) {
  if (!val || typeof val !== 'string') return val;
  try {
    return JSON.stringify(JSON.parse(val), null, 2);
  } catch {
    return val;
  }
}

export function parsePgArray(s) {
  if (typeof s !== 'string') {
    if (Array.isArray(s)) return s.map(String);
    return null;
  }
  const trimmed = s.trim();
  if (trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') {
    const inner = trimmed.slice(1, -1);
    if (inner === '') return [];
    const items = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (inQuote) {
        if (ch === '\\' && i + 1 < inner.length) { current += inner[++i]; continue; }
        if (ch === '"') { inQuote = false; continue; }
        current += ch;
      } else {
        if (ch === '"') { inQuote = true; continue; }
        if (ch === ',') { items.push(current.trim()); current = ''; continue; }
        current += ch;
      }
    }
    items.push(current.trim());
    return items.map((v) => v === 'NULL' ? null : v);
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((v) => v === null ? null : String(v));
  } catch { }
  return null;
}

export function serializePgArray(items) {
  const parts = items.map((v) => {
    if (v === null) return 'NULL';
    const s = String(v);
    if (s === '' || s.includes(',') || s.includes('"') || s.includes('\\') || s.includes('{') || s.includes('}') || s.includes(' ') || s.toUpperCase() === 'NULL') {
      return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    return s;
  });
  return '{' + parts.join(',') + '}';
}

export function formatCellValue(val, format) {
  if (val === null || val === undefined || !format || format === 'raw') return null;
  const s = String(val);
  try {
    switch (format) {
      case 'epoch_s': {
        const n = Number(s);
        if (isNaN(n)) return null;
        return new Date(n * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
      }
      case 'epoch_ms': {
        const n = Number(s);
        if (isNaN(n)) return null;
        return new Date(n).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
      }
      case 'url':
        return s;
      case 'json':
        return JSON.stringify(JSON.parse(s), null, 2);
      case 'boolean': {
        const lower = s.toLowerCase();
        if (lower === '1' || lower === 'true' || lower === 't' || lower === 'yes') return 'true';
        if (lower === '0' || lower === 'false' || lower === 'f' || lower === 'no' || lower === '') return 'false';
        return s;
      }
      case 'hex': {
        const n = Number(s);
        if (isNaN(n) || !Number.isInteger(n)) return null;
        return '0x' + n.toString(16).toUpperCase();
      }
      case 'filesize': {
        const n = Number(s);
        if (isNaN(n)) return null;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
        return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
      }
      case 'array': {
        const items = parsePgArray(val);
        if (!items) return null;
        return `[${items.length} items]`;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function autoDetectColumnFormats(columns, rows, dbType) {
  const formats = {};
  if (!rows || rows.length === 0) return formats;
  for (const col of columns) {
    const values = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && !(typeof v === 'string' && v.startsWith('[Large data:')));
    if (values.length === 0) continue;
    const sample = values.slice(0, 20);
    if (dbType === 'postgres' && sample.every((v) => parsePgArray(v) !== null)) {
      formats[col] = 'array';
      continue;
    }
    if (sample.every((v) => /^https?:\/\/.+/i.test(String(v)))) {
      formats[col] = 'url';
      continue;
    }
    if (sample.every((v) => { const s = String(v).trimStart(); return (s[0] === '{' || s[0] === '[') && (() => { try { JSON.parse(s); return true; } catch { return false; } })(); })) {
      formats[col] = 'json';
      continue;
    }
    const boolVals = new Set(['0', '1', 'true', 'false', 't', 'f', 'yes', 'no']);
    if (sample.every((v) => boolVals.has(String(v).toLowerCase()))) {
      formats[col] = 'boolean';
      continue;
    }
    if (sample.every((v) => { const n = Number(v); return !isNaN(n) && Number.isFinite(n); })) {
      const nums = sample.map(Number);
      if (nums.every((n) => n >= 946684800 && n <= 4102444800 && Number.isInteger(n))) {
        formats[col] = 'epoch_s';
        continue;
      }
      if (nums.every((n) => n >= 946684800000 && n <= 4102444800000 && Number.isInteger(n))) {
        formats[col] = 'epoch_ms';
        continue;
      }
    }
  }
  return formats;
}
