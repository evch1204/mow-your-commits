// 3D-only colours and numbers. Nothing here belongs to the sim or to the flat
// view, so it lives beside the renderer instead of in src/core/palette.js.

/** Ink, as a THREE colour literal (palette.js keeps the CSS string). */
export const INK_HEX = 0x2c2c2a;

/** Hemisphere light tint per season: cool in winter, warm in summer. */
export const HEMI = ['#DCE9F4', '#EEF8E6', '#FFF6DE', '#FBEBD6'];
export const DIR_INTENSITY = [0.75, 1.05, 1.35, 1.0];

/** The three browns an autumn leaf can be. */
export const AUTUMN_TRIO = ['#D85A30', '#EF9F27', '#BA7517'];

/**
 * The doodle grass cards, in tile units (a tile is 1 unit across). These are
 * the 3D column of the grammar table in docs/plans/v05-doodle.md: the day's
 * count picks a *shape*, not just a height, so a level-1 week and a level-4
 * week read apart from the overview as well as from the chase cam.
 */
export const CARD = [
  null,
  { name: 'sprouts', h: 0.30, w: 0.50 },
  { name: 'tuft', h: 0.60, w: 0.70 },
  { name: 'bush', h: 1.00, w: 0.95 },
  { name: 'hedge', h: 1.50, w: 1.10 },
];
export const STUBBLE = { h: 0.14, w: 0.66 };

/** Vigor (0..1 inside a level) scales a card between these. */
export const VIGOR_LO = 0.85;
export const VIGOR_HI = 1.15;

/**
 * Extra darkening per level on top of `bladeColor`, so the four greens pull
 * apart in a 3D frame where lighting flattens them: a hedge is the darkest
 * thing on the board.
 */
export const LEVEL_SHADE = [1, 1.22, 1.06, 0.9, 0.74];

/**
 * And a squeeze of the level's own green toward a fresh yellow-green (level 1)
 * or a deep bottle green (level 4), so a quiet week and a busy week are two
 * colours and not two brightnesses of one.
 */
export const LEVEL_PUSH = [
  null, ['#C8E58A', 0.34], ['#8FD07A', 0.16], ['#2E7D46', 0.18], ['#14512A', 0.34],
];

/** A hedge stands off its tile on a soft blob shadow. */
export const BLOB_Y = 0.145;
export const BLOB_R = 0.62;
export const BLOB_ALPHA = 0.3;

/** Tile top, and where a tuft's feet sit. */
export const TILE_TOP = 0.14;

/** The tile pop on reveal: scale 1.12 -> 1 over this long. */
export const POP_SCALE = 1.12;
export const POP_TIME = 0.3;

/** Three layered hand-drawn hill planes, near to far. */
export const HILLS = [
  { z: -34, w: 170, h: 13, y: 2.6, mul: 0.70, lerp: 0.06, ink: 0.5, seed: 3251 },
  { z: -60, w: 250, h: 19, y: 4.6, mul: 0.86, lerp: 0.36, ink: 0.34, seed: 9187 },
  { z: -98, w: 380, h: 28, y: 7.6, mul: 1.00, lerp: 0.66, ink: 0.2, seed: 5443 },
];

/** Fog: far enough back that the third hill line is still a pale shape. */
export const FOG_NEAR = 30;
export const FOG_FAR = 130;

/** Meadow doodle cards scattered around the board. */
export const MEADOW_CARDS = 300;

/** How far out in front the sun and the clouds hang, and how high. */
export const SKY_DIST = 42;
export const SKY_RISE = 1.4;

/** Tyre tracks: two ribbons behind the mower, fading over this many seconds. */
export const TRACK_LIFE = 6;
export const TRACK_PAIRS = 110;
export const TRACK_STEP = 0.16;      // world units between stamps
export const TRACK_HALF = 0.44;      // ribbon offset either side of centre
export const TRACK_Y = 0.152;

/** Debris pools (one instanced mesh each, so a full lawn is two draw calls). */
export const CLIP_POOL = 260;
export const PUFF_POOL = 90;

/** Leaves in autumn, blossom in spring. */
export const LEAF_N = 44;

/** Sky props: 5 birds drift across in spring and summer. */
export const BIRD_N = 5;

/** Trees: 8 on the fence line, 20 set back in the meadow. */
export const FENCE_TREES = 8;
export const MEADOW_TREES = 20;
export const TREE_SHAPES = ['round', 'pine', 'poplar'];

/** The overview is framed from the lawn out; see camera.js. */
export const OVER_PITCH = 0.64;
export const OVER_LOOK_Y = 1.2;
export const OVER_LOOK_Z = -5.5;
export const OVER_FALLBACK = 34;     // until the first fit (no canvas size yet)
export const CHASE_FOV = 50;
export const OVER_FOV = 34;          // a longer lens: the far rows keep their size

/** The sketch pass. */
export const SKETCH = {
  edge: 0.8,          // how black the ink goes
  threshold: 0.0042,  // depth step (scaled by distance) that counts as an edge
  grain: 0.12,        // paper noise, multiplied
  vignette: 0.18,
  boil: 1.6,          // pixels the edge sample wanders when the seed changes
  /**
   * The pass renders the whole scene into its own buffer, so its resolution
   * is the scene's resolution and the frame cost is quadratic in it. A 3x
   * phone screen would be paying four times a desktop's fill rate for a
   * drawing that is deliberately soft, so cap the ratio, and drop the
   * multisampling with it: the ink pass draws the edges either way.
   */
  ratio: 2,
  phoneRatio: 1.5,
  phoneUnder: 900,    // css px of canvas width that counts as a phone
  samples: 4,
  phoneSamples: 0,
};
