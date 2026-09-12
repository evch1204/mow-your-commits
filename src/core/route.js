// One drive that mows the whole year. Pure data + maths, no DOM, no
// dependencies: the exported SVG animation and its tests both run on this.
//
// The drive is what a person does with a riding mower, and the seed picks
// which of the two ways it is done:
//
//   'spiral' - the ride-on's way. Round the outside of the board and then
//              inward, ring by ring, cutting each corner with a quarter arc
//              that stays on the grass, and out along the middle row.
//   'rows'   - the stripe mower's way. Adjacent rows in a serpentine, so the
//              cut stripes grow in order down the board instead of
//              alternating, with an omega turn between them: the loop a
//              tractor drives when the next swath is closer than its turning
//              circle - swing away from it, round through more than a half
//              turn, and straighten onto it.
//
// Rows used to be taken evens then odds, which meant half the loop looked like
// a striped board of alternate rows and the only turns anywhere were the
// U-turns off the edges: "it only moves horizontally back and forth"
// (docs/plans/readme-drive.md). Every pass still carries a gentle hand-drawn
// weave so the tractor steers rather than slides, thick grass slows it down,
// and once or twice a loop the driver stops for a breather.
//
// A pass down a row cuts that row and nothing else (MOW_RADIUS 0.67 against a
// 1-cell pitch, weave under 0.3), so every grown day sits on a pass. `mowWalk`
// proves it anyway: a route with a hole in it would ship a tuft that never gets
// cut into somebody's README.
//
// It used to be a greedy tour with a turn penalty; drawn on the board that was
// a scribble of hairpins, and `rotate="auto"` swung the mower round each one.

import { MOW_RADIUS, BLADE_OFFSET, rng, hash } from './lawn.js';

/**
 * The drive, in cells per second: down a pass, and round a turn. A pass is 10
 * rather than the 9 it was, because the thick-grass factor below only ever
 * slows the tractor down: at 9 the demo year came round in 58 s, and a README
 * picture that takes a minute to loop is one nobody watches twice.
 */
export const SPEED = 10;
export const TURN_SPEED = 5.5;
/**
 * Thick grass slows the tractor, the way it does in a field: the tallest day
 * in a pass's swath picks the factor, by level. Real and data-driven, so a
 * busy week reads as effort rather than as a wobble somebody dialled in.
 */
const THICK = [1, 1, 1, 0.85, 0.7];

/** Where the drive starts and parks, in cells past the board edges. */
const ENTRY_X = -2;
const PARK_X = 2.5;
/** The first weave knot: the run-in from the edge stays straight. */
const RUN_IN = 3.5;
/**
 * The weave: half-wave length and amplitude ranges, in cells. Amplitude must
 * stay under 1 - MOW_RADIUS or a pass would nick the row beside it.
 */
const WEAVE_LEN = [3, 5];
const WEAVE_AMP = [0.1, 0.22];
/** A leg shorter than this is driven straight: no room to steer, so no weave. */
const WEAVE_MIN = 3;
/**
 * A spiral corner. Radius 1 keeps the arc on the board and still cuts the
 * corner cell: an arc from (xr-1, zt) to (xr, zt+1) about (xr-1, zt+1) passes
 * 0.41 from the corner cell's centre, inside MOW_RADIUS.
 */
const CORNER_R = 1;
/**
 * The omega turn's radius, in cells. Any r above shift/2 closes; 0.9 keeps
 * every arc wider than the one-cell radius rotate="auto" needs to look like
 * steering, while the loop still only reaches about 2 cells past the board.
 */
const OMEGA_R = 0.9;
/** The breather: how long the mower stands still, and how many times a loop. */
const PAUSE_SECS = [0.6, 0.9];
const PAUSES = [1, 3];
/** How finely the curve is walked when working out what it cuts. */
const FINE = 0.02;

