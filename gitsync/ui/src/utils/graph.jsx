import { For } from 'solid-js';

export const GRAPH_COLORS = [
  '#7c5cfc', '#50c878', '#f0a030', '#e05555', '#5090f0',
  '#c070f0', '#f06090', '#40c0c0', '#d0a050', '#8888cc',
];

// Stable color per hash — lanes shift but colors follow the branch identity
let hashColors = new Map();
let nextColor = 0;

export function resetGraphColors() {
  hashColors = new Map();
  nextColor = 0;
}

function colorFor(hash, fallbackCol) {
  if (!hashColors.has(hash)) {
    hashColors.set(hash, fallbackCol != null ? fallbackCol : nextColor++);
  }
  return hashColors.get(hash);
}

export function buildGraph(commits, initialLanes) {
  if (!commits.length) return { graph: [], maxCols: 0, lanes: initialLanes || [] };

  // lanes: array where lanes[i] = hash of the commit expected in that column,
  // or null if the lane is free.
  // laneColors: parallel array tracking the color index for each lane.
  let lanes = initialLanes ? [...initialLanes] : [];
  let laneColors = lanes.map((h, i) => h ? colorFor(h, i) : 0);
  const rows = [];
  let maxCols = 0;

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const hash = c.hash;
    const parents = c.parents;

    // --- Find all lanes expecting this commit ---
    const incomingLanes = [];
    for (let l = 0; l < lanes.length; l++) {
      if (lanes[l] === hash) incomingLanes.push(l);
    }

    // Assign column: take leftmost existing lane, else find a free slot
    let col;
    if (incomingLanes.length > 0) {
      col = incomingLanes[0];
    } else {
      col = lanes.indexOf(null);
      if (col === -1) {
        col = lanes.length;
        lanes.push(null);
        laneColors.push(0);
      }
      lanes[col] = hash;
      laneColors[col] = colorFor(hash, col);
    }

    const myColor = laneColors[col];
    const topPipes = [];
    const botPipes = [];

    // --- Top half: lines coming into this row from above ---

    // Main lane
    if (incomingLanes.length > 0) {
      topPipes.push({ from: col, to: col, color: myColor });
    }

    // Other lanes converging into this commit
    for (const l of incomingLanes) {
      if (l === col) continue;
      topPipes.push({ from: l, to: col, color: laneColors[l] });
      lanes[l] = null;
      laneColors[l] = 0;
    }

    // Pass-through (top half)
    for (let l = 0; l < lanes.length; l++) {
      if (l === col || incomingLanes.includes(l)) continue;
      if (lanes[l] !== null) {
        topPipes.push({ from: l, to: l, color: laneColors[l] });
      }
    }

    // --- Bottom half: lines going from this row downward ---

    const nextLanes = [...lanes];
    const nextColors = [...laneColors];
    nextLanes[col] = null;
    nextColors[col] = 0;

    // First parent: ALWAYS stays in the same column as the commit.
    // This is the key rule that keeps the main branch stable.
    if (parents.length > 0) {
      const p0 = parents[0];
      const existing = nextLanes.indexOf(p0);
      if (existing !== -1 && existing !== col) {
        // First parent was already reserved in another lane (by a merge's
        // second parent from an earlier row). Relocate it to this column
        // so the first-parent chain stays visually straight.
        nextLanes[existing] = null;
        nextColors[existing] = 0;
      }
      nextLanes[col] = p0;
      nextColors[col] = myColor;
      botPipes.push({ from: col, to: col, color: myColor });
    }

    // Additional parents (merge edges)
    for (let p = 1; p < parents.length; p++) {
      const ph = parents[p];
      const existing = nextLanes.indexOf(ph);
      if (existing !== -1) {
        botPipes.push({ from: col, to: existing, color: nextColors[existing] });
      } else {
        // Find a free slot, preferring slots to the right of col
        let slot = -1;
        for (let s = col + 1; s < nextLanes.length; s++) {
          if (nextLanes[s] === null) { slot = s; break; }
        }
        if (slot === -1) {
          // Try slots left of col
          slot = nextLanes.indexOf(null);
        }
        if (slot === -1) {
          slot = nextLanes.length;
          nextLanes.push(null);
          nextColors.push(0);
        }
        const branchColor = colorFor(ph, slot);
        nextLanes[slot] = ph;
        nextColors[slot] = branchColor;
        botPipes.push({ from: col, to: slot, color: branchColor });
      }
    }

    // Pass-through (bottom half): lanes that were occupied before and
    // continue into nextLanes, possibly shifting if relocated
    const botPipeSet = new Set(botPipes.map(p => `${p.from}-${p.to}`));
    for (let l = 0; l < lanes.length; l++) {
      if (l === col || incomingLanes.includes(l)) continue;
      const laneHash = lanes[l];
      if (laneHash === null) continue;
      const dest = nextLanes.indexOf(laneHash);
      if (dest !== -1) {
        const key = `${l}-${dest}`;
        if (!botPipeSet.has(key)) {
          botPipes.push({ from: l, to: dest, color: laneColors[l] });
          botPipeSet.add(key);
        }
      }
    }

    // Trim trailing empty lanes
    while (nextLanes.length > 0 && nextLanes[nextLanes.length - 1] === null) {
      nextLanes.pop();
      nextColors.pop();
    }

    const rowWidth = Math.max(lanes.length, nextLanes.length);
    if (rowWidth > maxCols) maxCols = rowWidth;

    rows.push({ col, topPipes, botPipes, isMerge: parents.length > 1, color: myColor });
    lanes = nextLanes;
    laneColors = nextColors;
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
  const h = 26;
  const mid = 13;
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

  const nodeColor = GRAPH_COLORS[row.color % GRAPH_COLORS.length];

  return (
    <svg width={w} height={h} class="git-graph-svg" style={{ 'margin-top': '-1px', 'margin-bottom': '-1px' }}>
      <For each={row.topPipes}>{(pipe) => pipeHalf(pipe, 0, mid)}</For>
      <For each={row.botPipes}>{(pipe) => pipeHalf(pipe, mid, h)}</For>
      <circle cx={cx} cy={mid} r={row.isMerge ? 5 : 4} fill={nodeColor}
        stroke={row.isMerge ? '#fff' : 'none'} stroke-width={row.isMerge ? 1.5 : 0} />
    </svg>
  );
}
