// Lawn -> SVG string. Pure: no DOM, no dependencies. Runs in node (the GitHub
// Action) and in the browser (the download buttons and the live preview).
//
// This is a port of src/render2d's drawTile / drawGrass / mower, so the picture
// in a README and the board on the site are the same drawing. Two places keep
// that port honest and must be re-synced together when render2d changes:
//   GEOM   - every coordinate constant
//   BLADES / HEIGHT / SPREAD - the grass grammar
// Nothing else in this file hard-codes a number that render2d also owns.

import { MONTH_NAMES, seasonIndexOfCol } from '../core/lawn.js';
import {
  SEASON_TINT, WINTER_BLADE, AUTUMN_BLADE, FLOWERS, ORANGE, CREAM,
  mix, shade, stripe,
} from '../core/palette.js';
import { themeFor, OVERGROWN } from './themes.js';
import { PATRICK_HAND_WOFF2_B64, FONT_STACK } from './font.js';

/** Every coordinate render2d owns. Mirror of src/render2d/index.js. */
export const GEOM = {
  CELL: 16,
  GAP: 3,
  PITCH: 19,
  R: 3,
  OX: 48,
  OY: 58,
  PAD_R: 22,
  PAD_B: 66,
  // header
  CAPTION_X: 48,
  CAPTION_Y: 20,
  CAPTION_SIZE: 16,
  MONTH_SIZE: 16,
  MONTH_DY: -22,
  // fence above the grid
  FENCE_STEP: 14,
  FENCE_TOP: -16,
  FENCE_BOT: -9,
  FENCE_RULE: -12,
  FENCE_W: 1.1,
  // dirt bed
  BED_INSET: 5,
  BED_R: 8,
  BED_W: 1.6,
  // Mon / Wed / Fri
  LABEL_X: 4,
  LABEL_SIZE: 15,
  // legend
  LEGEND_DY: 28,
  LEGEND_SIZE: 15,
  LEGEND_GAP: 26,
  LEGEND_MORE_W: 31,   // Patrick Hand 15px, measured once; only affects spacing
  LEGEND_LESS_W: 26,
  LEGEND_SCALE: 1.3,
  // mower
  MOWER_SCALE: 1.25,
};

/** The grass grammar: blades per level and their height. Mirror of render2d. */
export const BLADES = [0, 3, 5, 7, 10];
export const HEIGHT = [0, 6, 10, 13, 17];
export const SPREAD = (level) => (level >= 3 ? GEOM.CELL * 0.68 : GEOM.CELL * 0.44);

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

