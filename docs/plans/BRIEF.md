# Shared brief for the three v0.4 plans

Read this first. It is the contract every plan, builder and the integration step follow.

## The project

`mow-your-commits`: your GitHub contribution graph is a lawn; you drive a riding mower over
it and mowing a day reveals the clean GitHub tile and that day's contributions. Two
renderers (`src/render2d` canvas, `src/render3d` Three.js) share one pure sim in
`src/core` (no DOM there, ever). Vite, static hosting on GitHub Pages, no backend.
Read `README.md` and `docs/PLAN.md` (v0.2 + v0.3 history: what was tried, what the owner
liked) before designing anything.

Owner's stated goal: a shareable one-shot toy that makes a visitor want to try it once with
their own graph, gets posted on Reddit/X, collects stars. Polish and feel over features.
Art direction is locked: keep the doodle look (Patrick Hand, ink outlines, paper `#FBF9F2`,
"boiling" wobble) and push it further, richer and more atmospheric.

## Decisions already made by the owner (do not re-open)

- Real data: **username only**, no token required. Site calls a CORS-enabled public
  contributions API (e.g. `https://github-contributions-api.jogruber.de/v4/<user>?y=all`,
  verify the actual response shape yourself) with an **optional** "paste a token" fallback
  that queries GitHub GraphQL `contributionsCollection` directly. No proxy, no backend.
- README embed: **a GitHub Action** that renders the 2D lawn as an SVG for a username and
  commits it into the user's profile repo (like the snake game), **plus** in-site
  "download SVG / PNG" and a copy-paste markdown snippet.
- Static site only. Everything must keep working from `npm run build` served at a relative
  path (GitHub Pages).

## Scope partition (three parallel worktrees)

| plan | branch | owns |
| --- | --- | --- |
| A visual | `feat/visual` | `src/render2d/*`, `src/render3d/*`, `src/core/palette.js`, look and layout of the existing page (theme CSS variables, h1/lede, `.stats`, `.board`, `#stage`, `.controls`, `#pad`, `#years`, `#tag`, `#endcard`), HUD text and **date/period formatting**, per-cell grass differentiation by contribution count, weather/temperature by season. May add read-only fields to `src/core/lawn.js`. |
| B github data | `feat/github-data` | `src/core/contrib.js`, new `src/core/github.js` (fetch, parse, cache, errors), a loader form (username or profile URL) in `index.html`, its wiring in `src/main.js` (`?user=` param, year list from real data, loading and error states, fallback to demo), `scripts/smoke.mjs` tests for parsing. |
| C product | `feat/share-readme` | landing/conversion structure of the page (hero copy, how-it-works, "put this in your README" section, footer, `<meta>` OG/social tags), `src/export/*` (lawn -> SVG string, PNG download), share/copy actions, the GitHub Action + workflow template under `action/` and `.github/`, README/docs for users. |

Interface contracts so the three merge cleanly:

1. `createLawn(days, { seed, year })` in `src/core/lawn.js` keeps its signature; A may add
   fields to cells or the lawn, never remove or rename existing ones. Cell shape stays
   `{ col, row, date, count, level, void, mowed, ... }`.
2. B adds `<form id="loader">` containing `<input id="user">` and puts it directly above
   the `.stats` row inside `.wrap`. B exposes `window.mowLoadUser(name)` no; instead B
   exports `loadUser(name)` from a new module `src/loader.js` that `main.js` calls. C's
   call-to-action buttons only need to focus `#user` (or navigate to `?user=<name>`).
3. C's new page sections go **outside** `.wrap` and `.controls` (above `h1` or below
   `#pad`). C does not restyle the board; A does not add landing sections.
4. C's SVG exporter reads only `lawn.cells`, `lawn.cols`, `lawn.year`, the palette in
   `src/core/palette.js` and (if it exists after A) any level/height table A exports from
   `src/core`. Keep the exporter a pure function of lawn data, usable in node.
5. New URL flags: B owns `?user=`, `?token=` is NOT allowed (tokens stay in localStorage).
   A and C may add flags but must list them in the plan and README.
6. Nobody renames existing element ids or removes existing URL flags.

## What a plan must contain (an Opus 5 agent builds from it without asking questions)

1. **Review of the current state** with evidence: file:line references and, for visual
   work, headless screenshots you took (recipe below). Say what is wrong and why.
2. **Design goals** in one short list, ranked.
3. **Concrete changes, file by file**: exact numbers, colours, formulas, algorithms, DOM
   structure, copy text. "Make it nicer" is not a plan. Prefer diagrams or ASCII sketches
   for layout.
4. **Commit sequence**: 4-8 logical commits with titles, each buildable on its own.
5. **Verification**: additions to `scripts/smoke.mjs`, the exact screenshot URLs to take
   (`?view=flat`, `?view=deep`, flags), and what a reviewer must see in each. Include a
   mobile-width screenshot (`--window-size=390,844`).
6. **Risks and out of scope.**
7. Keep the plan under ~350 lines. Write it to `docs/plans/<name>.md` in this worktree.

## Headless screenshot recipe (works on this machine)

```
npm run build
npx vite preview --port <PORT> --strictPort      # background
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1000,900 --virtual-time-budget=6000 \
  --screenshot=<scratchpad>/x.png "http://localhost:<PORT>/?view=flat&autodrive=1"
```

Ports: plan A uses 4173, plan B 4174, plan C 4175. Then Read the PNG and look at it.
Existing debug flags: `?view=`, `?year=`, `?seed=`, `?autodrive=1`, `?cam=overview`,
`?start=<col>`, `?yaw=`, `?dist=`, `?finish=1`.
