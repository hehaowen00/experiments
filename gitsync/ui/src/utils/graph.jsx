import { For } from 'solid-js';

export const GRAPH_COLORS = [
  '#7c5cfc', '#50c878', '#f0a030', '#e05555', '#5090f0',
  '#c070f0', '#f06090', '#40c0c0', '#d0a050', '#8888cc',
];

export function buildGraph(commits, initialLanes) {
  if (!commits.length) return { graph: [], maxCols: 0, lanes: initialLanes || [] };

  let lanes = initialLanes ? [...initialLanes] : [];
  const rows = [];
  let maxCols = 0;

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const hash = c.hash;
    const parents = c.parents;

    let col = lanes.indexOf(hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) { col = lanes.length; lanes.push(hash); }
      else lanes[col] = hash;
    }

    const topPipes = [];
    const botPipes = [];

    topPipes.push({ from: col, to: col, color: col });

    for (let l = 0; l < lanes.length; l++) {
      if (l === col) continue;
      if (lanes[l] === hash) {
        topPipes.push({ from: l, to: col, color: l });
        lanes[l] = null;
      } else if (lanes[l] && lanes[l] !== null) {
        topPipes.push({ from: l, to: l, color: l });
      }
    }

    const nextLanes = [...lanes];
    nextLanes[col] = null;

    if (parents.length > 0) {
      const p0 = parents[0];
      const existing = nextLanes.indexOf(p0);
      if (existing !== -1 && existing !== col) {
        botPipes.push({ from: col, to: existing, color: col });
      } else {
        nextLanes[col] = p0;
        botPipes.push({ from: col, to: col, color: col });
      }
    }

    for (let p = 1; p < parents.length; p++) {
      const ph = parents[p];
      const existing = nextLanes.indexOf(ph);
      if (existing !== -1) {
        botPipes.push({ from: col, to: existing, color: existing });
      } else {
        let slot = nextLanes.indexOf(null);
        if (slot === -1) { slot = nextLanes.length; nextLanes.push(ph); }
        else nextLanes[slot] = ph;
        botPipes.push({ from: col, to: slot, color: slot });
      }
    }

    for (let l = 0; l < Math.max(lanes.length, nextLanes.length); l++) {
      if (l === col) continue;
      const laneHash = lanes[l];
      if (laneHash && laneHash !== hash && laneHash !== null) {
        const dest = nextLanes.indexOf(laneHash);
        if (dest !== -1) {
          botPipes.push({ from: l, to: dest, color: dest });
        }
      }
    }

    while (nextLanes.length > 0 && nextLanes[nextLanes.length - 1] === null) {
      nextLanes.pop();
    }

    const rowWidth = Math.max(lanes.length, nextLanes.length);
    if (rowWidth > maxCols) maxCols = rowWidth;

    rows.push({ col, topPipes, botPipes, isMerge: parents.length > 1 });
    lanes = nextLanes;
  }

  return { graph: rows, maxCols: Math.max(maxCols, 1), lanes };
}

export function parseRefs(refStr) {
  if (!refStr) return [];
  return refStr.split(',').map(r => r.trim()).filter(Boolean).map(r => {
    if (r.startsWith('HEAD -> ')) return { name: r.slice(8), type: 'git-ref-head' };
    if (r === 'HEAD') return { name: 'HEAD', type: 'git-ref-head' };
    if (r.startsWith('tag: ')) return { name: r.slice(5), type: 'git-ref-tag' };
    if (r.includes('/')) return { name: r, type: 'git-ref-remote' };
    return { name: r, type: 'git-ref-branch' };
  });
}

export function GraphCell(props) {
  const { row, maxCols } = props;
  const w = Math.max(maxCols, 1) * 16 + 8;
  const h = 24;
  const mid = h / 2;
  const cx = row.col * 16 + 12;

  function pipeHalf(pipe, y0, y1) {
    const x1 = pipe.from * 16 + 12;
    const x2 = pipe.to * 16 + 12;
    const color = GRAPH_COLORS[pipe.color % GRAPH_COLORS.length];
    const halfH = y1 - y0;
    if (x1 === x2) {
      return <line x1={x1} y1={y0} x2={x2} y2={y1} stroke={color} stroke-width="2" />;
    }
    return <path d={`M ${x1} ${y0} C ${x1} ${y0 + halfH * 0.6}, ${x2} ${y1 - halfH * 0.6}, ${x2} ${y1}`} fill="none" stroke={color} stroke-width="2" />;
  }

  return (
    <svg width={w} height={h} class="git-graph-svg">
      <For each={row.topPipes}>{(pipe) => pipeHalf(pipe, 0, mid)}</For>
      <For each={row.botPipes}>{(pipe) => pipeHalf(pipe, mid, h)}</For>
      <circle cx={cx} cy={mid} r={row.isMerge ? 5 : 4} fill={GRAPH_COLORS[row.col % GRAPH_COLORS.length]}
        stroke={row.isMerge ? '#fff' : 'none'} stroke-width={row.isMerge ? 1.5 : 0} />
    </svg>
  );
}