const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * Plan the drive.
 *
 * @param lawn from createLawn(); never mutated.
 * @param seed picks the strategy, its mirror, the weave and the breathers.
 * @returns {{
 *   waypoints: Array<{x, z}>,           // cell units, the frame lawn.mower lives in
 *   curve: Array<{a, c1, c2, b, kind, speed}>, // one cubic per span
 *   cuts: Map<number, number>,          // cell index -> arc length at which it is cut
 *   length: number,                     // total arc length, in cells
 *   strategy: 'spiral' | 'rows',
 * }}
 * `kind` is 'drive' on a pass, 'turn' on an arc, and 'pause' on a zero-length
 * span where the mower stands still for `secs`. `speed` is cells per second.
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

  // The seed arrives as a day number from the Action, so consecutive nights
  // are consecutive integers, and an LCG's first draw walks in a straight line
  // over those: eight spirals running, then eight serpentines. hash() is the
  // sine scatter the leaning columns already use, and it has no such run in it.
  //
  // The spiral's rings step inward two rows at a time and finish on the middle
  // one, so it only closes on an odd board. GitHub's is seven rows, forever.
  const wantSpiral = hash(seed * 1.7 + 0.5) < 0.5;
  const strategy = wantSpiral && rows >= 5 && rows % 2 === 1 ? 'spiral' : 'rows';
  const mirror = hash(seed * 3.1 + 0.9) < 0.5;
  const curve = strategy === 'spiral' ? spiral(rows, cols, rnd) : serpentine(rows, cols, rnd);
  // The mirror flips the whole drive about the middle row: the spiral enters
  // along the bottom row and goes the other way round, the serpentine stripes
  // bottom to top. With seven rows both still finish on row 3, heading east.
  if (mirror) {
    for (const sp of curve) for (const p of [sp.a, sp.c1, sp.c2, sp.b]) p.z = rows - p.z;
  }

  const walk = mowWalk(curve, targets, lawn);
  // Loud beats wrong: a route with a hole in it would ship a tuft that never
  // gets cut into somebody's README, on a loop, forever.
  if (walk.missed.length) {
    throw new Error(`planRoute: ${walk.missed.length} cell(s) not on any pass`);
  }
  for (let i = 0; i < curve.length; i++) {
    curve[i].speed = curve[i].kind === 'turn' ? TURN_SPEED : SPEED * THICK[walk.tall[i]];
  }
  breathers(curve, rnd);

  const waypoints = curve.map((sp) => sp.a);
  waypoints.push(curve[curve.length - 1].b);

  return { waypoints, curve, cuts: walk.cuts, length: walk.length, strategy };
}

// --- the two ways to mow ---------------------------------------------------

/**
 * Round the outside and then inward. Ring k is rows k / rows-1-k and columns
 * k / cols-1-k: along the top row, a quarter arc into the last column, down
 * it, along the bottom row, up the first column, and an arc that lands on the
 * next ring's top row already heading east. Seven rows is three rings; the
 * innermost has no columns left to drive, so it turns straight round at the
 * right and omegas back onto the middle row, which drives off the right edge.
 */
function spiral(rows, cols, rnd) {
  const out = [];
  let zt = 0.5;
  let zb = rows - 0.5;
  let xl = 0.5;
  let xr = cols - 0.5;
  let first = true;
  for (;;) {
    leg(out, first ? ENTRY_X : xl, zt, xr - CORNER_R, zt, rnd, first);
    arcTo(out, xr - CORNER_R, zt + CORNER_R, CORNER_R, -Math.PI / 2, 0);
    // on the innermost ring this leg is a point: the two arcs meet as one
    // half circle about the same centre, which is the turn a tractor makes
    leg(out, xr, zt + CORNER_R, xr, zb - CORNER_R, rnd, false);
    arcTo(out, xr - CORNER_R, zb - CORNER_R, CORNER_R, 0, Math.PI / 2);
    first = false;
    if (zb - zt < 3) {
      // one row left in the middle of the ring: run the bottom row out to the
      // inner corner, loop back up onto it, and leave off the right edge
      leg(out, xr - CORNER_R, zb, xl, zb, rnd, false);
      omega(out, xl, zb, zt + 1 - zb, -1);
      leg(out, xl, zt + 1, cols + PARK_X, zt + 1, rnd, false);
      return out;
    }
    leg(out, xr - CORNER_R, zb, xl + CORNER_R, zb, rnd, false);
    arcTo(out, xl + CORNER_R, zb - CORNER_R, CORNER_R, Math.PI / 2, Math.PI);
    leg(out, xl, zb - CORNER_R, xl, zt + 2 * CORNER_R, rnd, false);
    arcTo(out, xl + CORNER_R, zt + 2 * CORNER_R, CORNER_R, Math.PI, Math.PI * 1.5);
    zt += 1;
    zb -= 1;
    xl += 1;
    xr -= 1;
  }
}

