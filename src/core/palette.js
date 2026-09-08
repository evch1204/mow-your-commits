// Shared colour rules. Pure data + maths, no DOM, no rendering.
// Both renderers import this so a level-3 tile is the same green in flat and 3D.

export const INK = '#2C2C2A';
export const PAPER = '#FBF9F2';
export const CREAM = '#FBF4DD';
export const ORANGE = '#D85A30';
export const SUN = '#FAC775';
export const DIRT = '#A9855B';
export const PENCIL = '#75736D';

/** The real GitHub contribution greens, levels 0..4. */
export const GITHUB = ['#EBEDF0', '#9BE9A8', '#40C463', '#30A14E', '#216E39'];

/** Level 0 in doodle land is bare paper-dirt, not GitHub's cold grey. */
export const BARE = '#E7E1D0';

/**
 * Season tint, [hex, amount]. Lerped on top of the GitHub green so the graph
 * still reads as GitHub greens in every season. Never more than 25%.
 * 0 winter, 1 spring, 2 summer, 3 autumn.
 */
/**
 * "no season at all", for the plain chart the exporter can draw (`weather=0`).
 * Every rule that reads a season index treats it as zero tint and no weather,
 * so the tiles come out as GitHub's exact ramp.
 */
export const NO_SEASON = -1;

export const SEASON_TINT = [
  ['#C3D4DB', 0.25], // winter: cool, desaturated
  ['#BDEE72', 0.12], // spring: fresh
  ['#69C92B', 0.06], // summer: almost nothing
  ['#D9A83A', 0.20], // autumn: warm
];

/** Overgrown grass darkens and dulls the tile it is standing on. */
export const OVERGROWN = '#4E5A3C';

/** Snow dusting on winter ground, and the pale blades that grow through it. */
export const FROST = '#F2F5F7';
/**
 * Frosted but still green enough that four winter densities read apart, and
 * every blade stays lighter than the tile it stands on: the old level-4 blade
 * was darker than its own tile, so the busiest winter days went blank.
 */
export const WINTER_BLADE = ['', '#B2D3BC', '#8CC1A2', '#68A987', '#4C9070'];
/** A few blades in autumn columns go brown. */
export const AUTUMN_BLADE = '#BA7517';
/** Spring flowers. */
export const FLOWERS = ['#F6C3D4', '#FFFDF5', '#F4D06F'];

/** A best-day dandelion: yellow disc, then a seed-head puff. */
export const DANDELION = '#F4D06F';
export const FLUFF = '#FFFDF5';
export const PETAL = ['#F6C3D4', '#FFE1EA'];

/** Sky, ground and light per season: 0 winter, 1 spring, 2 summer, 3 autumn. */
export const SKY_TOP = ['#C9D6E2', '#BFDDF5', '#8FC6F0', '#E9C9A2'];
export const SKY_HORIZON = ['#EEF2F5', '#F1F7EC', '#E8F4FB', '#FBEEDC'];
export const MEADOW_BY_SEASON = ['#E4EAE6', '#C9DCAE', '#B9D48F', '#D6C98E'];
export const SUN_LIGHT = ['#DCE8F5', '#FFF6E6', '#FFE9B8', '#FFD9A8'];
export const DIRT_BY_SEASON = ['#BFC7CA', '#B08A5C', '#A9855B', '#B7925E'];

/**
 * The grass grammar, shared by both renderers (and by the SVG exporter).
 * Index is the GitHub level; every span is [at vigor 0, at vigor 1], so a
 * 40-contribution level-4 day is visibly taller and denser than a 12.
 */
export const GRASS = {
  blades: [[0, 0], [2, 3], [4, 6], [7, 9], [10, 13]],
  height: [[0, 0], [4, 6], [7, 10], [10, 14], [14, 19]],   // 2D px on a 16px tile
  width: [0, 1.2, 1.4, 1.6, 1.85],                         // 2D stroke px
  tuftY: [[0, 0], [0.8, 1.05], [0.8, 1.1], [0.85, 1.15], [0.9, 1.3]],  // 3D y-scale
};

