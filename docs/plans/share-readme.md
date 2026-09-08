# Plan C — share, README embed, landing (`feat/share-readme`)

Scope per `docs/plans/BRIEF.md`: landing/conversion copy and sections, `src/export/*`,
share/copy actions, the GitHub Action + workflow template, user docs. Board, HUD, palette
and data loading belong to A and B; this plan only *reads* `lawn.cells/cols/year` and
`src/core/palette.js`. Site URL: `https://evch1204.github.io/mow-your-commits/`, repo
`evch1204/mow-your-commits` (from `git remote -v`).

## 1. Review of the current state (evidence)

Screenshots in `scratchpad/planC/{flat,finish,mobile}.png` (recipe in BRIEF, port 4175).

1. **Nothing below the fold.** `flat.png`: the page ends at y≈450 of 900; after
   `.controls` (`index.html:181-187`) there is only the hidden `#pad`. A visitor who does
   not press a key learns nothing: no "what is this", no "try yours", no reason to star.
   `README.md:1-9` explains the idea; the page does not.
2. **No conversion loop.** The end card (`finish.png`, `index.html:167-174`) offers
   `regrow` and `copy brag`; `copyBrag` (`src/main.js:167-178`) has no link back.
3. **No image export.** `README.md:82` still lists it as todo; the 2D view is a canvas.
4. **No social preview.** `<head>` (`index.html:3-8`) is a title only: links unfurl blank
   on X/Reddit/Discord. Cheapest fix for shares.
5. **Mobile** (`mobile.png`): board + chips + pad first is right for play; same emptiness after.
6. **Good, keep:** `drawTile`/`drawGrass` (`render2d/index.js:120-217`) port 1:1 to SVG
   with the same constants (`CELL 16, GAP 3, PITCH 19, R 3, OX 48, OY 58, PAD_R 22,
   PAD_B 66`), so the README picture and the site agree pixel for pixel.

## 2. Design goals (ranked)

1. A visitor understands the joke in 3 seconds and can try their own graph in one click.
2. Every share carries a link back with `?user=<name>` so the recipient mows *their* lawn.
3. One copy-paste (workflow yaml + markdown) puts a real lawn on a profile README with no
   tokens, no server, and it looks exactly like the site's 2D view.
4. Downloads (SVG/PNG) work offline in the browser with the same exporter as the action.
5. Copy stays lowercase, short, in the project's voice. No marketing.

## 3. Verified facts about SVG in GitHub READMEs

- Markdown images render as `<img>`; `<object>/<embed>` are stripped: no scripts, no
  hover, no interactivity. Animations inside an `<img>` do run: CSS `@keyframes` (what
  `Platane/snk` ships) and SMIL (`<animate>`, `<animateTransform>`) in Chrome/Firefox/Safari.
- An `<img>` SVG loads **no external resources** (no `@import`/`<link>` fonts, images,
  fetch); `data:` URIs are fine, so a base64 `@font-face` in `<style>` works. Same-repo
  paths are served from `raw.githubusercontent.com` (`Cache-Control: max-age=300`); other
  URLs go through `camo.githubusercontent.com` (content-type whitelist incl.
  `image/svg+xml`, `CAMO_LENGTH_LIMIT` 5 MB, cached). Nightly regeneration shows in minutes.
- `<picture>` + `<source media="(prefers-color-scheme: dark)">` is GitHub's documented
  dark-variant mechanism; snk recommends it; it works in any README.
- Font decision: **embed** the Latin subset of Patrick Hand (Google's own split, 23,944 B
  woff2, ~32 KB base64, SIL OFL 1.1) plus a system fallback stack. The labels are what
  make it read as *the GitHub graph*; on Linux `cursive` falls to a serif and looks
  broken. Glyphs-as-paths needs a subsetter this machine lacks (no Python/fonttools) and
  would not be smaller. The embed also makes the in-browser PNG correct: an SVG drawn
  through `<img>` cannot see the page's web fonts either.