/** The same 16807 LCG render2d uses, so blades jitter the same way. */
function rng(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** render2d's hash(), used for the per-tile doodle rotation. */
function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
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

// --- theme-aware colour rules (palette.js formulas, swappable ramp) --------

function levelGreen(theme, level, season) {
  const [tint, amt] = SEASON_TINT[season] || SEASON_TINT[2];
  if (level <= 0) return mix(theme.bare, tint, amt * 0.5);
  return mix(theme.greens[level], tint, amt);
}

function tileColor(theme, level, season, mowed) {
  const g = levelGreen(theme, level, season);
  if (mowed) return g;
  if (level <= 0) return season === 0 ? mix(g, theme.frost, 0.5) : g;
  const over = shade(mix(g, OVERGROWN, 0.34), 0.82);
  return season === 0 ? mix(over, theme.frost, 0.42) : over;
}

function bladeColor(theme, level, season) {
  if (season === 0) return WINTER_BLADE[level] || WINTER_BLADE[4];
  const g = levelGreen(theme, level, season);
  return mix(g, theme.ink, [0, 0.3, 0.15, 0.08, 0.06][level] || 0);
}

// --- options --------------------------------------------------------------

function defaultCaption(lawn, user) {
  const when = lawn.year == null ? 'in the last year' : 'in ' + lawn.year;
  const head = user ? '@' + user + ' - ' : '';
  return head + commas(lawn.totalContributions) + ' contributions ' + when;
}

function normalize(lawn, opts) {
  const o = opts || {};
  const cols = lawn.cols;
  const rows = lawn.rows;
  const asIs = o.mowed === 'as-is';
  let frac = 0.5;
  if (!asIs && o.mowed != null) frac = Math.max(0, Math.min(1, Number(o.mowed) || 0));

  // "mowed for export": the first k cells in row-major order (Sun..Sat top to
  // bottom, left to right within a row), which is the order you actually mow in.
  const k = asIs ? -1 : Math.round(frac * cols * rows);
  const progress = asIs ? lawn.mowed : k;

  return {
    theme: themeFor(o.theme),
    themeName: o.theme === 'dark' ? 'dark' : 'light',
    asIs,
    k,
    frac,
    seed: o.seed == null ? 7 : Number(o.seed),
    animate: !!o.animate,
    user: o.user || '',
    caption: o.caption === null ? null
      : (o.caption ? String(o.caption) : defaultCaption(lawn, o.user || '')),
    mower: o.mower === undefined ? progress > 0 : !!o.mower,
  };
}

// --- the drawing ----------------------------------------------------------

const tileX = (col) => OX + col * PITCH;
const tileY = (row) => OY + row * PITCH;
const px = (x) => OX + x * PITCH - GAP / 2;
const py = (z) => OY + z * PITCH - GAP / 2;

/**
 * One overgrown tuft, as path data pushed into `bag` (a Map keyed by
 * "colour|width"). A literal port of render2d's drawGrass + blade.
 */
function tuft(bag, dots, x, y, cell, season, theme, o, scale) {
  const level = cell.level;
  if (cell.void || level === 0) return;
  const mowed = cell.mowedX;
  const shrink = mowed ? 0.12 : 1;                    // mowT is 1 in a still
  const n = Math.max(1, Math.round(BLADES[level] * (mowed ? 0.5 : 1)));
  const h0 = HEIGHT[level] * shrink * scale;
  if (h0 < 1.2) return;

  const rnd = rng((cell.col * 31 + cell.row * 7) * 131 + o.seed * 131 + 1);
  rnd(); rnd();                                       // render2d skips two here
  const wob = (v, a) => v + (rnd() - 0.5) * a;

  const cx = x + CELL / 2;
  const base = y + CELL - 1;
  const spread = SPREAD(level) * scale;
  const color = bladeColor(theme, level, season);
  const w = 1.25 + level * 0.22;

  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const bx = cx - spread + f * spread * 2 + (rnd() - 0.5) * 2;
    const h = h0 * (0.72 + rnd() * 0.5);
    const lean = (rnd() - 0.5) * (5 + level);
    const turned = season === 3 && rnd() < 0.15;
    const col = turned ? AUTUMN_BLADE : color;

    const d = `M${n2(wob(bx, 0.5))} ${n2(base)}`
      + `Q${n2(wob(bx + lean * 0.35, 0.8))} ${n2(wob(base - h * 0.62, 0.8))} `
      + `${n2(wob(bx + lean, 0.6))} ${n2(wob(base - h, 0.6))}`;
    const key = col + '|' + n2(w);
    if (!bag.has(key)) bag.set(key, []);
    bag.get(key).push(d);

    const tip = [bx + lean, base - h];
    if (level === 4 && !mowed && i % 4 === 1) push(dots, col, circleD(tip[0], tip[1], 1.3));
    if (season === 0 && level >= 3 && !mowed && i % 3 === 0) {
      push(dots, '#FFFFFF', circleD(tip[0], tip[1] - 0.4, 1.5));
    }
  }

  if (season === 1 && level <= 2 && !mowed) {
    for (let f = 0; f < 2; f++) {
      const col = FLOWERS[Math.floor(rnd() * FLOWERS.length)];
      push(dots, col, circleD(cx + (rnd() - 0.5) * CELL * 0.7, base - 2 - rnd() * h0, 1.5));
    }
  }
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

/** The riding mower, in its own local space. Port of render2d's mower(). */
function mowerGroup(theme, inner) {
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
  // blade inside the deck (frozen at spin 0)
  const blade = [];
  for (const o of [0, 1.57]) {
    blade.push(lineD(6 + Math.cos(o) * 6.5, Math.sin(o) * 6.5, 6 - Math.cos(o) * 6.5, -Math.sin(o) * 6.5));
  }
  p.push(`<path d="${blade.join('')}" fill="none" stroke="#B8B6AE" stroke-width="1.4"/>`);

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
    for (let t = -3; t <= 3; t++) tread.push(lineD(-9 + t * 1.4, s * 9.5 - 2.4, -9 + t * 1.4, s * 9.5 + 2.4));
    p.push(`<path d="${tread.join('')}" fill="none" stroke="#55534E" stroke-width="1"/>`);
    ellipse(-9, s * 9.5, 1.5, 1.1, CREAM, 0.8);
  }

  // steering wheel on its column
  p.push(`<ellipse cx="-1.5" cy="0" rx="3.2" ry="3.2" fill="none" stroke="${ink}" stroke-width="1.3"/>`);
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

  return `<g stroke-linejoin="round" stroke-linecap="round">${p.join('')}${inner || ''}</g>`;
}

