// One drive that mows the whole year. Pure data + maths, no DOM, no
// dependencies: the exported SVG animation and its tests both run on this.
//
// The mower wanders. It does not drive the board end to end and it does not
// follow a shape somebody drew in advance: from wherever it is standing it
// looks at every day still standing, works out the arc-then-straight that
// would reach it, and takes whichever of those cuts the most grass for the
// least driving - with a die roll on top, so two seeds wander differently and
// a straight answer never wins by a hair twice.
//
// Two rules keep that from turning back into stripes. Every run is cut off at
// a length drawn fresh for that move (RUN, 5 to 18 cells), so a row is almost
// never mown end to end in one go and the mower turns somewhere in the middle
// of the board to go and find grass elsewhere. And every turn is a real
// circle of radius 1 that has to start and finish on the board, so the tractor
// steers rather than pivoting, and never swings out over the month labels
// above, the legend below or the Mon/Wed/Fri column on the left. That last one
// is what the owner saw as the mower "stopping on Fri and Wed": the old omega
// turn hung off the left edge, right on top of the labels.
//
// It used to mow in two fixed ways, a spiral and a serpentine of stripes, with
// deliberate breathers and a slow crawl through thick weeks
// (docs/plans/readme-drive.md). Both of those read as lag rather than as life -
// "it occasionally gets stuck and keeps going" - so the drive now has exactly
// two speeds, SPEED down a run and TURN_SPEED round a bend, and never stops.
//
// Finishing is not left to luck. Every move is aimed at the centre of a day
// that is still standing, so every day is reachable in one move from almost
// anywhere; the planner tracks what it has cut, and `mowWalk` proves the whole
// thing at the end - a route with a hole in it would ship a tuft that never
// gets cut into somebody's README, on a loop, forever.

import { MOW_RADIUS, BLADE_OFFSET, rng } from './lawn.js';

/**
 * The drive, in cells per second: down a run, and round a bend. A wander is a
 * longer drive than seven passes were - it doubles back, and the turns are on
 * the board rather than off the end of a row - so the run speed is up from the
 * 9 the striped mower ran at. The demo year then comes round in about a
 * minute, which is a loop somebody watches twice.
 */
export const SPEED = 11;
export const TURN_SPEED = 5.5;

/**
 * Where the drive starts and parks, in cells past the board edges. The entry
 * is far enough out that the mower is off the picture at t=0: the honest still
 * of an animation that starts there is the uncut lawn and no tractor, not a
 * tractor parked on top of the Mon/Wed/Fri labels.
 */
const ENTRY_X = -4.5;
const PARK_X = 2.5;
/** How far in the run-in from the edge reaches before the wander takes over. */
const RUN_IN = 3.5;
/**
 * The weave: half-wave length and amplitude ranges, in cells. Amplitude must
 * stay under 1 - MOW_RADIUS or a run would nick the row beside it.
 */
const WEAVE_LEN = [3, 5];
const WEAVE_AMP = [0.1, 0.22];
/** A run shorter than this is driven straight: no room to steer, so no weave. */
const WEAVE_MIN = 3;

/** The turning circle, in cells. One cell is what rotate="auto" reads as steering. */
const TURN_R = 1;
/**
 * How long a run may be, in cells. One cap is drawn per move and every
 * candidate that move is held to it: this is the wander. Without it the best
 * move is nearly always "carry on to the end of the row", which is the stripe
 * mower again.
 */
const RUN = [5, 18];
/**
 * How far ahead of the blade a run looks for a reason to keep going, in cells.
 * A real year is bare about a third of the time, so at 1.2 - one cell of grass
 * and no more - a run stopped at every gap and the median came out at five
 * cells, which reads as a stutter of hops rather than as mowing. 1.7 steps
 * over a single bare day and stops at two.
 */
