# Plan A - visual: make the lawn the hero

Branch `feat/visual`. Scope per `BRIEF.md`: `src/render2d/*`, `src/render3d/*`, `src/core/palette.js`,
read-only additions to `src/core/lawn.js`, the look of the existing page (theme, h1/lede, `.stats`,
`.board`, `#stage`, `.controls`, `#pad`, `#years`, `#tag`, `#endcard`), HUD text and date formatting.
No landing sections, no data loader, no new dependencies, `src/core` stays DOM-free.

## 1. Review of the current build (screenshots in `scratchpad/planA/`)

`flat.png` (`?view=flat&autodrive=1`, 1000x900), `chase.png`, `overview.png`, `winter.png`
(`?view=deep&start=17`), `jan2025.png`, `finish.png`, `mobile.png` (390 iframe, see 5.2).

1. **The page is a letterbox on blank paper.** `body` is flat `#FBF9F2` with no grain, no vignette
   (`index.html:19-26`). The flat board is ~210px tall, so 60% of a 900px window is empty. The
   `.stats` row is four pencil phrases pushed to the far edges by `justify-content: space-between`
   (`index.html:33-38`); it reads as loose text, not a HUD. `#stage` draws an ink border *and* the
   canvas draws an ink dirt bed, a double frame (`index.html:43-48`, `render2d/index.js:516-519`).
2. **Count is invisible.** Grass is a function of `level` only: `BLADES/HEIGHT` tables
   (`render2d/index.js:19-20`) and `TUFT_BLADES/TUFT_HEIGHT` (`render3d/index.js:13-14`). A
   3-contribution day and a 40-contribution day in the same level are identical. Level 3 vs 4 in 2D
   differ only by darkness (`flat.png`, Jun-Aug block).
3. **Winter erases the graph.** `tileColor` lerps unmowed winter tiles 42% toward `FROST`
   (`palette.js:75`) and `WINTER_BLADE` is pale, so Dec-Feb is a uniform pale slab in 2D
   (`flat.png` cols 13-24) and in the 3D overview (`overview2025.png`). GitHub's silhouette is gone
   for a quarter of the year.
4. **3D atmosphere is two flat bands.** `scene.background` is one colour, the meadow is a
   600x600 plane in `MEADOW` lerped toward the sky (`render3d/index.js:216-220, 831`), no fog, no
   hills; the horizon is a hard line at mid-frame and khaki fills half the picture (`chase.png`,
   `winter.png` is grey on grey). Trees are bare stick sprites in every season (`:241-253`). The
   overview camera (`dist 33`, `OVER_PITCH 0.42`, `lookAt.y 5`, `:99-101, 1019`) puts the lawn as a
   thin strip with 40% empty meadow below it; signs are unreadable (`overview.png`).
5. **Mowing feedback is weak.** Tyre tracks draw a 0.2px segment (`t.x + nx` to `t.x + nx*1.02`,
   `render2d/index.js:298-301`), invisible. `+N` popups are the same 26px whatever N and stack
   (`+11 +8` in `jan2025.png`). Clippings are 2px squares.
6. **Text formatting.** `describeCell` gives `Wed 25 Mar 2026 - 3 contributions` (hyphen, no comma,
   `lawn.js:302-313`); the end card says `1,741 contributions - 52 weeks - 0:37` (`main.js:205`);
   the brag says `from this year` for the rolling view (`main.js:168`). `fresh` as a weather word
   says nothing, and there is no temperature anywhere. Legend is 15px with 4 tufts and no level-0
   swatch (`render2d/index.js:436-455`).
7. **Mobile** (`mobile.png`): structurally fine (stats wrap, stage scrolls, chips, pad), but the
   flat stage shows 60px of blank cream under the lawn (legend strip off-screen) and the tag text is
   11px after CSS scaling. NB: headless Chrome clamps windows to 500px wide (`innerWidth=500` with
   `--window-size=390,844`, both headless modes), so the BRIEF recipe silently lies at 390; use the
   iframe recipe in 5.2.

## 2. Design goals, ranked

1. The contribution graph is the hero and reads as GitHub in one glance: month/weekday labels,
   legend, GitHub greens, year list; every day's `count` is visible in its grass.
2. Atmosphere: paper grain and vignette on the page; sky, ground, light, fog and weather in 3D
   change with the season under the mower and the temperature is felt; 2D shows the year's
   climate spatially (snow over winter columns, leaves over autumn).
