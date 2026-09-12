# README drive: a mower with a plan, on GitHub's own background

**Complaint (owner, 2026-09-12).** The animated README lawn "only moves
horizontally back and forth" and feels unnatural: seven long row passes,
evens then odds, so half the loop is a striped board of alternate cut rows,
and the only turns are the U-turns off the edges. "A small occasional
randomness and turn might be better." And the cream paper rectangle
(`#FBF9F2`) sits as a beige box on GitHub's white README; the picture should
sit on the README background, not on its own sheet.

Both are about one thing: this picture has to be something a stranger wants
in their profile. The two streams below can be built in parallel; they touch
`src/export/svg.js` in different regions (A: the timing / fx / route half,
below `SPEED`; B: `normalize`, the paper rect, the label halo).

Verify with headless Chrome (recipe at the end), on a `#ffffff` page for light
and `#0d1117` for dark, at named SMIL times. Look at the frames yourself.

---

## Stream A: the drive (`feat/readme-drive`)

Owns: `src/core/route.js`, `src/export/svg.js` below the `SPEED` constant
(plus `lawnToSvg`'s width `W` and steps 8a/8b/9), the route + animate section
of `scripts/smoke.mjs` (from `// --- the route the animated mower drives` to
the end of the SMIL-validity checks).

### A1. Two ways to mow, chosen by the seed

`planRoute(lawn, seed)` keeps its signature and return shape
(`{waypoints, curve, cuts, length}`; `curve` spans carry `kind`), plus a new
`strategy` string on the result. The seed picks one of:

1. **`spiral`** (the ride-on mower's way): around the outside, then inward.
   Enter from off-left along the top row (`ENTRY_X`, run-in straight), corner
   with a **radius-1 quarter arc that stays on the board** (an arc from
   `(xr-1, zt)` to `(xr, zt+1)` about `(xr-1, zt+1)` cuts the corner cell: its
   centre is 0.41 from the arc, under `MOW_RADIUS`), drive down the last
   column, along the bottom row, up the first column, and arc into the next
   ring. Ring k is rows `k` / `rows-1-k` and columns `k` / `cols-1-k`; with
   seven rows that is three rings and a final pass along row 3, which drives
   off the right edge to `PARK_X`. Mirror variant: enter along the bottom row
   and go anticlockwise (still ends on row 3, still exits right).
   Column legs are 5, 3 and 1 cells: no weave on legs under 3 cells.
2. **`rows`** (the stripe mower's way): adjacent rows in a serpentine, top to
   bottom or bottom to top, so the cut stripes grow in order instead of
   alternating. Between rows an **omega turn** (what a tractor does when the
   next swath is closer than its turning circle): three tangent arcs of one
   radius `r`, turn away by `a`, round through `180 + 2a` degrees, back by `a`,
   with `cos a = (1 + 2r) / (4r)` so the net shift is exactly one row. Use
   `r = 0.9` cells (`a` about 39 degrees); the loop then reaches about 2.0
   cells past the board edge. Seven passes; pass 0 heads east, so the last
   heads east too and parks off the right edge.

`kind` per span: `'drive'` on passes, `'turn'` on arcs (corner or omega).
Keep `pass()` and its weave for the long passes. Delete the evens/odds order.

The picture needs room for the omega and for the mower's nose: under
`animate`, `lawnToSvg` uses a right pad of **64 px** instead of `GEOM.PAD_R`
(the still keeps `1068 x 267`). On the left `OX = 58` already holds it:
a 2.0-cell excursion reaches x of about 19 and the nose about 3. Add a test
that samples the whole motion path and asserts the mower centre stays at
least 17 px inside `[0, W]` horizontally and inside `[OY - 30, H - 40]`
vertically.

### A2. The clock has moods

`loopTiming` becomes per-span rather than per-kind. Each span gets a `speed`
(cells/s) from the planner:

- passes: `SPEED` (keep 9), turns: `TURN_SPEED` (keep 5.5);
- **thick grass slows the tractor**: a drive span whose swath (cells within
  `MOW_RADIUS` of the blade along it) holds a level-4 day runs at 0.7x, a
  level-3 day at 0.85x. Real, data-driven, and busy weeks read as effort.
  Compute it in `planRoute` (it has the lawn); stamp `sp.speed`.
- **pauses**: one to three times per drive (seed-driven, never on the first
  pass and never inside a turn) the mower stops for 0.6 to 0.9 s: a
  zero-length span `{kind: 'pause', secs}` at a knot on a pass. In the keys
  that is the same `keyPoints` value twice with `keyTimes` advancing (`at()`
  already guards the zero-width division). The clippings stop while the mower
  stands (the clippings `<g>` gets its own opacity animate with a `0` window
  per pause); the exhaust keeps puffing, the blade keeps spinning.

Merge consecutive spans with equal speed so the key lists stay short
(target under 120 keys). The track-reveal `values` lists follow `timing.cells`
as they do now. Keep the whole loop between 40 and 55 s for the demo lawn.

### A3. Small life on the tractor

- **Engine bob**: an additive `animateTransform type="rotate"` on the art
  group, `values="-1.2;1.2;-1.2"`, `dur="0.16s"`, `repeatCount="indefinite"`.
  A parked tractor must not shiver: gate it with the fx (put it under the
  same opacity gate, or key its values to the loop so it is `0` in the hold).
- **Dandelion seeds**: when the blade reaches a `cell.heroic` day, six seeds
  (r 1.1 circles, fill `FLUFF`, no stroke) burst from the tile centre: one
  `<g>` per heroic cell holding one `<path>` of six circles placed on a
  1.5 to 2.5 px ring, with an opacity window `0;0;1;0;0` over
  `0; t; t+0.001; t+0.02; 1` of the loop (about 1 s at a 50 s loop) and an
  additive `animateTransform type="scale"` from 1 to 4 about the tile centre
  (translate the group to the centre, scale about the origin) over the same
  window, plus a `translate` drifting up 6 px. Draw them after the covers
  and before the mower. Zero heroic cells = no group.

### A4. Tests (`scripts/smoke.mjs`, the route section)

Keep every existing route assertion except:
- "one pass per row plus turns" becomes bounds `rows*cols < length <
  rows*cols*1.35` for both strategies (assert both `route.strategy` values
  appear across seeds 1..12, and that both cut every grown day);
- "never turns tighter than a one-cell radius" becomes threshold `1 / 0.85`;
- the animateTransform count: recount (blade 1, clippings 10, bob 1, seeds
  2 per heroic cell) and derive it from the lawn, not a literal;
- add: at least one pause span, with keyTimes strictly increasing while
  keyPoints repeat; the mower-stays-in-frame test from A1; the SMIL validity
  loop must also check `animateTransform` elements' keyTimes.

---

## Stream B: the canvas (`feat/readme-canvas`)

Owns: `src/export/themes.js`, `src/export/svg.js` in `normalize`, the paper
rect (step 1) and the label halo (step 10) only; `scripts/render-svg.mjs`;
the svg-export section of `scripts/smoke.mjs` (before the route section);
`README.md`, `action/README.md`, `action.yml`, `docs/DEV.md`; `src/style.css`
if the site preview needs a ground.

### B1. The picture sits on GitHub's background

- `THEMES.light.paper` becomes `#FFFFFF`, GitHub's light canvas, and stays the
  colour every mix and halo assumes behind the picture (`bed()` mixes soil
  with it; that is meant to lighten toward the canvas). Dark stays `#0D1117`.
  Keep the cream sheet available as `THEMES.light.sheet = PAPER`
  (`dark.sheet` = its paper).
- `background` grows a third value. `normalize`: `o.background` is
  `'none' | 'canvas' | 'paper'`; **default `'none'`** (transparent), because a
  transparent picture matches every GitHub theme, dimmed and high-contrast
  included, and any other host. `'canvas'` fills `theme.paper`; `'paper'`
  fills `theme.sheet`. Accept the old booleans: `true` is `'canvas'`,
  `false` is `'none'`.
- The Mon/Wed/Fri halo is drawn only when a background is filled (as now, in
  that fill colour); transparent means no halo, the mower passes behind the
  letters for a few frames, which is fine on every theme and never paints a
  wrong-coloured box.
- `render-svg.mjs`: `bg=0` is `'none'`, `bg=1` is `'canvas'`, `bg=paper` is
  `'paper'`; omitted means the default.
- Check `tileColor` / level-0 `BARE` on white in the frames: if the bare
  tiles look dirty on white rather than "paper dirt", say so in the report
  rather than retuning palette.js (not owned).

### B2. A different drive every night

`render-svg.mjs`: when `--seed` is not given, seed from the UTC date
(`Math.floor(Date.now() / 86400000)`) and log it (`  seed 20706`). The site
preview (`src/app/readme.js`) keeps its default. Stream A makes the seed pick
the strategy, the weave and the pauses, so a profile README mows a fresh
route every morning. Say so in the README and `action/README.md`
("it mows a different route every night").

### B3. Words

- README "Options" table and the paragraph above it: `bg` is now
  `0` (default, transparent), `1` (GitHub's canvas colour), `paper` (the
  cream sheet); the animate line describes the two ways it mows (round the
  outside and inward, or stripe by stripe with a loop turn at each end), the
  thick-grass slowdown, the pauses, and the nightly variety. Same in
  `action/README.md` and `action.yml`'s `outputs` description. `docs/DEV.md`
  ideas list: tick the new item.
- Do **not** re-render `docs/lawn.svg` / `docs/lawn-dark.svg`: that happens
  at integration, after A lands.

### B4. Tests

Existing export tests that assume a paper rect (`fill="#FBF9F2"`, the halo)
move to `background: 'paper'` / `'canvas'`; add: the default has no leading
`<rect width="100%"`, `bg=1` fills `#FFFFFF` in light and `#0D1117` in dark,
`bg=paper` fills `#FBF9F2`, `parseOutput('x.svg?bg=paper')` gives `'paper'`,
and a still with no background carries no `paint-order` halo.

---

## Verifying a frame (both streams)

```
node scripts/render-svg.mjs --demo --seed 3 --outputs "out/l.svg?animate=1
out/d.svg?theme=dark&animate=1"
```

Wrap each SVG inline in an HTML file on the GitHub canvas
(`<body style="margin:0;padding:20px;background:#ffffff">` light,
`#0d1117` dark) with

```html
<script>
const s = document.querySelector("svg");
s.pauseAnimations();
s.setCurrentTime(parseFloat(location.hash.slice(1)) || 0);
</script>
```

and shoot named times:

```
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --hide-scrollbars --window-size=1180,330 --virtual-time-budget=2000 \
  --screenshot=out/l-12.png "file:///.../l.html#12"
```

Shoot t = 0, a turn (find one from the `keyTimes` of the `<animateMotion>`:
a short segment at turn speed), a pause, a third, two thirds, one second
before the drive ends, and inside the hold. Both strategies (two seeds),
both themes. `node scripts/smoke.mjs` must print `all good`.