const REACH = 1.7;
/** How finely a candidate move is walked, in cells. */
const STEP = 0.25;
/** No candidate may need more than three quarters of a circle to line up. */
const MAX_SWEEP = Math.PI * 1.5;
/** An arc past this is a big loop: fine now and then, not every move. */
const BIG_SWEEP = (150 * Math.PI) / 180;
/** Under three degrees an arc is a twitch, not a bend: leave it at run speed. */
const TINY_SWEEP = 0.05;
/** Within 20 degrees of horizontal is "along the rows". */
const FLAT = Math.sin((20 * Math.PI) / 180);
const FLAT_BONUS = 1.3;
const BIG_TURN_COST = 0.7;
/** The die on every candidate: what makes two seeds different drives. */
const NOISE = [0.75, 0.5];
/** A planner that cannot finish must say so rather than spin. */
const MAX_MOVES = 600;
/** How far the mower rolls on after a recovery turn, in cells. */
const NUDGE = [1, 3];
/**
 * The blade radius the planner scores candidates with. The weave moves the
 * mower up to WEAVE_AMP[1] off the line it measured, so it works to that much
 * less: a day the planner says a move will take is then still inside the real
 * MOW_RADIUS once the weave is drawn on, which is what makes "every move cuts
 * at least the day it was aimed at" true and the whole thing finish. What was
 * actually cut is booked off the drawn cubics instead - see `takeDrawn`.
 */
const PLAN_R = MOW_RADIUS - WEAVE_AMP[1] - 0.02;
/** How finely the curve is walked when working out what it cuts. */
const FINE = 0.02;

const HALF = Math.PI / 2;
const TAU = Math.PI * 2;
const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * Plan the drive.
 *
 * @param lawn from createLawn(); never mutated.
 * @param seed picks the row it enters on, every run's cap and every die roll.
 * @returns {{
 *   waypoints: Array<{x, z}>,           // cell units, the frame lawn.mower lives in
 *   curve: Array<{a, c1, c2, b, kind, speed}>, // one cubic per span
 *   cuts: Map<number, number>,          // cell index -> arc length at which it is cut
 *   length: number,                     // total arc length, in cells
 *   strategy: 'wander',
 * }}
 * `kind` is 'drive' on a run and 'turn' on an arc; `speed` is cells per second
 * and is one of exactly two numbers. `cuts` has an entry for every mowable
 * cell; a route that cannot reach one throws rather than returning a drive
 * that leaves a tuft standing.
 */
export function planRoute(lawn, seed = 7) {
  const rows = lawn.rows;
  const cols = lawn.cols;
  const rnd = rng(seed * 7919 + 13);
  const ctx = ground(lawn);

  // Only grown days are mowable; level 0 is bare dirt and is never "cut".
  const targets = [];
  for (let i = 0; i < lawn.cells.length; i++) {
    const c = lawn.cells[i];
    if (c.void || c.level <= 0) continue;
    targets.push({ i, x: c.col + 0.5, z: c.row + 0.5 });
  }

  const curve = [];
  // In from off the left edge, along a row the seed picks, dead straight: the
  // run-in and the park run are the only two pieces of the drive allowed
  // outside the board, and they are the frames where the mower is off-picture.
  const z0 = Math.floor(rnd() * rows) + 0.5;
  run(curve, ENTRY_X, z0, 0, RUN_IN - ENTRY_X, rnd, false, null);
  let pose = { x: RUN_IN, z: z0, h: 0 };
  takeDrawn(ctx, curve, 0);

  let pending = targets.filter((t) => !ctx.cut[t.i]);
  let left = pending.length;
  let moves = 0;
  while (left > 0) {
    if (++moves > MAX_MOVES) {
      throw new Error(`planRoute: gave up with ${left} cell(s) standing`);
    }
    const cap = RUN[0] + rnd() * (RUN[1] - RUN[0]);
    // The cap first. If nothing at all is within it - the last few tufts can
    // be right across the board - the same search runs again uncapped, so the
    // wander is a preference the planner can drop rather than a trap.
    let best = null;
    let bestScore = 0;
    for (const limit of [cap, Infinity]) {
      for (const t of pending) {
        for (const side of [1, -1]) {
          const cand = reach(ctx, pose, t.x, t.z, side, limit, t.i);
          if (!cand) continue;
          const sc = score(cand, rnd());
          if (sc > bestScore) { bestScore = sc; best = cand; }
        }
      }
      if (best) break;
    }
    const from = curve.length;
    if (best) {
      emit(curve, best, rnd, ctx);
      pose = { x: best.ex, z: best.ez, h: best.eh };
    } else {
      pose = recover(curve, pose, ctx, rows, rnd);
    }
    takeDrawn(ctx, curve, from);
    pending = pending.filter((t) => !ctx.cut[t.i]);
    left = pending.length;
  }

  park(curve, pose, ctx, cols, rows);

  const walk = mowWalk(curve, targets, lawn);
  // Loud beats wrong: a route with a hole in it would ship a tuft that never
  // gets cut into somebody's README, on a loop, forever.
  if (walk.missed.length) {
    throw new Error(`planRoute: ${walk.missed.length} cell(s) not on any pass`);
  }
  for (const sp of curve) sp.speed = sp.kind === 'turn' ? TURN_SPEED : SPEED;

  const waypoints = curve.map((sp) => sp.a);
  waypoints.push(curve[curve.length - 1].b);

  return { waypoints, curve, cuts: walk.cuts, length: walk.length, strategy: 'wander' };
}