3. Mowing feels physical: reveal, tyre tracks, clippings from the chute, a `+N` that scales with N.
4. Clean typography and copy: one scale, `·` separators, `Sun, 14 Sep 2025 · 12 contributions`.
5. Stay at 60fps on a laptop and playable on a phone (instancing only, no post-processing).

## 3. Changes, file by file

### 3.1 `src/core/lawn.js` (additive only)

- In `createLawn`, after cells exist, compute per level `lo[l] = min count`, `hi[l] = max count`
  over non-void cells of that level, and add to every cell:
  `vigor = level === 0 ? 0 : (hi[l] === lo[l] ? 0.5 : (count - lo[l]) / (hi[l] - lo[l]))` (0..1),
  `heroic = level === 4 && count >= heroicMin` where `heroicMin` is the 97th percentile of the sorted
  non-zero counts (`nz[floor(nz.length * 0.97)]`, so at least one day is heroic in any non-empty
  lawn). Add `lawn.maxCount`, `lawn.heroicMin`. `resetLawn` leaves them alone.
- `TEMP_C = [-2, 0, 5, 11, 16, 20, 24, 23, 18, 12, 6, 1]` (northern-hemisphere feel, by month) and
  `tempAt(lawn, x) = TEMP_C[monthAt(lawn, x)]`.
- `SEASON_WORD` becomes `['snowing', 'blossom', 'sunny', 'leaves falling']`; add
  `SEASON_GLYPH = ['snow', 'flower', 'sun', 'leaf']` (names for the 2D glyph drawer).
- `formatDay(iso)` -> `Sun, 14 Sep 2025` (`DAY_NAMES[d] + ', ' + date + ' ' + Mon + ' ' + year`).
  `formatDate` stays as an alias. `describeCell` -> `formatDay(date) + ' · ' + n` where n is
  `12 contributions` / `1 contribution` / `no contributions`.
- `periodLabel(lawn)` -> `'in the last year'` when `lawn.year == null`, else `'in 2025'`.
- `formatTime`: unchanged under an hour; `h:mm:ss` from 3600s.
- `SEASONS[*].sky` unused after 3.5; leave the values.

### 3.2 `src/core/palette.js`

- Export the grass grammar so C's SVG exporter can reuse it:
  ```
  export const GRASS = {                    // index = level; [min, max] spans by vigor
    blades: [[0,0],[2,3],[4,6],[7,9],[10,13]],
    height: [[0,0],[4,6],[7,10],[10,14],[14,19]],   // 2D px on a 16px tile
    width:  [0, 1.2, 1.4, 1.6, 1.85],                // 2D stroke px
    tuftY:  [[0,0],[0.8,1.05],[0.8,1.1],[0.85,1.15],[0.9,1.3]],   // 3D y-scale span
  };
  export function grassFor(level, vigor) -> { blades, height, width, tuftY } (linear in vigor,
    blades rounded).
  ```
- Winter contrast: `WINTER_BLADE = ['', '#A8CDB5', '#7FB897', '#5A9878', '#3E7A5C']`. In
  `tileColor` the unmowed winter lerp toward `FROST` drops from `0.42` to `0.2`, the level-0
  winter lerp from `0.5` to `0.35`. Overgrown tiles also darken with vigor:
  `tileColor(level, season, mowed, vigor = 0)` -> `shade(over, 1 - 0.12 * vigor)`.
- Per-cell personality: `cellTint(hex, col, row)` = `mix(hex, ((col*7+row*3)%3 === 0 ? '#FFFFFF' :
  '#1F3A26'), 0.05)`; both renderers pass blade colours through it.
- New constants: `DANDELION = '#F4D06F'`, `FLUFF = '#FFFDF5'`, `PETAL = ['#F6C3D4', '#FFE1EA']`,
  `SKY_TOP = ['#C9D6E2', '#BFDDF5', '#8FC6F0', '#E9C9A2']`, `SKY_HORIZON = ['#EEF2F5', '#F1F7EC',
  '#E8F4FB', '#FBEEDC']`, `MEADOW_BY_SEASON = ['#E4EAE6', '#C9DCAE', '#B9D48F', '#D6C98E']`,
  `SUN_LIGHT = ['#DCE8F5', '#FFF6E6', '#FFE9B8', '#FFD9A8']`,
  `DIRT_BY_SEASON = ['#BFC7CA', '#B08A5C', '#A9855B', '#B7925E']`.

