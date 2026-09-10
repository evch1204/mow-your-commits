// The five silhouettes, as drawing instructions rather than as drawing.
//
// `grassOps` returns a flat list of ops -- filled paths, strokes, ovals -- in
// board pixels. src/render2d replays them onto a canvas and src/export/svg.js
// serialises them into <path>s, so the picture in a README is the same drawing
// as the board on the page rather than a second implementation of it.
//
// Pure: no DOM, no dependencies, and every random number comes from the `rnd`
// handed in, so the canvas can boil its jitter every 8th of a second while the
// exporter re-seeds and gets the identical shape twice.

import { GEOM } from './board.js';
import { hash } from './lawn.js';
import {
  AUTUMN_BLADE, DANDELION, FLOWERS, FLUFF, LIGHT_RAMP,
  bladeColor, cellTint, grassFor, innerColor, mix,
} from './palette.js';

const { CELL } = GEOM;

/**
 * Paint order. Everything at one layer is drawn before anything at the next,
 * across a whole row, which is what lets the exporter batch a row's strokes by
 * colour and still stack them exactly the way the canvas does.
 */
export const Z = { SHADOW: 0, BODY: 1, DETAIL: 2, ACCENT: 3 };

const FLAT = 0.15;      // the y scale a mown silhouette ends at
const OVERSHOOT = 0.15; // how far it bulges sideways on the way down

const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

/**
 * The outline of a filled clump: a flat base, a bowed side each end, and
 * `lobes` round bumps across the top. Three deep lobes read as a bush, four
 * shallow ones on a much taller body read as a hedge.
 *
 * Each bump is two quadratics whose controls sit level with the peak, which is
 * the quarter-ellipse a compass would draw. One quadratic per bump gives a
 * spike instead: the first draft of this looked like a mountain range.
 *
 * @param peaks [height as a fraction of h, sideways nudge] per lobe
 * @param dip   how far the tops between two bumps fall, 1 = not at all
 */
function lobed(cx, base, halfW, h, peaks, dip, w) {
  const lobes = peaks.length;
  const left = cx - halfW;
  const right = cx + halfW;
  const shoulder = base - h * 0.34;
  const tops = [];
  for (let k = 0; k <= lobes; k++) {
    const edge = k === 0 || k === lobes;
    const x = left + (k / lobes) * halfW * 2;
    const near = peaks[Math.min(lobes - 1, k)][0];
    tops.push([
      w(edge ? x + (k === 0 ? halfW * 0.08 : -halfW * 0.08) : x, 0.8),
      edge ? shoulder : w(base - h * near * dip, 1),
    ]);
  }

  const d = [['M', left, base]];
  d.push(['Q', left - halfW * 0.16, base - h * 0.2, tops[0][0], tops[0][1]]);
  const peakAt = [];
  for (let i = 0; i < lobes; i++) {
    const a = tops[i];
    const b = tops[i + 1];
    const px = (a[0] + b[0]) / 2 + peaks[i][1];
    const py = base - h * peaks[i][0];
    d.push(['Q', a[0] + (px - a[0]) * 0.18, py, px, py]);
    d.push(['Q', b[0] - (b[0] - px) * 0.18, py, b[0], b[1]]);
    peakAt.push([px, py]);
  }
  d.push(['Q', right + halfW * 0.16, base - h * 0.2, right, base]);
  d.push(['Z']);
  return { d, peakAt };
}

/**
 * A hedge is not a fourth lobe on a bush: it is a clipped wall, taller than
 * the tile it stands on, with a gently ragged top. Deliberately the opposite
 * silhouette to the bush's three round lobes, so the two busiest levels are
 * told apart by shape and not only by height.
 */
function wall(cx, base, halfW, h, w) {
  const left = cx - halfW;
  const right = cx + halfW;
  const inset = halfW * 0.3;
  const topY = base - h;
  const tops = [];
  for (let k = 0; k <= 4; k++) {
    tops.push([
      w(left + inset + (k / 4) * (halfW * 2 - inset * 2), 0.8),
      w(topY + (k % 2 ? h * 0.055 : 0), 0.9),
    ]);
  }
  const d = [['M', left, base]];
  // the sides bow out a touch, so it is a clipped hedge and not a brick
  d.push(['Q', left - halfW * 0.12, base - h * 0.5, w(left + inset * 0.2, 0.6), topY + h * 0.15]);
  d.push(['Q', left + inset * 0.06, topY + h * 0.01, tops[0][0], tops[0][1]]);
  for (let k = 1; k <= 4; k++) {
    const a = tops[k - 1];
    const b = tops[k];
    d.push(['Q', (a[0] + b[0]) / 2, Math.min(a[1], b[1]) - h * 0.05, b[0], b[1]]);
  }
  d.push(['Q', right - inset * 0.06, topY + h * 0.01, w(right - inset * 0.2, 0.6), topY + h * 0.15]);
  d.push(['Q', right + halfW * 0.12, base - h * 0.5, right, base]);
  d.push(['Z']);
  return { d, peakAt: [tops[0], tops[2], tops[4]] };
}