// --- the board the wanderer reasons about ----------------------------------

/**
 * What the planner keeps between moves: which days are grown, which it has
 * already cut, and where the mower's centre is allowed to be. The bounds are
 * the picture's margins in cell units - x from a fifth of a cell left of the
 * board to a cell and a bit past its right edge, z the seven rows exactly -
 * and every candidate move is sampled against them. A turn at the left edge
 * therefore has to begin on the board, which is what keeps the tractor off the
 * Mon/Wed/Fri labels. Column 0 still gets cut: the blade rides BLADE_OFFSET
 * ahead, so a mower at x = 0.8 heading west reaches it.
 */
function ground(lawn) {
  const cols = lawn.cols;
  const rows = lawn.rows;
  const grown = new Uint8Array(cols * rows);
  for (const c of lawn.cells) {
    if (!c.void && c.level > 0) grown[c.col * rows + c.row] = 1;
  }
  return {
    cols, rows, grown,
    cut: new Uint8Array(cols * rows),
    seen: new Int32Array(cols * rows).fill(-1),
    stamp: 0,
    xlo: -0.2, xhi: cols + 1.2, zlo: 0, zhi: rows,
  };
}

const inside = (ctx, x, z) => x >= ctx.xlo && x <= ctx.xhi && z >= ctx.zlo && z <= ctx.zhi;

/** Is a whole turning circle about (cx, cz) inside the picture? */
const roomToTurn = (ctx, cx, cz) => cx >= ctx.xlo + TURN_R && cx <= ctx.xhi - TURN_R
  && cz >= ctx.zlo + TURN_R && cz <= ctx.zhi - TURN_R;

/**
 * A pose the mower can get out of. Staying inside the bounds move by move is
 * not enough: a tractor nose-down at z = 6.5 is inside them and has nowhere to
 * go, because either way it turns the circle bulges past row 7. So a move may
 * only *end* somewhere at least one of the two turning circles fits whole,
 * which is a place the mower can always drive a half circle out of. Hold that
 * as an invariant from the run-in on and the drive can never box itself in.
 */
function loose(ctx, x, z, h) {
  for (const side of [1, -1]) {
    if (roomToTurn(ctx, x + TURN_R * Math.cos(h + side * HALF),
      z + TURN_R * Math.sin(h + side * HALF))) return true;
  }
  return false;
}

/**
 * What the blade takes at one point of the walk: every grown day inside
 * PLAN_R of it that this move has not already counted. `stamp` is the move's
 * own mark, so a candidate counts each day once however long it dwells on it.
 */
function bite(ctx, bx, bz, stamp) {
  const { cols, rows, grown, cut, seen } = ctx;
  let n = 0;
  const c0 = Math.max(0, Math.floor(bx - PLAN_R));
  const c1 = Math.min(cols - 1, Math.floor(bx + PLAN_R));
  const r0 = Math.max(0, Math.floor(bz - PLAN_R));
  const r1 = Math.min(rows - 1, Math.floor(bz + PLAN_R));
  for (let col = c0; col <= c1; col++) {
    for (let row = r0; row <= r1; row++) {
      const idx = col * rows + row;
      if (!grown[idx] || cut[idx] || seen[idx] === stamp) continue;
      const dx = col + 0.5 - bx;
      const dz = row + 0.5 - bz;
      if (dx * dx + dz * dz < PLAN_R * PLAN_R) { seen[idx] = stamp; n++; }
    }
  }
  return n;
}

