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
import { GEOM, SPREAD } from '../core/board.js';
import { planRoute } from '../core/route.js';
import {
  AUTUMN_BLADE, FLOWERS, ORANGE, CREAM, SUN, PETAL, DANDELION, FLUFF, NO_SEASON,
  grassFor, cellTint, tileColor, bladeColor, mix, stripe,
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
    // a junk seed would make every jitter NaN and every route cost NaN, and the
    // seed can come off a query string, so it is checked rather than trusted
    seed: o.seed != null && Number.isFinite(Number(o.seed)) ? Number(o.seed) : 7,
    animate: !!o.animate,
    // both default on: the picture is a doodle lawn first, a chart second
    weather: o.weather === undefined ? true : !!o.weather,
    background: o.background === undefined ? true : !!o.background,
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
 * One overgrown tuft, as path data pushed into `bag` (a Map keyed by
 * "colour|width"). A literal port of render2d's drawGrass + blade: the blades
 * are laid out first (so the two tallest of a level 3/4 day can take a darker
 * tip), then drawn, and every number comes from `grassFor(level, vigor)`.
 */
function tuft(bag, dots, over, x, y, cell, season, theme, o, scale) {
  const level = cell.level;
  if (cell.void || level === 0) return;
  const mowed = cell.mowedX;
  const shrink = mowed ? 0.12 : 1;                    // mowT is 1 in a still
  const g = grassFor(level, cell.vigor || 0);
  const n = Math.max(1, Math.round(g.blades * (mowed ? 0.5 : 1)));
  const h0 = g.height * shrink * scale;
  if (h0 < 1.2) return;

  const rnd = rng((cell.col * 31 + cell.row * 7) * 131 + o.seed * 131 + 1);
  rnd(); rnd();                                       // render2d skips two here
  const wob = (v, a) => v + (rnd() - 0.5) * a;

  const cx = x + CELL / 2;
  const base = y + CELL - 1;
  const spread = SPREAD(level) * scale;
  const color = cellTint(bladeColor(level, season, theme), cell.col, cell.row);
  const dark = mix(color, theme.ink, 0.25);
  const bias = (hash(cell.col) - 0.5) * 4;            // the patch leans as one
  const w = n2(g.width);

  const blades = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    blades.push({
      bx: cx - spread + f * spread * 2 + (rnd() - 0.5) * 2,
      h: h0 * (0.8 + rnd() * 0.4),
      lean: bias + (rnd() - 0.5) * (5 + level),
      turned: season === 3 && rnd() < 0.15,
      tall: false,
    });
  }
  if (level >= 3) {
    [...blades].sort((a, b) => b.h - a.h).slice(0, 2).forEach((b) => { b.tall = true; });
  }

  for (let i = 0; i < blades.length; i++) {
    const b = blades[i];
    const col = b.turned ? AUTUMN_BLADE : color;
    const d = `M${n2(wob(b.bx, 0.5))} ${n2(base)}`
      + `Q${n2(wob(b.bx + b.lean * 0.35, 0.8))} ${n2(wob(base - b.h * 0.62, 0.8))} `
      + `${n2(wob(b.bx + b.lean, 0.6))} ${n2(wob(base - b.h, 0.6))}`;
    push(bag, col + '|' + w, d);

    const tip = [b.bx + b.lean, base - b.h];
    if (b.tall && !b.turned) {
      // the top third of the tallest blades falls into shadow
      push(bag, dark + '|' + w,
        lineD(tip[0] - b.lean * 0.22, tip[1] + b.h * 0.3, tip[0], tip[1]));
    }
    if (level === 4 && !mowed && i % 4 === 1) push(dots, col, circleD(tip[0], tip[1], 1.3));
    if (season === 0 && level >= 3 && !mowed && i % 3 === 0) {
      push(dots, '#FFFFFF', circleD(tip[0], tip[1] - 0.4, 1.5));
    }
  }

  // the best days of the year put up a dandelion and a seed-head puff
  if (cell.heroic && !mowed && season !== 0) {
    const st = h0 + 5;
    for (let d = 0; d < 2; d++) {
      const dx = cx + (d ? 4.5 : -4) + (rnd() - 0.5) * 2;
      const top = base - st * (d ? 0.82 : 1);
      const hx = dx + bias * 0.4;
      // render2d draws the stalk with line(), which wobbles six numbers
      push(bag, theme.ink + '|1',
        `M${n2(wob(dx, 0.6))} ${n2(wob(base, 0.6))}`
        + `Q${n2(wob((dx + hx) / 2, 0.9))} ${n2(wob((base + top) / 2, 0.9))} `
        + `${n2(wob(hx, 0.6))} ${n2(wob(top, 0.6))}`);
      if (d === 0) {
        push(dots, DANDELION, circleD(hx, top, 2.4));
        push(over, theme.ink + '|0.8', circleD(hx, top, 2.4));
      } else {
        push(dots, FLUFF, circleD(hx, top, 2.2));
        for (let k = 0; k < 4; k++) {
          const a = k * 1.57 + 0.4;
          push(over, theme.ink + '|0.6', lineD(
            hx + Math.cos(a) * 1.6, top + Math.sin(a) * 1.6,
            hx + Math.cos(a) * 3.4, top + Math.sin(a) * 3.4,
          ));
        }
      }
    }
  }

  // spring puts a couple of flowers in the thin grass
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

/** "#hex|width" keyed path bags: every blade of one colour in one <path>. */
const strokeAttrs = (k) => {
  const [col, w] = k.split('|');
  return `stroke="${col}" stroke-width="${w}"`;
};

/** A stroked group: blades, stalks, the ink on a dandelion. */
function strokes(id, map) {
  return `<g${id ? ` id="${id}"` : ''} fill="none" stroke-linecap="round">`
    + batched(map, strokeAttrs) + '</g>';
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
 * @param opts  {theme, mowed, mower, animate, weather, background, caption, user, seed}
 *   theme      'light' (default) | 'dark'
 *   mowed      'as-is' to use cell.mowed, or a 0..1 fraction (default 0.5).
 *              Ignored under `animate`: the loop always starts fully grown.
 *   mower      draw the mower (default: whenever anything is mowed)
 *   animate    SMIL: the mower drives the whole year on a wandering route,
 *              then the lawn regrows and the loop restarts
 *   weather    seasons: glyphs, frost, flakes, leaves, flowers, the climate bed
 *              and the season tint on the greens. Off gives GitHub's exact ramp.
 *   background draw the paper rectangle behind everything (off = transparent)
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

  // Which cells read as mowed in this picture. Never touches the lawn.
  for (const c of lawn.cells) {
    c.mowedX = c.void || c.level === 0 ? true
      : route ? true
        : o.asIs ? !!c.mowed
          : (c.row * cols + c.col) < o.k;
  }

  const parts = [];

  // 1. paper
  if (o.background) parts.push(`<rect width="100%" height="100%" fill="${theme.paper}"/>`);

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
  parts.push(`<g id="months" font-size="${GEOM.MONTH_SIZE}" fill="${theme.pencil}">${months.join('')}</g>`);
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
  for (const c of lawn.cells) {
    if (c.void) continue;
    const season = seasonOf(c.col);
    const x = tileX(c.col);
    const y = tileY(c.row);
    tiles.push(tileRect(c, x, y, season, theme, c.mowedX));
    caps.push(frostCap(c, x, y, season, c.mowedX));
    if (c.mowedX && c.level > 0) {
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

  // 7. grass, batched by colour and width
  const bag = new Map();
  const dots = new Map();
  const over = new Map();
  for (const c of lawn.cells) {
    if (c.void || !c.level) continue;
    tuft(bag, dots, over, tileX(c.col), tileY(c.row), c, seasonOf(c.col), theme, o, 1);
  }
  parts.push(strokes('grass', bag));

  // 8. dressing: pebbles on bare dirt, snowflakes, leaves, dandelion heads,
  //    then the ink that sits on top of them (disc outlines, seed-head ticks)
  parts.push(`<g id="dressing">${dressing(lawn, theme, o, dots, seasonOf)}</g>`);
  if (over.size) parts.push(strokes('ink', over));

  // 8b. the overgrown lawn the animated mower cuts away, cell by cell
  const timing = route ? loopTiming(route.length) : null;
  if (route) parts.push(coverGroup(lawn, theme, o, route, timing, seasonOf));

  // 9. mower. The outer <g> parks it: the still position, or the start of the
  // route, which is also the fallback for anything that ignores SMIL.
  if (o.mower) {
    const m = route ? routeStart(route) : mowerAt(lawn, o, cols, rows);
    // under animateMotion the heading comes from rotate="auto", so the art
    // group carries the scale and nothing else
    const art = `<g transform="${route ? '' : `rotate(${n2(m.deg)}) `}`
      + `scale(${GEOM.MOWER_SCALE})">` + mowerGroup(theme, '') + `</g>`;
    if (!route) {
      parts.push(`<g id="mower" transform="translate(${n2(m.x)},${n2(m.y)})">${art}</g>`);
    } else {
      // animateMotion's matrix wraps *around* the element's own transform, so
      // rotate="auto" would swing the parked translate about the page origin.
      // The driven <g> therefore owns no transform: its parent parks it, the
      // path is relative to that, and rotate="auto" turns it in place. Right,
      // because the mower art faces +x. keyPoints holds it off the right edge
      // for the last stretch of the loop: the pause before everything regrows.
      const drive = `<animateMotion dur="${n2(timing.dur)}s" repeatCount="indefinite"`
        + ` rotate="auto" calcMode="linear" keyPoints="0;1;1"`
        + ` keyTimes="0;${timing.drive};1" path="${motionPath(route, m)}"/>`;
      parts.push(`<g id="mower" transform="translate(${n2(m.x)},${n2(m.y)})">`
        + `<g>${drive}${art}</g></g>`);
    }
  }

  // 10. Mon / Wed / Fri, with a paper halo so nothing can hide them
  const labels = ['Mon', 'Wed', 'Fri'].map((d, i) => {
    const y = tileY(1 + i * 2) + CELL / 2 + 1 + GEOM.LABEL_SIZE * 0.35;
    return `<text x="${GEOM.LABEL_X}" y="${n2(y)}">${d}</text>`;
  });
  // no paper means nothing to halo against, so the stroke goes with it
  const halo = o.background
    ? ` stroke="${theme.paper}" stroke-width="4" paint-order="stroke"` : '';
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

  for (const c of lawn.cells) delete c.mowedX;
  return head + parts.join('') + '</svg>';
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
      d.push(lineD(x - Math.cos(a) * 4, y - Math.sin(a) * 4, x + Math.cos(a) * 4, y + Math.sin(a) * 4));
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
      rays.push(lineD(x + Math.cos(a) * 5, y + Math.sin(a) * 5, x + Math.cos(a) * 7, y + Math.sin(a) * 7));
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
function dressing(lawn, theme, o, dots, seasonOf) {
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
  out.push(batched(dots, (col) => `fill="${col}"`));
  return out.join('');
}

/** The drive, in cells per second, and the pause parked off the right edge. */
const SPEED = 8;
const HOLD = 1.6;
/** How long a tuft takes to vanish once the blade reaches it, as a fraction. */
const SNAP = 0.004;

/**
 * One loop: drive the whole route, then hold off the edge while the year
 * regrows. `drive` is where the driving ends, as a fraction of the loop, and
 * is the last key of every animation in the picture.
 */
function loopTiming(length) {
  const dur = length / SPEED + HOLD;
  return { dur, drive: Number(((length / SPEED) / dur).toFixed(4)) };
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
    const bag = new Map();
    const dots = new Map();
    const over = new Map();
    const grown = {
      col: c.col, row: c.row, level: c.level, void: false, mowedX: false,
      vigor: c.vigor || 0, heroic: c.heroic,
    };
    tuft(bag, dots, over, x, y, grown, season, theme, o, 1);
    // planRoute guarantees a cut for every mowable cell, and the route always
    // starts off the board, so t is never 0. keyTimes still has to be strictly
    // increasing and end at exactly 1, so the snap that follows t must not
    // reach it: the last cell is cut a hair before the drive ends.
    const t = (route.cuts.get(i) / route.length) * timing.drive;
    const t2 = Math.min(t + SNAP, (1 + t) / 2);
    groups.push('<g>'
      + tileRect(c, x, y, season, theme, false)
      + frostCap(c, x, y, season, false)
      + batched(bag, strokeAttrs)
      + batched(dots, (col) => `fill="${col}"`)
      + (over.size ? batched(over, strokeAttrs) : '')
      + `<animate attributeName="opacity" values="1;1;0;0"`
      + ` keyTimes="0;${t.toFixed(4)};${t2.toFixed(4)};1"`
      + ` dur="${n2(timing.dur)}s" repeatCount="indefinite"/></g>`);
  }
  // one cover per cell means the stroke defaults cannot batch by colour, but
  // they can at least be said once for the whole layer instead of per cell
  return `<g id="cover" fill="none" stroke-linecap="round">${groups.join('')}</g>`;
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
  const out = ['M0 0'];
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
  const swatches = 5 * PITCH - GAP;
  const x0 = right - GEOM.LEGEND_MORE_W - GEOM.LEGEND_GAP - swatches;

  const bag = new Map();
  const dots = new Map();
  const over = new Map();
  const tiles = [];
  // the key follows the same rule as the board: summer green, or no season
  const season = o.weather ? 2 : NO_SEASON;
  for (let l = 0; l <= 4; l++) {
    const x = x0 + l * PITCH;
    // level 0 shows mowed, so the key opens on the bare tile the graph uses
    const fake = {
      col: l, row: 0, level: l, count: 0, void: false,
      vigor: 0.5, heroic: false, mowed: l === 0, mowedX: l === 0,
    };
    tiles.push(tileRect(fake, x, y, season, theme, l === 0));
    tuft(bag, dots, over, x, y, fake, season, theme, o, GEOM.LEGEND_SCALE);
  }
  const text = (x, anchor, str) =>
    `<text x="${n2(x)}" y="${n2(midY)}" text-anchor="${anchor}"`
    + ` font-size="${GEOM.LEGEND_SIZE}" fill="${theme.pencil}">${str}</text>`;
  return `<g id="legend">`
    + text(x0 - GEOM.LEGEND_GAP, 'end', 'less')
    + tiles.join('')
    + strokes('', bag)
    + batched(dots, (col) => `fill="${col}"`)
    + strokes('', over)
    + text(right, 'end', 'more')
    + `</g>`;
}