- Budget: ~364 rects + ~16 batched blade paths + mower + font ≈ 110-150 KB per file.

## 4. The exported picture: which state?

Primary — **half mowed, mower on the lawn** (`mowed: 0.5`): rows Sun..Tue fully mowed
(the real GitHub tiles show), Wednesday mowed up to the mower, Thu..Sat overgrown. One
still tells the whole story: this is your graph, and someone is mowing it. Cheap (same
code path as the site), deterministic, and the graph is readable.

Optional — **animated SMIL** (`animate: true`, `?animate=1` in the action outputs): the
mower drives the partial row left to right over 8 s on a loop; each cell in that row
carries an overgrown overlay whose `opacity` snaps to 0 when the mower passes. Frame 0 is
the primary still, so nothing changes for viewers without animation. Cost: ~52 overlay
groups + `<animate>` elements, +15-20 KB, and 5 more assertions. Benefit: it moves in the
profile feed like snk does, which is what gets screenshotted and posted. Do it last.

Rejected: fully overgrown with the graph "faintly underneath" — unmowed *hides* the graph
by design (v0.2); a README image that hides the graph is worse than GitHub's own.

## 5. Changes, file by file

### `src/export/font.js` (new)
`export const PATRICK_HAND_WOFF2_B64 = '…'` — the Latin woff2 from
`https://fonts.gstatic.com/s/patrickhand/v25/LDI1apSQOAYtSuYWp8ZhfYe8XsLL.woff2`
(`curl -sL <url> | base64 -w0`). Header comment: Patrick Hand by Patrick Wagesreiter,
SIL Open Font License 1.1. `export const FONT_STACK = "'Patrick Hand','Segoe Print',
'Chalkboard SE','Comic Sans MS',cursive"`.

### `src/export/themes.js` (new)
`THEMES.light = { paper: PAPER, ink: INK, pencil: PENCIL, cream: CREAM, dirt: DIRT,
greens: GITHUB, bare: BARE }` (all from `palette.js`); `THEMES.dark = { paper: '#0D1117',
ink: '#E6EDF3', pencil: '#8B949E', cream: '#161B22', dirt: '#2B3A27', bare: '#21262D',
greens: ['#161B22', '#0E4429', '#006D32', '#26A641', '#39D353'] }` — GitHub's own
dark-mode ramp, so the dark image matches a dark profile.

### `src/export/svg.js` (new) — `lawnToSvg(lawn, opts) -> string`, pure, no DOM
Options (all optional): `theme 'light'|'dark'` (default light), `mowed` = `'as-is'` (use
`cell.mowed`), or a fraction 0..1 (default `0.5`), `mower true`, `animate false`,
`caption` string|null (default: `"<n> contributions in the last year"` / `"in <year>"`,
computed from `lawn.totalContributions`, `lawn.year`; prefix `"@user - "` when
`opts.user`), `seed 7`.

Geometry = the 2D renderer's, verbatim: `W = 48 + cols*19 + 22`, `H = 58 + 7*19 + 66`
(52 cols -> `1058 x 257`). Output skeleton, in this order:
```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H" width="W" height="H" role="img" aria-label="…">
  <title>…caption…</title>
  <style>@font-face{font-family:'Patrick Hand';src:url(data:font/woff2;base64,…) format('woff2')}
         text{font-family:FONT_STACK}</style>
  <rect width="100%" height="100%" fill=paper/>
  <text x="48" y="20" font-size="16" fill=pencil>caption</text>
  <g id="months">   <text x=tileX(col) y="36" font-size="16"> per monthStart with span>=3
  <path id="fence"> ticks every 14px + rule at y=46, stroke=pencil 1.1
  <rect id="bed" x="43" y="53" rx="8" fill=mix(dirt,paper,.62) stroke=ink stroke-width="1.6"/>
  <g id="tiles">    one <rect> per non-void cell
  <g id="grass">    one <path> per (level, season, turned/snow) holding every blade of that class
  <g id="dressing"> pebbles / snowflakes / leaves / flowers, batched by colour
  <g id="mower">    only when mower:true
  <g id="labels">   Mon/Wed/Fri at x=4, y=tileY(1,3,5)+9, paint-order="stroke" stroke=paper stroke-width="4"
  <g id="legend">   less [4 tiles + tufts at 1.3x] more, at the 2D legend position
</svg>
```
Cell rules (port `drawTile`/`drawGrass`; `M(i)` = "mowed for export", never mutates `lawn`):
- `M`: `'as-is'` -> `cell.mowed`; fraction `f` -> the first `k = round(f*cols*rows)` cells
  in row-major order are mowed; the mower sits at `col = k % cols, row = floor(k/cols)`, facing +x.
