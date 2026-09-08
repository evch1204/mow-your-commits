// Colour sets for the exported picture. Light is the site's paper palette,
// verbatim from src/core/palette.js. Dark is GitHub's own dark-mode ramp so the
// image sits on a dark profile README without a bright rectangle around it.
//
// Pure data. No DOM, no dependencies.

import { PAPER, INK, PENCIL, CREAM, DIRT, BARE, GITHUB, FROST } from '../core/palette.js';

/** palette.js keeps OVERGROWN private; the exporter needs the same value. */
export const OVERGROWN = '#4E5A3C';

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
    inkRgb: '230,237,243',
    dark: true,
  },
};

export function themeFor(name) {
  return THEMES[name] || THEMES.light;
}
