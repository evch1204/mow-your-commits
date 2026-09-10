# v0.5 — "sketchbook": the doodle look pushed all the way, and a one-click README

Three builders work in parallel from this document, each in its own worktree and
branch. The owner's ask, verbatim in spirit: *make the 2D and 3D lawns strongly show the
difference between busy and quiet days, push the doodle style hard (this is what catches
an eye on GitHub and Reddit), make the 3D background and resolution much better, make
mowing feel better to play, make the README integration simpler than copying a workflow
by hand (everything free, no backend), and leave the code cleaner than we found it.*

Read `README.md`, `docs/DEV.md` and `docs/plans/BRIEF.md` first. The v0.4 decisions in
`BRIEF.md` still hold (username-only data, GitHub Action for the README, static site, no
backend, Patrick Hand + ink + paper). This document only adds to them.

## Art direction: one sketchbook

Everything is drawn in ink on paper. The flat view is the sketch; the 3D view is the same
sketch popped up into a paper diorama. Signature elements, in both renderers:

- **Ink outlines** on every filled shape (2D: 1.4-1.8 px on a 16 px tile; 3D: screen-space).
- **Flat fills**, a **hatched shadow** where something stands off the ground, and the
  existing **boil** (re-seeded jitter ~8 fps) on every line.
- **Silhouettes, not strokes.** The day's count decides the *shape* of what grows, not
  just its height: a sprout, a tuft, a bush, a hedge. You should be able to read a
  person's year from across the room.
- Patrick Hand for every label. Colours from `src/core/palette.js`; GitHub's greens stay
  the greens, the reveal on mowing stays the exact GitHub tile.

## The grass grammar, v2 (shared by 2D, SVG and 3D)

| level | name | 2D silhouette (16 px tile) | 3D card (tile = 1 unit) |
| --- | --- | --- | --- |
| 0 | bare | paper-dirt tile, two pebbles, rare crack | flat tile, nothing |
| 1 | sprouts | 3 thin blades, 5-7 px, no outline | 0.3 high, 0.5 wide, 3 blades |
| 2 | tuft | 5-6 blades 8-11 px on a small filled clump with a 1 px ink outline | 0.6 high, 0.7 wide |
| 3 | bush | filled 3-lobe silhouette 12-16 px, 1.4 px ink outline, 4-5 darker inner strokes, spills 3 px past the tile sides | 1.0 high, 0.95 wide, dense |
| 4 | hedge | filled silhouette 17-24 px (taller than a tile, overlaps the row above), 1.6 px outline, 6-8 inner strokes, 2-3 seed-head ovals on top, a 3-line hatched shadow on the tile below-right | 1.5 high, 1.1 wide, darkest green |
| heroic | best 3% | the hedge plus a dandelion and a seed puff, bigger than today | the hedge plus a dandelion 1.8x |

Vigor (`cell.vigor`, 0..1 inside the level) scales height and width by 0.85..1.15.
`GRASS` in `palette.js` grows a `kind` row (`['bare','sprouts','tuft','bush','hedge']`)
and the new heights; `grassFor(level, vigor)` returns `{ kind, blades, height, width,
tuftY, spread }`. Builder A owns that change; builder B reads `tuftY`/`kind` from it.

## Streams

| stream | branch | worktree | owns |
| --- | --- | --- | --- |
| A doodle 2D | `feat/doodle-2d` | `../doodle2d` | `src/render2d/*`, `src/export/svg.js`, `src/core/palette.js`, `src/core/board.js`, `src/core/effects.js`, the exporter tests in `scripts/smoke.mjs`, `docs/lawn*.svg` |
| B doodle 3D | `feat/doodle-3d` | `../doodle3d` | `src/render3d/*` (split into modules), nothing in `src/core` (put 3D-only constants in `src/render3d/theme.js`) |
| C product | `feat/product` | `../product` | `index.html`, a new `src/style.css`, `src/main.js` (split into `src/app/*`), `src/share.js`, `src/loader.js`, `src/core/lawn.js` (combo fields only), new `src/sound.js`, `README.md`, `docs/DEV.md`, `action/README.md`, `.github/workflows/lawn.yml`, share tests in `scripts/smoke.mjs` |

Nobody edits a file another stream owns. If you need a change there, write it down under
"handoff" in your final report and the integrator applies it.

