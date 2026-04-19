import { Show } from 'solid-js';

const LANE_W = 16;
const NODE_R = 3.5;
const R_CORNER = 5;
const COLORS = [
  '#4ec9b0', '#569cd6', '#c586c0', '#ce9178',
  '#dcdcaa', '#9cdcfe', '#d16969', '#6a9955',
];

function laneX(lane) {
  return lane * LANE_W + LANE_W / 2;
}

function color(lane) {
  return COLORS[lane % COLORS.length];
}

// Collapsing: vertical down from lane i, rounded turn, horizontal to commit
function collapsePath(i, cx, mid) {
  const x0 = laneX(i);
  const dx = Math.abs(x0 - cx);
  if (dx === 0) return `M${x0},0 L${x0},${mid}`;
  const r = Math.min(R_CORNER, dx, mid);
  if (x0 < cx) {
    // Source left of commit: down then turn right
    return `M${x0},0 L${x0},${mid - r} A${r},${r} 0 0,1 ${x0 + r},${mid} L${cx},${mid}`;
  }
  // Source right of commit: down then turn left
  return `M${x0},0 L${x0},${mid - r} A${r},${r} 0 0,1 ${x0 - r},${mid} L${cx},${mid}`;
}

// Merge: horizontal from commit to lane i, rounded turn, vertical down
function mergePath(cx, i, mid, h) {
  const x1 = laneX(i);
  const dx = Math.abs(x1 - cx);
  if (dx === 0) return `M${cx},${mid} L${cx},${h}`;
  const r = Math.min(R_CORNER, dx, h - mid);
  if (x1 > cx) {
    // Target right of commit: horizontal right then turn down
    return `M${cx},${mid} L${x1 - r},${mid} A${r},${r} 0 0,1 ${x1},${mid + r} L${x1},${h}`;
  }
  // Target left of commit: horizontal left then turn down
  return `M${cx},${mid} L${x1 + r},${mid} A${r},${r} 0 0,0 ${x1},${mid + r} L${x1},${h}`;
}

export function buildGraph(commits) {
  const lanes = [];
  const rows = [];
  let maxLanes = 0;

  for (const commit of commits) {
    let commitLane = lanes.indexOf(commit.hash);
    if (commitLane === -1) {
      commitLane = lanes.indexOf(null);
      if (commitLane === -1) commitLane = lanes.length;
      lanes[commitLane] = commit.hash;
    }

    // Snapshot top state
    const topActive = new Set();
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] != null) topActive.add(i);
    }

    // Collapsing lanes: other lanes also expecting this commit
    const collapsing = [];
    for (let i = 0; i < lanes.length; i++) {
      if (i !== commitLane && lanes[i] === commit.hash) {
        collapsing.push(i);
        lanes[i] = null;
      }
    }

    // Process parents
    const mergeToLanes = [];
    if (commit.parents.length === 0) {
      lanes[commitLane] = null;
    } else {
      lanes[commitLane] = commit.parents[0];
      for (let p = 1; p < commit.parents.length; p++) {
        const parent = commit.parents[p];
        const existing = lanes.indexOf(parent);
        if (existing !== -1) {
          mergeToLanes.push(existing);
        } else {
          let nl = lanes.indexOf(null);
          if (nl === -1) nl = lanes.length;
          lanes[nl] = parent;
          mergeToLanes.push(nl);
        }
      }
    }

    // Trim trailing nulls
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();

    // Bottom state
    const bottomActive = new Set();
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] != null) bottomActive.add(i);
    }

    const highest = Math.max(
      topActive.size ? Math.max(...topActive) + 1 : 0,
      bottomActive.size ? Math.max(...bottomActive) + 1 : 0,
      commitLane + 1,
    );
    if (highest > maxLanes) maxLanes = highest;

    rows.push({
      commitLane,
      topActive,
      bottomActive,
      collapsing,
      mergeToLanes,
      numLanes: highest,
    });
  }

  // Second pass: determine which lanes actually connect to adjacent rows
  for (let i = 0; i < rows.length; i++) {
    const prevBottom = i > 0 ? rows[i - 1].bottomActive : new Set();
    const nextTop =
      i < rows.length - 1 ? rows[i + 1].topActive : new Set();
    rows[i].continuesUp = new Set(
      [...rows[i].topActive].filter((l) => prevBottom.has(l)),
    );
    rows[i].continuesDown = new Set(
      [...rows[i].bottomActive].filter((l) => nextTop.has(l)),
    );
  }

  return { rows, maxLanes };
}

export function GraphCell(props) {
  const h = props.height;
  const mid = h / 2;
  const row = props.row;
  const w = row.numLanes * LANE_W;
  const cx = laneX(row.commitLane);
  const collapseSet = new Set(row.collapsing);

  // Pass-through: active at top & bottom, not commit lane, not collapsing
  const passThrough = [...row.topActive].filter(
    (i) =>
      i !== row.commitLane &&
      !collapseSet.has(i) &&
      row.bottomActive.has(i),
  );

  const up = row.continuesUp;
  const down = row.continuesDown;

  return (
    <svg
      width={w}
      height={h}
      class="git-graph-cell"
    >
      {/* Pass-through vertical lines — clip to connected portions */}
      {passThrough.map((i) => {
        const goesUp = up.has(i);
        const goesDown = down.has(i);
        if (!goesUp && !goesDown) return null;
        return (
          <line
            x1={laneX(i)} y1={goesUp ? 0 : mid}
            x2={laneX(i)} y2={goesDown ? h : mid}
            stroke={color(i)} stroke-width="2"
          />
        );
      })}

      {/* Commit lane: top half — only if lane connects to row above */}
      <Show when={row.topActive.has(row.commitLane) && up.has(row.commitLane)}>
        <line
          x1={cx} y1={0}
          x2={cx} y2={mid}
          stroke={color(row.commitLane)} stroke-width="2"
        />
      </Show>

      {/* Commit lane: bottom half — only if lane connects to row below */}
      <Show when={row.bottomActive.has(row.commitLane) && down.has(row.commitLane)}>
        <line
          x1={cx} y1={mid}
          x2={cx} y2={h}
          stroke={color(row.commitLane)} stroke-width="2"
        />
      </Show>

      {/* Collapsing: vertical down then horizontal in (outermost first) — only if lane connects above */}
      {[...row.collapsing].filter((i) => up.has(i)).sort((a, b) => Math.abs(b - row.commitLane) - Math.abs(a - row.commitLane)).map((i) => (
        <path
          d={collapsePath(i, cx, mid)}
          stroke={color(i)} stroke-width="2" fill="none"
        />
      ))}

      {/* Merge: horizontal out then vertical down (outermost first) — only if lane connects below */}
      {[...row.mergeToLanes].filter((i) => down.has(i)).sort((a, b) => Math.abs(b - row.commitLane) - Math.abs(a - row.commitLane)).map((i) => (
        <path
          d={mergePath(cx, i, mid, h)}
          stroke={color(i)} stroke-width="2" fill="none"
        />
      ))}

      {/* Commit node */}
      <circle
        cx={cx}
        cy={mid}
        r={NODE_R}
        fill={color(row.commitLane)}
        stroke="var(--bg)"
        stroke-width="1.5"
      />
    </svg>
  );
}
