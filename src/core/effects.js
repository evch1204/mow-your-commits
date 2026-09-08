// The bits of vocabulary both renderers speak: how much debris may be alive at
// once, how much a cut throws, what the hand-drawn labels are set in, and how
// long a burst of cuts stays one label. Pure numbers, no DOM, no dependencies.

/**
 * Flying clippings alive at once. Debris only ages inside draw(), and the view
 * you are not looking at never draws, so without a cap a whole lawn mowed in
 * one view lands on the other the moment you switch. The 3D pool holds the
 * exhaust puffs too, so this counts both.
 */
export const CLIP_MAX = 260;

/** How much debris one cut throws: a busier day makes more of a mess. */
export function clippingCount(cell) {
  return 3 + 2 * cell.level + (cell.heroic ? 6 : 0);
}

/** The doodle face, for canvas text and for the 3D sprites drawn on canvases. */
export const FONT = "'Patrick Hand', cursive";

/**
 * How long the newest +N label keeps absorbing further cuts, in seconds: a
 * burst of tiny cuts reads as one find, not a stack of labels.
 */
export const POPUP_MERGE = 0.25;