### 3.3 `index.html` - page, HUD, typography (CSS + two new spans inside `.stats`)

Typography scale (desktop / <=820px): h1 34/26, lede 22/18, HUD 17/15, buttons 18/17, hint 16,
card h2 34/28, card p 20/17, `#tag` 17/15. Line-height 1.25. `body` gap 12px, `.wrap` gap 10px.

- Background: `body { background: radial-gradient(ellipse 120% 80% at 50% 10%, #FDFBF5 0%,
  #FBF9F2 50%, #F0EBDC 100%) fixed; }` plus paper grain: `body::before { content:''; position:fixed;
  inset:0; pointer-events:none; opacity:.28; background-image:url("data:image/svg+xml,...") }` where
  the SVG is 160x160 with `<filter id=n><feTurbulence type=fractalNoise baseFrequency=.9
  numOctaves=2 stitchTiles=stitch/><feColorMatrix values="0 0 0 0 .2 0 0 0 0 .18 0 0 0 0 .12 0 0 0
  .35 0"/></filter><rect width=100% height=100% filter=url(%23n)/>`. A soft ground wash at the foot:
  `body::after { position:fixed; left:0; right:0; bottom:0; height:180px; background:
  linear-gradient(to bottom, transparent, #E9EFDD); pointer-events:none; z-index:-1 }`.
- h1: keep the doodle mower SVG, `letter-spacing: .2px`, a 3px `#97C459` hand-drawn underline via
  `text-decoration: underline wavy #97C459; text-underline-offset: 6px`.
- HUD `.stats` becomes a strip that reads like a GitHub header and a game HUD:
  ```
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ ⌂ March · snowing · −2 °C   │  mowed 9%  ▓▓▓▓░░░░░░░░  │ 183 / 1,741  │ ⏱ 0:03 │
  └───────────────────────────────────────────────────────────────────────────┘
  ```
  CSS: `background: var(--cream); border: 2px solid var(--ink); border-radius: 10px; padding: 5px
  14px 6px; display: grid; grid-template-columns: minmax(0,1.5fr) minmax(0,1.4fr) auto auto;
  gap: 4px 18px; align-items: center; transform: rotate(-.25deg); box-shadow: 3px 4px 0
  rgba(44,44,42,.12)`. New content in the second cell: `mowed <b id="pct">` followed by
  `<i class="bar" aria-hidden="true"><b id="barfill"></b></i>`; `.bar { display:inline-block;
  width: clamp(80px, 12vw, 160px); height: 10px; border: 1.5px solid var(--ink); border-radius: 6px;
  vertical-align: -1px; overflow: hidden }`, `#barfill { display:block; height:100%; width:0;
  background: repeating-linear-gradient(90deg, #40C463 0 6px, #30A14E 6px 12px); transition: width
  .2s }`. Add `<b id="temp">` after `#weather`: `driving through <b id=month> · <b id=weather> ·
  <b id=temp>−2 °C</b>`. Ids `month/weather/pct/cmowed/ctotal/timer` unchanged; `main.js` sets
  `#temp` and `#barfill.style.width = pct + '%'` in `updateHud`. Mobile: `grid-template-columns:
  1fr auto`, 15px.
- `#stage`: `border-radius: 14px; box-shadow: 4px 5px 0 rgba(44,44,42,.14)`. In flat view the
  canvas is the frame: `body[data-view="flat"] #stage { border-color: transparent; background:
  transparent; box-shadow: none }` (the canvas draws its own inked board, 3.4). `#deep { height:
  clamp(360px, 46vw, 560px) }`, mobile 360px.
- `#years`: GitHub-like: `min-width 96px`, `padding: 3px 12px 5px`, active = `#97C459` fill + ink
  border + `transform: rotate(-1deg)`; inactive hover cream. Mobile chips unchanged.
- `#tag`: `padding: 3px 12px 5px; border-radius: 10px; box-shadow: 2px 3px 0 rgba(44,44,42,.14)`.
- `#endcard`: backdrop `rgba(251,249,242,.6)` + `backdrop-filter: blur(2px)`; card `padding: 22px
  32px 26px; border-radius: 18px`; h2 `Lawn mowed!` 34px with the same wavy underline; the line
  under it is `1,741 contributions in the last year · mowed in 1:42` (main.js `endline`); a
  second pencil line `52 weeks · 7 rows · 1 riding mower`. Buttons `regrow` (cream) and
  `copy brag` (`#97C459`).