### Contracts that keep the three merges clean

1. Renderer public API is frozen. `Renderer2D`: `constructor(canvas, lawn)`, `setLawn`,
   `reset`, `draw(ts)`, `onMowed(indices, quiet)`, `sampleTrack`. `Renderer3D`: the same
   plus `applyLawn`, `resize`, `toggleCamera`, `setCamera`, `setOrbit`, `setDistance`.
   `src/render2d/index.js` and `src/render3d/index.js` keep exporting those classes.
2. `createLawn` / `tick` signatures and every existing cell field stay. C adds
   `lawn.combo`, `lawn.bestCombo`, `lawn.lastCutAt` (seconds of `lawn.time`), maintained
   in `tick`: a cut within 0.9 s of the previous cut raises `combo`, otherwise it resets
   to 1. A and B may read `lawn.combo || 0` and, when it is 3 or more, add ` x${combo}`
   to the +N popup and scale it up; nothing else depends on it.
3. Every element id in `index.html` today keeps its id. C may add ids, move sections and
   restyle, and moves the CSS into `src/style.css` imported from `main.js`.
4. `lawnToSvg(lawn, opts)` keeps its options (`theme`, `animate`, `weather`, `bg`,
   `year`, `mowed`, `mower`, `caption`, `user`) and stays pure and dependency-free.
   `scripts/render-svg.mjs` and `action.yml` do not change.
5. URL flags: nobody removes one. New ones go in `docs/DEV.md` (C owns the file; A and B
   list theirs in the handoff).
6. `npm test` (`scripts/smoke.mjs`) passes on every branch. `npm run build` passes.
   `ci.yml` still renders with `node_modules` deleted.

## A — doodle 2D (canvas + SVG exporter)

Goal, ranked: (1) five levels you can tell apart at a glance, (2) the doodle look
everywhere, (3) the README SVG is the board, (4) mowing feels physical.

Concrete changes:

- `palette.js`: the grammar above. Level colours pull further apart: `bladeColor` for
  level 1 mixes 0.65 toward ink — at 0.35 the blades came out *lighter* than the level-1
  tile they stand on and vanished; level 4 fill is GitHub's `#216E39` at full strength with
  an ink outline; bush/hedge inner strokes are `mix(fill, INK, 0.3)`. Keep `WINTER_BLADE`,
  season tints and `NO_SEASON` behaviour.
- `board.js`: unchanged geometry unless you need a taller top margin for the hedges
  (`OY` may grow to 64). Keep `CELL: 16`.
- `render2d/`: split `index.js` (960 lines) into `index.js` (the Renderer2D class: frame,
  layers, setLawn), `grass.js` (the five silhouettes, `drawGrass(ctx, rnd, x, y, cell,
  season, scale)`), `mower.js`, `weather.js`, `overlays.js` (popups, tag, legend, day
  labels). Tufts are drawn row 0..6 top to bottom so a hedge overlaps the row above it.
- Mow animation: on a cut the silhouette squashes (scale y 1 -> 0.15 with a 0.25 s
  ease-out and a 1.15x width overshoot), the tile flashes (exists) and pops (scale 1.12
  -> 1 over 0.3 s), clippings fly (exists). Cut tiles get the mower stripes (exist).
- Canvas DPR cap goes from 2 to 3.
- Hatched shadow: 3 diagonal ink lines at 0.14 alpha under every bush and hedge, offset
  (+3, +3), so the tall grass stands off the paper.
- `export/svg.js`: port the new grammar so the README picture matches the board; keep the
  batching-by-colour so the animated file stays under ~600 kB for a busy year. Update the
  exporter assertions in `smoke.mjs` (shape, options, determinism). Regenerate
  `docs/lawn.svg` and `docs/lawn-dark.svg` with `node scripts/render-svg.mjs --demo`.
- The legend at the bottom right shows the five new silhouettes.

Verification (port 4181): `?view=flat&autodrive=1&og=1` at 1000x700 must show sprouts,
tufts, bushes and hedges as four obviously different shapes, the +N popup, and a mowed
strip of clean GitHub tiles; `?view=flat&start=30&og=1` (winter); the dark README SVG via
the harness in `docs/DEV.md` at t=0, t=15 and inside the hold; a 500x844 shot of
`?view=flat`. `npm test`, `npm run build`, no console errors.

