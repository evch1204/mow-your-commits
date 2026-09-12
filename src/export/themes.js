// Colour sets for the exported picture. Light is the site's palette, verbatim
// from src/core/palette.js, over GitHub's own light canvas. Dark is GitHub's
// dark-mode ramp so the image sits on a dark profile README without a bright
// rectangle around it.
//
// `paper` is the canvas the picture is drawn *for*, not a sheet it is drawn on:
// it is the colour every mix and every halo in svg.js assumes is behind the
// board (bed() lightens the soil toward it), and the picture almost always
// lands on a README, where that is white or #0D1117. The site's cream sheet is
// still here as `sheet`, for anyone who wants the doodle on its own page
// (`bg=paper`).
//
// Pure data. No DOM, no dependencies.

import { PAPER, INK, PENCIL, BARE, GITHUB, FROST, DIRT_BY_SEASON } from '../core/palette.js';

export const THEMES = {
  light: {
    paper: '#FFFFFF',
    sheet: PAPER,
    ink: INK,
    pencil: PENCIL,
    bare: BARE,
    greens: GITHUB,
    frost: FROST,
    soil: DIRT_BY_SEASON,
    inkRgb: '44,44,42',
  },
  dark: {
    paper: '#0D1117',
    // a dark README has no second sheet to offer: the canvas is the sheet
    sheet: '#0D1117',
    ink: '#E6EDF3',
    pencil: '#8B949E',
    bare: '#21262D',
    greens: ['#161B22', '#0E4429', '#006D32', '#26A641', '#39D353'],
    // snow on a dark ground still has to be dark, or winter blows out the ramp
    frost: '#74787C',
    // the climate bed, dark-mode: the same cold-to-warm walk, near-black
    soil: ['#232B2E', '#2E2A21', '#2B2A1E', '#302A1F'],
    inkRgb: '230,237,243',
  },
};

export function themeFor(name) {
  return THEMES[name] || THEMES.light;
}