/**
 * Adjacent rows, top to bottom, with an omega turn between them, so the cut
 * stripes grow in order. Pass 0 heads east, so with seven rows the last one
 * does too and parks off the right edge where the loop already holds it.
 */
function serpentine(rows, cols, rnd) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const z = r + 0.5;
    const east = r % 2 === 0;
    const first = r === 0;
    const last = r === rows - 1;
    const x0 = first ? ENTRY_X : (east ? 0 : cols);
    const x1 = last ? (east ? cols + PARK_X : -PARK_X) : (east ? cols : 0);
    leg(out, x0, z, x1, z, rnd, first);
    // the pass stops at the board edge and the turn is the overrun: an omega
    // reaches two cells past it, which is all the room the picture has
    if (!last) omega(out, x1, z, 1, east ? 1 : -1);
  }
  return out;
}

// --- the pieces a drive is made of -----------------------------------------

/**
 * One straight leg from (x0, z0) to (x1, z1), along either axis: a chain of
 * cubics between weave knots, each with a tangent along the leg, so the
 * tractor eases from side to side like a hand steering it. The knots alternate
 * either side of the line and the leg starts and ends dead centre, where the
 * turns pick it up. A leg with no room for a full swing is driven straight.
 */
function leg(out, x0, z0, x1, z1, rnd, runIn) {
  // u runs down the leg, v sways across it
  const horiz = z0 === z1;
  const u0 = horiz ? x0 : z0;
  const u1 = horiz ? x1 : z1;
  const v = horiz ? z0 : x0;
  const at = (u, dv) => (horiz ? { x: u, z: v + dv } : { x: v + dv, z: u });
  const dir = Math.sign(u1 - u0);
  const len = Math.abs(u1 - u0);
  if (len < 1e-9) return;                 // the innermost ring's columns
  const knots = [{ u: u0, dv: 0 }];
  let s = runIn ? RUN_IN : 0;
  let side = rnd() < 0.5 ? 1 : -1;
  if (runIn && len > RUN_IN) knots.push({ u: u0 + dir * s, dv: 0 });
  if (len >= WEAVE_MIN) {
    for (;;) {
      s += WEAVE_LEN[0] + rnd() * (WEAVE_LEN[1] - WEAVE_LEN[0]);
      // the last knot is the leg end, level again: leave room for a full swing
      if (s > len - WEAVE_LEN[0]) break;
      const amp = WEAVE_AMP[0] + rnd() * (WEAVE_AMP[1] - WEAVE_AMP[0]);
      knots.push({ u: u0 + dir * s, dv: side * amp });
      side = -side;
    }
  }
  knots.push({ u: u1, dv: 0 });
  for (let i = 1; i < knots.length; i++) {
    const p = knots[i - 1];
    const q = knots[i];
    const h = (q.u - p.u) / 3;
    out.push({
      a: at(p.u, p.dv),
      c1: at(p.u + h, p.dv),
      c2: at(q.u - h, q.dv),
      b: at(q.u, q.dv),
      kind: 'drive',
    });
  }
}

/**
 * A circular arc about (cx, cz) from angle a0 to a1, as cubics of at most a
 * quarter turn each. The control handles are 4/3 tan(d/4) r along the tangent,
 * which is the cubic that meets a circle at both ends (and is KAPPA at 90).
 * The sign of the sweep carries the direction, so an arc can go either way.
 */
function arcTo(out, cx, cz, r, a0, a1, kind = 'turn') {
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + ((a1 - a0) * i) / steps;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
    const k = (4 / 3) * Math.tan((t1 - t0) / 4) * r;
    const p = { x: cx + r * Math.cos(t0), z: cz + r * Math.sin(t0) };
    const q = { x: cx + r * Math.cos(t1), z: cz + r * Math.sin(t1) };
    out.push({
      a: p,
      c1: { x: p.x - k * Math.sin(t0), z: p.z + k * Math.cos(t0) },
      c2: { x: q.x + k * Math.sin(t1), z: q.z - k * Math.cos(t1) },
      b: q,
      kind,
    });
  }
}

