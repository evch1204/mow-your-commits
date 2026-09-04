# mow-your-commits

🌱 Your GitHub contribution graph is a lawn. Mow it. A tiny browser game built with Three.js and canvas.

Two renderers share one model:

- `src/core/` — the lawn itself. Cells, mower physics, mowing detection, seasons. No DOM, no rendering.
- `src/render2d/` — hand-drawn canvas version, laid out at the proportions of the real graph.
- `src/render3d/` — Three.js version with cel shading, ink outlines, and a "boiling" wobble shader. Weather changes by month.

## Run

```
npm install
npm run dev
```

Click the lawn, then WASD or arrow keys. Toggle flat / 3D with the buttons.

## Real data

`src/core/contrib.js` parses GitHub's contribution table (`td[data-date][data-level]`).
In a browser extension you can read it straight off the profile page. On a standalone
site github.com won't send CORS headers, so you need a tiny proxy (Cloudflare Worker or
Vercel function) that fetches `https://github.com/users/<name>/contributions` and returns
the HTML with `Access-Control-Allow-Origin: *`. Then:

```js
import { fetchContributions, alignToGrid } from './core/contrib.js';
const days = alignToGrid(await fetchContributions('torvalds', '/api/contributions'));
const lawn = createLawn(days);
```

## Next

- [ ] hand-drawn tuft and mower textures instead of procedural strokes
- [ ] extension: content script that swaps `.js-calendar-graph` for the lawn
- [ ] sound
- [ ] end card + share image