- Tile: `<rect x y width="16" height="16" rx="3" fill=F stroke=ink stroke-opacity=".22|.30"
  transform="rotate(r cx cy)">`, `r = hash(col*31+row*7)*1.4-0.7` degrees (doodle wobble,
  cheaper than a wobbly path). `F = tileColor(level, season, M)` with `stripe()` on even
  mowed columns. Dark theme: same formulas with `theme.greens[level]` in place of
  `GITHUB[level]` (`OVERGROWN` is not exported; duplicate `'#4E5A3C'` with a comment).
  Mowed level>0 tiles get the two faint cut lines (one batched white `.24` path).
- Blades: `n=[0,3,5,7,10][L]`, `h=[0,6,10,13,17][L]`, mowed -> `h*0.12, n/2`; each `M bx
  base Q bx+lean*.35 base-h*.62 bx+lean base-h` with `drawGrass`'s jitter, seeded per cell
  (`seed*131 + col*31 + row*7`, local LCG); stroke `bladeColor(L, season)`, width
  `1.25 + L*0.22`, round caps. Seed heads, snow caps, turned autumn blades, spring flowers:
  same conditions as the canvas, batched as circle-arc `<path>`s per colour.
- Mower: literal port of `mower()` (`render2d/index.js:313-410`) into
  `<g transform="translate(px,py) scale(1.25)">` (`rect`, `ellipse`, `path`); no tracks/puffs/spin.
- Animation (`animate:true`): an outer mower `<g>` gets `<animateTransform
  attributeName="transform" type="translate" from="px(0) py" to="px(cols) py" dur="8s"
  repeatCount="indefinite"/>` (static rotate/scale stay on the inner `<g>`). Every cell
  of the partial row is drawn mowed, with a `<g class="cover">` on top (overgrown rect +
  blades) carrying `<animate attributeName="opacity" values="1;1;0;0"
  keyTimes="0;t;t+0.01;1" dur="8s" repeatCount="indefinite"/>`, `t=(col+0.5)/cols`. Loop:
  the row regrows at t=0 and the mower cuts it again.
- Deterministic (same lawn + opts -> identical string); never contains `http://`,
  `https://`, `<script` or `<foreignObject`.

### `src/export/png.js` (new, browser only)
`svgToPngBlob(svg, scale=2)`: `Blob([svg],{type:'image/svg+xml'})` -> object URL ->
`new Image()` -> canvas `W*scale x H*scale` -> `toBlob('image/png')`. Works because the
font is embedded as `data:`. `download(blob, name)` via a temporary `<a download>`.