/** Is there a day still standing within REACH in front of the blade? */
function ahead(ctx, bx, bz, ux, uz, stamp) {
  const { cols, rows, grown, cut, seen } = ctx;
  const c0 = Math.max(0, Math.floor(bx - REACH));
  const c1 = Math.min(cols - 1, Math.floor(bx + REACH));
  const r0 = Math.max(0, Math.floor(bz - REACH));
  const r1 = Math.min(rows - 1, Math.floor(bz + REACH));
  for (let col = c0; col <= c1; col++) {
    for (let row = r0; row <= r1; row++) {
      const idx = col * rows + row;
      if (!grown[idx] || cut[idx] || seen[idx] === stamp) continue;
      const dx = col + 0.5 - bx;
      const dz = row + 0.5 - bz;
      if (dx * dx + dz * dz <= REACH * REACH && dx * ux + dz * uz > 0) return true;
    }
  }
  return false;
}

/**
 * Mark what a chosen move really cuts, so the next move sees the gap it left.
 *
 * Not the line the planner measured: the cubics that were just emitted, weave
 * and all, walked with the blade `mowWalk` uses. The planner scores candidates
 * with a smaller blade on an unweaved line, which is the safe way round for
 * "will this day get cut" but leaves it hunting days the real blade already
 * took - which is a quarter of the drive spent mowing cut grass. So the plan
 * is conservative and the bookkeeping is exact. A hair comes off MOW_RADIUS
 * because `mowWalk` samples the same curve its own way: whatever this marks,
 * that has to find too.
 */
function takeDrawn(ctx, curve, from) {
  const { cols, rows, grown, cut } = ctx;
  const r2 = (MOW_RADIUS - 0.01) * (MOW_RADIUS - 0.01);
  const dense = [];
  for (let si = from; si < curve.length; si++) {
    const sp = curve[si];
    const rough = dist(sp.a, sp.c1) + dist(sp.c1, sp.c2) + dist(sp.c2, sp.b);
    const steps = Math.max(4, Math.ceil(rough / FINE));
    for (let i = dense.length ? 1 : 0; i <= steps; i++) dense.push(bezAt(sp, i / steps));
  }
  for (let i = 0; i < dense.length; i++) {
    const q = dense[i];
    const t = dense[Math.min(dense.length - 1, i + 1)];
    const f = dense[Math.max(0, i - 1)];
    const m = Math.hypot(t.x - f.x, t.z - f.z) || 1;
    const bx = q.x + ((t.x - f.x) / m) * BLADE_OFFSET;
    const bz = q.z + ((t.z - f.z) / m) * BLADE_OFFSET;
    const c0 = Math.max(0, Math.floor(bx - MOW_RADIUS));
    const c1 = Math.min(cols - 1, Math.floor(bx + MOW_RADIUS));
    const r0 = Math.max(0, Math.floor(bz - MOW_RADIUS));
    const r1 = Math.min(rows - 1, Math.floor(bz + MOW_RADIUS));
    for (let col = c0; col <= c1; col++) {
      for (let row = r0; row <= r1; row++) {
        const idx = col * rows + row;
        if (!grown[idx] || cut[idx]) continue;
        const dx = col + 0.5 - bx;
        const dz = row + 0.5 - bz;
        if (dx * dx + dz * dz < r2) cut[idx] = 1;
      }
    }
  }
}

// --- one move: an arc onto a line, then the line ---------------------------

/**
 * The shortest arc-then-straight from the pose to a day, with a free final
 * heading. `side` picks one of the two turning circles - one TURN_R to the
 * left of the pose, one to the right - and the mower runs round it until it is
 * pointing at the day, then drives straight. A day inside the circle it has
 * chosen cannot be reached that way at all (the tangent does not exist), which
 * is why both circles are always tried.
 *
 * The straight does not stop on the day: it carries on while there is grass
 * within REACH of the blade, up to `cap`. Everything is sampled every STEP and
 * checked against the bounds; a move that would take the mower off the picture
 * is not a move.
 *
 * @returns null if that circle cannot get there, or the move and what it cuts.
 */
