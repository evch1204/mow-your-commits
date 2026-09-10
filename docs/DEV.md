# Developer notes

Everything that is not needed to play or to put the lawn in a README.

## Layout

Two renderers share one model:

- `src/core/` — the lawn itself. Cells, mower physics, mowing detection, seasons,
  temperature by month, the shared palette, the flat board's geometry (`board.js`), the
  `GRASS`/`grassFor` blade grammar and, in `grass.js`, the five silhouettes themselves —
  written as *drawing ops* (filled paths, strokes, ovals, in board pixels) rather than as
  drawing. The canvas replays them and the SVG exporter serialises them, from the same
  list in the same order, so the picture in a README cannot drift from the board on the
  page. The 3D renderer takes only `tuftY` and the level's `kind` and carries its own
  cards. No DOM, no rendering, no dependencies.
- `src/render2d/` — hand-drawn canvas at the proportions of the real graph: 52x7 rounded
  tiles on a dirt bed whose colour follows the climate of each column, month labels with a
  season doodle, Mon/Wed/Fri down the left, legend bottom right. The whole year's weather
  is on screen at once: snow over winter columns, blossom over spring, dandelion fluff over
  summer, leaves over autumn. Six modules: `index.js` (the Renderer2D class — the frame,
  the layers, `setLawn`), `pen.js` (the jitter stream, the four wobbly primitives everything
  is built out of, and the replay of `core/grass.js`'s ops; Renderer2D extends it and the
  other modules take the renderer as their pen), `grass.js` (the tile and the silhouette
  standing on it), `mower.js` (the rig, its tracks, puffs and clippings), `weather.js`
  (the year's climate and the bare-tile dressing) and `overlays.js` (+N popups, the day
  tag, Mon/Wed/Fri, the key).
- `src/render3d/` — Three.js with cel shading, ink outlines, a "boiling" wobble shader and
  wind sway. Instanced tiles, doodle grass cards, a sky dome, fog, hills, trees that change
  with the season, a sun that climbs in summer and sits low in winter, and weather that
  follows the mower. `index.js` is the wiring — the frame, `setLawn`/`applyLawn`, the
  public API — and the drawing lives next door: `theme.js` (3D-only colours and numbers),
  `materials.js` (boil, sway, the cel gradient map, the inverted-hull ink), `doodle.js`
  (every texture in the scene, drawn with a pen on a canvas — grass cards, trees, hills,
  sky and farm props, month signs), `board.js` (slab, meadow, fence, signs, hill lines,
  treeline, barn and windmill), `grass.js` (one instanced box per day and the crossed-quad
  tuft card standing on it), `mower.js` (the rig and its pose), `weather.js` (the season
  weights that drive sky, fog, lights, snow, blossom, leaves, fluff), `camera.js` (chase
  ↔ overview, the orbit, and the fit that frames the whole year), `effects.js` (clippings,
  puffs, dust, tyre ribbons, +N labels — one instanced pool each) and `post.js` (the
  screen-space sketch pass: a depth-only Sobel that inks every edge, paper grain over the
  top, a vignette, and the sample offset boiling on `uSeed`). The pass is depth-only on
  purpose — the reason a normal pass is not used is written at the top of `post.js`: a
  `MeshNormalMaterial` override drops every map and `alphaTest` with it, so the grass
  cards would come back as solid rectangles and the ink would draw a field of boxes. The
  mower keeps its inverted hulls for the panel lines depth cannot see.
- `src/app/` — the page, split by job. `input.js` is the four booleans the mower steers
  by (the keys, the on-screen pad, the `C` and `R` shortcuts); `hud.js` owns the strip over
  the board, the last-mowed tag, the combo field and the end card; `readme.js` owns the
  README preview, the downloads, the copies and the three install buttons; `debug.js`
  reads every URL flag and holds `autodrive` and the two prewarms. `src/main.js` is the
  wiring left over: which lawn, which year, which renderer, and the frame loop.
- `src/style.css` — the whole page, in one file. `main.js` imports it, so Vite hashes it
  into the build and `index.html` carries no `<style>` block.
- `src/sound.js` — every noise the page makes, out of WebAudio oscillators and one buffer
  of white noise: an engine hum whose pitch, brightness and gain follow `|mower.vel|`, a
  band-passed puff per cut, a two-note chime on a heroic day, a four-note fanfare on the
  end card. No assets, and nothing in it may throw. Silent until the 🔇 button next to
  `regrow` is pressed, because no browser will start an `AudioContext` outside a gesture;
  the choice lives in `localStorage` under `mow:sound` and is restored at the first click
  or keypress of the next visit (`?sound=0` skips that restore).
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
- `src/share.js` — share links, brag text, the markdown snippet, the workflow yaml, and
  the four github.com URLs behind the three-step install: `newWorkflowUrl` (GitHub
  pre-fills its own new-file editor from `?filename=` and `?value=`), `actionsUrl`,
  `editReadmeUrl` and `newRepoUrl` (`github.com/new` has taken `owner`, `name`,
  `description` and `visibility` since April 2023, and ignores what it cannot honour).
  Every one runs its argument through `parseUserInput` and answers `''` for anything that
  is not a login, which is how the page knows to nudge at the username box instead of
  opening a tab on somebody else's repo.
- `scripts/render-svg.mjs` — what the Action runs. Imports only `src/core` and
  `src/export`, so it works with `node_modules` deleted (CI asserts this).

Grass reads the *count*, not just the level: the level picks the *shape* — `bare` (a dirt
tile with two pebbles), `sprouts` (three thin blades), `tuft` (five or six blades on a
small outlined clump), `bush` (a filled three-lobe silhouette that spills past the tile)
and `hedge` (taller than a tile, so it overlaps the row above, with seed heads on top and
a hatched shadow below) — and each cell then carries a `vigor` (where its count sits
inside its own level's range) that scales it 0.85..1.15, so a 40-contribution day grows
taller, denser and darker than a 12 in the same green. The top 3% of days are `heroic`:
the hedge, plus a dandelion and its seed puff.

**The combo.** `tick` keeps `lawn.combo`, `lawn.bestCombo` and `lawn.lastCutAt` (seconds
of `lawn.time`). A cut inside `COMBO_WINDOW` (0.9 s) of the last one raises the run;
anything slower resets it to 1, and a frame that catches several cells is one link, not
several. The HUD shows it from 3 up and pulses on each rise, the end card keeps the best,
the brag line mentions it from 5 up, and the renderers may add `x{combo}` to the +N popup.

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
| `?sketch=0` | debug: turn off the 3D sketch post pass, for comparison shots |
| `?stats=1` | debug: log the 3D draw calls and triangles once, on the first frame |
| `?sound=0` | do not restore a remembered "sound on", so a screenshot stays silent |

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
  "http://localhost:4173/?view=flat&autodrive=1&sound=0"
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
- [x] sound
- [ ] a leaderboard for the fastest mow of a given year
