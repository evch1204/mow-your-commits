// One wandering pass that mows the whole year. Pure data + maths, no DOM, no
// dependencies: the exported SVG animation and its tests both run on this.
//
// The shape of the problem is a travelling-salesman tour over every grown day,
// but a *pretty* tour matters more than a short one: a plain nearest-neighbour
// walk on a 7-row field settles into "one row, then the next row", which is the
// picture we already had. So the cost function carries three extra terms — a
// turn penalty, so the mower keeps its line; a sine wave down the rows that the
// route is pulled toward, so it crosses the field in waves instead of sweeping
// it; and a sliding frontier window, so the drive cleans up as it goes and the
// picture reads as cut lawn on the left, standing lawn on the right, with a
// wandering boundary between. Tune these by looking at the animation.

import { MOW_RADIUS, BLADE_OFFSET, rng } from './lawn.js';

/** Cells per radian of turn: how much the mower dislikes swinging round. */
const TURN_W = 1.15;
/** How hard the weave pulls the next pick toward the wave. */
const DRIFT_W = 1.2;
/** A little noise, so the tour is not a lattice. */
const JITTER = 0.7;
/**
 * The frontier. A greedy tour left to itself races to the far end and then
 * spends the rest of the loop coming back for the days it skipped, which reads
 * as a scribble. So only the leftmost WINDOW cells of *unmowed* lawn are in
 * play: anything past that is charged FRONT_W per cell, which is far more than
 * any distance on this board, so the mower cannot leave stragglers behind and
 * the frontier only advances once the window behind it is clean.
 */
const FRONT_W = 4;
const WINDOW = 2.5;
/** The weave: rows either side of the middle, and its wavelength in cells. */
const WAVE_A = 3.4;
const WAVE_L = 2.6;

/** Marking cells mowed along a straight pick, in cells. */
const MARK_STEP = 0.2;
/** Curve sampling: fine for the mowing walk, coarse for the returned path. */
const FINE = 0.02;
const WALK = 0.1;

/** Centripetal Catmull-Rom, and a cap on how far a control point may reach. */
const ALPHA = 0.5;
const MAX_CTRL = 0.42;   // x the span length; a hairpin would otherwise loop