- `button`: `box-shadow: 2px 2px 0 rgba(44,44,42,.18)`; `:active { transform: translate(2px,2px);
  box-shadow: none }`. `#pad button.gas` keeps `#97C459`.
- `main.js` copy (A owns HUD text): `endline` as above; brag: `I mowed my GitHub lawn: 1,741
  contributions in the last year, cut in 1:42 · mow-your-commits`; `#span` uses `periodLabel`.

### 3.4 `src/render2d/index.js`

Geometry: `OX = 58`, `OY = 60`, `PAD_B = 70`, `CELL/GAP/R` unchanged. Draw order: paper, month
labels + glyphs, dirt bed (season bands), tiles, tyre tracks, grass, dressing, weather, mower,
clippings, weekday labels, popups, tag, legend.

- **Dirt bed by climate.** Fill the bed in vertical bands per column using
  `mix(DIRT_BY_SEASON[s], PAPER, 0.58)` with a 1-column linear blend at each season change; one
  wobbly ink outline around the whole bed (lineWidth 1.8) plus a 2px `rgba(44,44,42,.08)` inner
  shadow along the top edge.
- **Grass grammar.** In `drawGrass`, `g = grassFor(cell.level, cell.vigor)`: blades `g.blades`,
  height `g.height * (0.8 + rnd()*0.4)`, width `g.width`, spread `CELL*0.44` (L1-2) / `CELL*0.7`
  (L3-4). Per-cell wind bias: `lean += (hash(col) - 0.5) * 4` so patches lean differently. Colour
  `cellTint(bladeColor(level, season), col, row)`; the two tallest blades of L3-4 get a darker
  tip: `mix(color, INK, 0.25)` over the top 30%. Seed heads on L4 unchanged. **Heroic** cells:
  1-2 dandelions - a stalk (ink 1px, height `g.height + 5`) with a `DANDELION` disc r=2.4 + 0.8px
  ink outline, and one `FLUFF` puff r=2.2 with 4 radial 0.6px ticks. Level 0: bare tile + 2
  pebbles (keep) + one 5px dry-crack `line()` at alpha .18 when `(col+row)%3 === 0`.
- **Winter.** With the palette change the tile contrast returns; add a frost cap instead of a
  fill lerp: a `#FFFFFF` rect at alpha .45 over the top 3px of unmowed winter tiles; snow dots on
  L3-4 tips unchanged.
- **Reveal.** Keep the stripe rule. Add a cut glow: `onMowed` records `cutAt.set(i, ts)`; for
  `age < 1.2s` overlay the tile with `rgba(255,255,255, .35 * (1 - age/1.2))`. Clippings:
  `3 + 2*level + (heroic ? 6 : 0)`, size `2.5 + rnd*1.5`, spawn at the chute (local `(6, 12)`),
  velocity `right * 2.6 + fwd * 0.6 ± 1.2`, life 22-34 frames, rotate 0.2 rad/frame (draw as
  rotated rects).
- **Tyre tracks (bug fix).** Store samples every 3px of travel (`{x, y, a, life: 1}`); draw
  consecutive pairs as two lines offset by `±(-sin a, cos a) * 8.5` from sample to sample,
  `lineWidth 2.6`, `rgba(44,44,42, .11 * life)`, `life -= dt/4`; max 160 samples; drawn under
  the grass so the grass hides them where uncut.
- **+N popups.** Merge: if the newest popup is younger than 0.25s add to its `n` instead of pushing.
  Font `px = 22 + min(16, n * 0.45)`; `n >= 25` fills `ORANGE` with ink stroke 1.2; heroic cells add
  a `!` (`+41!`). Rise 30px over 0.8s, paper halo 4px kept.
