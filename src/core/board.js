// The 2D board's geometry: every coordinate the flat lawn is laid out on.
// Pure numbers, no DOM, no dependencies.
//
// src/render2d draws it on a canvas and src/export/svg.js draws it as SVG, so
// this is the one place either of them reads a coordinate from and the README
// picture cannot drift away from the board on the page.

/** Every coordinate the flat board is laid out on. */
export const GEOM = {
  CELL: 16,
  GAP: 3,
  PITCH: 19,           // CELL + GAP
  R: 3,                // tile corner radius
  OX: 58,              // grid origin: room for Mon/Wed/Fri on the left
  // A hedge is 24px tall on a 16px tile, so a level-4 Sunday reaches 9px above
  // the grid. The header keeps its absolute positions (the DYs below all grew
  // by the same 4) and the grid drops instead, leaving the fence clear.
  OY: 64,
  PAD_R: 22,
  PAD_B: 70,           // legend strip
  // header. The caption is the exporter's own line; the canvas puts the same
  // words in the page's <h1> instead.
  CAPTION_X: 58,
  CAPTION_Y: 22,
  CAPTION_SIZE: 16,
  MONTH_SIZE: 16,
  MONTH_DY: -26,
  GLYPH_DY: -31,
  // fence above the grid
  FENCE_STEP: 14,
  FENCE_TOP: -20,
  FENCE_BOT: -13,
  FENCE_RULE: -16,
  FENCE_W: 1.1,
  // dirt bed
  BED_INSET: 5,
  BED_R: 8,
  BED_W: 1.8,
  // Mon / Wed / Fri
  LABEL_X: 8,
  LABEL_SIZE: 15,
  // legend: five swatches (bare + four greens), right-aligned to the bed
  LEGEND_DY: 30,
  LEGEND_SIZE: 16,
  LEGEND_GAP: 26,
  // Patrick Hand 16px, measured once: the canvas measures "more" for itself,
  // so only the exporter needs the number.
  LEGEND_MORE_W: 35,
  // the key is the grammar, so its five shapes are drawn at their real size
  LEGEND_SCALE: 1,
  // mower
  MOWER_SCALE: 1.25,
};