/** One blade, curving as it goes up. Returns the path and its tip. */
function blade(bx, foot, h, lean, w) {
  const tip = [bx + lean, foot - h];
  return {
    d: [
      ['M', w(bx, 0.5), foot],
      ['Q', w(bx + lean * 0.35, 0.8), w(foot - h * 0.62, 0.8), w(tip[0], 0.6), w(tip[1], 0.6)],
    ],
    tip,
  };
}

/**
 * Everything that grows on one day, in board pixels.
 *
 * @param cell   a lawn cell (only col/row/level/vigor/heroic are read)
 * @param x,y    the tile's top-left corner
 * @param season 0..3, or NO_SEASON for the plain chart
 * @param opts   { rnd, ramp, scale, mowT }
 *   rnd    () => [0,1); the caller owns the seed
 *   ramp   a theme (light by default), so dark mode follows every colour rule
 *   scale  1 on the board; the key draws at its own size
 *   mowT   0 standing, 0..1 mid-cut, >= 1 gone
 * @returns [{ z, t, ... }] ops, in paint order within each layer
 */
export function grassOps(cell, x, y, season, opts = {}) {
  const level = cell.level;
  if (cell.void || !level) return [];
  const mowT = opts.mowT || 0;
  if (mowT >= 1) return [];             // cut: the clean GitHub tile is the point

  const rnd = opts.rnd || Math.random;
  const ramp = opts.ramp || LIGHT_RAMP;
  const scale = opts.scale == null ? 1 : opts.scale;
  const w = (v, a) => v + (rnd() - 0.5) * a;

  const g = grassFor(level, cell.vigor || 0);
  const cx = x + CELL / 2;
  const base = y + CELL - 1;
  const h = g.height * scale;
  const halfW = g.spread * scale;
  const fill = cellTint(bladeColor(level, season, ramp), cell.col, cell.row);
  const inner = innerColor(fill, ramp);
  const ink = ramp.ink;
  const bias = (hash(cell.col) - 0.5) * 4;      // the whole patch leans together
  const autumn = season === 3;
  const winter = season === 0;
  const filled = g.kind === 'bush' || g.kind === 'hedge';

  const ops = [];
  const stroke = (z, d, color, width) => ops.push({ z, t: 'path', d, stroke: color, w: width });
  const oval = (z, ox, oy, rx, ry, f, s, width) =>
    ops.push({ z, t: 'oval', x: ox, y: oy, rx, ry, fill: f, stroke: s, w: width });

  // --- the hatched shadow that lifts a bush or a hedge off the paper ------
  if (filled) {
    const d = [];
    for (let k = 0; k < 3; k++) {
      const sx = cx - halfW * 0.3 + k * halfW * 0.36 + 3;
      d.push(['M', sx, base + 3], ['L', sx + 6, base - 3]);
    }
    stroke(Z.SHADOW, d, `rgba(${ramp.inkRgb || '44,44,42'},0.16)`, 1.4);
  }

  // --- the body -----------------------------------------------------------
  let peakAt = null;
  if (g.kind === 'tuft') {
    // a low two-humped mound for the blades to stand in
    const peaks = [[0.92, 0], [1, 0]].map((p) => [p[0] + (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 1.2]);
    const shell = lobed(cx, base, halfW, h * 0.5, peaks, 0.78, w);
    // a shade darker than the blades, so the blades read against it
    ops.push({ z: Z.BODY, t: 'path', d: shell.d, fill: inner, stroke: ink, w: g.width });
  } else if (filled) {
    // three deep round lobes for a bush; a clipped wall for a hedge
    const shell = g.kind === 'bush'
      ? lobed(cx, base, halfW, h,
        [0.84, 1, 0.88].map((p) => [p + (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 1.6]), 0.56, w)
      : wall(cx, base, halfW, h, w);
    ops.push({ z: Z.BODY, t: 'path', d: shell.d, fill, stroke: ink, w: g.width });
    peakAt = shell.peakAt;
  }

  // --- blades (thin kinds) or inner strokes (filled kinds) ----------------
  const n = g.blades;
  if (!filled) {
    const foot = g.kind === 'tuft' ? base - h * 0.2 : base;
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1);
      const bx = cx - halfW * 0.75 + f * halfW * 1.5 + (rnd() - 0.5) * 1.6;
      const bh = h * (0.78 + rnd() * 0.44);
      const lean = bias + (rnd() - 0.5) * (5 + level);
      const turned = autumn && rnd() < 0.15;
      const b = blade(bx, foot, bh, lean, w);
      stroke(Z.DETAIL, b.d, turned ? AUTUMN_BLADE : fill, g.width);
      if (winter && i % 3 === 0) {
        oval(Z.ACCENT, b.tip[0], b.tip[1] - 0.4, 1.5, 1.5, '#FFFFFF', null, 0);
      }
    }
  } else {
    const d = [];
    const brown = [];
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1);
      const sx = cx - halfW * 0.66 + f * halfW * 1.32 + (rnd() - 0.5) * 1.6;
      const y0 = base - h * 0.08;
      // stop short of the outline: a bush dips to 0.56 of its peak between the
      // lobes, and a stroke that overshot there poked out through the top
      const y1 = base - h * (g.kind === 'hedge' ? 0.52 + rnd() * 0.32 : 0.28 + rnd() * 0.24);
      const lean = bias * 0.5 + (rnd() - 0.5) * 3.4;
      const seg = [
        ['M', w(sx, 0.5), y0],
        ['Q', w(sx + lean * 0.4, 0.8), (y0 + y1) / 2, w(sx + lean, 0.6), w(y1, 0.7)],
      ];
      (autumn && rnd() < 0.18 ? brown : d).push(...seg);
    }
    const iw = Math.max(1, g.width * 0.78);
    if (d.length) stroke(Z.DETAIL, d, inner, iw);
    if (brown.length) stroke(Z.DETAIL, brown, AUTUMN_BLADE, iw);

    // seed heads standing proud of a hedge: the fastest way to tell it from
    // a bush at a glance, even a row away
    if (g.kind === 'hedge') {
      const heads = [...peakAt].sort((a, b) => a[1] - b[1]);
      const many = 2 + (rnd() < 0.5 ? 1 : 0);
      for (const p of heads.slice(0, many)) {
        const top = p[1] - 3.4;
        stroke(Z.ACCENT, [['M', p[0], p[1] + 1], ['L', w(p[0], 1), top + 1.6]], inner, 1);
        oval(Z.ACCENT, w(p[0], 0.6), top, 1.2, 2.4, mix(fill, '#FFFFFF', 0.34), ink, 0.8);
      }
    }
    // snow settles on the tops of a winter bush or hedge
    if (winter) {
      for (const p of peakAt) oval(Z.ACCENT, p[0], p[1] + 0.8, halfW * 0.3, 1.7, '#FFFFFF', null, 0);
    }
  }

  // --- the best days of the year: a dandelion and a seed-head puff ---------
  if (cell.heroic && !winter) {
    const st = h * 0.85 + 9;
    for (let k = 0; k < 2; k++) {
      const dx = cx + (k ? 6.5 : -6) + (rnd() - 0.5) * 2;
      const top = base - st * (k ? 0.82 : 1);
      const hx = dx + bias * 0.4;
      stroke(Z.ACCENT, [
        ['M', w(dx, 0.6), w(base, 0.6)],
        ['Q', w((dx + hx) / 2, 0.9), w((base + top) / 2, 0.9), w(hx, 0.6), w(top, 0.6)],
      ], ink, 1.1);
      if (k === 0) {
        const rays = [];
        for (let j = 0; j < 7; j++) {
          const a = j * 0.898 + 0.3;
          rays.push(['M', hx + Math.cos(a) * 2.6, top + Math.sin(a) * 2.6],
            ['L', hx + Math.cos(a) * 5.2, top + Math.sin(a) * 5.2]);
        }
        stroke(Z.ACCENT, rays, DANDELION, 1.4);
        oval(Z.ACCENT, hx, top, 3.2, 3.2, DANDELION, ink, 1);
      } else {
        const spokes = [];
        for (let j = 0; j < 8; j++) {
          const a = j * 0.785 + 0.4;
          spokes.push(['M', hx + Math.cos(a) * 1.6, top + Math.sin(a) * 1.6],
            ['L', hx + Math.cos(a) * 4.4, top + Math.sin(a) * 4.4]);
        }
        stroke(Z.ACCENT, spokes, ink, 0.6);
        oval(Z.ACCENT, hx, top, 2.8, 2.8, FLUFF, null, 0);
      }
    }
  }

  // --- spring blossom, scattered through whatever is growing --------------
  if (season === 1) {
    for (let f = 0; f < 2; f++) {
      const fx = cx + (rnd() - 0.5) * Math.max(CELL * 0.7, halfW * 1.4);
      const fy = base - 2 - rnd() * h * 0.85;
      oval(Z.ACCENT, fx, fy, 1.7, 1.7, FLOWERS[Math.floor(rnd() * FLOWERS.length)], null, 0);
    }
  }

  return mowT > 0 ? squash(ops, cx, base, mowT) : ops;
}

/**
 * The cut: the silhouette flattens to 0.15 of its height on a 0.25s ease-out
 * and bulges 1.15x wide on the way down, then fades over the last of it so the
 * clean GitHub tile is what is left standing.
 */
function squash(ops, cx, base, mowT) {
  const e = easeOut(Math.min(1, mowT));
  const sy = 1 - (1 - FLAT) * e;
  const sx = 1 + OVERSHOOT * Math.sin(Math.PI * e);
  const alpha = mowT < 0.6 ? 1 : Math.max(0, (1 - mowT) / 0.4);
  const X = (v) => cx + (v - cx) * sx;
  const Y = (v) => base + (v - base) * sy;
  return ops.map((op) => {
    if (op.t === 'oval') {
      return { ...op, x: X(op.x), y: Y(op.y), rx: op.rx * sx, ry: op.ry * sy, alpha };
    }
    const d = op.d.map((seg) => {
      const out = [seg[0]];
      for (let i = 1; i < seg.length; i += 2) out.push(X(seg[i]), Y(seg[i + 1]));
      return out;
    });
    return { ...op, d, alpha };
  });
}