function reach(ctx, pose, tx, tz, side, cap, want) {
  const cx = pose.x + TURN_R * Math.cos(pose.h + side * HALF);
  const cz = pose.z + TURN_R * Math.sin(pose.h + side * HALF);
  const dx = tx - cx;
  const dz = tz - cz;
  const d = Math.hypot(dx, dz);
  if (d <= TURN_R + 1e-9) return null;         // inside this turning circle
  const line = Math.sqrt(d * d - TURN_R * TURN_R);
  if (line > cap) return null;
  // where the mower stands on the circle now, and where it leaves it: the
  // tangent point is acos(r/d) round from the day, against the sweep
  const phi0 = pose.h + side * HALF + Math.PI;
  const phiT = Math.atan2(dz, dx) - side * Math.acos(TURN_R / d);
  let sweep = side * (phiT - phi0);
  sweep = ((sweep % TAU) + TAU) % TAU;         // always the short way round
  if (sweep > MAX_SWEEP) return null;
  const dir = phiT + side * HALF;
  const move = {
    side, cx, cz, phi0, phiT, sweep, dir,
    sx: cx + TURN_R * Math.cos(phiT),
    sz: cz + TURN_R * Math.sin(phiT),
    ux: Math.cos(dir), uz: Math.sin(dir),
    line, cap, straight: 0, cells: 0, ex: 0, ez: 0, eh: dir,
  };
  const stamp = ++ctx.stamp;
  if (!walkMove(ctx, move, stamp, ctx)) return null;
  // A day barely outside the circle can end up behind the blade before the
  // straight even starts. Aiming at a day that does not get cut is a wasted
  // move and, chosen twice, a stall.
  if (want !== undefined && ctx.seen[want] !== stamp) return null;
  return move;
}

/**
 * Walk a move, counting what it cuts and finding where it ends. With `bounds`
 * it also enforces them and says whether the move is legal at all; the same
 * walk with no bounds is how a chosen move is committed.
 */
function walkMove(ctx, move, stamp, bounds) {
  const { cx, cz, phi0, sweep, side, sx, sz, ux, uz } = move;
  let cells = 0;
  // a move with no arc at all - the run-in - has no circle to walk round
  const steps = sweep > 1e-9 ? Math.max(1, Math.ceil((TURN_R * sweep) / STEP)) : -1;
  for (let i = 0; i <= steps; i++) {
    const a = phi0 + side * sweep * (i / steps);
    const x = cx + TURN_R * Math.cos(a);
    const z = cz + TURN_R * Math.sin(a);
    if (bounds && !inside(bounds, x, z)) return false;
    const h = a + side * HALF;
    cells += bite(ctx, x + Math.cos(h) * BLADE_OFFSET, z + Math.sin(h) * BLADE_OFFSET, stamp);
  }
  const target = move.straight || move.line;   // committing replays the same length
  let len = 0;
  // the last length the run could still be stopped at and driven out of
  let out = bounds && loose(bounds, sx, sz, move.dir) ? 0 : -1;
  let outCells = cells;
  for (;;) {
    let step = STEP;
    if (target - len > 1e-6) {
      step = Math.min(STEP, target - len);
    } else if (bounds) {
      // past the day it was aimed at: carry on only while there is more grass
      if (len + STEP > move.cap) break;
      if (!ahead(ctx, sx + ux * (len + BLADE_OFFSET), sz + uz * (len + BLADE_OFFSET),
        ux, uz, stamp)) break;
    } else break;
    const nl = len + step;
    const nx = sx + ux * nl;
    const nz = sz + uz * nl;
    if (bounds && !inside(bounds, nx, nz)) break;
    len = nl;
    cells += bite(ctx, nx + ux * BLADE_OFFSET, nz + uz * BLADE_OFFSET, stamp);
    if (bounds && loose(bounds, nx, nz, move.dir)) { out = len; outCells = cells; }
  }
  if (bounds) {
    // The blade has to get to the day it was aimed at, and the mower has to be
    // able to turn where it stops. The blade rides BLADE_OFFSET ahead, so the
    // run may stop that much short of the day and still have taken it - which
    // is the only way the four corners of the board ever get cut: a run that
    // ended on top of the corner cell would have nowhere left to turn.
    if (out < move.line - BLADE_OFFSET - 1e-6) return false;
    move.straight = out;
    move.cells = outCells;
    move.ex = sx + ux * out;
    move.ez = sz + uz * out;
  }
  return true;
}

/**
 * Grass cut, over ground covered, with three thumbs on the scale: a lawn is
 * mown along its rows more often than across them, a loop right round is worth
 * doing now and then rather than every move, and a die roll so the arithmetic
 * never decides a close call the same way twice.
 */
