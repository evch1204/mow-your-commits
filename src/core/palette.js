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
export const SEASON_TINT = [
  ['#C3D4DB', 0.25], // winter: cool, desaturated
  ['#BDEE72', 0.12], // spring: fresh
  ['#69C92B', 0.06], // summer: almost nothing
  ['#D9A83A', 0.20], // autumn: warm
];

/** Overgrown grass darkens and dulls the tile it is standing on. */
const OVERGROWN = '#4E5A3C';

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

/** Season-tinted GitHub green for a level. Always recognisably GitHub. */
export function levelGreen(level, season = 2) {
  const [tint, amt] = SEASON_TINT[season] || SEASON_TINT[2];
  if (level <= 0) return mix(BARE, tint, amt * 0.5);
  return mix(GITHUB[level], tint, amt);
}

/**
 * The colour of a day tile.
 * mowed -> the exact (season-tinted) GitHub green: this is the reveal.
 * unmowed -> the same green darkened and dulled, because grass is hiding it.
 */
export function tileColor(level, season, mowed) {
  const g = levelGreen(level, season);
  if (level <= 0 || mowed) return g;
  return shade(mix(g, OVERGROWN, 0.34), 0.82);
}

/** Multiply a hex colour brightness. */
export function shade(hex, k) {
  const c = hexToRgb(hex);
  return rgbToHex([c[0] * k, c[1] * k, c[2] * k]);
}

/** Every other column gets a slightly lighter fill: mower stripes. */
export function stripe(hex) { return mix(hex, '#FFFFFF', 0.17); }

/** Grass blade colour: level 1 needs a push toward ink to show on its tile. */
export function bladeColor(level, season = 2) {
  const g = levelGreen(level, season);
  return mix(g, INK, [0, 0.3, 0.15, 0.08, 0.06][level] || 0);
}

/** Clipping / particle colour for a level. */
export function clipColor(level, season = 2) {
  return mix(levelGreen(Math.max(1, level), season), '#FFFFFF', 0.15);
}