const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/** Signed turn from heading `h` to angle `a`, folded into [-PI, PI]. */
function turn(h, a) {
  let d = a - h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Plan the drive.
 *
 * @param lawn from createLawn(); never mutated.
 * @param seed picks the entry row, the phase of the weave and the jitter.
 * @returns {{
 *   waypoints: Array<{x, z}>,   // cell units, the frame lawn.mower lives in
 *   curve: Array<{a, c1, c2, b}>, // the smoothed spline, one cubic per span
 *   path: Array<{x, z, s}>,     // samples along the curve, ~0.1 cells apart
 *   cuts: Map<number, number>,  // cell index -> arc length at which it is cut
 *   length: number,             // total arc length, in cells
 * }}
 */
export function planRoute(lawn, seed = 7) {
  const rows = lawn.rows;
  const cols = lawn.cols;
  const rnd = rng(seed * 7919 + 13);

  // Only grown days are mowable; level 0 is bare dirt and is never "cut".
  const targets = [];
  for (let i = 0; i < lawn.cells.length; i++) {
    const c = lawn.cells[i];
    if (c.void || c.level <= 0) continue;
    targets.push({ i, x: c.col + 0.5, z: c.row + 0.5 });
  }

  const z0 = 1.5 + rnd() * Math.max(0, rows - 3);
  const phase = rnd() * Math.PI * 2;
  const start = { x: -1.5, z: z0 };

  const waypoints = targets.length
    ? tour(targets, start, rows, phase, rnd)
    : [start];
  // far enough past the last column that the whole mower clears the picture:
  // the loop parks it here while the year regrows, and half a mower stuck to
  // the right edge reads as a bug rather than a pause
  const last = waypoints[waypoints.length - 1];
  waypoints.push({ x: cols + 2.5, z: last.z });

  // The smoothed curve bows away from the straight picks, so a cell the greedy
  // pass thought it had covered can survive. Walk, patch, walk again. Patching
  // one cell can move the curve off another, so keep going: a route that misses
  // a day leaves a tuft standing in somebody's README for a whole loop.
  let curve = beziers(waypoints);
  let walk = mowWalk(curve, targets, lawn);
  for (let pass = 0; pass < 10 && walk.missed.length; pass++) {
    for (const m of walk.missed) insertCheapest(waypoints, m);
    curve = beziers(waypoints);
    walk = mowWalk(curve, targets, lawn);
  }

  return { waypoints, curve, path: walk.path, cuts: walk.cuts, length: walk.length };
}

/**
 * Greedy tour with a turn penalty and a weave. From the current point, pick the
 * unmowed cell that is cheap to reach *and* near where the wave currently is,
 * then mow everything the straight run there passes over.
 */
function tour(targets, start, rows, phase, rnd) {
  const left = targets.map((t) => ({ x: t.x, z: t.z, done: false }));
  let n = left.length;
  let p = start;
  let h = 0;              // heading: the mower enters driving +x
  let s = 0;              // arc length so far, in cells
  const out = [p];

  while (n > 0) {
    const zWant = rows / 2 + WAVE_A * Math.sin(s / WAVE_L + phase);
    // the frontier: the leftmost column of lawn still standing
    let xMin = Infinity;
    for (const c of left) if (!c.done && c.x < xMin) xMin = c.x;
    const edge = xMin + WINDOW;
    let best = -1;
    let bestCost = Infinity;
    for (let k = 0; k < left.length; k++) {
      const c = left[k];
      if (c.done) continue;
      const d = dist(p, c);
      const cost = d
        + TURN_W * Math.abs(turn(h, Math.atan2(c.z - p.z, c.x - p.x)))
        + DRIFT_W * Math.abs(c.z - zWant)
        + FRONT_W * Math.max(0, c.x - edge)
        + JITTER * rnd();
      if (cost < bestCost) { bestCost = cost; best = k; }
    }
    const c = left[best];
    const to = { x: c.x, z: c.z };
    n -= sweep(left, p, to);
    h = Math.atan2(to.z - p.z, to.x - p.x);
    s += dist(p, to);
    p = to;
    out.push(p);
  }
  return out;
}

/** Mark every cell the straight run `a -> b` passes over. Returns how many. */
function sweep(left, a, b) {
  const len = dist(a, b);
  const steps = Math.max(1, Math.ceil(len / MARK_STEP));
  const r2 = MOW_RADIUS * MOW_RADIUS;
  let cut = 0;
  for (let k = 0; k < left.length; k++) {
    const c = left[k];
    if (c.done) continue;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const dx = c.x - (a.x + (b.x - a.x) * f);
      const dz = c.z - (a.z + (b.z - a.z) * f);
      if (dx * dx + dz * dz < r2) { c.done = true; cut++; break; }
    }
  }
  return cut;
}

/** Slot a stranded cell into the cheapest gap between two waypoints. */
function insertCheapest(waypoints, cell) {
  const c = { x: cell.x, z: cell.z };
  let at = 1;
  let best = Infinity;
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const add = dist(waypoints[i], c) + dist(c, waypoints[i + 1])
      - dist(waypoints[i], waypoints[i + 1]);
    if (add < best) { best = add; at = i + 1; }
  }
  waypoints.splice(at, 0, c);
}

// --- the smoothed curve ---------------------------------------------------

const refl = (a, b) => ({ x: 2 * a.x - b.x, z: 2 * a.z - b.z });

/**
 * Centripetal Catmull-Rom through the waypoints, as one cubic Bezier per span.
 * The ends get a reflected phantom point so the drive on and off the field
 * carries straight on. Control points are capped: the greedy tour makes the odd
 * hairpin, and an uncapped spline answers those with a loop.
 */
function beziers(pts) {
  if (pts.length < 2) return [];
  const n = pts.length;
  const ext = [refl(pts[0], pts[1]), ...pts, refl(pts[n - 1], pts[n - 2])];
  const out = [];
  for (let i = 1; i + 2 < ext.length; i++) {
    out.push(span(ext[i - 1], ext[i], ext[i + 1], ext[i + 2]));
  }
  return out;
}