function score(move, roll) {
  let s = move.cells / (TURN_R * move.sweep + move.straight + 1);
  if (Math.abs(move.uz) < FLAT) s *= FLAT_BONUS;
  if (move.sweep > BIG_SWEEP) s *= BIG_TURN_COST;
  return s * (NOISE[0] + NOISE[1] * roll);
}

/** The arc and the run of a chosen move, as cubics. */
function emit(out, move, rnd, ctx) {
  if (move.sweep > 1e-9) {
    // a couple of degrees is a twitch, not a bend: leave it at run speed and
    // the clock merges it into the run either side rather than spending two
    // keys on it
    arcTo(out, move.cx, move.cz, TURN_R, move.phi0, move.phi0 + move.side * move.sweep,
      move.sweep > TINY_SWEEP ? 'turn' : 'drive');
  }
  if (move.straight > 1e-9) {
    run(out, move.sx, move.sz, move.dir, move.straight, rnd, true, ctx);
  }
}

/**
 * Nowhere to go: everything still standing is inside both turning circles or
 * behind a bound. Turn the mower round toward the middle of the board and try
 * again. A half circle is the first choice and the way out of a corner; the
 * quarters and the three-quarters are there for a pose the half circle would
 * take off the picture.
 */
function recover(out, pose, ctx, rows, rnd) {
  const want = pose.z < rows / 2 ? 1 : -1;     // curve toward the middle
  const first = Math.sin(pose.h + HALF) * want > 0 ? 1 : -1;
  for (const side of [first, -first]) {
    const cx = pose.x + TURN_R * Math.cos(pose.h + side * HALF);
    const cz = pose.z + TURN_R * Math.sin(pose.h + side * HALF);
    // `loose` promised this circle: every pose the drive ends a move on has
    // one that fits, so there is always a half circle to take
    if (!roomToTurn(ctx, cx, cz)) continue;
    const phi0 = pose.h + side * HALF + Math.PI;
    const a = phi0 + side * Math.PI;
    arcTo(out, cx, cz, TURN_R, phi0, a, 'turn');
    const dir = wrap(a + side * HALF);
    const x = cx + TURN_R * Math.cos(a);
    const z = cz + TURN_R * Math.sin(a);
    // and a nudge along the new heading. Without it the next recovery turns
    // straight back and the mower rocks between two poses until the move cap
    // stops the whole plan: two half circles about the same circle are a loop,
    // and a loop is the one thing a planner that must finish cannot do.
    const len = nudge(ctx, x, z, dir, NUDGE[0] + rnd() * (NUDGE[1] - NUDGE[0]));
    run(out, x, z, dir, len, rnd, false, ctx);
    return { x: x + Math.cos(dir) * len, z: z + Math.sin(dir) * len, h: dir };
  }
  throw new Error('planRoute: the mower is boxed in');
}

/** How far a straight can go from here before it is out of room, up to `want`. */
function nudge(ctx, x, z, dir, want) {
  const ux = Math.cos(dir);
  const uz = Math.sin(dir);
  let ok = 0;
  for (let s = STEP; s <= want + 1e-9; s += STEP) {
    if (!inside(ctx, x + ux * s, z + uz * s)) break;
    if (loose(ctx, x + ux * s, z + uz * s, dir)) ok = s;
  }
  return ok;
}

/**
 * The way out: an arc onto the row it is standing nearest, then straight off
 * the right edge to where the loop parks it. This run is the other piece
 * exempt from the bounds - it is meant to leave the picture - so the arc is
 * judged on the board and the straight is not judged at all.
 */
