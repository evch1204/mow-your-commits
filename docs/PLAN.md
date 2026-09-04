# mow-your-commits — v0.2 plan: "mow to reveal your year"

Personal for-fun project. Goal for this pass: make the 2D and 3D views feel awesome,
shareable, and unmistakably *both* a GitHub contribution graph *and* a lawn you mow.
Not in scope this pass: fetching other users' data, downloadable/README embeds.

## Review of what exists (commit 1f24eb4)

Good and must be kept:
- Clean split: `src/core/lawn.js` (pure sim), `src/render2d`, `src/render3d`. Keep it.
- The doodle look: Patrick Hand font, ink outlines, "boiling" wobble that re-seeds ~8x/s,
  hand-drawn strokes, warm paper background `#FBF9F2`, ink `#2C2C2A`. Keep all of it.
- Seasons by month, 3D weather props (sun, clouds, snow, leaves), fence + month signs.
- Chase-cam mower with tilt, wheel spin, clippings.

Problems (seen in a headless screenshot of the current build):
1. 2D grass is 1–4 thin strokes per cell; levels 1–3 are hard to tell apart and level 4 is
   only darker. Level 0 is a lone dot. Nothing reads as a *day block*.
2. There is no cell boundary, so the contribution graph shape (the thing people recognise)
   is invisible. It does not feel like GitHub.
3. Mowing gives no information. The whole point of driving over a day should be seeing
   what that day was. "Mowed 0%" is the only feedback.
4. Mowed cells become two faint lines ("stubble"). No satisfying before/after.
5. 3D: every cell is the same 5-blade crossed sprite scaled in Y. From the chase cam,
   level 1 vs level 4 is a subtle height difference. Mowed = shorter + paler. Level 0 is
   invisible dirt so the graph silhouette is lost here too.
6. 3D chase cam is so low and close that you never see the year as a whole.
7. No touch input. Reddit/X traffic is mostly phones; today it is unplayable there.
8. Nothing happens at 100%. No timer, no stats, no bragging moment.
9. `vite build` uses absolute `/assets` paths, so `dist/` breaks on GitHub Pages.
10. Fake demo year is a sine wave over the year; it does not look like a developer's
    graph (streaks, weekend dips, a vacation gap, one heroic week).

## The core idea

**Unmowed = overgrown doodle grass hiding the graph. Mowed = the clean GitHub tile
underneath.** The more you mow, the more your real contribution chart appears. Mowing IS
the reveal. Every cell must read as (a) a GitHub day square and (b) a patch of grass.

Shared palette (put in `src/core/palette.js`, both renderers import it):
- GitHub greens, level 0..4: `#EBEDF0 #9BE9A8 #40C463 #30A14E #216E39`
  (level 0 in doodle land is a pale *bare dirt / paper* tile, not grey).
- Season tint is applied as a small lerp on top of the GitHub green (<= 25%) so the graph
  still reads as GitHub greens in every season. Winter desaturates, autumn warms.
- Ink `#2C2C2A`, paper `#FBF9F2`, cream `#FBF4DD`, mower orange `#D85A30`, sun `#FAC775`.

## 2D (`src/render2d`)

Layout: mimic GitHub's box. Square-ish cells, `CELL=16`, `GAP=3` (pitch 19), rounded
corners r=3, 52x7. Grid origin leaves room for weekday labels (Mon/Wed/Fri) on the left
and month labels on top exactly like GitHub. Canvas internal width ~ 52*19 + margins
(~1060px); CSS scales it to the 720px stage (the canvas already does this).
Keep the hand-drawn wobbly border around the grid and the little fence ticks.

