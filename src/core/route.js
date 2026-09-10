// One drive that mows the whole year. Pure data + maths, no DOM, no
// dependencies: the exported SVG animation and its tests both run on this.
//
// The drive is what a person does with a riding mower: long passes along the
// rows, a round U-turn off the edge of the board between passes, and a gentle
// hand-drawn weave down each pass so the tractor steers rather than slides.
// Rows are taken evens then odds (0 2 4 6, then 1 3 5): every U-turn then has a
// one-cell radius, bar one wide loop back up the left edge, and seven passes
// end on the right where the loop parks. A pass down a row cuts that row and
// nothing else (MOW_RADIUS 0.67 against a 1-cell pitch, weave under 0.3), so
// every grown day sits on a pass. `mowWalk` proves it anyway: a route with a
// hole in it would ship a tuft that never gets cut into somebody's README.
//
// It used to be a greedy tour with a turn penalty; drawn on the board that was
// a scribble of hairpins, and `rotate="auto"` swung the mower round each one.

import { MOW_RADIUS, BLADE_OFFSET, rng } from './lawn.js';

/** Where the drive starts and parks, in cells past the board edges. */
const ENTRY_X = -4.5;
const PARK_X = 2.5;
/** How far past the edge a pass runs before the U-turn begins. */
const OVER = 0.6;
/** The first weave knot: the run-in from off screen stays straight. */
const RUN_IN = 3.5;
/**
 * The weave: half-wave length and amplitude ranges, in cells. Amplitude must
 * stay under 1 - MOW_RADIUS or a pass would nick the row beside it.
 */
const WEAVE_LEN = [3, 5];
const WEAVE_AMP = [0.1, 0.22];
/** A quarter circle as a cubic: control points at KAPPA x radius. */
const KAPPA = 0.5523;
/** How finely the curve is walked when working out what it cuts. */
const FINE = 0.02;

const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * Plan the drive.
 *
 * @param lawn from createLawn(); never mutated.
 * @param seed picks top-down or bottom-up, and the weave.
 * @returns {{
 *   waypoints: Array<{x, z}>,           // cell units, the frame lawn.mower lives in
 *   curve: Array<{a, c1, c2, b, kind}>, // one cubic per span; kind 'drive' | 'turn'
 *   cuts: Map<number, number>,          // cell index -> arc length at which it is cut
 *   length: number,                     // total arc length, in cells
 * }}
 * `cuts` has an entry for every mowable cell; a route that cannot reach one
 * throws rather than returning a drive that leaves a tuft standing.
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

  const evens = [];
  const odds = [];
  for (let r = 0; r < rows; r++) (r % 2 ? odds : evens).push(r);
  const order = rnd() < 0.5
    ? [...evens, ...odds]
    : [...evens.reverse(), ...odds.reverse()];

  const curve = [];
  const left = -OVER;
  const right = cols + OVER;
  for (let i = 0; i < order.length; i++) {
    const z = order[i] + 0.5;
    const east = i % 2 === 0;               // pass 0 heads +x, then alternate
    const first = i === 0;
    const last = i === order.length - 1;
    const x0 = first ? ENTRY_X : (east ? left : right);
    const x1 = last ? (east ? cols + PARK_X : -PARK_X) : (east ? right : left);
    pass(curve, x0, x1, z, rnd, first);
    if (!last) uturn(curve, x1, z, order[i + 1] + 0.5, east ? 1 : -1);
  }

  const waypoints = curve.map((sp) => sp.a);
  waypoints.push(curve[curve.length - 1].b);

  const walk = mowWalk(curve, targets, lawn);
  // Loud beats wrong: a route with a hole in it would ship a tuft that never
  // gets cut into somebody's README, on a loop, forever.
  if (walk.missed.length) {
    throw new Error(`planRoute: ${walk.missed.length} cell(s) not on any pass`);
  }

  return { waypoints, curve, cuts: walk.cuts, length: walk.length };
}

/**
 * One pass along row centre `z` from x0 to x1: a chain of cubics between
 * weave knots, each with a level tangent, so the tractor eases from side to
 * side like a hand steering it. The knots alternate above and below the row
 * and the pass starts and ends dead centre, where the U-turns pick it up.
 */
function pass(out, x0, x1, z, rnd, runIn) {
  const dir = Math.sign(x1 - x0);
  const len = Math.abs(x1 - x0);
  const knots = [{ x: x0, dz: 0 }];
  let s = runIn ? RUN_IN : 0;
  let side = rnd() < 0.5 ? 1 : -1;
  if (runIn) knots.push({ x: x0 + dir * s, dz: 0 });
  for (;;) {
    s += WEAVE_LEN[0] + rnd() * (WEAVE_LEN[1] - WEAVE_LEN[0]);
    // the last knot is the pass end, level again: leave room for a full swing
    if (s > len - WEAVE_LEN[0]) break;
    const amp = WEAVE_AMP[0] + rnd() * (WEAVE_AMP[1] - WEAVE_AMP[0]);
    knots.push({ x: x0 + dir * s, dz: side * amp });
    side = -side;
  }
  knots.push({ x: x1, dz: 0 });
  for (let i = 1; i < knots.length; i++) {
    const p = knots[i - 1];
    const q = knots[i];
    const h = (q.x - p.x) / 3;
    out.push({
      a: { x: p.x, z: z + p.dz },
      c1: { x: p.x + h, z: z + p.dz },
      c2: { x: q.x - h, z: z + q.dz },
      b: { x: q.x, z: z + q.dz },
      kind: 'drive',
    });
  }
}

/**
 * A half circle from (xe, zFrom) heading `dir` (+1 for +x) round to (xe, zTo)
 * heading back, as two quarter arcs. Radius is half the row gap, so a skip of
 * two rows turns on one cell and the loop back up the board turns wide.
 */
function uturn(out, xe, zFrom, zTo, dir) {
  const r = Math.abs(zTo - zFrom) / 2;
  const sg = Math.sign(zTo - zFrom);
  const k = KAPPA * r;
  const mid = { x: xe + dir * r, z: zFrom + sg * r };
  out.push({
    a: { x: xe, z: zFrom },
    c1: { x: xe + dir * k, z: zFrom },
    c2: { x: xe + dir * r, z: zFrom + sg * (r - k) },
    b: mid,
    kind: 'turn',
  });
  out.push({
    a: mid,
    c1: { x: xe + dir * r, z: zFrom + sg * (r + k) },
    c2: { x: xe + dir * k, z: zTo },
    b: { x: xe, z: zTo },
    kind: 'turn',
  });
}

/** A point on a span, t in 0..1. */
export function bezAt(sp, t) {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return {
    x: w0 * sp.a.x + w1 * sp.c1.x + w2 * sp.c2.x + w3 * sp.b.x,
    z: w0 * sp.a.z + w1 * sp.c1.z + w2 * sp.c2.z + w3 * sp.b.z,
  };
}

/** Arc length of one span, by sampling. */
export function spanLength(sp, steps = 24) {
  let s = 0;
  let p = sp.a;
  for (let i = 1; i <= steps; i++) {
    const q = bezAt(sp, i / steps);
    s += dist(p, q);
    p = q;
  }
  return s;
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
  // grid lookup: a MOW_RADIUS of 0.67 spans at most two columns and two rows,
  // so a blade point can only touch four cells
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
  const r2 = MOW_RADIUS * MOW_RADIUS;
  let s = 0;

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
  }

  const missed = targets.filter((t) => !cuts.has(t.i));
  return { cuts, length: s, missed };
}
