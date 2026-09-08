# Developer notes

Everything that is not needed to play or to put the lawn in a README.

## Layout

Two renderers share one model:

- `src/core/` — the lawn itself. Cells, mower physics, mowing detection, seasons,
  temperature by month, the shared palette, the flat board's geometry (`board.js`) and the
  `GRASS`/`grassFor` blade grammar. The 2D canvas and the SVG exporter draw the grammar
  in full; the 3D renderer takes only `tuftY` from it and carries its own tuft builds.
  No DOM, no rendering, no dependencies.
- `src/render2d/` — hand-drawn canvas at the proportions of the real graph: 52x7 rounded
  tiles on a dirt bed whose colour follows the climate of each column, month labels with a
  season doodle, Mon/Wed/Fri down the left, legend bottom right. The whole year's weather
  is on screen at once: snow over winter columns, blossom over spring, dandelion fluff over
  summer, leaves over autumn.
- `src/render3d/` — Three.js with cel shading, ink outlines, a "boiling" wobble shader and
  wind sway. Instanced tiles plus four tuft builds scaled by the day's count. Sky dome,
  fog, hills, trees that change with the season, a sun that climbs in summer and sits low
  in winter, and weather that follows the mower.
- `src/loader.js` — the username form, its states, the `?user=` param, the token box.
- `src/core/route.js` — `planRoute(lawn, seed)`: the one wandering drive that mows every
  grown day, as waypoints, a smoothed spline, and the arc length at which each cell is
  cut. A greedy tour with a turn penalty, a sine weave down the rows and a sliding
  frontier window (only the leftmost few columns of standing lawn are in play), so it
  curves across the year instead of sweeping it row by row, and cleans up as it goes
  instead of leaving stragglers. Only the animated export uses it, but it is pure core:
  no DOM, no dependencies.
- `src/export/` — `lawnToSvg(lawn, opts)`, a pure function that draws the 2D board as SVG
  from the same geometry and palette. Used by the page's download buttons and by the
  GitHub Action. `svg.js`, `themes.js` and `font.js` touch no DOM and have no
  dependencies, so node can run them; `png.js` is the browser half, rasterising that SVG
  through a canvas for the download buttons.
- `src/share.js` — share links, brag text, the markdown snippet and the workflow yaml.
- `scripts/render-svg.mjs` — what the Action runs. Imports only `src/core` and
  `src/export`, so it works with `node_modules` deleted (CI asserts this).