- **Weather layer** (spatial, whole year visible): persistent particle pool per season, each
  confined to its columns `[x0, x1]` from `lawn.monthStarts`:
  snow 70 dots r 1.2-2.2 `rgba(255,255,255,.9)` falling 14px/s with `sin` drift over winter
  columns, wrapping from `OY-14` to the bed bottom; leaves 26 ellipses 3x1.8 in
  `[ORANGE, '#EF9F27', AUTUMN_BLADE]` tumbling (rotate 2 rad/s) 10px/s; petals 16 dots r 1.4
  `PETAL[i%2]` over spring, 8px/s; summer: 14 dandelion fluff dots (`FLUFF` r 1.3 with a 0.5px
  ink tick) rising 6px/s, plus a 2px `rgba(255,255,255,.18)` heat band above the top row that
  wobbles with `boil` (two `line()`s at `OY-7` across summer columns, amplitude 1.5).
  Skip a season whose span is 0 columns. Budget: <= 130 particles per frame.
- **Labels.** Month labels 16px `PENCIL`; after the first month of each season draw a 10px doodle
  glyph (`SEASON_GLYPH`): snow = 3 crossed 8px lines `#85B7EB`; flower = 5 `PETAL` dots r 1.6
  around a `DANDELION` centre; sun = `SUN` disc r 4 + 8 ink ticks; leaf = `ORANGE` ellipse 6x3.5
  with a 1px ink vein. Weekday labels at `x = 8`, 15px, halo kept, drawn last (unchanged rule).
- **Legend.** `less [L0 bare][L1][L2][L3][L4] more` at 1.3x, drawn with `drawTile/drawGrass`,
  16px `PENCIL`, right-aligned to the bed; fake cells use `vigor 0.5`, L4 `heroic: false`.
- **Tag.** `describeCell` output, 17px, `padding 9px`, shadow `2px 3px 0 rgba(44,44,42,.14)`.
- **Mower.** Unchanged silhouette; blade disc spin `spin += |vel| * 6 + 0.1`; two tread marks
  are the tracks above.

### 3.5 `src/render3d/index.js`

- **Sky dome.** Replace `scene.background` with `SphereGeometry(320, 24, 12)` + `ShaderMaterial`
  (`side: BackSide`, `depthWrite: false`, `fog: false`): vertex passes `vY = normalize(position).y`;
  fragment `gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(-0.02, 0.45, vY)), 1.0)`. Uniforms
  `uTop`, `uHorizon` are the `weatherMix`-weighted blends of `SKY_TOP` / `SKY_HORIZON`; the dome
  follows the camera position each frame. Keep `scene.background` set to the horizon colour.
