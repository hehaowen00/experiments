import { Show, For } from 'solid-js';

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

// Find first-parent ancestry of `main` (or `master`) within the loaded commit
// set. Used to pin the trunk to lane 0 so reciprocal merges between main and a
// topic branch don't produce two parallel "main" lanes.
export function computeTrunkHashes(commits) {
  const byHash = new Map();
  for (const c of commits) byHash.set(c.hash, c);

  const findTip = (predicate) => {
    for (const c of commits) {
      if (!c.refs) continue;
      const refs = c.refs
        .split(',')
        .map((r) => r.trim().replace(/^HEAD -> /, ''));
      if (refs.some(predicate)) return c.hash;
    }
    return null;
  };
  const tip =
    findTip((r) => r === 'main') ||
    findTip((r) => r === 'master') ||
    findTip((r) => /\/main$/.test(r)) ||
    findTip((r) => /\/master$/.test(r));
  if (!tip) return new Set();

  const trunk = new Set();
  let cur = byHash.get(tip);
  while (cur && !trunk.has(cur.hash)) {
    trunk.add(cur.hash);
    if (cur.parents.length === 0) break;
    cur = byHash.get(cur.parents[0]);
  }
  return trunk;
}

export function buildGraph(commits, trunkHashes = new Set()) {
  const lanes = [];
  const rows = [];
  let maxLanes = 0;
  const reserveTrunkLane = trunkHashes.size > 0;

  for (const commit of commits) {
    let commitLane = lanes.indexOf(commit.hash);
    if (commitLane === -1) {
      if (reserveTrunkLane && trunkHashes.has(commit.hash)) {
        commitLane = 0;
      } else if (reserveTrunkLane) {
        commitLane = -1;
        for (let i = 1; i < lanes.length; i++) {
          if (lanes[i] === null) { commitLane = i; break; }
        }
        if (commitLane === -1) commitLane = Math.max(1, lanes.length);
      } else {
        commitLane = lanes.indexOf(null);
        if (commitLane === -1) commitLane = lanes.length;
      }
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
        if (reserveTrunkLane && trunkHashes.has(parent)) {
          mergeToLanes.push(0);
          if (lanes[0] == null) lanes[0] = parent;
          continue;
        }
        const existing = lanes.indexOf(parent);
        if (existing !== -1) {
          mergeToLanes.push(existing);
        } else {
          let nl = -1;
          if (reserveTrunkLane) {
            for (let i = 1; i < lanes.length; i++) {
              if (lanes[i] === null) { nl = i; break; }
            }
            if (nl === -1) nl = Math.max(1, lanes.length);
          } else {
            nl = lanes.indexOf(null);
            if (nl === -1) nl = lanes.length;
          }
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
  // All derived values must be reactive getters — props.row updates in place
  // when buildGraph recomputes (e.g. new commits loaded above this row change
  // its continuesUp set). Destructuring into `const` would freeze the view to
  // the initial props.
  const row = () => props.row;
  const h = () => props.height;
  const mid = () => h() / 2;
  const w = () => row().numLanes * LANE_W;
  const cx = () => laneX(row().commitLane);
  const up = () => row().continuesUp;
  const down = () => row().continuesDown;

  const passThrough = () => {
    const r = row();
    const collapse = new Set(r.collapsing);
    return [...r.topActive].filter(
      (i) =>
        i !== r.commitLane &&
        !collapse.has(i) &&
        r.bottomActive.has(i),
    );
  };

  const sortedCollapsing = () => {
    const r = row();
    return [...r.collapsing]
      .filter((i) => up().has(i))
      .sort(
        (a, b) =>
          Math.abs(b - r.commitLane) - Math.abs(a - r.commitLane),
      );
  };

  const sortedMergeTo = () => {
    const r = row();
    return [...r.mergeToLanes]
      .filter((i) => down().has(i))
      .sort(
        (a, b) =>
          Math.abs(b - r.commitLane) - Math.abs(a - r.commitLane),
      );
  };

  return (
    <svg
      width={w()}
      height={h()}
      class="git-graph-cell"
    >
      {/* Pass-through vertical lines — clip to connected portions */}
      <For each={passThrough()}>{(i) => {
        const goesUp = () => up().has(i);
        const goesDown = () => down().has(i);
        return (
          <Show when={goesUp() || goesDown()}>
            <line
              x1={laneX(i)} y1={goesUp() ? 0 : mid()}
              x2={laneX(i)} y2={goesDown() ? h() : mid()}
              stroke={color(i)} stroke-width="2"
            />
          </Show>
        );
      }}</For>

      {/* Commit lane: top half — only if lane connects to row above */}
      <Show when={row().topActive.has(row().commitLane) && up().has(row().commitLane)}>
        <line
          x1={cx()} y1={0}
          x2={cx()} y2={mid()}
          stroke={color(row().commitLane)} stroke-width="2"
        />
      </Show>

      {/* Commit lane: bottom half — only if lane connects to row below */}
      <Show when={row().bottomActive.has(row().commitLane) && down().has(row().commitLane)}>
        <line
          x1={cx()} y1={mid()}
          x2={cx()} y2={h()}
          stroke={color(row().commitLane)} stroke-width="2"
        />
      </Show>

      {/* Collapsing: vertical down then horizontal in (outermost first) */}
      <For each={sortedCollapsing()}>{(i) => (
        <path
          d={collapsePath(i, cx(), mid())}
          stroke={color(i)} stroke-width="2" fill="none"
        />
      )}</For>

      {/* Merge: horizontal out then vertical down (outermost first) */}
      <For each={sortedMergeTo()}>{(i) => (
        <path
          d={mergePath(cx(), i, mid(), h())}
          stroke={color(i)} stroke-width="2" fill="none"
        />
      )}</For>

      {/* Commit node */}
      <circle
        cx={cx()}
        cy={mid()}
        r={NODE_R}
        fill={color(row().commitLane)}
        stroke="var(--bg)"
        stroke-width="1.5"
      />
    </svg>
  );
}