## B — doodle 3D (Three.js)

Goal, ranked: (1) the whole 3D frame reads as a hand-drawn sketch, (2) the five levels are
unmistakable from the chase cam and the overview, (3) a background worth a screenshot,
(4) the mower feels like it is cutting.

Concrete changes:

- **Split `src/render3d/index.js` (1530 lines)** into: `index.js` (Renderer3D: wiring,
  `draw`, `setLawn`, `applyLawn`, the public API), `materials.js` (`BOIL`, `SWAY`,
  `wobbly`, `toon`, `plain`, `inked`, the gradient map), `doodle.js` (every canvas-drawn
  texture: tuft cards, trees, hills, clouds, sun, leaf, flake, signs, faces),
  `board.js` (slab, fence, month signs, hills, trees, props), `grass.js` (the card tufts,
  flowers, dandelions, `setCell`), `mower.js` (the rig and `poseMower`),
  `weather.js` (snow, fluff, leaves, sky colours, sky props), `camera.js` (orbit, fit,
  `updateCamera`), `effects.js` (clippings, puffs, popups, tyre tracks), `post.js`
  (the sketch pass), `theme.js` (3D-only colours and numbers).
- **Doodle grass cards.** Replace the thin-blade `tuftGeometry` with two crossed quads
  per tuft (an X, not camera-facing) carrying a canvas-drawn tuft: white fill (so
  `instanceColor` tints it), ink outline, a few darker inner strokes, `alphaTest: 0.5`,
  `DoubleSide`, the existing sway and boil. One texture per level (sprouts / tuft / bush /
  hedge) plus a stubble card for mowed cells. Sizes from the table above; vigor scales
  0.85..1.15. Hedges are the darkest green and cast a soft blob shadow (a flat dark
  translucent disc at y = 0.145) so they stand off the tile.
- **Sketch post pass** (`post.js`): render the scene to a `WebGLRenderTarget` with a
  `DepthTexture`; a full-screen `ShaderPass` does a Sobel over depth (and, if cheap
  enough, over a normal pass) to draw ink edges, multiplies a paper-grain noise at
  ~0.12, adds a faint vignette, and offsets the edge sample by a low-frequency noise
  re-seeded with `uSeed` so the ink boils. Keep the inverted-hull outlines on the mower.
  Skip the pass when WebGL2 is unavailable. Frame budget: the pass must not drop a
  60 fps desktop below 60, or a phone below 30.
- **Background.** Replace the nine sphere hills with three layered hill planes (z -30,
  -55, -90) drawn as hand-drawn silhouettes (ink outline, a scribble or two, fog does the
  distance). Three tree shapes (round canopy, pine, poplar), 8 on the fence line and ~20
  in the meadow, all three season faces. Props: a red doodle barn on the left horizon, a
  windmill on the right whose blades turn, a scarecrow by the fence, 5 birds (two-frame
  V doodles) drifting across in spring/summer, a snowman by the fence in winter. Meadow:
  a denser doodle-tuft texture plus ~300 instanced meadow cards around the board.
- **Feel.** Tyre tracks: an instanced flat quad trail under the mower, two ribbons,
  fading over ~6 s. The deck kicks up a small dust ring while over grass. The tile pops
  (scale 1.12 -> 1) on reveal. Popups honour `lawn.combo` (contract 2).
- Weather: snowflakes get a doodle "*" texture, leaves a leaf texture with an ink edge.
- Leave `?cam=overview`, `?yaw=`, `?dist=`, `?start=`, `?autodrive=1` working; add
  `?sketch=0` to disable the post pass for comparison shots.

Verification (port 4182): `?view=deep&autodrive=1` and `?view=deep&cam=overview` at
1000x900; `?view=deep&start=8` (winter), `?view=deep&start=20` (spring),
`?view=deep&start=44` (summer); the same with `&sketch=0`; 500x844 `?view=deep`. Read
every shot: edges inked, five levels distinct, hills/trees/props in frame, no z-fighting,
signs legible. Check `renderer.info.render.calls` stays under ~120. `npm test`, `npm run
build`, no console errors.

## C — product: one-click README, play feel, cleaner page

Goal, ranked: (1) putting the lawn in a README takes three clicks and no copy-paste,
(2) mowing has a score to chase, (3) the page and `main.js` are tidy, (4) the docs sell it.