### `src/share.js` (new)
`SITE = 'https://evch1204.github.io/mow-your-commits/'`, `REPO = 'https://github.com/evch1204/mow-your-commits'`;
`shareUrl(user)` = `SITE + '?user=' + encodeURIComponent(user)` (or `SITE`);
`bragText(lawn, user, when)` = `I mowed my GitHub lawn: 1,234 contributions from 2025 in
1:42 🌱🚜 mow yours: <shareUrl>`; `xUrl(text)` = `https://twitter.com/intent/tweet?text=…`;
`redditUrl(url, title)` = `https://www.reddit.com/submit?url=…&title=…`;
`markdownSnippet(user)` (below), `workflowYaml()` (§5 template verbatim), `copy(text, btn)`
(clipboard, `prompt()` fallback, 1.6 s `copied!` flash — the existing `copyBrag` pattern).
`user` = `?user=` param or `#user`'s value when B's form exists; empty -> `YOUR-USERNAME`.

Markdown snippet (what `copy markdown` writes):
```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/USER/USER/output/lawn-dark.svg">
  <img alt="my GitHub contribution graph as a half-mowed lawn" src="https://raw.githubusercontent.com/USER/USER/output/lawn.svg">
</picture>
```

### `index.html` — new sections, all outside `.wrap`/`.controls`, after `#pad`
```
<section id="try" class="strip" hidden>          shown when no ?user (demo data)
  <p>that was a made-up developer. <button id="tryme">mow your own graph</button></p>
</section>
<section id="how" class="strip">
  <h2>how it works</h2>
  <p>every day on your graph is a patch of grass. more commits, taller grass. drive over a
     day and the real tile pops out with the count. mow all 52 weeks and you get a time to brag about.</p>
</section>
<section id="readme" class="strip">
  <h2>put your lawn in your README</h2>
  <p>a GitHub Action mows your graph every night and commits the picture to your profile
     repo. no tokens, no servers, nothing to host.</p>
  <img id="preview" alt="your lawn as it will look in a README">   <- object URL, lawnToSvg(lawn, {mowed:.5})
  <div class="btns"> #dlsvg "download svg" · #dlpng "download png" · #cpmd "copy markdown" </div>
  <ol>
    <li>make a repo named after you (<code>you/you</code>) if you don't have one</li>
    <li>add <code>.github/workflows/lawn.yml</code> with this: <button id="cpyml">copy workflow</button>
        <pre id="yaml">…workflowYaml()…</pre></li>
    <li>run it once from the actions tab, then paste the markdown above into your README</li>
  </ol>
</section>
<footer class="strip"><p>a weekend toy. <a href="REPO">star it on github</a> ·
  <a href="REPO/issues">something broke?</a> · patrick hand by patrick wagesreiter, OFL</p></footer>
```
CSS (C-owned selectors only): `.strip { width: min(1040px,100%); margin-top: 26px }`,
`.strip h2 { font-size: 24px; font-weight: 400; margin: 0 0 4px }`, `.strip p, .strip li {
color: var(--pencil); font-size: 18px }`, `.strip code { color: var(--ink) }`, `#preview {
width: 100%; border: 2px solid var(--ink); border-radius: 12px; background: var(--paper) }`,
`#yaml { background: var(--cream); border: 2px solid var(--ink); border-radius: 9px; padding:
10px 14px; font: 14px/1.4 ui-monospace, monospace; overflow-x: auto }`, `.btns { display:
flex; gap: 8px; flex-wrap: wrap }`, `body[data-og="1"] :is(.controls, #pad, .strip) { display: none }`.

`<head>` additions (OG needs absolute URLs; `S = https://evch1204.github.io/mow-your-commits/`):
```html
<meta name="description" content="your GitHub contribution graph is a lawn. mow it.">
<link rel="canonical" href="S"><meta property="og:url" content="S"><meta property="og:type" content="website">
<meta property="og:title" content="mow your commits">
<meta property="og:description" content="your GitHub contribution graph is a lawn. mow it. type a username, drive the mower, brag.">
<meta property="og:image" content="S/og.png">   <!-- 1200x630 -->
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="S/og.png">
<link rel="icon" href="data:image/svg+xml,…the h1 mower svg…">
```
`public/og.png` (1200x630): headless Chrome of `?view=flat&autodrive=1&og=1` at
`--window-size=1200,630`; `?og=1` sets `body[data-og="1"]` (hides controls/pad/strips)
and is listed in the README flags table. Regenerate whenever A changes the look.

