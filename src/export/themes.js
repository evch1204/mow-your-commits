// Colour sets for the exported picture. Light is the site's paper palette,
// verbatim from src/core/palette.js. Dark is GitHub's own dark-mode ramp so the
// image sits on a dark profile README without a bright rectangle around it.
//
// Pure data. No DOM, no dependencies.

import {
  PAPER, INK, PENCIL, CREAM, DIRT, BARE, GITHUB, FROST, DIRT_BY_SEASON,
} from '../core/palette.js';

export const THEMES = {
  light: {
    paper: PAPER,
    ink: INK,
    pencil: PENCIL,
    cream: CREAM,
    dirt: DIRT,
    bare: BARE,
    greens: GITHUB,
    frost: FROST,
    soil: DIRT_BY_SEASON,
    inkRgb: '44,44,42',
    dark: false,
  },
  dark: {
    paper: '#0D1117',
    ink: '#E6EDF3',
    pencil: '#8B949E',
    cream: '#161B22',
    dirt: '#2B3A27',
    bare: '#21262D',
    greens: ['#161B22', '#0E4429', '#006D32', '#26A641', '#39D353'],
    // snow on a dark ground still has to be dark, or winter blows out the ramp
    frost: '#74787C',
    // the climate bed, dark-mode: the same cold-to-warm walk, near-black
    soil: ['#232B2E', '#2E2A21', '#2B2A1E', '#302A1F'],
    inkRgb: '230,237,243',
    dark: true,
  },
};

export function themeFor(name) {
  return THEMES[name] || THEMES.light;
}
