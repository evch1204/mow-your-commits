# Developer notes

Everything that is not needed to play or to put the lawn in a README.

## Layout

Two renderers share one model:

- `src/core/` — the lawn itself. Cells, mower physics, mowing detection, seasons,
  temperature by month, the shared palette and the `GRASS`/`grassFor` blade grammar both
  renderers draw from. No DOM, no rendering, no dependencies.
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
- `src/export/` — `lawnToSvg(lawn, opts)`, a pure function that draws the 2D board as SVG
  with the same geometry and palette. Used by the page's download buttons and by the
  GitHub Action. No DOM, no dependencies.
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

node scripts/render-svg.mjs --demo --outputs "docs/lawn.svg
docs/lawn-dark.svg?theme=dark"             # the README pictures
node scripts/render-svg.mjs --user torvalds --outputs "out/lawn.svg?animate=1"
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
picture is the board on the page. Details and every option: [`action/README.md`](../action/README.md).

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

## Ideas

- [ ] the animated README lawn mows the whole year, row by row, like the snake
- [ ] a hosted image URL (`/lawn.svg?user=`) for a one-line README embed
- [ ] hand-drawn tuft and mower textures instead of procedural strokes
- [ ] extension: content script that swaps `.js-calendar-graph` for the lawn
- [ ] sound