// --- the whole picture ----------------------------------------------------

/**
 * Render a lawn as a standalone SVG document string.
 *
 * @param lawn  from createLawn(); never mutated.
 * @param opts  {theme, mowed, mower, animate, caption, user, seed}
 *   theme    'light' (default) | 'dark'
 *   mowed    'as-is' to use cell.mowed, or a 0..1 fraction (default 0.5)
 *   mower    draw the mower (default: whenever anything is mowed)
 *   animate  SMIL: the mower drives the half-mowed row on an 8 s loop
 *   caption  string, or null for none (default: "<n> contributions in <when>")
 *   user     github login, prefixes the caption with "@user - "
 *   seed     jitter seed for the blades (default 7)
 */
export function lawnToSvg(lawn, opts) {
  const o = normalize(lawn, opts);
  const theme = o.theme;
  const cols = lawn.cols;
  const rows = lawn.rows;
  const W = GEOM.OX + cols * PITCH + GEOM.PAD_R;
  const H = GEOM.OY + rows * PITCH + GEOM.PAD_B;
  const gw = cols * PITCH - GAP;

  // The animated loop mows one row over and over, so that row is drawn cut and
  // gets a regrowing overlay on top. -1 when there is nothing to animate.
  const animRow = o.animate && !o.asIs && o.k > 0 && o.k < cols * rows
    ? Math.floor(o.k / cols) : -1;

  // Which cells read as mowed in this picture. Never touches the lawn.
  for (const c of lawn.cells) {
    c.mowedX = c.void || c.level === 0 ? true
      : c.row === animRow ? true
        : o.asIs ? !!c.mowed
          : (c.row * cols + c.col) < o.k;
  }

  const parts = [];

  // 1. paper
  parts.push(`<rect width="100%" height="100%" fill="${theme.paper}"/>`);

  // 2. caption
  if (o.caption) {
    parts.push(`<text x="${GEOM.CAPTION_X}" y="${GEOM.CAPTION_Y}" font-size="${GEOM.CAPTION_SIZE}"`
      + ` fill="${theme.pencil}">${esc(o.caption)}</text>`);
  }

  // 3. month labels, GitHub's rule: skip a month that owns fewer than 3 columns
  const months = [];
  for (const ms of lawn.monthStarts) {
    if (ms.span < 3) continue;
    months.push(`<text x="${n2(tileX(ms.col))}" y="${n2(OY + GEOM.MONTH_DY)}">`
      + `${MONTH_NAMES[ms.month].slice(0, 3)}</text>`);
  }
  parts.push(`<g id="months" font-size="${GEOM.MONTH_SIZE}" fill="${theme.pencil}">${months.join('')}</g>`);

  // 4. fence ticks + the rule they hang from
  const fence = [];
  for (let f = 0; f <= gw / GEOM.FENCE_STEP; f++) {
    const x = OX + f * GEOM.FENCE_STEP;
    fence.push(lineD(x, OY + GEOM.FENCE_TOP, x, OY + GEOM.FENCE_BOT));
  }
  fence.push(lineD(OX, OY + GEOM.FENCE_RULE, OX + gw, OY + GEOM.FENCE_RULE));
  parts.push(`<path id="fence" d="${fence.join('')}" fill="none" stroke="${theme.pencil}"`
    + ` stroke-width="${GEOM.FENCE_W}"/>`);

  // 5. dirt bed under the tiles
  const bi = GEOM.BED_INSET;
  parts.push(`<rect id="bed" x="${OX - bi}" y="${OY - bi}" width="${n2(gw + bi * 2)}"`
    + ` height="${n2(rows * PITCH - GAP + bi * 2)}" rx="${GEOM.BED_R}"`
    + ` fill="${mix(theme.dirt, theme.paper, 0.62)}" stroke="${theme.ink}"`
    + ` stroke-width="${GEOM.BED_W}"/>`);

  // 6. tiles
  const tiles = [];
  const cuts = [];
  for (const c of lawn.cells) {
    if (c.void) continue;
    const season = seasonIndexOfCol(lawn, c.col);
    const x = tileX(c.col);
    const y = tileY(c.row);
    tiles.push(tileRect(c, x, y, season, theme, c.mowedX));
    if (c.mowedX && c.level > 0) {
      cuts.push(lineD(x + 2, y + 6, x + CELL - 2, y + 6));
      cuts.push(lineD(x + 2, y + 11, x + CELL - 2, y + 11));
    }
  }
  parts.push(`<g id="tiles">${tiles.join('')}</g>`);
  if (cuts.length) {
    parts.push(`<path id="cuts" d="${cuts.join('')}" fill="none" stroke="#FFFFFF"`
      + ` stroke-opacity="0.24" stroke-width="1"/>`);
  }

  // 7. grass, batched by colour and width
  const bag = new Map();
  const dots = new Map();
  for (const c of lawn.cells) {
    if (c.void || !c.level) continue;
    tuft(bag, dots, tileX(c.col), tileY(c.row), c, seasonIndexOfCol(lawn, c.col), theme, o, 1);
  }
  parts.push(`<g id="grass" fill="none" stroke-linecap="round">`
    + batched(bag, (k) => {
      const [col, w] = k.split('|');
      return `stroke="${col}" stroke-width="${w}"`;
    })
    + `</g>`);

  // 8. dressing: pebbles on bare dirt, then snowflakes and fallen leaves
  parts.push(`<g id="dressing">${dressing(lawn, theme, o, dots)}</g>`);

  // 8b. the regrowing overlay the animated mower cuts away, frame by frame
  if (animRow >= 0) parts.push(coverGroup(lawn, theme, o, animRow, cols));

  // 9. mower. When animating, the outer <g> is the one that drives: it carries
  // the still position as a plain transform (so a renderer that ignores SMIL
  // still gets the primary picture) and an animateTransform that overrides it.
  if (o.mower) {
    const m = mowerAt(lawn, o, cols, rows);
    const inner = `<g transform="rotate(${n2(m.deg)}) scale(${GEOM.MOWER_SCALE})">`
      + mowerGroup(theme, '') + `</g>`;
    const drive = animRow >= 0
      ? `<animateTransform attributeName="transform" type="translate"`
        + ` from="${n2(px(0))} ${n2(py(animRow + 0.5))}"`
        + ` to="${n2(px(cols))} ${n2(py(animRow + 0.5))}"`
        + ` dur="${LOOP}s" repeatCount="indefinite"/>`
      : '';
    parts.push(`<g id="mower" transform="translate(${n2(m.x)},${n2(m.y)})">${drive}${inner}</g>`);
  }

  // 10. Mon / Wed / Fri, with a paper halo so nothing can hide them
  const labels = ['Mon', 'Wed', 'Fri'].map((d, i) => {
    const y = tileY(1 + i * 2) + CELL / 2 + 1 + GEOM.LABEL_SIZE * 0.35;
    return `<text x="${GEOM.LABEL_X}" y="${n2(y)}">${d}</text>`;
  });
  parts.push(`<g id="labels" font-size="${GEOM.LABEL_SIZE}" fill="${theme.pencil}"`
    + ` stroke="${theme.paper}" stroke-width="4" paint-order="stroke">${labels.join('')}</g>`);

  // 11. legend
  parts.push(legend(lawn, theme, o));

  const label = (o.caption || defaultCaption(lawn, o.user))
    + ' - a GitHub contribution graph drawn as a half-mowed lawn';
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"`
    + ` width="${W}" height="${H}" role="img" aria-label="${esc(label)}">`
    + `<title>${esc(o.caption || label)}</title>`
    + `<style>@font-face{font-family:'Patrick Hand';font-style:normal;font-weight:400;`
    + `src:url(data:font/woff2;base64,${PATRICK_HAND_WOFF2_B64}) format('woff2')}`
    + `text{font-family:${FONT_STACK}}</style>`;

  for (const c of lawn.cells) delete c.mowedX;
  return head + parts.join('') + '</svg>';
}