function park(out, pose, ctx, cols, rows) {
  const zp = Math.min(rows - 1, Math.max(1, pose.z));
  const tx = cols + PARK_X;
  let best = null;
  for (const side of [1, -1]) {
    const cx = pose.x + TURN_R * Math.cos(pose.h + side * HALF);
    const cz = pose.z + TURN_R * Math.sin(pose.h + side * HALF);
    const dx = tx - cx;
    const dz = zp - cz;
    const d = Math.hypot(dx, dz);
    if (d <= TURN_R + 1e-9) continue;
    const phi0 = pose.h + side * HALF + Math.PI;
    const phiT = Math.atan2(dz, dx) - side * Math.acos(TURN_R / d);
    let sweep = side * (phiT - phi0);
    sweep = ((sweep % TAU) + TAU) % TAU;
    if (sweep > MAX_SWEEP) continue;
    // the straightest way out wins: whatever leaves the mower pointing most
    // nearly east, so it drives off the edge rather than across the legend.
    // An arc that swings off the board loses to one that does not, whatever
    // it is pointing at: the last thing the drive should do is climb the day
    // labels on its way out.
    const east = Math.abs(wrap(phiT + side * HALF)) + (onBoard(ctx, cx, cz, phi0, side, sweep)
      ? 0 : TAU);
    if (!best || east < best.east) {
      best = { side, cx, cz, phi0, phiT, sweep, east, line: Math.sqrt(d * d - TURN_R * TURN_R) };
    }
  }
  if (!best) return;
  arcTo(out, best.cx, best.cz, TURN_R, best.phi0, best.phi0 + best.side * best.sweep, 'turn');
  const dir = best.phiT + best.side * HALF;
  const sx = best.cx + TURN_R * Math.cos(best.phiT);
  const sz = best.cz + TURN_R * Math.sin(best.phiT);
  run(out, sx, sz, dir, best.line, null, false, null);
}

/** Does an arc keep the mower inside the picture the whole way round? */
function onBoard(ctx, cx, cz, phi0, side, sweep) {
  const steps = Math.max(1, Math.ceil((TURN_R * sweep) / STEP));
  for (let i = 0; i <= steps; i++) {
    const a = phi0 + side * sweep * (i / steps);
    if (!inside(ctx, cx + TURN_R * Math.cos(a), cz + TURN_R * Math.sin(a))) return false;
  }
  return true;
}

/** An angle folded into -pi..pi. */
function wrap(a) {
  let d = a % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// --- the pieces a drive is made of -----------------------------------------

/**
 * One straight run of `len` cells from (x0, z0) along `ang`: a chain of cubics
 * between weave knots, each with a tangent along the run, so the tractor eases
 * from side to side like a hand steering it. The knots alternate either side
 * of the line and the run starts and ends dead centre, where the arcs pick it
 * up. A run with no room for a full swing is driven straight, and a knot that
 * would push the mower off the picture is pulled back onto it. The two runs
 * that are meant to leave the picture - the run-in and the park run - are
 * passed no bounds at all.
 */
function run(out, x0, z0, ang, len, rnd, weave, ctx) {
  if (len < 1e-9) return;
  const ux = Math.cos(ang);
  const uz = Math.sin(ang);
  const knots = [{ s: 0, dv: 0 }];
  if (weave && len >= WEAVE_MIN) {
    let s = 0;
    let side = rnd() < 0.5 ? 1 : -1;
    for (;;) {
      s += WEAVE_LEN[0] + rnd() * (WEAVE_LEN[1] - WEAVE_LEN[0]);
      // the last knot is the run's end, level again: leave room for a full swing
      if (s > len - WEAVE_LEN[0]) break;
      const amp = WEAVE_AMP[0] + rnd() * (WEAVE_AMP[1] - WEAVE_AMP[0]);
      knots.push({ s, dv: side * amp });
      side = -side;
    }
  }
  knots.push({ s: len, dv: 0 });
  const at = (k) => {
    const x = x0 + ux * k.s - uz * k.dv;
    const z = z0 + uz * k.s + ux * k.dv;
    // clamping a knot only ever moves it back toward the line it swings about,
    // and the handles stay along the run, so the cubic follows it in
    if (!ctx) return { x, z };
    return {
      x: Math.min(ctx.xhi, Math.max(ctx.xlo, x)),
      z: Math.min(ctx.zhi, Math.max(ctx.zlo, z)),
    };
  };
  for (let i = 1; i < knots.length; i++) {
    const p = at(knots[i - 1]);
    const q = at(knots[i]);
    const h = (knots[i].s - knots[i - 1].s) / 3;
    out.push({
      a: p,
      c1: { x: p.x + ux * h, z: p.z + uz * h },
      c2: { x: q.x - ux * h, z: q.z - uz * h },
      b: q,
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
 * This is the proof, not the plan: the planner works to a smaller blade on the
 * line it measured, and this walks the curve that is actually drawn.
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
  for (let si = 0; si < curve.length; si++) {
    const sp = curve[si];
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
