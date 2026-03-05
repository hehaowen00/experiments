import { esc, contentTypeToFormat } from './helpers';

// Minimal JSONPath evaluator
export function evaluateJsonPath(data, path) {
  const results = [];
  if (!path.startsWith('$')) path = '$' + (path.startsWith('.') || path.startsWith('[') ? '' : '.') + path;
  const tokens = tokenizeJsonPath(path);
  if (!tokens) throw new Error('Invalid JSONPath syntax');

  function walk(obj, tIdx, currentPath) {
    if (tIdx >= tokens.length) { results.push({ path: currentPath, value: obj }); return; }
    const token = tokens[tIdx];
    if (token.type === 'root') { walk(obj, tIdx + 1, '$'); return; }
    if (token.type === 'child') {
      if (obj == null || typeof obj !== 'object') return;
      const key = token.value;
      if (key === '*') {
        const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
        for (const [k, v] of entries) walk(v, tIdx + 1, `${currentPath}[${JSON.stringify(k)}]`);
      } else if (Array.isArray(obj)) {
        const idx = parseInt(key);
        if (!isNaN(idx) && idx >= 0 && idx < obj.length) walk(obj[idx], tIdx + 1, `${currentPath}[${idx}]`);
      } else if (key in obj) {
        walk(obj[key], tIdx + 1, `${currentPath}.${key}`);
      }
      return;
    }
    if (token.type === 'recursive') {
      walk(obj, tIdx + 1, currentPath);
      if (obj != null && typeof obj === 'object') {
        const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
        for (const [k, v] of entries) {
          const nextPath = Array.isArray(obj) ? `${currentPath}[${k}]` : `${currentPath}.${k}`;
          walk(v, tIdx, nextPath);
        }
      }
      return;
    }
    if (token.type === 'index') {
      if (!Array.isArray(obj)) return;
      const idx = token.value < 0 ? obj.length + token.value : token.value;
      if (idx >= 0 && idx < obj.length) walk(obj[idx], tIdx + 1, `${currentPath}[${idx}]`);
      return;
    }
    if (token.type === 'slice') {
      if (!Array.isArray(obj)) return;
      const start = (token.start ?? 0) < 0 ? Math.max(0, obj.length + token.start) : (token.start ?? 0);
      const end = (token.end ?? obj.length) < 0 ? Math.max(0, obj.length + token.end) : (token.end ?? obj.length);
      for (let i = start; i < Math.min(end, obj.length); i++) walk(obj[i], tIdx + 1, `${currentPath}[${i}]`);
      return;
    }
    if (token.type === 'filter') {
      if (obj == null || typeof obj !== 'object') return;
      const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
      for (const [k, v] of entries) {
        if (evalFilter(v, token.expr)) {
          const nextPath = Array.isArray(obj) ? `${currentPath}[${k}]` : `${currentPath}.${k}`;
          walk(v, tIdx + 1, nextPath);
        }
      }
    }
  }

  walk(data, 0, '');
  return results;
}

function tokenizeJsonPath(path) {
  const tokens = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === '$') { tokens.push({ type: 'root' }); i++; }
    else if (path[i] === '.' && path[i + 1] === '.') { tokens.push({ type: 'recursive' }); i += 2; }
    else if (path[i] === '.') {
      i++;
      let key = '';
      while (i < path.length && path[i] !== '.' && path[i] !== '[') key += path[i++];
      if (key) tokens.push({ type: 'child', value: key });
    } else if (path[i] === '[') {
      i++;
      if (path[i] === '?') {
        i++;
        if (path[i] !== '(') return null;
        i++;
        let depth = 1, expr = '';
        while (i < path.length && depth > 0) {
          if (path[i] === '(') depth++;
          else if (path[i] === ')') { depth--; if (depth === 0) break; }
          expr += path[i++];
        }
        i++;
        if (path[i] === ']') i++;
        tokens.push({ type: 'filter', expr });
      } else if (path[i] === '\'' || path[i] === '"') {
        const q = path[i++];
        let key = '';
        while (i < path.length && path[i] !== q) key += path[i++];
        i++;
        if (path[i] === ']') i++;
        tokens.push({ type: 'child', value: key });
      } else if (path[i] === '*') {
        i++;
        if (path[i] === ']') i++;
        tokens.push({ type: 'child', value: '*' });
      } else {
        let num = '';
        while (i < path.length && path[i] !== ']' && path[i] !== ':') num += path[i++];
        if (path[i] === ':') {
          i++;
          let end = '';
          while (i < path.length && path[i] !== ']') end += path[i++];
          if (path[i] === ']') i++;
          tokens.push({ type: 'slice', start: num ? parseInt(num) : null, end: end ? parseInt(end) : null });
        } else {
          if (path[i] === ']') i++;
          tokens.push({ type: 'index', value: parseInt(num) });
        }
      }
    } else { i++; }
  }
  return tokens;
}

function evalFilter(value, expr) {
  const m = expr.match(/^@\.(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) {
    const em = expr.match(/^@\.(\w+)$/);
    if (em && value != null && typeof value === 'object') return em[1] in value;
    return false;
  }
  if (value == null || typeof value !== 'object') return false;
  const left = value[m[1]];
  let right = m[3].trim();
  if ((right.startsWith('"') && right.endsWith('"')) || (right.startsWith("'") && right.endsWith("'")))
    right = right.slice(1, -1);
  else if (right === 'true') right = true;
  else if (right === 'false') right = false;
  else if (right === 'null') right = null;
  else if (!isNaN(Number(right))) right = Number(right);

  switch (m[2]) {
    case '==': return left == right;
    case '!=': return left != right;
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
  }
  return false;
}

export function searchXPathResults(body, query) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(body, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML parse error');

  const xpResult = doc.evaluate(query, doc, null, XPathResult.ANY_TYPE, null);
  const results = [];

  switch (xpResult.resultType) {
    case XPathResult.NUMBER_TYPE: results.push({ path: query, value: xpResult.numberValue }); break;
    case XPathResult.STRING_TYPE: results.push({ path: query, value: xpResult.stringValue }); break;
    case XPathResult.BOOLEAN_TYPE: results.push({ path: query, value: xpResult.booleanValue }); break;
    default: {
      let node;
      while ((node = xpResult.iterateNext())) {
        const path = getXmlNodePath(node);
        const value = node.nodeType === 1 ? node.outerHTML || node.textContent : node.textContent;
        results.push({ path, value });
      }
    }
  }
  return results;
}

function getXmlNodePath(node) {
  const parts = [];
  let current = node;
  while (current && current.nodeType === 1) {
    let name = current.tagName;
    const parent = current.parentNode;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === name);
      if (siblings.length > 1) name += `[${siblings.indexOf(current) + 1}]`;
    }
    parts.unshift(name);
    current = current.parentNode;
  }
  return '/' + parts.join('/');
}