End card (`#endcard .cardbtns`, the one touch inside `.wrap`; A styles, C wires): add
`<button id="sharex">share on X</button>` and `<button id="dlcard">download png</button>`
after `copy brag`. `copyBrag` moves to `share.js` and gains the link (goal 2).

### `src/main.js` — wiring only
- `#tryme`: if `#user` exists, `focus()` + `scrollIntoView({block:'center'})`; else
  `prompt('github username')` -> `location.search = '?user=' + encodeURIComponent(name)`.
  `#try` is visible only when `!params.get('user')`.
- `refreshPreview()`: revoke the old object URL, `lawnToSvg(lawn, {mowed:.5, user})` ->
  blob -> `#preview.src`. Called after `buildYears()`, in `pickYear`, and (after B) when
  `loadUser` resolves; never per frame.
- `#dlsvg` -> `lawn-<user|demo>-<year|last>.svg`, `mowed:'as-is'` when `lawn.mowed > 0`
  else `.5` ("download what you mowed"); `#dlpng`/`#dlcard` -> `svgToPngBlob(…, 2)`.
- `#cpmd`, `#cpyml` -> `copy()`; `#sharex` -> `window.open(xUrl(bragText(…)), '_blank',
  'noopener')`, or `navigator.share` when present (label becomes `share`).

### `action.yml` (repo root) + `action/README.md`
Root placement is what lets users write `uses: evch1204/mow-your-commits@v1`; an
`action/` subfolder would force `uses: evch1204/mow-your-commits/action@v1`. `action/`
keeps the docs and the fetch helper.
```yaml
name: mow your commits
description: renders your GitHub contribution graph as a half-mowed doodle lawn (SVG), ready for a README
branding: { icon: scissors, color: green }
inputs:
  github_user_name: { description: github login to render, required: true }
  github_token: { description: token for the GraphQL calendar (the default action token is enough), default: "${{ github.token }}" }
  outputs:
    description: one per line, path relative to the workspace + options as a query string (theme=dark, animate=1, year=2025, mowed=0.5)
    default: "dist/lawn.svg\ndist/lawn-dark.svg?theme=dark"
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    - shell: bash
      env:
        USER_NAME: ${{ inputs.github_user_name }}
        GITHUB_TOKEN: ${{ inputs.github_token }}
        OUTPUTS: ${{ inputs.outputs }}
      run: node "$GITHUB_ACTION_PATH/scripts/render-svg.mjs" --user "$USER_NAME" --outputs "$OUTPUTS" --cwd "$GITHUB_WORKSPACE"
```
No `npm ci`: `scripts/render-svg.mjs` imports only `src/core/*` and `src/export/*`, which
have zero dependencies (`three` is used by `render3d` only). Keep it that way; CI asserts
it by running the script with `node_modules` absent. If a dependency ever appears, add
`npm ci --omit=dev --ignore-scripts` in `$GITHUB_ACTION_PATH` before the node step.

### `scripts/render-svg.mjs` (new, ESM, node >= 20, no DOM)
Args: `--user`, `--outputs` (multi-line), `--cwd`, `--demo` (fake data, no network),
`--seed`. Per output line: parse `path?query`; `theme`, `animate`, `year`, `mowed`,
`caption`, `mower` map to `lawnToSvg` opts; `mkdir -p`; write.
Data, in this order:
1. **GraphQL (recommended, primary)** when `GITHUB_TOKEN` is set: `POST
   https://api.github.com/graphql`, `Authorization: bearer <token>`, query
   `user(login:$login){ contributionsCollection(from:$from,to:$to){ contributionCalendar{
   totalContributions weeks{ contributionDays{ date contributionCount contributionLevel }}}}}`.
   `from/to` omitted for the rolling year; `year=2025` -> `2025-01-01T00:00:00Z ..
   2025-12-31T23:59:59Z`. Levels: `NONE..FOURTH_QUARTILE -> 0..4`. Exactly what snk does
   with the default action token: official data, exact counts, no third party.