- **Fog + meadow.** `scene.fog = new THREE.Fog(horizon, 18, 95)` (colour updated per frame). The
  apron colour is the `weatherMix` blend of `MEADOW_BY_SEASON` (no more lerp toward sky). Add 9
  hills: `SphereGeometry(1, 12, 8)` scaled `(14..24, 3..5, 8..12)` at radius 42-70 around the
  origin (angles `i * 0.7 + 0.3`, skip `|angle - pi/2| < 0.5` so nothing sits behind the chase
  camera's usual shot), toon material `shade(meadow, 0.9)`, updated with the meadow colour.
- **Trees by season.** Each tree is three sprites at one position: bare (existing texture), leafy
  (green canopy: `#5C8F3A` blob of 3 circles with 6px ink outline over the same trunk), autumn
  (same with `#EF9F27`). Opacities: bare `mix[0]`, leafy `mix[1] + mix[2]`, autumn `mix[3]`. 5
  trees along the fence as now + 8 in the meadow at `z = fenceZ - 6 .. -22`, `x` spread
  `-cols .. cols`, scale 4-7. Winter trees get a `#FFFFFF` 40%-alpha snow line on the branches
  (a fourth small sprite, opacity `mix[0]`).
- **Light and temperature.** `dir.color` = blend of `SUN_LIGHT`; `DIR_INTENSITY = [0.75, 1.05,
  1.35, 1.0]`; `HEMI` unchanged; `hemi.groundColor` = meadow colour. Sun sprite: scale
  `4.4 + sunny * 1.4`, height `camY + 0.6 + 1.8 * mix[2]` (summer sun sits higher), opacity
  `sunny = clamp(mix[2] + 0.5*mix[1] + 0.25*mix[3], 0, 1)`. A pale winter sun: opacity
  `0.35 * mix[0]` at `camY + 0.3`, tinted `#F3EBD8` (second sprite, same texture).
- **Weather systems.** Snow `N = 420`, size `0.42`. Leaves also serve spring: colour per frame
  `mix[1] > mix[3] ? PETAL[i%2] : AUTUMN_TRIO[i%3]`, opacity `mix[3] + 0.6 * mix[1]`, spring
  fall speed x0.6. Summer fluff: a second `Points` (80, texture = the snow dot with a 1px ink tick,
  size 0.3) rising `+0.012/frame` with drift, opacity `mix[2]`, respawn box as snow. Heat: none
  (no post-processing).
- **Grass by count.** In `setCell`: unmowed y-scale `lerp(GRASS.tuftY[level][0], [1], vigor)`, xz
  `0.85 + 0.3 * vigor`; colour `cellTint(bladeColor(level, season))` then `col.lerp(darker,
  0.25 * vigor)` where `darker = shade(bladeColor, 0.7)`; keep the autumn brown lerp. Tile colour
  passes `vigor`. **Dandelions**: extend the `flowers` InstancedMesh to also hold one instance
  per heroic cell (any season but winter): sphere scale 1.8, colour `DANDELION`, at
  `y = 0.14 + TUFT_HEIGHT[3] * 1.15`, hidden when mowed. Slot counting in `applyLawn` adds the
  heroic cells; buffer stays `SLOTS`.
- **Feedback.** `spawnPopup(n, heroic)`: sprite scale `2.4 + min(1.6, n * 0.04)`, orange fill
  for `n >= 25`, `!` for heroic; merge popups younger than 0.25s like 2D. Clippings
  `3 + 2*level + (heroic ? 6 : 0)`, box `0.11`. Mowed tiles get the cut glow: for 1.2s after
  the mow, `tile colour = mix(tile, '#FFFFFF', 0.3 * (1 - age))` (track `cutAt` per index,
  keep the index in `anim` until age > 1.2).
- **Camera framing.** Chase: `dist 9.6`, `CHASE_PITCH 0.5`, look-ahead `3.0`. Overview:
  `dist 29`, `OVER_PITCH 0.40`, `lookAt` in overview `(0, 0.8, 1.5)` so the slab sits at ~58% of
  frame height with hills and sky above. Zoom clamps unchanged.
- **Signs.** Plane `2.4`, text `84px`, posts alternate `1.95 / 2.3`. Fence geometry unchanged.
- **Level-0 tiles.** Colour from `tileColor` as now; no pebbles in 3D (perf, and the gap dirt
  already gives the silhouette).

### 3.6 `src/main.js` (HUD wiring only, A-owned strings)

`updateHud`: set `#temp` to `(t < 0 ? '−' : '') + |t| + ' °C'` from `tempAt`, `#barfill` width,
`#span` via `periodLabel`, `endline` and brag copy as in 3.3. `showMowed` passes `heroic` to
renderers via the cell (no signature change: renderers read `cell.heroic`).

## 4. Commit sequence

1. `core: vigor/heroic per cell, GRASS table, temperature, formatDay + "·" copy` - lawn.js,
   palette.js, smoke tests (5.1). Renderers untouched, build passes.
2. `page: paper grain, HUD strip with progress bar, type scale, stage/card/year styling` -
   index.html, main.js HUD wiring (`#temp`, `#barfill`, `periodLabel`, endline, brag).
3. `2D: grass reads the count (vigor, heroic dandelions), winter contrast, climate bed, legend L0`.
4. `2D: mowing feel (tracks fix, cut glow, chute clippings, scaled +N) and spatial weather`.
5. `3D: sky dome, fog, hills, seasonal trees, sun and light by temperature, camera framing`.
6. `3D: grass by count, dandelions, spring petals, summer fluff, scaled +N, cut glow, sign size`.
7. `docs: README flags/recipe, screenshot pass` - update the URL-flag table (no new flags) and
   the mobile screenshot recipe; re-take every screenshot in 5.2 and fix what fails.

## 5. Verification

### 5.1 `scripts/smoke.mjs` additions

- `formatDay('2025-09-14') === 'Sun, 14 Sep 2025'`; `describeCell` for counts 0/1/12 gives
  `'… · no contributions'`, `'… · 1 contribution'`, `'… · 12 contributions'`; no `' - '` anywhere.
- `periodLabel(createLawn(null,{year:null})) === 'in the last year'`, `… {year:2025}` -> `'in 2025'`.
- Every non-void cell has `0 <= vigor <= 1`; level 0 has `vigor 0`; within one level a higher
  `count` never has a lower `vigor`; at least one `heroic` cell and all heroic cells are level 4;
  void cells `heroic === false`.
- `GRASS.blades/height` spans are non-decreasing across levels; `grassFor(4, 1).height === 19`;
  `grassFor(l, 0).blades === GRASS.blades[l][0]`.
- `tempAt` returns a number for `x` in `[-2, cols + 2]`; `formatTime(3723) === '1:02:03'`.

### 5.2 Screenshots (`npm run build`, `npx vite preview --port 4173 --strictPort`, Chrome flags
from BRIEF; desktop `--window-size=1000,900`)