function tileRect(cell, x, y, season, theme, mowed) {
  const under = tileColor(theme, cell.level, season, false);
  const over = tileColor(theme, cell.level, season, true);
  let fill = cell.level === 0 ? under : (mowed ? over : under);
  if (mowed && cell.level > 0 && cell.col % 2 === 0) fill = mix(fill, stripe(fill), 0.75);
  // the canvas wobbles every vertex; a whole-tile tilt is the cheap equivalent
  const rot = hash(cell.col * 31 + cell.row * 7) * 1.4 - 0.7;
  return `<rect x="${n2(x)}" y="${n2(y)}" width="${CELL}" height="${CELL}" rx="${GEOM.R}"`
    + ` fill="${fill}" stroke="rgba(${theme.inkRgb},${cell.level === 0 ? 0.3 : 0.22})"`
    + ` stroke-width="1" transform="rotate(${n2(rot)} ${n2(x + CELL / 2)} ${n2(y + CELL / 2)})"/>`;
}

/** Pebbles on bare dirt + the seasonal dressing render2d scatters on level 0. */
function dressing(lawn, theme, o, dots) {
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
      for (let p = 0; p < 2; p++) {
        pebbles.push(circleD(x + 4 + rnd() * 8, y + 5 + rnd() * 7, 0.9));
      }
      const s = seasonIndexOfCol(lawn, c.col);
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
  out.push(batched(dots, (col) => `fill="${col}"`));
  return out.join('');
}

