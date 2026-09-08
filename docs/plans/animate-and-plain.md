# Plan: the README lawn mows the whole year, and can go plain

> Shipped. Every constant below was a starting point; `src/core/route.js` holds
> the tuned ones, and they differ (the backtracking idea became a frontier
> window, and the weave got faster and shallower).

Three changes to the exported picture (`src/export/svg.js`, the Action, the docs).
The site's 2D/3D renderers are not touched. Everything here must stay pure and
dependency-free: the Action runs `scripts/render-svg.mjs` with no `node_modules`.

## 1. `animate=1` mows the whole year on a wandering route

Today `animate=1` drives one row back and forth on an 8 s loop. Replace it: the mower
starts off the left edge with the lawn fully grown, wanders across the whole year on a
curved, seeded route until every grown day is cut, drives off the right edge, holds a
moment, and the loop restarts with everything regrown (an instant reset, like the
snake). The old row loop is deleted, not kept behind a flag.

### 1a. The route: `src/core/route.js` (new, pure, no DOM)

```js
export function planRoute(lawn, seed = 7) -> {
  waypoints: [{x, z}],          // cell units, same frame as lawn.mower (x along cols, z down rows)
  path: [{x, z}],               // dense samples along the smoothed curve, ~0.1 cells apart
  cuts: Map<cellIndex, s>,      // arc length (cells) at which each mowable cell is cut
  length: number,               // total arc length in cells
}
```

- Mowable cells: `!void && level > 0`. Cells of level 0 are never "cut".
- Start at `(-1.5, z0)`, `z0` seeded in `[1.5, rows - 1.5]`, heading +x.
- Greedy tour with a turn penalty and a weave. From the current point `p`, heading `h`,
  pick the unmowed cell `c` (centre `col+0.5,row+0.5`) that minimises
  `dist(p,c) + TURN_W * |turn(h, p->c)| + DRIFT_W * |c.z - zPref(s)| + JITTER * rnd()`.
  Suggested: `TURN_W 1.2` (cells per radian), `DRIFT_W 0.6`, `JITTER 1.2`, and
  `zPref(s) = rows/2 + A * sin(s / L + phase)` with `A ~ 2.2`, `L ~ 6` cells, `phase`
  seeded, `s` = arc length so far. The weave is what stops the greedy tour from settling
  into "one row after another": the route should cross rows in waves and curves. Tune
  these by looking at the picture, not by the numbers.
- Use the same 16807 LCG `rng` as svg.js (move it into `src/core` if it is not already
  shared, so both renderers and the exporter jitter identically).
- After picking `c`, append it, mark every unmowed cell whose centre is within
  `MOW_RADIUS` of the straight segment `p->c` as mowed (sample the segment every 0.2
  cells), then continue from `c` with heading `dir(p->c)`.
- When nothing is left, append `(cols + 1.5, z_last)` so the mower leaves the frame.
- Smooth: centripetal Catmull-Rom through the waypoints, then compute `path`, `cuts`
  and `length` on the *smoothed* curve: walk it in 0.1-cell steps, blade point =
  position + `BLADE_OFFSET` along the tangent, and a cell is cut the first time the
  blade point is within `MOW_RADIUS` of its centre (export `MOW_RADIUS` and
  `BLADE_OFFSET` from lawn.js; today they are module-private). If any mowable cell is
  still uncut after the walk (the curve can bow away from a segment), append those cells
  as extra waypoints before the exit and rebuild once more. Assert coverage in smoke.
- Deterministic for a given `(lawn, seed)`. Different seeds give visibly different routes.

### 1b. The SVG

In `lawnToSvg`, when `o.animate`:

- `mowed` is ignored (documented): at t=0 nothing is cut. The mower is always drawn.
- Base layer: every mowable cell is drawn **mowed** (the reveal colour, the stripes, the
  stubble `cuts`). Level 0 tiles as today.
- Cover layer: one `<g>` per mowable cell holding the grown tile, its frost cap, its tuft,
  dots and ink (the existing `coverGroup` generalised from one row to every cell) with
  `<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;t;t2;1" dur=.. repeatCount="indefinite"/>`
  where `t = (cuts[i] / length) * DRIVE`, `t2 = min(t + 0.004, (1 + t) / 2)`. Keep the
  existing "strictly increasing, ends at exactly 1" discipline; smoke already checks it.
