import { Show } from 'solid-js';

const LANE_W = 14;
const NODE_R = 3.5;
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

  return (
    <svg
      width={w}
      height={h}
      class="git-graph-cell"
    >
      {/* Pass-through vertical lines */}
      {passThrough.map((i) => (
        <line
          x1={laneX(i)} y1={0}
          x2={laneX(i)} y2={h}
          stroke={color(i)} stroke-width="2"
        />
      ))}

      {/* Commit lane: top half */}
      <Show when={row.topActive.has(row.commitLane)}>
        <line
          x1={cx} y1={0}
          x2={cx} y2={mid}
          stroke={color(row.commitLane)} stroke-width="2"
        />
      </Show>

      {/* Commit lane: bottom half */}
      <Show when={row.bottomActive.has(row.commitLane)}>
        <line
          x1={cx} y1={mid}
          x2={cx} y2={h}
          stroke={color(row.commitLane)} stroke-width="2"
        />
      </Show>

      {/* Collapsing lines: top of lane → commit node */}
      {row.collapsing.map((i) => (
        <line
          x1={laneX(i)} y1={0}
          x2={cx} y2={mid}
          stroke={color(i)} stroke-width="2"
        />
      ))}

      {/* Merge lines: commit node → bottom of target lane */}
      {row.mergeToLanes.map((i) => (
        <line
          x1={cx} y1={mid}
          x2={laneX(i)} y2={h}
          stroke={color(i)} stroke-width="2"
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