Per cell, unmowed (level L >= 1):
- Draw the rounded tile first: fill = season-tinted GitHub green for L, but *darkened and
  desaturated* a bit (it's overgrown), 1px wobbly ink outline at low alpha.
- Then grass on top, overflowing the tile: blade count = `[0, 3, 5, 7, 9][L]`, height =
  `[0, 5, 8, 11, 14][L]` px (+ per-blade jitter), stroke width `1.2 -> 1.8` by level,
  colour goes darker with level (level 4 = `#216E39`, level 1 = `#9BE9A8` mixed a bit
  toward ink so it is visible on the tile). Level 3-4 tufts overlap into neighbouring
  cells' gaps so dense weeks look like a hedge. Blades are drawn with the existing wobbly
  `line()` and boil with the rest of the doodle. Add 1-2 tiny "seed heads" (dots) on level
  4 blades.
- Level 0: pale bare tile `#EBEDF0`-ish with a couple of tiny pebble dots. This is what
  gives the graph its silhouette. Keep the seasonal dressing (snowflake / fallen leaf)
  but only on level-0 tiles so it never hides grass levels.

Per cell, mowed (animate over ~250ms via `mowT`):
- Grass blades shrink to stubble (height 2px, count halved) during the animation, then
  the tile shows the **exact GitHub green** for its level, fully saturated, plus a mow
  stripe: alternate columns (`col % 2`) get a slightly lighter fill, and 2 faint
  horizontal stroke lines across the tile suggest the cut. This is the "reveal".
- Clippings: spawn `2 + 2*L` particles, size 2-3px, tinted with the cell's green, arcing
  away from the mower and fading. Current ones are too few and too small.

Mow feedback (this is the "show contribution" requirement):
- On mowing a cell with `count > 0`, spawn a floating label `+N` in Patrick Hand, ink
  colour, rising ~18px over 700ms and fading. If several cells are mowed in the same
  frame, sum them into one label at the mower position.
- Next to the mower draw a small doodle "tag" (cream rounded box, ink outline) with the
  **last mowed day**: `Tue 14 Mar - 12 contributions` (`0 -> "nothing that day"`). It
  follows the mower with a little lag and hides after 2s of no mowing.
- Legend: `less [tile+tuft L1..L4] more` drawn with the same tile+tuft routine so it
  doubles as a key for how grass maps to levels.

Mower: keep the current doodle mower but make it ~1.3x bigger relative to the new cells,
add an exhaust puff (2-3 grey circles) when accelerating, and spin the blade disc faster
with speed. Small "tyre track" marks (two faint lines) fade behind it.

## 3D (`src/render3d`)

Tiles:
- One `InstancedMesh` of a rounded box (`BoxGeometry(0.86, 0.14, 0.86)` is fine; give it
  a tiny bevel via a slightly smaller top box if cheap) - one per cell, per-instance
  colour = same rule as 2D (overgrown-dark while unmowed, exact GitHub green when mowed,
  `col % 2` stripe when mowed). Level 0 = pale tile, no grass. The gap between tiles
  shows the brown dirt base so the grid reads from any angle.
- Column ground strips (`colMats`) go away; the base + tiles replace them.

Grass:
- Build a real tuft geometry: N tapered blades (thin triangles, 3 segments each so they
  can bend) arranged in a circle with random lean. Make **four** tuft geometries for
  levels 1-4 with blade counts `[3, 5, 8, 12]` and heights `[0.35, 0.6, 0.9, 1.25]`, and
  four `InstancedMesh`es (one per level), so a level-4 week looks like a hedge and a
  level-1 week like sparse sprouts. Per-instance colour, `MeshToonMaterial` with the
  gradient map, `DoubleSide`.
- Vertex shader (extend the existing `wobbly()` hook): add wind sway
  `sin(time*1.6 + worldX*0.7 + worldZ*0.4) * y*y * 0.12` on top of the boil jitter, so
  the field ripples. A per-instance "bend away from the mower" is nice-to-have only.
- Mowed: instance scales to `y = 0.18` (stubble), colour = exact GitHub green; a brief
  squash (`y` overshoot) on the mow frame. Keep the cut cell's tile colour vivid.
- Keep ink outlines on the mower/fence/props. Do not outline every blade (perf).

Feedback:
- Floating `+N` sprite (canvas texture, Patrick Hand) rising above the mower, same rule
  as 2D. The "last mowed day" tag lives in the HTML HUD (shared with 2D) so 3D does not
  need text meshes for it.
- Clippings: bump to `3 + 2*L` per cell, tinted with the level green.

Camera:
- Raise and widen the chase cam: FOV 50, target offset back 7.5 / up 6, look-at slightly
  ahead of the mower, smoothing kept. You should see ~12 columns and the fence signs.
- Add an **overview** camera (high three-quarter shot showing all 52 columns) toggled by
  key `C` and a button in the HTML. Lerp between the two so it feels like one camera.
- Keep the sky lerp by season.

Mower: keep. Add a tiny ink face on the cab (two dots + smile) - cheap, on-brand.

## Shared HUD / page (`index.html`, `src/main.js`)

- Frame the stage like GitHub does: a heading line **"1,234 contributions in the last
  year"** above the lawn (computed from `lawn.totalContributions`), the grid, and the
  legend at bottom-right. Title becomes "mow your commits" with a tiny doodle mower.
- Stats bar: `month under mower`, `mowed 42%`, `contributions mowed 512 / 1,234`, and a
  running `timer` that starts on first movement and stops at 100%.
- Last-mowed tag in HTML (used by both views): `Tue 14 Mar 2026 - 12 contributions`.
- **End card** at 100%: overlay in doodle style: "Lawn mowed! 1,234 contributions -
  52 weeks - 1:42", a short confetti of clippings, buttons `regrow` and `copy brag`
  (copies a plain-text line to the clipboard, e.g.
  `I mowed my GitHub lawn: 1,234 contributions in 1:42 - mow-your-commits`). No image
  export this pass.
- Touch controls: when `(pointer: coarse)` matches (or always on narrow screens), show
  an on-screen pad: left/right on the left, gas/reverse on the right, styled like the
  existing buttons. They feed the same `input` object. Pointer events with
  `touch-action: none`. Keyboard keeps working.
- `?view=deep|flat` URL param selects the initial view (also makes screenshots easy).
- `?seed=<n>` picks a different fake year (see below).
- Regrow resets timer, clippings, popups, end card.

## Core (`src/core`)

- `generateFakeData(seed)`: make it look like a real developer. Weekday-heavy, weekends
  ~35% as active, 2-3 multi-week streaks, one 1-2 week vacation gap, one "shipping week"
  of 4s, sparse January. Deterministic per seed (keep default seed identical every load).
  Level from count using GitHub-ish quartiles so `count` and `level` agree.
- `tick()` returns mowed indices as today; also expose `lawn.mowedContributions` (sum of
  `count` over mowed cells) and `lawn.lastMowed` (cell index or -1) so the HUD needs no
  extra loop. Add `lawn.time` (seconds, advances from the first movement until finished)
  and `lawn.finished`.
- Mower physics: nudge `MAX_SPEED` to 0.24 and make turning slightly tighter at low
  speed so you can line up passes on a 7-row field. Keep the outside-the-lawn margin.

## Housekeeping

- `vite.config.js` with `base: './'` so `dist/` works on GitHub Pages / any subpath.
- README: update run/controls, add a "how it looks" line, keep the contributions/proxy
  section. Keep the `Next` list (share image, extension, sound).
- No new npm dependencies. Three + Vite only.

## Definition of done

1. `npm run build` passes with no warnings other than the chunk-size one.
2. Headless screenshots of `?view=flat` and `?view=deep` (see below) show: visible day
   tiles with a clear GitHub-graph silhouette, four visibly different grass densities,
   level-0 tiles readable as bare, month + weekday labels, legend.
3. A node smoke test (`node scripts/smoke.mjs`) that creates a lawn, drives the mower
   through several rows with `tick()`, and asserts: mowed count rises,
   `mowedContributions` equals the sum of counts of mowed cells, `progress` reaches 1
   when every mowable cell is passed, `finished` flips, regrow resets everything.
4. Screenshot check after simulated movement: add a `?autodrive=1` debug flag that feeds
   `input.up=true` for the first 3s so a screenshot with `--virtual-time-budget` shows
   mowed tiles, popups, and the tag.

Headless screenshot recipe (Chrome is installed on this machine):

    npm run build
    npx vite preview --port 4173 --strictPort   (run in background)
    "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars --window-size=1000,800 --virtual-time-budget=6000 --screenshot=<scratchpad>/flat.png "http://localhost:4173/?view=flat&autodrive=1"

Then Read the PNG and actually look at it. Iterate on the look until it matches the plan.


---

# v0.3 - follow GitHub's year picker, live weather, a real mower, drag-to-look

User feedback on v0.2 (screenshots in scratchpad/shots): "looks a lot better", then:

1. GitHub shows every year and lets you pick one. We only show the rolling last 52 weeks.
2. In 3D the first two month signs are merged together (Aug/Sep overlap at the start).
3. In 3D, mouse drag should let you look around.
4. Weather and "temperature" should change only when you drive into that time frame.
   Winter should be almost snowy grass.
5. The 3D mower feels like a toy car. Make it read as a riding lawn mower.

Also carry over v0.2 rough edges: 3D overview has empty sky under the slab (needs a
horizon); summer sky is indistinguishable from the page paper; the 2D view shows the
last-mowed tag twice (on-canvas and in the HTML bar).

## 1. Year picker (core + both renderers + page)

Match GitHub's profile: to the right of the graph a vertical list of years, the active one
highlighted. Top entry is the rolling "last year" (current behaviour), then one entry per
calendar year, newest first. For the fake data offer the current year back 5 years; when
real data lands this becomes the account's years. On narrow screens the list becomes a
horizontal row of chips under the stage.

Calendar-year semantics, exactly like GitHub:
- Grid starts on the Sunday of the week containing 1 Jan and ends on the Saturday of the
  week containing 31 Dec. That is 53 columns (sometimes 54) with **void cells** before
  1 Jan and after 31 Dec.
- Void cells: `date: null`, `level: 0`, `count: 0`, `void: true`, never mowable, drawn as
  *nothing* in 2D (no tile, no pebbles) and as no tile/no grass in 3D (dirt shows).
- Month labels start at Jan. A month owning fewer than 3 columns still gets no label.
- Heading becomes `1,764 contributions in 2025` for a picked year, and keeps
  `... in the last year` for the rolling view.

Core changes:
- `COLS` stops being a hard constant that renderers read. `createLawn` returns
  `lawn.cols` (52, 53 or 54) and `lawn.rows = 7`. Both renderers must use `lawn.cols`.
  Keep an exported `MAX_COLS = 54` for buffer sizing (3D InstancedMesh counts).
- `createLawn(days, { year })` where `days` may include void entries, or a helper
  `layoutYear(days, year)` that pads a Jan 1..Dec 31 list into the 53/54-column grid.
- `generateFakeData(seed, year)`: `year == null` -> rolling 52 weeks ending today (current
  behaviour); a year -> every day of that calendar year. Seed the RNG with `seed ^ year`
  so each year looks different but deterministic.
- `resetLawn` and the mower start position use `lawn.cols`.
- `contrib.js`: add `daysForYear(days, year)` that filters a parsed list to a calendar
  year and pads voids via the same layout helper, so the real-data path will work later.
- Smoke test: add cases for a 53-column year and for void cells being unmowable and not
  counted in `mowable` or `totalContributions`.

Page: `?year=2025` URL flag. Picking a year rebuilds the lawn, calls `setLawn` on both
renderers (3D must rebuild signs, weather ranges, tile/grass instance counts), resets the
timer and end card. The 2D canvas width follows `lawn.cols`.

## 2. 3D month signs

Signs currently sit at `col + 2.1`, so a first month with 1-3 columns collides with the
next one. Rule: place a sign at the month's first column + 0.6; skip months owning fewer
than 3 columns (same as 2D); if two signs would still be closer than 3.2 world units,
drop the earlier one. Signs should also alternate post height slightly (1.9 / 2.2) so a
run of signs does not read as a single fence rail. Rebuild signs on `setLawn`.

## 3. Drag to look around (3D)

- Pointer drag on the 3D canvas orbits the camera: horizontal drag changes yaw, vertical
  drag changes pitch (clamp pitch 8-75 degrees). Wheel / pinch zooms the distance (clamp
  4-14 in chase, 25-60 in overview). Use pointer events with `touch-action: none`;
  a drag must not steal keyboard focus from the stage (still call `stage.focus()`).
- Chase mode: the orbit is *relative to the mower heading*. The yaw offset persists while
  the mower is not accelerating; once the player holds gas for > 0.5 s, ease the offset
  back to 0 over ~1.5 s so driving always returns to the chase framing.
- Overview mode: the orbit persists (it's a look-around camera), centred on the lawn.
- Double-click / double-tap resets the offsets. Add "drag to look around" to the hint.
- The drag must not conflict with the touch pad buttons (they stop propagation).

## 4. Weather follows the mower; winter is snowy grass

Today weather props are placed statically over the season's columns (snow over the winter
columns, leaves over autumn, sun over summer). Change to: **the scene's weather is a
function of the season under the mower**, blended smoothly as you cross month boundaries.

- Introduce `weatherMix[4]` (winter/spring/summer/autumn weights, sum 1) that lerps toward
  the one-hot of `seasonAt(lawn, mower.x)` at ~1.2/s. Every weather system reads it:
  - **Snow**: particle count/visibility x `mix[winter]`, falls over the whole visible
    scene around the camera target (respawn within +/-14 units of the mower), not just over
    winter columns. Larger flakes than the current points (use a small canvas-textured
    sprite `PointsMaterial` with a soft round dot, size ~0.35).
  - **Leaves**: x `mix[autumn]`, same follow-the-mower box.
  - **Sun + clouds**: sun sprite opacity/scale x `(mix[summer] + 0.5*mix[spring])`,
    clouds drift and their opacity x `(mix[spring] + mix[autumn] + 0.6*mix[winter])`.
    Anchor them to the camera target horizontally (skybox-ish), high up behind the fence.
  - **Sky colour**: already lerps by season; also lerp the hemisphere light colour
    (cool blue-white in winter, warm in summer) and the directional light intensity
    (0.8 winter -> 1.3 summer). Fix the summer sky: use `#DDEFFB`-ish clear blue so it is
    never confused with the paper background, and adjust `SEASONS[2].sky` in
    `src/core/lawn.js` (2D does not draw a sky so this is 3D-only in effect).
  - A small HUD word next to the month: `driving through January - snowing` /
    `- sunny` / `- leaves falling` / `- fresh` - one adjective per season.
- **Winter cells look wintry regardless of where the mower is** (the ground has a
  climate, the weather is what's happening now):
  - Winter-column tiles get a snow dusting: per-instance colour lerps toward
    `#F2F5F7` by ~55% while unmowed; the blade colour for winter is pale frosted green
    `#B9CFC0` with a white tip (add a vertical colour gradient in the sway/boil shader
    hook, or simpler: a second, shorter white-ish tuft instance overlapping the green one
    for winter columns; pick whichever is cheaper to get right).
  - Mowed winter tiles still reveal the GitHub green (the reveal rule wins), but with the
    <=25% winter tint already in `palette.js`.
  - 2D: winter columns already have the season tint; push it further so the tiles look
    frosted (lighter, cooler) and draw 1-2 tiny snow caps (white dots) on level 3-4 tufts.
    Keep the snowflake dressing on level-0 tiles.
- Autumn columns: a few orange/brown blades mixed into level 2-4 tufts (per-instance
  colour jitter toward `#BA7517` on ~20% of autumn cells). Spring: a couple of tiny
  flower dots (pink/white) on level-1/2 tiles in 2D and small sprite dots in 3D.

## 5. The 3D mower: a riding mower, not a toy car

Rebuild `buildMower()` as a recognisable riding lawn mower (John Deere / Husqvarna
silhouette) in the same toon + ink style. Overall footprint ~1.0 wide x 1.7 long, sits low.
Parts, front to back (front = +z in mower local space, matching the deck offset today):
- **Hood**: a low, slightly tapered box (orange `#D85A30`) with a rounded top edge
  (use a box + a half-cylinder or a slightly smaller box on top), a black grille strip at
  the front, two tiny round headlights (cream) with ink outlines.
- **Cutting deck** under the middle: a wide flat cylinder (dark grey), *wider than the
  body* so it visibly sticks out both sides, with a **discharge chute** (small angled
  box) on the right side. Clippings should spawn from the chute, not from under the
  centre.
- **Front wheels**: small (r 0.14) on a thin axle. **Rear wheels**: big (r 0.30) with
  chunky tread (a torus or a cylinder with 8 dark ridges) and a cream hub. Rear wheels
  larger than fronts is the riding-mower signature; do not skip this.
- **Seat**: a high-backed seat (dark grey box + backrest) behind the hood on a fender
  plate; a **steering wheel** (thin torus, ink) on an angled column rising from the hood.
- **Driver**: a simple figure sitting: torso (green shirt), two arm cylinders reaching
  the wheel, a round head with the existing ink face, a cap (small cylinder + brim) in the
  mower orange. Head bobs with the body; arms stay on the wheel.
- **Exhaust pipe** at the back-left with a puff every ~0.5 s while accelerating (2-3
  small grey spheres rising and fading, reuse the clippings loop).
- Animation: wheels roll with speed (rear slower than front by the radius ratio),
  subtle engine idle vibration on the whole body (`y += sin(t*60)*0.004`), tilt on
  accelerate/brake kept, and a lean into turns (`rotation.z` proportional to turn input
  x speed).
- Keep every part inked with the inverted hull. Total should still be < 40 meshes.
- Update the 2D mower doodle to match the new silhouette (big rear wheel, small front
  wheel, seat + driver seen from above, deck wider than body), so the two views agree.

## 6. Carry-over fixes

- **Horizon for 3D**: add a large flat ground plane far below the slab (e.g. a
  `PlaneGeometry(400, 400)` at `y = -0.9` in a paper/meadow colour, toon-shaded), plus
  a soft gradient sky (a big inverted sphere with a two-colour vertex gradient, or just
  set the ground plane colour to a lighter version of the sky so the horizon reads).
  The v0.2 attempt filled the frame because the plane was at the slab's height and the
  camera looked down; keep the plane well below and check the overview screenshot: the
  sky, sun and clouds must remain visible above the horizon line.
- **Duplicate tag in 2D**: the on-canvas doodle tag stays for the flat view; hide the
  HTML tag when `data-view="flat"`, show it in 3D.
- Legend tufts in 2D: draw them at 1.3x scale so level 1 vs 2 is legible after CSS
  scaling.

## Definition of done for v0.3

1. `npm run build` passes; `node scripts/smoke.mjs` passes with the new year/void cases.
2. Screenshots (same recipe): `?view=flat&year=2025` shows a Jan->Dec grid with void
   cells at the start/end drawn as nothing and the year list with 2025 highlighted;
   `?view=deep` shows non-overlapping month signs and the new mower clearly readable as a
   riding mower (big rear wheels, seat, driver, wide deck); `?view=deep&cam=overview`
   shows a horizon under the slab and the sky/sun still visible; a screenshot with the
   mower placed in winter columns (add `?start=<col>` debug flag to spawn the mower at a
   column) shows snowfall over the scene and frosted grass, and one in summer shows the
   sun, no snow, warm light.
3. Drag-to-look cannot be verified headlessly; verify by code review and by a screenshot
   with a `?yaw=45` debug flag that applies an orbit offset.