/** One pass of the animated mower, seconds. */
const LOOP = 8;

/**
 * The animated row is drawn cut; this puts the overgrown version back on top of
 * it and fades each cell out at the moment the mower reaches that column. At
 * t=0 the whole row is grown again, so the loop reads as "regrow, mow, repeat".
 * Static opacity matches the still, for anything that ignores SMIL.
 */
function coverGroup(lawn, theme, o, row, cols) {
  const at = o.k % cols;
  const groups = [];
  for (const c of lawn.cells) {
    if (c.row !== row || c.void || c.level === 0) continue;
    const season = seasonIndexOfCol(lawn, c.col);
    const x = tileX(c.col);
    const y = tileY(c.row);
    const bag = new Map();
    const dots = new Map();
    const grown = { col: c.col, row: c.row, level: c.level, void: false, mowedX: false };
    tuft(bag, dots, x, y, grown, season, theme, o, 1);
    const t = (c.col + 0.5) / cols;
    groups.push(`<g opacity="${c.col < at ? 0 : 1}">`
      + tileRect(c, x, y, season, theme, false)
      + `<g fill="none" stroke-linecap="round">`
      + batched(bag, (k) => {
        const [col, w] = k.split('|');
        return `stroke="${col}" stroke-width="${w}"`;
      })
      + `</g>${batched(dots, (col) => `fill="${col}"`)}`
      + `<animate attributeName="opacity" values="1;1;0;0"`
      + ` keyTimes="0;${t.toFixed(4)};${Math.min(1, t + 0.01).toFixed(4)};1"`
      + ` dur="${LOOP}s" repeatCount="indefinite"/></g>`);
  }
  return `<g id="cover">${groups.join('')}</g>`;
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

/** "less [tuft tuft tuft tuft] more", bottom right, same as the canvas key. */
function legend(lawn, theme, o) {
  const y = OY + lawn.rows * PITCH + GEOM.LEGEND_DY;
  const right = OX + lawn.cols * PITCH - GAP;
  const midY = y + CELL / 2 + 1 + GEOM.LEGEND_SIZE * 0.35;
  const x0 = right - GEOM.LEGEND_MORE_W - GEOM.LEGEND_GAP - (4 * PITCH - GAP);

  const bag = new Map();
  const dots = new Map();
  const tiles = [];
  for (let l = 1; l <= 4; l++) {
    const x = x0 + (l - 1) * PITCH;
    const fake = { col: l, row: 0, level: l, mowed: false, mowedX: false, count: 0, void: false };
    tiles.push(tileRect(fake, x, y, 2, theme, false));
    tuft(bag, dots, x, y, fake, 2, theme, o, GEOM.LEGEND_SCALE);
  }
  return `<g id="legend">`
    + `<text x="${n2(x0 - GEOM.LEGEND_GAP)}" y="${n2(midY)}" text-anchor="end"`
    + ` font-size="${GEOM.LEGEND_SIZE}" fill="${theme.pencil}">less</text>`
    + tiles.join('')
    + `<g fill="none" stroke-linecap="round">`
    + batched(bag, (k) => {
      const [col, w] = k.split('|');
      return `stroke="${col}" stroke-width="${w}"`;
    })
    + `</g>${batched(dots, (col) => `fill="${col}"`)}`
    + `<text x="${n2(right)}" y="${n2(midY)}" text-anchor="end"`
    + ` font-size="${GEOM.LEGEND_SIZE}" fill="${theme.pencil}">more</text>`
    + `</g>`;
}