2. **Fallback** when the token is empty or the call fails (non-200 or `errors[]`):
   `GET https://github-contributions-api.jogruber.de/v4/<user>?y=last` (or `?y=<year>`).
   Verified shape: `{ total: { lastYear: n } | { "2025": n, … }, contributions: [{ date:
   "2025-09-07", count: 8, level: 1 }, …] }`, 368 entries ending today for `y=last`; sort
   by date defensively (`y=all` came back descending).
3. Grid: calendar year -> `daysForYear(days, year)` (`contrib.js:58`). Rolling -> drop
   leading days until a Sunday, pad the tail with `{date:null, void:true}` to a multiple
   of 7 (today's partial week, like GitHub). Then `createLawn(days, { year })`. When B's
   `src/core/github.js` lands, reuse its parser instead of keeping two copies.
Exit 1 with a one-line reason (unknown user, both fetches failed). Print written paths + sizes.

### `.github/workflows/lawn.yml` — the template users copy (also dogfoods on this repo)
```yaml
name: mow the lawn
on:
  schedule: [{ cron: '0 3 * * *' }]     # nightly
  workflow_dispatch:
  push: { branches: [main] }
permissions: { contents: write }
jobs:
  mow:
    runs-on: ubuntu-latest
    steps:
      - uses: evch1204/mow-your-commits@v1
        with:
          github_user_name: ${{ github.repository_owner }}
          outputs: |
            dist/lawn.svg
            dist/lawn-dark.svg?theme=dark
      - uses: crazy-max/ghaction-github-pages@v4
        with: { target_branch: output, build_dir: dist }
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```
Same shape as snk's, so people who already run the snake recognise it. `v1` is a moving
tag the maintainer re-points (`git tag -f v1 && git push -f origin v1`).

### `.github/workflows/ci.yml`
`npm ci`, `npm run build`, `node scripts/smoke.mjs`, then `rm -rf node_modules && node
scripts/render-svg.mjs --demo --outputs "out/a.svg\nout/b.svg?theme=dark&animate=1"` and
`test -s out/a.svg`.

### `README.md`
New sections (B rewrites the fetch/proxy part): `## try it` (site link, `?user=torvalds`,
"mow someone else's lawn"); `## put it in your profile` (3 steps, the yaml above, the
`<picture>` snippet, outputs options table: `theme=dark`, `animate=1`, `year=2025`,
`mowed=0..1`, `mower=0`); `## download` (page buttons); `?og=1` in the flags table; font
credit. Top of README: the owner's own lawn via `<picture>` from
`raw.githubusercontent.com/evch1204/mow-your-commits/output/lawn.svg` once commit 7 has
run, so the README is the demo. Tick off "share image export".

## 6. Commit sequence

1. `export: lawnToSvg, embedded Patrick Hand, light/dark themes, smoke assertions`
2. `export: png download, "put your lawn in your README" section with live preview + copy buttons`
3. `page: how-it-works, try-strip, footer, OG/Twitter meta, og.png, ?og=1`
4. `share: brag carries ?user= link, share on X, download from the end card`
5. `action: composite action.yml, scripts/render-svg.mjs (GraphQL + jogruber fallback), lawn.yml template, ci.yml`
6. `export: SMIL animate option (mower mows the partial row)`
7. `docs: README try/profile/download sections, dogfood the workflow, show the owner's lawn`

Each commit builds and passes `node scripts/smoke.mjs` on its own.

## 7. Verification

`scripts/smoke.mjs` additions (`import { lawnToSvg } from '../src/export/svg.js'`):
- starts with `<svg xmlns="http://www.w3.org/2000/svg"`, `viewBox="0 0 1058 257"` for the
  rolling lawn, `1077` wide for a 53-column year; `<rect` count in `#tiles` equals the
  non-void cell count (a 2025 lawn has fewer than `cols*rows`).
- contains `>Mon<`, `>Wed<`, `>Fri<`, `>less<`, `>more<`, `data:font/woff2;base64,`; none
  of `<script`, `<foreignObject`, `https://`, `http://` (after removing the `xmlns`).
- `mowed: 0` has no `#mower`; `mowed: 1` mows every tile; `mowed: 'as-is'` after `tick`
  sweeps reflects `cell.mowed`; `JSON.stringify(lawn)` is identical before and after.
- `theme:'dark'` contains `#0D1117` and `#39D353`, not `#FBF9F2`; `animate:true` contains
  `<animateTransform` and `repeatCount="indefinite"`, the default does not.
- identical on two calls; length < 200 000; `render-svg.mjs --demo` (via `child_process`)
  writes both default outputs with non-zero sizes.

Screenshots (`npm run build`, `npx vite preview --port 4175 --strictPort`):
| URL | window | must show |
| --- | --- | --- |
| `/?view=flat&autodrive=1` | 1000x1600 | board, then try-strip, how, README section with the SVG preview (identical to the board's look), yaml box, footer |
| `/?view=flat&finish=1` | 1000x900 | end card with `regrow · copy brag · share on X · download png` |
| `/?view=flat&og=1&autodrive=1` | 1200x630 | title + lede + board only, fills the frame (this is `og.png`) |
| `/?view=flat&autodrive=1` | 390x844 and 390x2000 | phone: board, chips, pad; then the strips stacked, buttons wrap, yaml scrolls sideways, no page-level horizontal scroll |
| `/?view=flat&user=torvalds` (after B) | 1000x1600 | try-strip hidden, preview caption `@torvalds - …` |
| `file:///…/out/lawn.svg`, `lawn-dark.svg` | 1100x300 | the SVG rendered by Chrome: same tiles/grass/mower as the canvas; dark one on `#0D1117`; open the animated one with `--virtual-time-budget=4000` and see the mower mid-row |

Manual checklist for the action (cannot be automated here):
1. Run `mow the lawn` from this repo's Actions tab; the `output` branch gets `lawn.svg`
   and `lawn-dark.svg`, 80-200 KB each; open the raw URL: Patrick Hand labels, mower, half mowed.
2. Paste the `<picture>` snippet into a README on a branch; check light and dark
   appearance on github.com, in the profile README and in a normal repo README.
3. `github_token: ''` in a test workflow -> log says `fallback: github-contributions-api.jogruber.de`, image still renders.
4. Unknown user -> job fails with `no such user: xyz`, nothing written.
5. Re-run: `output` only gets a commit when the picture changed; README updates within ~5 min.

## 8. Risks and out of scope

- **A changes the look.** Colours follow automatically (exporter calls `palette.js`);
  geometry changes must be mirrored in the exported `GEOM` object. Review compares the
  preview `<img>` against the canvas in one screenshot.
- **B not merged yet.** CTAs degrade: `#tryme` prompts and navigates to `?user=`; the
  preview uses the demo lawn. Nothing in C imports from B.
- **GraphQL token.** `github.token` reads any public user's calendar (snk relies on it);
  private counts appear only if the profile setting is on, like GitHub's graph. The
  jogruber fallback covers a restricted token; if jogruber dies, the token path still works.
- **Font licence.** OFL allows embedding; keep the notice in `font.js` and the footer.
- **SVG size.** 110-150 KB per file (+20 KB animated); nightly commits grow `output`
  slowly, same as snk.
- **Reddit share.** A link can only pre-fill the submit form; ship `copy brag`, X and
  native share, mention Reddit in the docs.
- Out of scope: any hosted render endpoint (no backend, by decision), GIF output, the
  browser extension, the 3D view in a README (WebGL cannot be an SVG).