Concrete changes:

- **One-click install.** GitHub pre-fills its new-file editor from the URL:
  `https://github.com/{u}/{u}/new/main?filename=.github/workflows/lawn.yml&value={yaml}`.
  Verify the parameter names with a web search before building on them. The README
  section becomes three numbered steps, each with one button:
  1. **add the workflow to GitHub** opens that URL in a new tab (`rel=noopener`). With no
     username loaded it focuses the username box and says "type your username first".
     Under it, a collapsed `<details>` "or copy it yourself" holds the existing
     `copy workflow` button and the yaml listing.
  2. **run it once** opens `https://github.com/{u}/{u}/actions/workflows/lawn.yml`.
  3. **copy markdown** (exists) and **open your README** opens
     `https://github.com/{u}/{u}/edit/main/README.md`. A line under it: "no `{u}/{u}` repo
     yet? create it" linking to `https://github.com/new` (check whether `?name=` prefills;
     if it does, use it; if not, say "name it exactly {u}").
  New helpers in `share.js`: `newWorkflowUrl(user)`, `actionsUrl(user)`,
  `editReadmeUrl(user)`, `newRepoUrl(user)`, all through `parseUserInput`. Tests in
  `smoke.mjs`: the URLs for a login, an @handle and junk.
- **Combo** (contract 2) in `src/core/lawn.js` `tick`, and in the HUD: a fifth field
  "combo x7" that appears at 3 and pulses on each rise; the end card adds "best combo
  x21". Brag text mentions it when it is 5 or more.
- **Sound** (`src/sound.js`, WebAudio, no assets): an engine hum (sawtooth through a
  low-pass, pitch and gain follow `|mower.vel|`), a short noise burst per cut, a two-note
  chime on a heroic cut, a four-note fanfare on the end card. Off until the visitor
  clicks a 🔇/🔊 button next to `regrow`; remembered in `localStorage`; the context is
  created on that click (autoplay policy). `?sound=0` keeps it off for screenshots.
- **Page.** Move the CSS to `src/style.css` (imported by `main.js`, Vite inlines it in the
  build). Keep the doodle look. Tidy the strips: hero, board, controls, "how it works"
  as three short illustrated lines (an inline SVG doodle each: a sprout, a mower, a
  README card), the three-step README strip, footer with a star link.
- **`main.js` (590 lines)** splits into `src/app/input.js` (keys, pad, focus),
  `src/app/hud.js` (HUD fields, end card, combo), `src/app/readme.js` (preview, downloads,
  copy and the one-click buttons), `src/app/debug.js` (`autodrive`, `prewarm`,
  `prewarmFinish`, flags), with `main.js` as the wiring. Behaviour unchanged.
- **Docs.** `README.md`: lead with the one-click flow (three steps, three buttons), then
  play, then the option table, then "run it locally" and "how it works"; keep the
  screenshot table (the integrator regenerates the pictures). `docs/DEV.md`: the new
  module layout, flags, sound. `action/README.md`: mention the one-click flow.
  `.github/workflows/lawn.yml`'s comment: the same.

Verification (port 4183): `?view=flat&user=` unloaded shows the "type your username
first" nudge on step 1; with `?user=torvalds` loaded (live API; fall back to the fixture
if offline) the three buttons carry `torvalds` URLs (inspect `href`/the opened URL via a
`window.open` stub in the smoke test or by reading the anchor); `?view=flat&autodrive=1`
shows the combo field; 500x844 `?view=flat` and `?view=deep` still lay out. `npm test`,
`npm run build`, no console errors.

## Integration (the main session)

Merge A, B, C into `v05`, resolve `smoke.mjs` and `palette.js` reads, apply handoffs,
`npm test`, `npm run build`, re-shoot `docs/shots/*.png` and `public/og.png`, regenerate
`docs/lawn*.svg`, bump `package.json` to 0.5.0, fast-forward `main`. Nothing is pushed.

## Screenshot recipe

```
npm run build
npx vite preview --port <PORT> --strictPort &
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1000,900 --virtual-time-budget=6000 --enable-logging=stderr --v=0 \
  --screenshot=<scratchpad>/x.png "http://localhost:<PORT>/?view=deep&autodrive=1" 2>&1 | grep -i "console"
```

Then Read the PNG and look at it. Do not trust a build that you have not looked at.