Grass reads the *count*, not just the level: each cell carries a `vigor` (where its count
sits inside its own level's range), so a 40-contribution day grows taller, denser and
darker than a 12 in the same green. The top 3% of days are `heroic` and grow a dandelion.

## Commands

```
npm install
npm run dev
npm run build                              # dist/ uses relative paths (GitHub Pages)
node scripts/smoke.mjs                     # pure-node assertions over sim, data, export
node scripts/smoke.mjs --live torvalds     # also hits the real contributions API

node scripts/render-svg.mjs --demo --outputs "docs/lawn.svg?animate=1
docs/lawn-dark.svg?theme=dark&animate=1"   # the README pictures
node scripts/render-svg.mjs --user torvalds --outputs "out/plain.svg?weather=0&bg=0"
```

## URL flags

| flag | what it does |
| --- | --- |
| `?view=flat` / `?view=deep` | which renderer to start in |
| `?user=torvalds` | load a real account (a login, an @handle or a profile link) |
| `?year=2025` | pick a calendar year instead of the rolling 52 weeks |
| `?seed=123` | a different fake year (deterministic), demo lawn only |
| `?autodrive=1` | debug: drives a lap down the year and back, for headless screenshots |
| `?cam=overview` | debug: start the 3D view on the overview camera |
| `?start=30` | debug: park the mower in a column (drive into a season) |
| `?yaw=45`, `?dist=6` | debug: preset look-around angle and camera distance |
| `?finish=1` | debug: mow everything before the first paint (end card) |
| `?og=1` | debug: hide controls, year list and landing strips, for social-card shots |

Only `?user`, `?year` and `?seed` travel in a share link.

## Real data

The site calls `https://github-contributions-api.jogruber.de/v4/<login>`, the one
CORS-open public mirror of the contribution graph (github.com itself sends no
`Access-Control-Allow-Origin`). Two requests per cold load: `?y=all` for the whole history
and the year list, `?y=last` for GitHub's rolling window. That API caches for an hour and
limits uncached requests to 10 per 10 seconds per IP, so the site keeps a `localStorage`
cache: six accounts, fresh for an hour, usable for a week if the API is down.
Organisations have no contribution graph and come back as "not found".

```js
import { fetchContributions, parseUserInput } from './core/github.js';
import { daysForYear, daysForRolling } from './core/contrib.js';

const login = parseUserInput('https://github.com/torvalds/');   // -> 'torvalds'
const data = await fetchContributions(login, { today: '2026-09-08' });
// { days: [{date, count, level}], years: [2026, ..., 2011], totals, last }

createLawn(daysForYear(data.days, 2025, today), { year: 2025 });  // one calendar year
createLawn(daysForRolling(data.last), { year: null });            // the rolling window
```

`src/core/github.js` is pure: `fetch` and the storage are injectable, and every failure
is a `GithubError` with a `kind` (`invalid`, `notfound`, `ratelimited`, `network`,
`malformed`, `token`).

**The optional token.** Under "or paste a token" the page can query
`api.github.com/graphql` directly instead: no shared rate limit, no third party, and your
own private contributions included. A fine-grained personal access token with no
permissions is enough. It is stored only in `localStorage`, sent only to
`api.github.com`, never put in a URL (`?token=` is stripped on load). `forget` deletes it.

**Without any of that**, `generateFakeData(seed)` makes a plausible developer year and
that is the demo lawn. It stays on screen while a real one loads and after any failure.

## The Action

`action.yml` at the repo root is a composite action. It fetches the calendar through
GitHub's GraphQL API with the default action token, falls back to the public mirror, and
renders through the same `src/core` + `src/export` code the site uses, so the README
picture is the board on the page. Its default outputs carry `animate=1`, so the picture
that lands in a profile is the mower driving the year; `weather=0&bg=0` goes the other
way and gives a plain transparent chart in GitHub's own greens. Details and every
option: [`action/README.md`](../action/README.md).

## Screenshots

```
npm run build
npx vite preview --port 4173 --strictPort
chrome --headless=new --disable-gpu --use-gl=angle --use-angle=swiftshader \
  --enable-unsafe-swiftshader --hide-scrollbars --window-size=1000,900 \
  --virtual-time-budget=6000 --screenshot=out.png \
  "http://localhost:4173/?view=flat&autodrive=1"
```

Headless Chrome clamps its window to 500px wide, so `--window-size=390,844` quietly lies
about phone width. For a real 390px shot, point it at a local file holding
`<iframe width="390" height="844" src="http://localhost:4173/?view=flat">` and use
`--window-size=500,844`.

**An exact frame of the animated SVG.** `--virtual-time-budget` does advance SMIL, but not
to a time you can name. Inline the SVG in a scratch HTML file (an `<img>` or `fetch` from
`file://` will not do) and drive the clock yourself:

```html
<script>
const s = document.querySelector("svg");
s.pauseAnimations();
s.setCurrentTime(parseFloat(location.hash.slice(1)) || 0);
</script>
```

```
chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1100,320 \
  --virtual-time-budget=2000 --screenshot=t20.png "file:///.../harness.html#20"
```

Shoot t = 0 (nothing cut), a third, two thirds, one second before the drive ends
(everything cut, mower leaving) and inside the hold (mower off-frame). The loop length is
in the `dur` of the `<animateMotion>`, and the drive ends at its second `keyTimes` value.

## Ideas

- [x] the animated README lawn mows the whole year, on a wandering route
- [ ] a hosted image URL (`/lawn.svg?user=`) for a one-line README embed
- [ ] hand-drawn tuft and mower textures instead of procedural strokes
- [ ] extension: content script that swaps `.js-calendar-graph` for the lawn
- [ ] sound
