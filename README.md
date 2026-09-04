# mow-your-commits

🌱 Your GitHub contribution graph is a lawn. Mow it. A tiny browser game built with Three.js and canvas.

**Unmowed = overgrown doodle grass hiding the graph. Mowed = the clean GitHub tile
underneath.** Every cell is both a GitHub day square and a patch of grass: level 4 is a
hedge you can barely see the tile through, level 0 is bare dirt. Driving over a day cuts
it back to its exact GitHub green and pops up `+12` for the contributions you just found.
Mowing *is* the reveal.

Two renderers share one model:

- `src/core/` — the lawn itself. Cells, mower physics, mowing detection, seasons, the
  shared colour palette. No DOM, no rendering.
- `src/render2d/` — hand-drawn canvas version at the proportions of the real graph:
  52x7 rounded tiles, month labels on top, Mon/Wed/Fri down the left, legend bottom right.
- `src/render3d/` — Three.js version with cel shading, ink outlines, a "boiling" wobble
  shader and wind sway. Instanced tiles plus four tuft builds, one per level. A riding
  mower with a driver, and weather that follows you: drive into winter and it starts
  snowing, into autumn and the leaves come down. Chase cam you can drag to look around,
  or press `C` for the overview shot of the whole year.

Pick a year from the list beside the lawn, just like on a GitHub profile. The rolling
"last year" is 52 weeks; a calendar year is GitHub's 53- or 54-column grid, with void
cells before 1 Jan and after 31 Dec that are drawn as nothing and can't be mowed.

## Run

```
npm install
npm run dev
```

Click the lawn, then WASD or arrow keys. In 3D, drag to look around, scroll or pinch to
zoom, double-click to recentre; `C` swaps the chase cam for an overview of the whole year
and `R` regrows. Toggle flat / 3D with the buttons. On a phone there is an on-screen pad;
the flat lawn scrolls sideways and follows the mower.

Mow every day to get the end card, with your time and a `copy brag` button.

```
npm run build          # dist/ uses relative paths, so it works on GitHub Pages
node scripts/smoke.mjs # pure-node assertions over the sim
```

### URL flags

| flag | what it does |
| --- | --- |
| `?view=flat` / `?view=deep` | which renderer to start in |
| `?year=2025` | pick a calendar year instead of the rolling 52 weeks |
| `?seed=123` | a different fake year (deterministic) |
| `?autodrive=1` | debug: holds the gas, useful for headless screenshots |
| `?cam=overview` | debug: start the 3D view on the overview camera |
| `?start=30` | debug: park the mower in a column (drive into a season) |
| `?yaw=45`, `?dist=6` | debug: preset look-around angle and camera distance |
| `?finish=1` | debug: mow everything before the first paint (end card) |

## Real data

`src/core/contrib.js` parses GitHub's contribution table (`td[data-date][data-level]`).
In a browser extension you can read it straight off the profile page. On a standalone
site github.com won't send CORS headers, so you need a tiny proxy (Cloudflare Worker or
Vercel function) that fetches `https://github.com/users/<name>/contributions` and returns
the HTML with `Access-Control-Allow-Origin: *`. Then:

```js
import { fetchContributions, daysForYear, yearsIn } from './core/contrib.js';
const days = await fetchContributions('torvalds', '/api/contributions');
const lawn = createLawn(daysForYear(days, 2025), { year: 2025 });   // one calendar year
// yearsIn(days) gives the year list for the picker
```

Without data, `generateFakeData(seed)` makes a plausible developer year: weekday-heavy, a
sparse January, a few multi-week streaks, one vacation gap and one heroic shipping week.

## Next

- [ ] hand-drawn tuft and mower textures instead of procedural strokes
- [ ] extension: content script that swaps `.js-calendar-graph` for the lawn
- [ ] sound
- [ ] share image export
