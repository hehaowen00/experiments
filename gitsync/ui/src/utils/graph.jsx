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

    // First parent: stays in the same column unless already claimed by
    // another lane (e.g. the merge commit's first-parent line). In that
    // case, converge toward the existing lane instead of stealing it.
    if (parents.length > 0) {
      const p0 = parents[0];
      const existing = nextLanes.indexOf(p0);
      if (existing !== -1 && existing !== col) {
        // Parent already tracked in another lane — merge toward it
        botPipes.push({ from: col, to: existing, color: myColor });
      } else {
        nextLanes[col] = p0;
        nextColors[col] = myColor;
        botPipes.push({ from: col, to: col, color: myColor });
      }
    }

    // Additional parents (merge edges) — prefer closest free slot
    for (let p = 1; p < parents.length; p++) {
      const ph = parents[p];
      const existing = nextLanes.indexOf(ph);
      if (existing !== -1) {
        botPipes.push({ from: col, to: existing, color: nextColors[existing] });
      } else {
        // Find the closest free slot to col
        let slot = -1;
        let bestDist = Infinity;
        for (let s = 0; s < nextLanes.length; s++) {
          if (nextLanes[s] === null) {
            const dist = Math.abs(s - col);
            if (dist < bestDist) {
              bestDist = dist;
              slot = s;
            }
          }
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

    // Pass-through (bottom half)
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

    const rowWidth = Math.max(lanes.length, nextLanes.length);
    if (rowWidth > maxCols) maxCols = rowWidth;

    rows.push({ col, topPipes, botPipes, isMerge: parents.length > 1, color: myColor });
    lanes = nextLanes;
    laneColors = nextColors;
  }

  // Only trim lanes at the very end of a batch
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop();
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

const ROW_H = 24;
const MID = ROW_H / 2;
const OVERLAP = 2;

export function GraphCell(props) {
  const { row, maxCols } = props;
  const w = Math.max(maxCols, 1) * 16 + 8;
  const cx = row.col * 16 + 12;

  function pipeHalf(pipe, y0, y1) {
    const x1 = pipe.from * 16 + 12;
    const x2 = pipe.to * 16 + 12;
    const color = GRAPH_COLORS[pipe.color % GRAPH_COLORS.length];
    if (x1 === x2) {
      return <line x1={x1} y1={y0} x2={x2} y2={y1} stroke={color} stroke-width="2" />;
    }
    const dy = y1 - y0;
    return (
      <path
        d={`M ${x1} ${y0} C ${x1} ${y0 + dy * 0.6}, ${x2} ${y1 - dy * 0.6}, ${x2} ${y1}`}
        fill="none" stroke={color} stroke-width="2"
      />
    );
  }

  const nodeColor = GRAPH_COLORS[row.color % GRAPH_COLORS.length];

  return (
    <svg
      width={w}
      height={ROW_H + OVERLAP * 2}
      viewBox={`0 ${-OVERLAP} ${w} ${ROW_H + OVERLAP * 2}`}
      class="git-graph-svg"
      style={{ 'margin-top': `-${OVERLAP}px`, 'margin-bottom': `-${OVERLAP}px` }}
    >
      <For each={row.topPipes}>{(pipe) => pipeHalf(pipe, -OVERLAP, MID)}</For>
      <For each={row.botPipes}>{(pipe) => pipeHalf(pipe, MID, ROW_H + OVERLAP)}</For>
      <circle cx={cx} cy={MID} r={row.isMerge ? 5 : 4} fill={nodeColor}
        stroke={row.isMerge ? '#fff' : 'none'} stroke-width={row.isMerge ? 1.5 : 0} />
    </svg>
  );
}
