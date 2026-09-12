// Lawn -> SVG string. Pure: no DOM, no dependencies. Runs in node (the GitHub
// Action) and in the browser (the download buttons and the live preview).
//
// This is a port of src/render2d's drawTile / drawGrass / mower, so the picture
// in a README and the board on the site are the same drawing. Nothing shared is
// duplicated here: src/core/board.js owns the geometry, and palette.js runs
// every colour rule (tileColor, bladeColor, cellTint, grassFor) on the theme's
// own ramp, so light and dark both follow the site.

import {
  MONTH_NAMES, SEASON_GLYPH, SEASON_OF_MONTH, seasonIndexOfCol, periodLabel, rng, hash,
} from '../core/lawn.js';
import { GEOM } from '../core/board.js';
import { planRoute, spanLength } from '../core/route.js';
import { Z, grassOps } from '../core/grass.js';
import {
  ORANGE, CREAM, SUN, PETAL, DANDELION, NO_SEASON, tileColor, mix, stripe,
} from '../core/palette.js';
import { themeFor } from './themes.js';
import { PATRICK_HAND_WOFF2_B64, FONT_STACK } from './font.js';

const { CELL, GAP, PITCH, OX, OY } = GEOM;

// --- small helpers --------------------------------------------------------

/** Two decimals, no trailing zeros, no "-0". Keeps the output deterministic. */
function n2(v) {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function commas(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function circleD(cx, cy, r) {
  return `M${n2(cx - r)} ${n2(cy)}a${n2(r)} ${n2(r)} 0 1 0 ${n2(r * 2)} 0`
    + `a${n2(r)} ${n2(r)} 0 1 0 ${n2(-r * 2)} 0Z`;
}

function lineD(x1, y1, x2, y2) {
  return `M${n2(x1)} ${n2(y1)}L${n2(x2)} ${n2(y2)}`;
}

/** Rounded rect as a path, so the mower can be one <g> of <path>s. */
function boxD(x, y, w, h, r) {
  return `M${n2(x + r)} ${n2(y)}H${n2(x + w - r)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(x + w)} ${n2(y + r)}`
    + `V${n2(y + h - r)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(x + w - r)} ${n2(y + h)}`
    + `H${n2(x + r)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(x)} ${n2(y + h - r)}`
    + `V${n2(y + r)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(x + r)} ${n2(y)}Z`;
}

// --- options --------------------------------------------------------------

function defaultCaption(lawn, user) {
  const head = user ? '@' + user + ' - ' : '';
  return head + commas(lawn.totalContributions) + ' contributions ' + periodLabel(lawn);
}

/**
 * What goes behind the board: 'none', 'canvas' (the theme's own ground) or
 * 'paper' (the site's cream sheet). Transparent is the default because the
 * picture's home is a README, and a filled rectangle is only ever right for one
 * GitHub theme: dimmed, high-contrast and every third-party host get a beige or
 * white box around the lawn instead. The old booleans still mean what they
 * meant - `true` was the filled rectangle, `false` was transparent - so an
 * existing caller keeps its picture.
 */
function backgroundMode(v) {
  if (v === true) return 'canvas';
  if (v === undefined || v === null || v === false) return 'none';
  const s = String(v);
  return s === 'canvas' || s === 'paper' ? s : 'none';
}

function normalize(lawn, opts) {
  const o = opts || {};
  const cols = lawn.cols;
  const rows = lawn.rows;
  const asIs = o.mowed === 'as-is';
  const frac = asIs || o.mowed == null
    ? 0.5 : Math.max(0, Math.min(1, Number(o.mowed) || 0));

  // "mowed for export": the first k cells in row-major order (Sun..Sat top to
  // bottom, left to right within a row), which is the order you actually mow in.
  const k = asIs ? -1 : Math.round(frac * cols * rows);
  const progress = asIs ? lawn.mowed : k;

  return {
    theme: themeFor(o.theme),
    asIs,
    k,
    // a junk seed would make every jitter NaN and every route cost NaN, and the
    // seed can come off a query string, so it is checked rather than trusted
    seed: o.seed != null && Number.isFinite(Number(o.seed)) ? Number(o.seed) : 7,
    animate: !!o.animate,
    // both default on: the picture is a doodle lawn first, a chart second
    weather: o.weather === undefined ? true : !!o.weather,
    background: backgroundMode(o.background),
    user: o.user || '',
    caption: o.caption === null ? null
      : (o.caption ? String(o.caption) : defaultCaption(lawn, o.user || '')),
    // the animation is the mower driving, so it is never parked off the picture
    mower: o.animate ? true : (o.mower === undefined ? progress > 0 : !!o.mower),
  };
}

// --- the drawing ----------------------------------------------------------

const tileX = (col) => OX + col * PITCH;
const tileY = (row) => OY + row * PITCH;
const px = (x) => OX + x * PITCH - GAP / 2;
const py = (z) => OY + z * PITCH - GAP / 2;

/**
 * One day's grass, as the ops src/core/grass.js hands back. The canvas replays
 * the same list; this file turns it into path data. `mowed` is whether this
 * picture shows the day cut, which is not `cell.mowed`: see `mowedFor` below,
 * and a cut day grows nothing, because the clean GitHub tile is the point.
 */
function cellOps(cell, x, y, mowed, season, theme, o, scale) {
  if (cell.void || !cell.level) return [];
  const rnd = rng((cell.col * 31 + cell.row * 7) * 131 + o.seed * 131 + 1);
  rnd(); rnd();                                       // render2d skips two here
  return grassOps(cell, x, y, season, {
    rnd, ramp: theme, scale, mowT: mowed ? 1 : 0,
  });
}

/** Grass is jitter: one decimal is under a tenth of a pixel and half the bytes. */
function n1(v) {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
}

/** An ellipse as path data, so an op of any kind can join a batched <path>. */
function ovalD(cx, cy, rx, ry) {
  return `M${n1(cx - rx)} ${n1(cy)}a${n1(rx)} ${n1(ry)} 0 1 0 ${n1(rx * 2)} 0`
    + `a${n1(rx)} ${n1(ry)} 0 1 0 ${n1(-rx * 2)} 0Z`;
}

function opD(op) {
  if (op.t === 'oval') return ovalD(op.x, op.y, op.rx, op.ry);
  let d = '';
  for (const seg of op.d) {
    if (seg[0] === 'Z') { d += 'Z'; continue; }
    d += seg[0] + n1(seg[1]) + ' ' + n1(seg[2]);
    if (seg.length > 3) d += ' ' + n1(seg[3]) + ' ' + n1(seg[4]);
  }
  return d;
}

/** Ops that share a fill, a stroke and a width can be one <path>. */
const opKey = (op) => `${op.fill || ''}|${op.stroke || ''}|${op.w || 0}`;

function opAttrs(key) {
  const [fill, stroke, w] = key.split('|');
  return `fill="${fill || 'none'}"`
    + (stroke && Number(w) > 0 ? ` stroke="${stroke}" stroke-width="${w}"` : '');
}

/**
 * A run of cells' ops, one layer at a time, each layer batched by colour: the
 * exact order render2d paints a row in, so the ink stacks the same way.
 */
function opsToPaths(list) {
  const out = [];
  for (let z = Z.SHADOW; z <= Z.ACCENT; z++) {
    const bag = new Map();
    for (const ops of list) {
      for (const op of ops) if (op.z === z) push(bag, opKey(op), opD(op));
    }
    if (bag.size) out.push(batched(bag, opAttrs));
  }
  return out.join('');
}

function push(map, key, d) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(d);
}

function batched(map, attrsFor) {
  const out = [];
  for (const [key, ds] of map) out.push(`<path ${attrsFor(key)} d="${ds.join('')}"/>`);
  return out.join('');
}

/**
 * The riding mower, in its own local space. Port of render2d's mower().
 * With `fx` (the loop timing) the blade spins and the exhaust and clippings
 * from mowerFx ride along; without it, the still.
 */
function mowerGroup(theme, fx = null) {
  const ink = theme.ink;
  const p = [];
  const el = (d, fill, sw) =>
    p.push(`<path d="${d}" fill="${fill}"${sw ? ` stroke="${ink}" stroke-width="${sw}"` : ''}/>`);
  const ellipse = (cx, cy, rx, ry, fill, sw) =>
    p.push(`<ellipse cx="${n2(cx)}" cy="${n2(cy)}" rx="${n2(rx)}" ry="${n2(ry)}" fill="${fill}"`
      + `${sw ? ` stroke="${ink}" stroke-width="${sw}"` : ''}/>`);

  // cutting deck, wider than the body, with the discharge chute on the right
  el(boxD(0, -9.5, 12, 19, 3), '#615F58', 1.4);
  el('M5 9L10 9L13 14.5L7 14.5Z', '#3A3A38', 1.4);
  // blade inside the deck: frozen at spin 0 in the still, spinning on the loop
  const blade = [];
  for (const o of [0, 1.57]) {
    blade.push(lineD(6 + Math.cos(o) * 6.5, Math.sin(o) * 6.5,
      6 - Math.cos(o) * 6.5, -Math.sin(o) * 6.5));
  }
  const spin = fx
    ? `<animateTransform attributeName="transform" type="rotate" values="0 6 0;360 6 0"`
      + ` keyTimes="0;1" dur="0.3s" repeatCount="indefinite"/>`
    : '';
  p.push(`<path d="${blade.join('')}" fill="none" stroke="#B8B6AE" stroke-width="1.4">`
    + `${spin}</path>`);

  // front wheels
  for (const s of [-1, 1]) ellipse(5.5, s * 8, 2.6, 1.7, '#33332F', 1);

  // hood, grille, headlights
  el(boxD(-4.5, -6.5, 12, 13, 3.5), ORANGE, 1.5);
  el(boxD(5.6, -4.5, 1.8, 9, 0.8), '#2C2C2A', 0);
  for (const s of [-1, 1]) el(circleD(4.4, s * 5, 1.2), CREAM, 0.8);

  // rear body
  el(boxD(-13, -7.5, 9, 15, 3), '#C24E27', 1.5);

  // rear wheels: tyre, treads, cream hub
  for (const s of [-1, 1]) {
    ellipse(-9, s * 9.5, 4.8, 3, '#2C2C2A', 1.2);
    const tread = [];
    for (let t = -3; t <= 3; t++) {
      tread.push(lineD(-9 + t * 1.4, s * 9.5 - 2.4, -9 + t * 1.4, s * 9.5 + 2.4));
    }
    p.push(`<path d="${tread.join('')}" fill="none" stroke="#55534E" stroke-width="1"/>`);
    ellipse(-9, s * 9.5, 1.5, 1.1, CREAM, 0.8);
  }

  // steering wheel on its column
  p.push(`<ellipse cx="-1.5" cy="0" rx="3.2" ry="3.2" fill="none"`
    + ` stroke="${ink}" stroke-width="1.3"/>`);
  p.push(`<path d="${lineD(-4.4, 0, 1.4, 0)}" fill="none" stroke="${ink}" stroke-width="1.3"/>`);

  // seat, driver, arms reaching the wheel
  el(boxD(-12.5, -4.5, 7, 9, 2), '#3A3A38', 1.2);
  ellipse(-7.6, 0, 3.2, 4.4, '#5C8F3A', 1.3);
  const arms = [];
  for (const s of [-1, 1]) {
    arms.push(`M-6.4 ${n2(s * 3.2)}Q-4.2 ${n2(s * 3.6)} -1.8 ${n2(s * 2.6)}`);
  }
  p.push(`<path d="${arms.join('')}" fill="none" stroke="${ink}" stroke-width="1.5"/>`);

  // head, then the cap on top of it
  el(circleD(-6.6, 0, 3), '#F5C4B3', 1.3);
  const a0 = -1.9, a1 = 1.9, r = 3;
  const cap = `M${n2(-6.6 + r * Math.cos(a0))} ${n2(r * Math.sin(a0))}`
    + `A${r} ${r} 0 1 1 ${n2(-6.6 + r * Math.cos(a1))} ${n2(r * Math.sin(a1))}Z`;
  el(cap, ORANGE, 1.1);
  p.push(`<path d="${circleD(-4.6, -1.1, 0.6)}${circleD(-4.6, 1.1, 0.6)}" fill="${ink}"/>`);

  // the marks come first so the tractor is drawn over them
  return `<g stroke-linejoin="round" stroke-linecap="round">`
    + `${fx ? mowerFx(fx, theme) : ''}${p.join('')}</g>`;
}

// --- the whole picture ----------------------------------------------------

/**
 * Render a lawn as a standalone SVG document string.
 *
 * @param lawn  from createLawn(); never mutated.
 * @param opts  {theme, mowed, mower, animate, weather, background, caption, user, seed}
 *   theme      'light' (default) | 'dark'
 *   mowed      'as-is' to use cell.mowed, or a 0..1 fraction (default 0.5).
 *              Ignored under `animate`: the loop always starts fully grown.
 *   mower      draw the mower (default: whenever anything is mowed)
 *   animate    SMIL: the mower drives the whole year on a wandering route,
 *              then the lawn regrows and the loop restarts
 *   weather    seasons: glyphs, frost, flakes, leaves, flowers, the climate bed
 *              and the season tint on the greens. Off gives GitHub's exact ramp.
 *   background what is behind the board: 'none' (default, transparent, so the
 *              picture takes the colour of whatever it lands on), 'canvas'
 *              (theme.paper: GitHub's white or #0D1117) or 'paper' (the cream
 *              sheet). `true` means 'canvas' and `false` 'none', as before.
 *   caption    string, or null for none (default: "<n> contributions in <when>")
 *   user       github login, prefixes the caption with "@user - "
 *   seed       jitter seed for the blades and the route (default 7)
 */
export function lawnToSvg(lawn, opts) {
  const o = normalize(lawn, opts);
  const theme = o.theme;
  const cols = lawn.cols;
  const rows = lawn.rows;
  const W = GEOM.OX + cols * PITCH + GEOM.PAD_R;
  const H = GEOM.OY + rows * PITCH + GEOM.PAD_B;
  const gw = cols * PITCH - GAP;
  // seasons are what `weather=0` switches off, so every season index in the
  // picture comes through here and nothing else has to know about the flag
  const seasonOf = (col) => (o.weather ? seasonIndexOfCol(lawn, col) : NO_SEASON);

  // The animated loop mows the whole year, so every grown day is drawn cut and
  // gets an overgrown cover on top that fades when the mower reaches it.
  const route = o.animate && lawn.mowable > 0 ? planRoute(lawn, o.seed) : null;

  const mowedX = mowedFor(lawn, o, route, cols);

  const parts = [];

  // 1. the ground, if any. Nothing is the default: the lawn then sits straight
  // on whatever is behind it, which on a README is GitHub's own canvas in
  // whatever theme the reader chose.
  const ground = o.background === 'canvas' ? theme.paper
    : o.background === 'paper' ? theme.sheet : '';
  if (ground) parts.push(`<rect width="100%" height="100%" fill="${ground}"/>`);

  // 2. caption
  if (o.caption) {
    parts.push(`<text x="${GEOM.CAPTION_X}" y="${GEOM.CAPTION_Y}" font-size="${GEOM.CAPTION_SIZE}"`
      + ` fill="${theme.pencil}">${esc(o.caption)}</text>`);
  }

  // 3. month labels, GitHub's rule: skip a month that owns fewer than 3 columns.
  // The first month of a season carries the same little doodle the canvas draws.
  const months = [];
  const glyphs = [];
  let lastSeason = -1;
  for (const ms of lawn.monthStarts) {
    if (ms.span < 3) continue;
    const name = MONTH_NAMES[ms.month].slice(0, 3);
    const lx = tileX(ms.col);
    months.push(`<text x="${n2(lx)}" y="${n2(OY + GEOM.MONTH_DY)}">${name}</text>`);
    const sn = SEASON_OF_MONTH[ms.month];
    if (o.weather && sn !== lastSeason) {
      glyphs.push(seasonGlyph(lx + name.length * GEOM.MONTH_SIZE * 0.42 + 12,
        OY + GEOM.GLYPH_DY, sn, theme));
      lastSeason = sn;
    }
  }
  parts.push(`<g id="months" font-size="${GEOM.MONTH_SIZE}" fill="${theme.pencil}">`
    + `${months.join('')}</g>`);
  if (glyphs.length) parts.push(`<g id="glyphs">${glyphs.join('')}</g>`);

  // 4. fence ticks + the rule they hang from
  const fence = [];
  for (let f = 0; f <= gw / GEOM.FENCE_STEP; f++) {
    const x = OX + f * GEOM.FENCE_STEP;
    fence.push(lineD(x, OY + GEOM.FENCE_TOP, x, OY + GEOM.FENCE_BOT));
  }
  fence.push(lineD(OX, OY + GEOM.FENCE_RULE, OX + gw, OY + GEOM.FENCE_RULE));
  parts.push(`<path id="fence" d="${fence.join('')}" fill="none" stroke="${theme.pencil}"`
    + ` stroke-width="${GEOM.FENCE_W}"/>`);

  // 5. dirt bed under the tiles, coloured by the climate of each column
  parts.push(bed(lawn, theme, gw, rows, o.weather));

  // 6. tiles
  const tiles = [];
  const caps = [];
  const cuts = [];
  for (let i = 0; i < lawn.cells.length; i++) {
    const c = lawn.cells[i];
    if (c.void) continue;
    const season = seasonOf(c.col);
    const x = tileX(c.col);
    const y = tileY(c.row);
    tiles.push(tileRect(c, x, y, season, theme, mowedX[i]));
    caps.push(frostCap(c, x, y, season, mowedX[i]));
    if (mowedX[i] && c.level > 0) {
      cuts.push(lineD(x + 2, y + 6, x + CELL - 2, y + 6));
      cuts.push(lineD(x + 2, y + 11, x + CELL - 2, y + 11));
    }
  }
  parts.push(`<g id="tiles">${tiles.join('')}</g>`);
  if (caps.some(Boolean)) parts.push(`<g id="frost">${caps.join('')}</g>`);
  if (cuts.length) {
    parts.push(`<path id="cuts" d="${cuts.join('')}" fill="none" stroke="#FFFFFF"`
      + ` stroke-opacity="0.24" stroke-width="1"/>`);
  }

  // 7. grass, a row at a time and a layer at a time, batched by colour: a
  //    hedge overlaps the row above it, so the rows have to stay in order
  const rowOps = Array.from({ length: rows }, () => []);
  for (let i = 0; i < lawn.cells.length; i++) {
    const c = lawn.cells[i];
    if (c.void || !c.level || mowedX[i]) continue;
    rowOps[c.row].push(
      cellOps(c, tileX(c.col), tileY(c.row), false, seasonOf(c.col), theme, o, 1),
    );
  }
  const grass = rowOps.map(opsToPaths).join('');
  parts.push(`<g id="grass" stroke-linecap="round" stroke-linejoin="round">${grass}</g>`);

  // 8. dressing: pebbles on bare dirt, snowflakes and fallen leaves
  parts.push(`<g id="dressing">${dressing(lawn, theme, o, seasonOf)}</g>`);

  // 8a. the tyre tracks the animated mower leaves, under the grass it cuts
  const timing = route ? loopTiming(route) : null;
  if (route) parts.push(trackLayer(route, timing, theme, W, H));

  // 8b. the overgrown lawn the animated mower cuts away, cell by cell
  if (route) parts.push(coverGroup(lawn, theme, o, route, timing, seasonOf));

  // 9. mower. The outer <g> parks it: the still position, or the start of the
  // route, which is also the fallback for anything that ignores SMIL.
  if (o.mower) {
    const m = route ? routeStart(route) : mowerAt(lawn, o, cols, rows);
    // under animateMotion the heading comes from rotate="auto", so the art
    // group carries the scale and nothing else
    const art = `<g transform="${route ? '' : `rotate(${n2(m.deg)}) `}`
      + `scale(${GEOM.MOWER_SCALE})">` + mowerGroup(theme, route ? timing : null) + `</g>`;
    if (!route) {
      parts.push(`<g id="mower" transform="translate(${n2(m.x)},${n2(m.y)})">${art}</g>`);
    } else {
      // animateMotion's matrix wraps *around* the element's own transform, so
      // rotate="auto" would swing the parked translate about the page origin.
      // The driven <g> therefore owns no transform: its parent parks it, the
      // path is relative to that, and rotate="auto" turns it in place. Right,
      // because the mower art faces +x. The keys are the loop's clock: slower
      // through the U-turns, then held off the right edge for the last stretch
      // of the loop, the pause before everything regrows.
      const drive = `<animateMotion dur="${n2(timing.dur)}s" repeatCount="indefinite"`
        + ` rotate="auto" calcMode="linear" keyPoints="${timing.keyPoints}"`
        + ` keyTimes="${timing.keyTimes}" path="${motionPath(route, m)}"/>`;
      parts.push(`<g id="mower" transform="translate(${n2(m.x)},${n2(m.y)})">`
        + `<g>${drive}${art}</g></g>`);
    }
  }

  // 10. Mon / Wed / Fri, with a halo of the ground so nothing can hide them
  const labels = ['Mon', 'Wed', 'Fri'].map((d, i) => {
    const y = tileY(1 + i * 2) + CELL / 2 + 1 + GEOM.LABEL_SIZE * 0.35;
    return `<text x="${GEOM.LABEL_X}" y="${n2(y)}">${d}</text>`;
  });
  // No ground means nothing to halo against, so the stroke goes with it: the
  // mower drives behind the letters for a few frames, which is nothing next to
  // painting three wrong-coloured boxes on somebody else's theme.
  const halo = ground
    ? ` stroke="${ground}" stroke-width="4" paint-order="stroke"` : '';
  parts.push(`<g id="labels" font-size="${GEOM.LABEL_SIZE}" fill="${theme.pencil}"`
    + `${halo}>${labels.join('')}</g>`);

  // 11. legend
  parts.push(legend(lawn, theme, o));

  const label = (o.caption || defaultCaption(lawn, o.user))
    + (route ? ' - a GitHub contribution graph drawn as a lawn being mowed'
      : ' - a GitHub contribution graph drawn as a half-mowed lawn');
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"`
    + ` width="${W}" height="${H}" role="img" aria-label="${esc(label)}">`
    + `<title>${esc(o.caption || label)}</title>`
    + `<style>@font-face{font-family:'Patrick Hand';font-style:normal;font-weight:400;`
    + `src:url(data:font/woff2;base64,${PATRICK_HAND_WOFF2_B64}) format('woff2')}`
    + `text{font-family:${FONT_STACK}}</style>`;

  return head + parts.join('') + '</svg>';
}

/**
 * Which cells read as mowed in this picture, by cell index. Not `cell.mowed`:
 * a still is cut to a fraction in row-major order, and the animation draws the
 * whole year cut and puts the overgrown covers back on top. Kept here rather
 * than stamped on the cells, so the lawn handed in is never touched.
 */
function mowedFor(lawn, o, route, cols) {
  const out = new Uint8Array(lawn.cells.length);
  for (let i = 0; i < lawn.cells.length; i++) {
    const c = lawn.cells[i];
    const mowed = c.void || c.level === 0 ? true
      : route ? true
        : o.asIs ? !!c.mowed
          : (c.row * cols + c.col) < o.k;
    out[i] = mowed ? 1 : 0;
  }
  return out;
}

/**
 * The bed the tiles sit in, coloured by climate: cold grey soil under the
 * winter columns, warm brown under summer, blending one column either side of
 * a season change. Port of render2d's drawBed().
 */
function bed(lawn, theme, gw, rows, weather) {
  const bi = GEOM.BED_INSET;
  const x0 = OX - bi, y0 = OY - bi;
  const w = gw + bi * 2, h = rows * PITCH - GAP + bi * 2;
  const soil = (sn) => mix(theme.soil[sn], theme.paper, 0.58);
  const bands = [];
  if (!weather) {
    // no weather means no climate: one neutral bed, the summer soil
    bands.push(`<rect x="${n2(x0)}" y="${n2(y0)}" width="${n2(w)}" height="${n2(h)}"`
      + ` fill="${soil(2)}"/>`);
  } else {
    for (let c = 0; c < lawn.cols; c++) {
      const sn = seasonIndexOfCol(lawn, c);
      const prev = seasonIndexOfCol(lawn, Math.max(0, c - 1));
      const bx = c === 0 ? x0 : tileX(c) - GAP / 2;
      const bw = (c === lawn.cols - 1 ? x0 + w : tileX(c + 1) - GAP / 2) - bx;
      bands.push(`<rect x="${n2(bx)}" y="${n2(y0)}" width="${n2(bw)}" height="${n2(h)}"`
        + ` fill="${prev === sn ? soil(sn) : mix(soil(prev), soil(sn), 0.5)}"/>`);
    }
  }
  const round = `<rect x="${n2(x0)}" y="${n2(y0)}" width="${n2(w)}" height="${n2(h)}"`
    + ` rx="${GEOM.BED_R}"`;
  return `<clipPath id="bedclip">${round}/></clipPath>`
    + `<g id="bed" clip-path="url(#bedclip)">${bands.join('')}`
    // the tiles are set into the bed, so the top edge catches a shadow
    + `<rect x="${n2(x0)}" y="${n2(y0)}" width="${n2(w)}" height="2"`
    + ` fill="rgba(${theme.inkRgb},0.08)"/></g>`
    + round + ` fill="none" stroke="${theme.ink}" stroke-width="${GEOM.BED_W}"/>`;
}

/** The 10px doodle for a season, over the first month that belongs to it. */
function seasonGlyph(x, y, season, theme) {
  const kind = SEASON_GLYPH[season];
  if (kind === 'snow') {
    const d = [];
    for (let k = 0; k < 3; k++) {
      const a = k * 1.047 + 0.3;
      d.push(lineD(x - Math.cos(a) * 4, y - Math.sin(a) * 4,
        x + Math.cos(a) * 4, y + Math.sin(a) * 4));
    }
    return `<path d="${d.join('')}" fill="none" stroke="#85B7EB" stroke-width="1.1"/>`;
  }
  if (kind === 'flower') {
    let out = '';
    for (let k = 0; k < 5; k++) {
      const a = k * 1.257;
      out += `<path d="${circleD(x + Math.cos(a) * 2.8, y + Math.sin(a) * 2.8, 1.6)}"`
        + ` fill="${PETAL[k % 2]}"/>`;
    }
    return out + `<path d="${circleD(x, y, 1.5)}" fill="${DANDELION}"/>`;
  }
  if (kind === 'sun') {
    const rays = [];
    for (let k = 0; k < 8; k++) {
      const a = k * 0.785;
      rays.push(lineD(x + Math.cos(a) * 5, y + Math.sin(a) * 5,
        x + Math.cos(a) * 7, y + Math.sin(a) * 7));
    }
    return `<path d="${circleD(x, y, 4)}" fill="${SUN}"/>`
      + `<path d="${rays.join('')}" fill="none" stroke="${theme.ink}" stroke-width="0.9"/>`;
  }
  return `<ellipse cx="${n2(x)}" cy="${n2(y)}" rx="6" ry="3.5" fill="${ORANGE}"`
    + ` transform="rotate(-22.92 ${n2(x)} ${n2(y)})"/>`
    + `<path d="${lineD(x - 5, y + 1.4, x + 5, y - 1.4)}" fill="none"`
    + ` stroke="${theme.ink}" stroke-width="1"/>`;
}

function tileRect(cell, x, y, season, theme, mowed) {
  const under = tileColor(cell.level, season, false, cell.vigor || 0, theme);
  const over = tileColor(cell.level, season, true, 0, theme);
  let fill = cell.level === 0 ? under : (mowed ? over : under);
  if (mowed && cell.level > 0 && cell.col % 2 === 0) fill = mix(fill, stripe(fill), 0.75);
  // the canvas wobbles every vertex; a whole-tile tilt is the cheap equivalent
  return `<rect x="${n2(x)}" y="${n2(y)}" width="${CELL}" height="${CELL}" rx="${GEOM.R}"`
    + ` fill="${fill}" stroke="rgba(${theme.inkRgb},${cell.level === 0 ? 0.3 : 0.22})"`
    + ` stroke-width="1"${tilt(cell, x, y)}/>`;
}

/** The per-tile doodle tilt, shared by the tile and its frost cap. */
function tilt(cell, x, y) {
  const rot = hash(cell.col * 31 + cell.row * 7) * 1.4 - 0.7;
  return ` transform="rotate(${n2(rot)} ${n2(x + CELL / 2)} ${n2(y + CELL / 2)})"`;
}

/** Winter: snow settles along the top edge instead of washing the whole tile. */
function frostCap(cell, x, y, season, mowed) {
  if (season !== 0 || mowed || cell.level === 0 || cell.void) return '';
  return `<rect x="${n2(x + 1.5)}" y="${n2(y + 1)}" width="${CELL - 3}" height="2.5"`
    + ` fill="#FFFFFF" fill-opacity="0.34"${tilt(cell, x, y)}/>`;
}

/** Pebbles on bare dirt + the seasonal dressing render2d scatters on level 0. */
function dressing(lawn, theme, o, seasonOf) {
  const out = [];
  const pebbles = [];
  const flakes = [];
  const leaves = [];
  for (const c of lawn.cells) {
    if (c.void) continue;
    if (c.level === 0) {
      const rnd = rng((c.col * 31 + c.row * 7) * 131 + o.seed * 131 + 1);
      const x = tileX(c.col);
      const y = tileY(c.row);
      // pebbles are doodle dressing on bare dirt; the plain chart has none
      if (o.weather) {
        for (let p = 0; p < 2; p++) {
          pebbles.push(circleD(x + 4 + rnd() * 8, y + 5 + rnd() * 7, 0.9));
        }
      }
      const s = seasonOf(c.col);
      if ((s === 0 || s === 3) && (c.col * 7 + c.row * 3) % 5 === 0) {
        const cx = x + CELL / 2;
        const cy = y + CELL / 2;
        if (s === 0) {
          flakes.push(lineD(cx - 3, cy, cx + 3, cy), lineD(cx, cy - 3, cx, cy + 3));
        } else {
          leaves.push(`<ellipse cx="${n2(cx)}" cy="${n2(cy)}" rx="2.6" ry="1.6"`
            + ` transform="rotate(34.38 ${n2(cx)} ${n2(cy)})"/>`);
        }
      }
    }
  }
  if (pebbles.length) out.push(`<path d="${pebbles.join('')}" fill="rgba(${theme.inkRgb},0.28)"/>`);
  if (flakes.length) {
    out.push(`<path d="${flakes.join('')}" fill="none" stroke="#85B7EB" stroke-width="1"/>`);
  }
  if (leaves.length) out.push(`<g fill="${ORANGE}">${leaves.join('')}</g>`);
  return out.join('');
}

/** The drive, in cells per second: down a pass, and round a U-turn. */
const SPEED = 9;
const TURN_SPEED = 5.5;
/** The pause parked off the right edge, in seconds. */
const HOLD = 1.6;
/** How long a tuft takes to vanish once the blade reaches it, as a fraction. */
const SNAP = 0.004;
/** Four decimals: what every keyTimes/keyPoints in the picture is written to. */
const f4 = (v) => v.toFixed(4);

/**
 * One loop: drive the whole route, then hold off the edge while the year
 * regrows. The drive is a chain of legs (a pass, a U-turn, a pass...) that
 * the mower takes at two speeds, so the loop's clock is piecewise linear in
 * arc length. `keyPoints`/`keyTimes` spell that clock out for animateMotion;
 * `at()` runs a cut's arc length through the same clock, so a tuft vanishes
 * on the frame the drawn mower reaches it and the tracks reveal in step.
 * `drive` is where the driving ends, as a fraction of the loop.
 */
function loopTiming(route) {
  const legs = [];
  for (const sp of route.curve) {
    const len = spanLength(sp);
    const last = legs[legs.length - 1];
    if (last && last.kind === sp.kind) last.len += len;
    else legs.push({ kind: sp.kind, len });
  }
  const total = legs.reduce((s, l) => s + l.len, 0);
  const secs = (l) => l.len / (l.kind === 'turn' ? TURN_SPEED : SPEED);
  const dur = legs.reduce((s, l) => s + secs(l), 0) + HOLD;
  const arcs = [0];
  const times = [0];
  let s = 0;
  let t = 0;
  for (const l of legs) {
    s += l.len;
    t += secs(l);
    arcs.push(s / total);
    times.push(t / dur);
  }
  // the keys are what the SVG carries, so the clock is read back off the
  // rounded values: a cut must not land a hair past the key it belongs to
  const kp = arcs.map((v) => Number(f4(v)));
  const kt = times.map((v) => Number(f4(v)));
  kp[kp.length - 1] = 1;
  const drive = kt[kt.length - 1];
  const at = (arc) => {
    const f = Math.min(1, Math.max(0, arc / route.length));
    let i = 1;
    while (i < kp.length - 1 && kp[i] < f) i++;
    const u = (f - kp[i - 1]) / ((kp[i] - kp[i - 1]) || 1);
    return kt[i - 1] + u * (kt[i] - kt[i - 1]);
  };
  return {
    dur, drive, at,
    // arc length in cells at every key, for anything measured along the path
    cells: kp.map((f) => f * route.length),
    keyPoints: [...kp.map(f4), '1'].join(';'),
    keyTimes: [...kt.map(f4), '1'].join(';'),
  };
}

/**
 * Twin tyre tracks, the way render2d draws them: under the grass, so they
 * only show where the lawn has been cut, and fading out behind the mower.
 * One centreline path does both tyres: through a luminance mask, a wide white
 * stroke minus a narrower black one leaves the two edges, which stay in step
 * through every turn (offset polylines would not: the inner tyre's path is
 * shorter). The reveal is a dash window sliding along that path on the loop's
 * clock; three nested windows step the tail down like the game's fade.
 */
// Half the track and the tyre width, in page px. Narrower than the drawn rear
// wheels on purpose, as in the game: the real wheel track is wider than a tile
// row, and a tyre mark under the next row's uncut grass is a tyre mark nobody
// sees. This pair stays on the tile through the weave.
const TYRE_X = 6;
const TYRE_W = 2.4;
const TRACK_WINDOWS = [16, 10, 5];   // cells behind the mower, longest first
function trackLayer(route, timing, theme, W, H) {
  const wide = n2(TYRE_X * 2 + TYRE_W);
  const gap = n2(TYRE_X * 2 - TYRE_W);
  const L = route.length;
  // longest window first and darkest, each shorter one painted over it
  // brighter: the luminance steps up toward the mower. Solid greys rather
  // than translucent white, and sRGB rather than the linearRGB default, or a
  // mid grey reads as a tenth of itself and the tracks vanish.
  const greys = ['#555', '#AAA', '#FFF'];
  const windows = TRACK_WINDOWS.map((w, i) => {
    // dashoffset w hides the dash before the start; w - s slides it to s
    const values = [...timing.cells.map((s) => n2(w - s)), n2(w - L)].join(';');
    return `<g fill="none" stroke="${greys[i]}" stroke-width="${wide}"`
      + ` stroke-dasharray="${w} ${n2(L + w)}" stroke-dashoffset="${w}"><use href="#drive"/>`
      + `<animate attributeName="stroke-dashoffset" values="${values}"`
      + ` keyTimes="${timing.keyTimes}" dur="${n2(timing.dur)}s" repeatCount="indefinite"/></g>`;
  });
  return `<defs><path id="drive" d="${motionPath(route, { x: 0, y: 0 })}" pathLength="${n2(L)}"/>`
    + `<mask id="ruts" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"`
    + ` color-interpolation="sRGB">`
    + windows.join('')
    + `<use href="#drive" fill="none" stroke="#000" stroke-width="${gap}"/></mask></defs>`
    + `<rect id="tracks" width="${W}" height="${H}" fill="rgba(${theme.inkRgb},0.16)"`
    + ` mask="url(#ruts)" clip-path="url(#bedclip)"/>`;
}

/**
 * What the game leaves in the air around a moving mower, in the mower's own
 * space so it rides along: exhaust puffs off the back left, clippings out of
 * the chute on the right. Everything starts invisible (a renderer that
 * ignores SMIL sees a clean tractor) and the whole lot is gated off while the
 * mower is parked off the edge.
 */
function mowerFx(timing, theme) {
  const loop = (attr, values, keyTimes, dur, begin) =>
    `<animate attributeName="${attr}" values="${values}" keyTimes="${keyTimes}"`
    + ` dur="${dur}s"${begin ? ` begin="${begin}s"` : ''} repeatCount="indefinite"/>`;
  const rnd = rng(11);
  const puffs = [];
  for (let i = 0; i < 3; i++) {
    const begin = n2(i * 0.23);
    puffs.push(`<circle cx="-12" cy="-6" r="1.6" fill="#8C8A84" opacity="0">`
      + loop('cx', '-12;-104', '0;1', 0.7, begin)
      + loop('r', '1.6;7', '0;1', 0.7, begin)
      + loop('opacity', '0.42;0', '0;1', 0.7, begin) + '</circle>');
  }
  const clippings = [];
  for (let i = 0; i < 5; i++) {
    const begin = n2(i * 0.1);
    const x = n2(-14 - rnd() * 30);
    const y = n2(21 + rnd() * 12);
    const spin = n2(200 + rnd() * 200);
    const fill = theme.greens[2 + (i % 3)];
    clippings.push(`<g opacity="0"><rect x="-1.8" y="-1.3" width="3.6" height="2.6" fill="${fill}"/>`
      + `<animateTransform attributeName="transform" type="translate" values="10 13;${x} ${y}"`
      + ` keyTimes="0;1" dur="0.5s" begin="${begin}s" repeatCount="indefinite"/>`
      + `<animateTransform attributeName="transform" type="rotate" additive="sum"`
      + ` values="0;${spin}" keyTimes="0;1" dur="0.5s" begin="${begin}s" repeatCount="indefinite"/>`
      + loop('opacity', '1;1;0', '0;0.55;1', 0.5, begin) + '</g>');
  }
  const gate = loop('opacity', '1;1;0;0',
    `0;${f4(timing.drive)};${f4(timing.drive + 0.002)};1`, n2(timing.dur));
  return `<g opacity="1">${gate}${puffs.join('')}${clippings.join('')}</g>`;
}

/**
 * Every grown day is drawn cut underneath; this puts the overgrown version back
 * on top of it and fades each one out at the arc length where the route's blade
 * reaches it. At t=0 the whole year is grown, so the loop reads as
 * "regrow, mow, repeat". Static opacity is 1: a renderer that ignores SMIL gets
 * the uncut lawn, which is the honest still of an animation that starts there.
 */
function coverGroup(lawn, theme, o, route, timing, seasonOf) {
  const groups = [];
  for (let i = 0; i < lawn.cells.length; i++) {
    const c = lawn.cells[i];
    if (c.void || c.level === 0) continue;
    const season = seasonOf(c.col);
    const x = tileX(c.col);
    const y = tileY(c.row);
    const grown = {
      col: c.col, row: c.row, level: c.level, void: false,
      vigor: c.vigor || 0, heroic: c.heroic,
    };
    // planRoute guarantees a cut for every mowable cell, and the route always
    // starts off the board, so t is never 0. keyTimes still has to be strictly
    // increasing and end at exactly 1, so the snap that follows t must not
    // reach it: the last cell is cut a hair before the drive ends.
    const t = timing.at(route.cuts.get(i));
    const t2 = Math.min(t + SNAP, (1 + t) / 2);
    groups.push('<g>'
      + tileRect(c, x, y, season, theme, false)
      + frostCap(c, x, y, season, false)
      + opsToPaths([cellOps(grown, x, y, false, season, theme, o, 1)])
      + `<animate attributeName="opacity" values="1;1;0;0"`
      + ` keyTimes="0;${t.toFixed(4)};${t2.toFixed(4)};1"`
      + ` dur="${n2(timing.dur)}s" repeatCount="indefinite"/></g>`);
  }
  // one cover per cell means the ink cannot batch across cells, but the stroke
  // defaults can at least be said once for the whole layer instead of per cell
  return `<g id="cover" stroke-linecap="round" stroke-linejoin="round">`
    + `${groups.join('')}</g>`;
}

/**
 * Where the route begins, in page pixels. No heading: `rotate="auto"` takes
 * that off the path, and this point is off the picture anyway.
 */
function routeStart(route) {
  const a = route.waypoints[0];
  return { x: px(a.x), y: py(a.z) };
}

/**
 * The route as one `M0 0 C ...` path in page pixels, relative to the start:
 * animateMotion composes with the `transform` on the same element, so the
 * static translate doubles as the fallback position and the path must not
 * repeat it. One cubic per span, straight out of the planner.
 */
function motionPath(route, start) {
  const X = (x) => n2(px(x) - start.x);
  const Y = (z) => n2(py(z) - start.y);
  const first = route.curve[0].a;
  const out = [`M${X(first.x)} ${Y(first.z)}`];
  for (const sp of route.curve) {
    out.push(`C${X(sp.c1.x)} ${Y(sp.c1.z)} ${X(sp.c2.x)} ${Y(sp.c2.z)} ${X(sp.b.x)} ${Y(sp.b.z)}`);
  }
  return out.join('');
}

/** Where the mower parks, in page pixels + degrees. */
function mowerAt(lawn, o, cols, rows) {
  if (o.asIs) {
    return { x: px(lawn.mower.x), y: py(lawn.mower.z), deg: (lawn.mower.angle * 180) / Math.PI };
  }
  const total = cols * rows;
  if (o.k >= total) return { x: px(cols), y: py(rows - 0.5), deg: 0 };
  const col = o.k % cols;
  const row = Math.floor(o.k / cols);
  return { x: px(col), y: py(row + 0.5), deg: 0 };
}

/** "less [bare 1 2 3 4] more", bottom right: the canvas key, verbatim. */
function legend(lawn, theme, o) {
  const y = OY + lawn.rows * PITCH + GEOM.LEGEND_DY;
  const right = OX + lawn.cols * PITCH - GAP;
  const midY = y + CELL / 2 + 1 + GEOM.LEGEND_SIZE * 0.35;
  // the swatches sit on their own, wider pitch: a bush and a hedge spill
  const swatches = 4 * GEOM.LEGEND_PITCH + CELL;
  const x0 = right - GEOM.LEGEND_MORE_W - GEOM.LEGEND_GAP - swatches;

  const shapes = [];
  const tiles = [];
  // the key follows the same rule as the board: summer green, or no season
  const season = o.weather ? 2 : NO_SEASON;
  for (let l = 0; l <= 4; l++) {
    const x = x0 + l * GEOM.LEGEND_PITCH;
    // level 0 shows mowed, so the key opens on the bare tile the graph uses
    const fake = { col: l, row: 0, level: l, void: false, vigor: 0.5, heroic: false };
    tiles.push(tileRect(fake, x, y, season, theme, l === 0));
    shapes.push(cellOps(fake, x, y, l === 0, season, theme, o, GEOM.LEGEND_SCALE));
  }
  const text = (x, anchor, str) =>
    `<text x="${n2(x)}" y="${n2(midY)}" text-anchor="${anchor}"`
    + ` font-size="${GEOM.LEGEND_SIZE}" fill="${theme.pencil}">${str}</text>`;
  return `<g id="legend" stroke-linecap="round" stroke-linejoin="round">`
    + text(x0 - GEOM.LEGEND_GAP, 'end', 'less')
    + tiles.join('')
    + opsToPaths(shapes)
    + text(right, 'end', 'more')
    + `</g>`;
}