Mobile recipe (headless Chrome clamps windows at 500px): write `mobile.html` in the scratchpad
containing `<iframe width="390" height="844" style="border:0;display:block" src="http://localhost:
4173/?view=flat&autodrive=1">`, screenshot it with `--window-size=500,844` and `file:///` URL;
crop mentally at x=390. Same for `?view=deep`.

| URL | must see |
| --- | --- |
| `?view=flat&autodrive=1` | grain + vignette on the page; cream HUD strip with a striped progress bar and `March · blossom · 5 °C`; no double frame; dirt bed shifts colour across seasons; within one green, taller/denser tufts on bigger days; 1-3 dandelions on heroic days; Dec-Feb tiles still show four distinct densities; snow dots over winter columns, leaves over autumn, fluff over summer; visible twin tyre tracks behind the mower; `+N` bigger for bigger N; tag `Wed, 25 Mar 2026 · 3 contributions`; legend `less [bare][1..4] more` |
| `?view=flat&year=2025` | Jan-Dec labels with a snow glyph after Jan, flower after Mar, sun after Jun, leaf after Sep; void cells drawn as nothing; `1,513 contributions in 2025`; 2025 chip active |
| `?view=deep&autodrive=1` | gradient sky, fog fading the meadow into the horizon, hills, leafy trees; mower larger in frame; `+N` sprite scaled; HTML tag with the new format |
| `?view=deep&start=17` | snow, pale low sun, bare snow-lined trees, whitish meadow, cold blue-grey sky, HUD `January · snowing · −2 °C`; grass frosted but four densities still distinct |
| `?view=deep&year=2025&start=28&autodrive=1` | summer: high bright sun, warm light, rising fluff, green trees, `sunny · 24 °C` |
| `?view=deep&cam=overview` | whole year with the slab at ~58% height, hills and sky above, signs legible, autumn leaves and orange trees, no empty band below the slab |
| `?view=flat&finish=1` | end card `Lawn mowed!` with `1,741 contributions in the last year · mowed in 0:37` and the pencil line; blurred lawn behind fully revealed in GitHub greens |
| mobile iframe, flat and deep | HUD wraps to two rows without clipping; chips row; pad `◀ ▶ … rev gas` all visible; stage scrolls; tag readable |

Frame budget: with DevTools on the 3D view, `renderer.info.render.calls` <= 120 and steady 60fps
on an integrated GPU (instanced tiles/grass/flowers, <= 500 snow points, <= 80 fluff, 44 leaves,
<= 39 tree sprites, 9 hills, 1 dome).

## 6. Risks and out of scope

- Fog on `MeshToonMaterial` and sprites: Three applies fog by default (`fog: true`); the sky dome
  and `+N` sprites must set `fog: false` or they fade. Check the winter shot for grey mush; if
  the horizon looks muddy raise `fog.near` to 26.
- Overview framing is a geometric trade-off: to keep the horizon visible the pitch must stay under
  the 25° half-FOV, so the slab is always a strip; hills, fog and the lower `lookAt` are what fix
  the emptiness, not a steeper camera. If the slab still floats, try `dist 27, lookAt.z 2.0`.
- 2D particle layer runs every frame on a 1060px canvas; keep the pool sizes above and skip the
  layer entirely while `document.hidden`.
- Heroic threshold on real data: a user whose top day is 1 contribution still gets `heroic` on
  level-4 days (97th percentile of a flat list); acceptable, they are still their best days.
- Rain is deliberately absent (no rainy season in the 4-season model and wet paper fights the
  doodle look); spring gets petals and blossom instead. Sound, hand-drawn textures, landing copy,
  data loading and SVG export belong to other plans.
- Changing `SEASON_WORD[1]` from `fresh` to `blossom` alters HUD copy only; no consumer beyond
  `main.js:194`.
