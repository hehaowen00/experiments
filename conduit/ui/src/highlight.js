import { esc } from './helpers';

export function highlightJsonFlat(str) {
  const tokens = [];
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
  let last = 0,
    m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) tokens.push(esc(str.slice(last, m.index)));
    if (m[1] && m[2])
      tokens.push(`<span class="hl-key">${esc(m[1])}</span>${esc(m[2])}`);
    else if (m[1]) tokens.push(`<span class="hl-str">${esc(m[1])}</span>`);
    else if (m[3]) tokens.push(`<span class="hl-bool">${esc(m[3])}</span>`);
    else if (m[4]) tokens.push(`<span class="hl-num">${esc(m[4])}</span>`);
    else if (m[5]) tokens.push(`<span class="hl-punct">${esc(m[5])}</span>`);
    last = m.index + m[0].length;
  }
  if (last < str.length) tokens.push(esc(str.slice(last)));
  return tokens.join('');
}

export function highlightXmlFlat(str) {
  const tokens = [];
  const re =
    /(<!--[\s\S]*?-->)|(<\/?[\w:.=-]+)|(\s[\w:.-]+=)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\/?>)/g;
  let last = 0,
    m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) tokens.push(esc(str.slice(last, m.index)));
    if (m[1]) tokens.push(`<span class="hl-comment">${esc(m[1])}</span>`);
    else if (m[2]) tokens.push(`<span class="hl-tag">${esc(m[2])}</span>`);
    else if (m[3] && m[4])
      tokens.push(
        `<span class="hl-attr">${esc(m[3])}</span><span class="hl-str">${esc(m[4])}</span>`,
      );
    else if (m[5]) tokens.push(`<span class="hl-tag">${esc(m[5])}</span>`);
    last = m.index + m[0].length;
  }
  if (last < str.length) tokens.push(esc(str.slice(last)));
  return tokens.join('');
}

export function highlightFlat(str, format) {
  if (!str) return '';
  if (format === 'json') return highlightJsonFlat(str);
  if (format === 'xml' || format === 'html') return highlightXmlFlat(str);
  return esc(str);
}