function span(p0, p1, p2, p3) {
  const d1 = Math.max(1e-6, Math.pow(dist(p0, p1), ALPHA));
  const d2 = Math.max(1e-6, Math.pow(dist(p1, p2), ALPHA));
  const d3 = Math.max(1e-6, Math.pow(dist(p2, p3), ALPHA));
  const c1 = {};
  const c2 = {};
  for (const k of ['x', 'z']) {
    c1[k] = (d1 * d1 * p2[k] - d2 * d2 * p0[k]
      + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[k]) / (3 * d1 * (d1 + d2));
    c2[k] = (d3 * d3 * p1[k] - d2 * d2 * p3[k]
      + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[k]) / (3 * d3 * (d3 + d2));
  }
  const cap = MAX_CTRL * dist(p1, p2);
  return { a: p1, c1: clamp(p1, c1, cap), c2: clamp(p2, c2, cap), b: p2 };
}

/** Pull a control point back toward its anchor if it reaches too far. */
function clamp(anchor, c, cap) {
  const d = dist(anchor, c);
  if (d <= cap || d === 0) return c;
  const f = cap / d;
  return { x: anchor.x + (c.x - anchor.x) * f, z: anchor.z + (c.z - anchor.z) * f };
}

function bezAt(sp, t) {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return {
    x: w0 * sp.a.x + w1 * sp.c1.x + w2 * sp.c2.x + w3 * sp.b.x,
    z: w0 * sp.a.z + w1 * sp.c1.z + w2 * sp.c2.z + w3 * sp.b.z,
  };
}

// --- walking it -----------------------------------------------------------

/**
 * Walk the curve in fine steps and record, for every mowable cell, the arc
 * length at which the blade first reaches it. The blade rides `BLADE_OFFSET`
 * ahead of the mower along the tangent, exactly as `tick()` has it, so the SVG
 * fades a tuft on the frame the drawn mower would have eaten it.
 */
function mowWalk(curve, targets, lawn) {
  const cols = lawn.cols;
  const rows = lawn.rows;
  // grid lookup: a blade point can only touch the nine cells around it
  const at = new Int32Array(cols * rows).fill(-1);
  for (let k = 0; k < targets.length; k++) at[targets[k].i] = k;

  // the whole drive as one dense polyline, so a tangent is just its neighbours
  const dense = [];
  for (const sp of curve) {
    const rough = dist(sp.a, sp.c1) + dist(sp.c1, sp.c2) + dist(sp.c2, sp.b);
    const steps = Math.max(4, Math.ceil(rough / FINE));
    // spans share their end point; skip the first of every span but the first
    for (let i = dense.length ? 1 : 0; i <= steps; i++) dense.push(bezAt(sp, i / steps));
  }

  const cuts = new Map();
  const path = [];
  const r2 = MOW_RADIUS * MOW_RADIUS;
  let s = 0;
  let next = 0;            // arc length of the next sample to keep

  for (let i = 0; i < dense.length; i++) {
    const q = dense[i];
    if (i) s += dist(dense[i - 1], q);
    const t = dense[Math.min(dense.length - 1, i + 1)];
    const f = dense[Math.max(0, i - 1)];
    const dx = t.x - f.x;
    const dz = t.z - f.z;
    const m = Math.hypot(dx, dz) || 1;
    const bx = q.x + (dx / m) * BLADE_OFFSET;
    const bz = q.z + (dz / m) * BLADE_OFFSET;

    const c0 = Math.max(0, Math.floor(bx - MOW_RADIUS));
    const c1 = Math.min(cols - 1, Math.floor(bx + MOW_RADIUS));
    const r0 = Math.max(0, Math.floor(bz - MOW_RADIUS));
    const r1 = Math.min(rows - 1, Math.floor(bz + MOW_RADIUS));
    for (let col = c0; col <= c1; col++) {
      for (let row = r0; row <= r1; row++) {
        const idx = col * rows + row;
        if (at[idx] < 0 || cuts.has(idx)) continue;
        const ddx = col + 0.5 - bx;
        const ddz = row + 0.5 - bz;
        if (ddx * ddx + ddz * ddz < r2) cuts.set(idx, s);
      }
    }

    if (s >= next || i === dense.length - 1) {
      path.push({ x: q.x, z: q.z, s });
      next = s + WALK;
    }
  }

  const missed = targets.filter((t) => !cuts.has(t.i));
  return { cuts, path, length: s, missed };
}