/**
 * The omega (or bulb) turn, the one a tractor makes when the next swath is
 * closer than its turning circle: swing away from it by `a`, round the other
 * way through 180 + 2a, then straighten back by `a`. Three tangent arcs of one
 * radius, and cos a = (shift + 2r) / (4r) makes the net sideways step exactly
 * `shift` - which is why the middle arc's centre lands half a row over.
 *
 * From (x0, z0) heading east (`dir` 1) or west (-1), to (x0, z0 + shift)
 * heading back the other way. Built heading east and shifting +z, then
 * mirrored: the mirror flips a sweep's sign, one axis at a time.
 */
function omega(out, x0, z0, shift, dir) {
  const d = Math.abs(shift);
  const sg = Math.sign(shift);
  const r = OMEGA_R;
  const a = Math.acos((d + 2 * r) / (4 * r));
  const H = Math.PI / 2;
  const ang = (t) => Math.atan2(sg * Math.sin(t), dir * Math.cos(t));
  const arc = (cx, cz, t0, sweep) => {
    const s = ang(t0);
    arcTo(out, x0 + dir * (cx - x0), z0 + sg * (cz - z0), r, s, s + dir * sg * sweep);
  };
  const away = Math.atan2(-Math.cos(a), -Math.sin(a));
  arc(x0, z0 - r, H, -a);
  arc(x0 + 2 * r * Math.sin(a), z0 - r + 2 * r * Math.cos(a), away, Math.PI + 2 * a);
  arc(x0, z0 + d / 2 + 2 * r * Math.cos(a), a - H, -a);
}

/**
 * One to three times a loop the driver stops for most of a second. A pause is
 * a zero-length span at a weave knot: the same point on the path twice, so the
 * clock advances while the mower does not. Never on the way in and never
 * inside a turn - a tractor that stops mid-U-turn reads as a dropped frame.
 */
function breathers(curve, rnd) {
  const spots = [];
  let turned = false;
  for (let i = 0; i < curve.length - 1; i++) {
    if (curve[i].kind !== 'drive') { turned = true; continue; }
    if (turned && curve[i + 1].kind === 'drive') spots.push(i);
  }
  const n = PAUSES[0] + Math.floor(rnd() * (PAUSES[1] - PAUSES[0] + 1));
  const picked = [];
  for (let j = 0; j < n; j++) {
    // one per equal share of the drive, so they never bunch up
    const lo = Math.floor((j * spots.length) / n);
    const hi = Math.floor(((j + 1) * spots.length) / n);
    if (hi > lo) picked.push(spots[lo + Math.floor(rnd() * (hi - lo))]);
  }
  // from the back, so the indices still ahead of the splice stay put
  for (let j = picked.length - 1; j >= 0; j--) {
    const p = curve[picked[j]].b;
    curve.splice(picked[j] + 1, 0, {
      a: { ...p }, c1: { ...p }, c2: { ...p }, b: { ...p },
      kind: 'pause', speed: 0,
      secs: PAUSE_SECS[0] + rnd() * (PAUSE_SECS[1] - PAUSE_SECS[0]),
    });
  }
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
 *
 * `tall` comes out of the same walk: the tallest day each span actually cuts,
 * which is what slows the tractor down. Grass a span drives over that an
 * earlier one already cut is cut grass, and cut grass is no work.
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
  const owner = [];
  for (let si = 0; si < curve.length; si++) {
    const sp = curve[si];
    const rough = dist(sp.a, sp.c1) + dist(sp.c1, sp.c2) + dist(sp.c2, sp.b);
    const steps = Math.max(4, Math.ceil(rough / FINE));
    // spans share their end point; skip the first of every span but the first
    for (let i = dense.length ? 1 : 0; i <= steps; i++) {
      dense.push(bezAt(sp, i / steps));
      owner.push(si);
    }
  }

  const cuts = new Map();
  const tall = new Uint8Array(curve.length);
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
        if (ddx * ddx + ddz * ddz < r2) {
          cuts.set(idx, s);
          const lv = lawn.cells[idx].level;
          if (lv > tall[owner[i]]) tall[owner[i]] = lv;
        }
      }
    }
  }

  const missed = targets.filter((t) => !cuts.has(t.i));
  return { cuts, length: s, missed, tall };
}