const span = (s, v) => s[0] + (s[1] - s[0]) * v;

/** How a day of this level and this vigor grows. */
export function grassFor(level, vigor = 0.5) {
  const l = Math.max(0, Math.min(4, level | 0));
  const v = Math.max(0, Math.min(1, vigor));
  return {
    blades: Math.round(span(GRASS.blades[l], v)),
    height: span(GRASS.height[l], v),
    width: GRASS.width[l],
    tuftY: span(GRASS.tuftY[l], v),
  };
}

/**
 * A whisper of per-cell personality so a big block of one level does not read
 * as a printed swatch: every third cell lifts, the rest sink, by 5%.
 */
export function cellTint(hex, col, row) {
  return mix(hex, ((col * 7 + row * 3) % 3 === 0 ? '#FFFFFF' : '#1F3A26'), 0.05);
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(c) {
  const v = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return '#' + v(c[0]) + v(c[1]) + v(c[2]);
}

/** Lerp two hex colours. Returns hex. */
export function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/**
 * The colour ramp the rules below run on. The site always uses this one; the
 * SVG exporter passes GitHub's dark-mode ramp instead, so the exported picture
 * follows every formula here in both themes without copying any of them.
 */
export const LIGHT_RAMP = { greens: GITHUB, bare: BARE, frost: FROST, ink: INK };

/** Season-tinted GitHub green for a level. Always recognisably GitHub. */
export function levelGreen(level, season = 2, ramp = LIGHT_RAMP) {
  const base = level <= 0 ? ramp.bare : ramp.greens[level];
  // NO_SEASON returns the ramp colour untouched rather than mixing by 0, so the
  // plain chart carries GitHub's own hex strings, not a re-rounded copy of them
  const st = SEASON_TINT[season] || (season === NO_SEASON ? null : SEASON_TINT[2]);
  if (!st) return base;
  return mix(base, st[0], level <= 0 ? st[1] * 0.5 : st[1]);
}

/**
 * The colour of a day tile.
 * mowed -> the exact (season-tinted) GitHub green: this is the reveal.
 * unmowed -> the same green darkened and dulled, because grass is hiding it.
 */
export function tileColor(level, season, mowed, vigor = 0, ramp = LIGHT_RAMP) {
  const g = levelGreen(level, season, ramp);
  if (mowed) return g;                      // the reveal rule always wins
  if (level <= 0) return season === 0 ? mix(g, ramp.frost, 0.30) : g;
  // overgrown; a busier day casts a deeper shadow on its own tile
  const over = shade(shade(mix(g, OVERGROWN, 0.34), 0.82), 1 - 0.12 * Math.max(0, Math.min(1, vigor)));
  // winter ground carries a snow dusting, but thin: the old 0.2 wash plus the
  // frost cap in 2D flattened L1..L4 into one pale slab.
  return season === 0 ? mix(over, ramp.frost, 0.12) : over;
}

/** Multiply a hex colour brightness. */
export function shade(hex, k) {
  const c = hexToRgb(hex);
  return rgbToHex([c[0] * k, c[1] * k, c[2] * k]);
}

/** Every other column gets a slightly lighter fill: mower stripes. */
export function stripe(hex) { return mix(hex, '#FFFFFF', 0.17); }

/** Grass blade colour: level 1 needs a push toward ink to show on its tile. */
export function bladeColor(level, season = 2, ramp = LIGHT_RAMP) {
  if (season === 0) return WINTER_BLADE[level] || WINTER_BLADE[4];
  const g = levelGreen(level, season, ramp);
  return mix(g, ramp.ink, [0, 0.3, 0.15, 0.08, 0.06][level] || 0);
}

/** Clipping / particle colour for a level. */
export function clipColor(level, season = 2) {
  return mix(levelGreen(Math.max(1, level), season), '#FFFFFF', 0.15);
}
