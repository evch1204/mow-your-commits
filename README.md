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

Type a GitHub username in the box above the lawn and it becomes that account's real
graph. Pick a year from the list beside the lawn, just like on a GitHub profile: the
years offered are exactly the years that profile's own year picker shows. The rolling
"last year" is 52 weeks; a calendar year is GitHub's 53- or 54-column grid, with void
cells before 1 Jan and after 31 Dec (and after today, in the current year) that are
drawn as nothing and can't be mowed.

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
node scripts/smoke.mjs # pure-node assertions over the sim + the data layer
node scripts/smoke.mjs --live torvalds   # also hits the real contributions API
```

### URL flags

| flag | what it does |
| --- | --- |
| `?view=flat` / `?view=deep` | which renderer to start in |
| `?year=2025` | pick a calendar year instead of the rolling 52 weeks |
| `?user=torvalds` | load a real account (a login, not a URL) |
| `?seed=123` | a different fake year (deterministic), demo lawn only |
| `?autodrive=1` | debug: holds the gas, useful for headless screenshots |
| `?cam=overview` | debug: start the 3D view on the overview camera |
| `?start=30` | debug: park the mower in a column (drive into a season) |
| `?yaw=45`, `?dist=6` | debug: preset look-around angle and camera distance |
| `?finish=1` | debug: mow everything before the first paint (end card) |

## Real data

Type `torvalds`, `@torvalds` or `https://github.com/torvalds/` into the box above the
lawn (or open `?user=torvalds`) and the lawn becomes that account's real contribution
graph: GitHub's own levels, GitHub's own year list, days after today left blank. No
account, no token, no backend. A loaded account is remembered in the URL, so the link
is shareable; `back to the demo` puts the fake lawn back.

The site calls **`https://github-contributions-api.jogruber.de/v4/<login>`**, the one
CORS-open public mirror of the contribution graph (github.com itself sends no
`Access-Control-Allow-Origin`). Two requests per cold load: `?y=all` for the whole
history and the year list, `?y=last` for GitHub's rolling 53-week window. That API
caches for an hour and limits *uncached* requests to 10 per 10 seconds per IP, so the
site keeps its own `localStorage` cache: six accounts, fresh for an hour, usable for a
week if the API is unreachable. Organisations have no contribution graph and come back
as "not found".

```js
import { fetchContributions, parseUserInput } from './core/github.js';
import { daysForYear, daysForRolling } from './core/contrib.js';

const login = parseUserInput('https://github.com/torvalds/');   // -> 'torvalds'
const data = await fetchContributions(login, { today: '2026-09-08' });
// { days: [{date, count, level}], years: [2026, ..., 2011], totals, last }

createLawn(daysForYear(data.days, 2025, today), { year: 2025 });  // one calendar year
createLawn(daysForRolling(data.last), { year: null });            // the rolling window
```

`src/core/github.js` is pure: `fetch` and the storage are injectable, so it all runs
under node, and every failure is a `GithubError` with a `kind` the page turns into a
sentence (`invalid`, `notfound`, `ratelimited`, `network`, `malformed`, `token`).

### The optional token

Under **or paste a token** you can hand the page a GitHub token, and it queries
`api.github.com/graphql` (`contributionsCollection`) directly instead: no shared rate
limit, no third party, and your *own* account's private contributions are included. A
fine-grained personal access token with **no permissions at all** is enough.

The token is stored only in your browser (`localStorage`), sent only to
`api.github.com`, and never put in a URL — `?token=` is stripped from the address bar
on load. `forget` deletes it. If GitHub is unreachable the page falls back to the
public mirror; if the token is rejected it says so and changes nothing else.

### Without any of that

`generateFakeData(seed)` makes a plausible developer year: weekday-heavy, a sparse
January, a few multi-week streaks, one vacation gap and one heroic shipping week. That
is the demo lawn, and it stays on screen (and playable) while a real one is loading and
after any failure. `?seed=123` picks a different one.

`parseContributions()` in `src/core/contrib.js` still reads GitHub's own
`td[data-date][data-level]` table, for the browser-extension idea below.

## Next

- [ ] hand-drawn tuft and mower textures instead of procedural strokes
- [ ] extension: content script that swaps `.js-calendar-graph` for the lawn
- [ ] sound
- [ ] share image export