- Mower: `<g id="mower" transform="translate(startX,startY)">` with an
  `<animateMotion dur=".." repeatCount="indefinite" rotate="auto" calcMode="linear" keyPoints="0;1;1" keyTimes="0;DRIVE;1" path="M0 0 C ..."/>`.
  Emit the Catmull-Rom spline as cubic Béziers (one `C` per span), in page pixels
  **relative to the start point**, because animateMotion composes with `transform`; the
  static translate is then also the fallback position for anything that ignores SMIL.
  `rotate="auto"` is right because the mower art faces +x. The inner `<g>` keeps only
  `scale(MOWER_SCALE)`.
- Timing: `SPEED = 7` cells per second, `HOLD = 1.6` s parked off the right edge, so
  `dur = length / SPEED + HOLD` and `DRIVE = (length / SPEED) / dur`. Expect a loop
  around 40-60 s for a full year.
- Size: the covers cannot batch by colour, so the animated file will be bigger. Keep
  the animated SVG under 450 kB (raise the smoke cap for animated only; the still stays
  under 200 kB). Two decimals, no trailing zeros, as today.
- Delete `coverGroup`'s row logic, `LOOP`, `animRow`, and the `animateTransform` path.

### 1c. Verifying it

Headless Chrome advances SMIL under `--virtual-time-budget`, but for exact frames use a
harness: an HTML file in the scratchpad that inlines the SVG and runs
`const s=document.querySelector('svg'); s.pauseAnimations(); s.setCurrentTime(T)` with
`T` from the URL hash. Shoot t = 0, ~1/3, ~2/3, and just before the end. Look for:
the mower pointing along its path, curves not row-by-row straight lines, every grown
tile gone by the end, nothing cut at t=0, the mower off-frame during the hold.

## 2. `weather=0` and `bg=0`: a plain chart for people who just want the graph

New `lawnToSvg` options, both default on:

- `weather` (`weather=0` in an output line): no seasons at all. No month glyphs, no
  frost caps, no snow dots on blade tips, no flakes or leaves on bare tiles, no turned
  autumn blades, no spring flowers, no climate-coloured bed (one neutral summer soil
  colour, `soil(2)`), and **no season tint** on the greens: add a `NO_SEASON = -1`
  handled in `palette.levelGreen` (and anything else that indexes `SEASON_TINT`) as
  zero tint, so the tiles are GitHub's exact ramp. Dandelions on heroic days stay: they
  are about the data, not the weather. The legend follows the same rule.
- `background` (`bg=0`): no paper rect (transparent), and the Mon/Wed/Fri halo stroke is
  dropped since there is no paper to halo against.

Wire both through `scripts/render-svg.mjs` (`parseOutput`), the `action.yml` input
description, `action/README.md` and the README option table.

## 3. The README hero is the animation itself

- Regenerate `docs/lawn.svg` and `docs/lawn-dark.svg` with `--demo` and `?animate=1`
  (`?theme=dark&animate=1`). The `<picture>` in README.md keeps pointing at them; GitHub
  renders them as `<img>` so SMIL plays.
- Snippets: README.md, `action/README.md`, `src/share.js` `workflowYaml()` and the
  `action.yml` default `outputs` all become
  `dist/lawn.svg?animate=1` and `dist/lawn-dark.svg?theme=dark&animate=1`.
- Docs: rewrite the `animate` row and the "Want it to move?" paragraph, add `weather`
  and `bg` rows, mention `mowed` is ignored under `animate`, add `src/core/route.js` to
  DEV.md's layout section, tick off the "mows the whole year" idea, and add the
  `setCurrentTime` harness to the screenshots section.

## Tests (`scripts/smoke.mjs`)

- route: covers every mowable cell; deterministic per seed; two seeds differ; path
  length between 1x and 3x the mowable count; fewer than half of consecutive waypoint
  pairs share a row (the "not row after row" guard); ends past the right edge.
- animate: `<animateMotion` present with `keyPoints`/`keyTimes` valid; exactly one
  opacity `<animate>` per mowable cell; the existing keyTimes discipline holds for all
  of them; deterministic; nothing external; the still has no `<animate`; animated size
  under 450 kB; `animate` + `mowed=1` still animates (mowed is ignored).
- weather=0: no glyph markup, no `id="frost"`, no `#85B7EB`, no leaf ellipses, greens
  are the exact ramp hexes; bg=0: no paper rect and no `stroke="<paper>"` on labels.
- `node scripts/render-svg.mjs --demo` with `node_modules` removed still works (ci.yml).
