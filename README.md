<h1 align="center">🌱 mow your commits</h1>

<p align="center">
  Your GitHub contribution graph is a lawn. Mow it.
</p>

<p align="center">
  <a href="https://evch1204.github.io/mow-your-commits/"><b>▶ play it with your own graph</b></a>
  &nbsp;·&nbsp;
  <a href="#put-it-in-your-readme">put it in your README</a>
  &nbsp;·&nbsp;
  <a href="#run-it-locally">run it locally</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-97C459.svg"></a>
  <a href="https://github.com/evch1204/mow-your-commits/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/evch1204/mow-your-commits?style=flat&color=97C459"></a>
  <img alt="zero backend" src="https://img.shields.io/badge/backend-none-D85A30.svg">
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/lawn-dark.svg">
    <img alt="a GitHub contribution graph drawn as a half-mowed doodle lawn" src="docs/lawn.svg">
  </picture>
</p>

Every day on your graph is a patch of grass. More commits, taller grass. Drive the mower
over a day and the real GitHub tile pops out with the count. Mow all 52 weeks and you get
a time to brag about.

Type any GitHub username on the site and it becomes that account's real graph. No login,
no token, nothing to install.

<table>
  <tr>
    <td><img alt="riding the mower through spring" src="docs/shots/deep.png"></td>
    <td><img alt="the whole year from above, in autumn" src="docs/shots/overview.png"></td>
  </tr>
  <tr>
    <td><img alt="the flat view, mid-mow" src="docs/shots/flat.png"></td>
    <td><img alt="January, snowing, −2 °C" src="docs/shots/winter.png"></td>
  </tr>
</table>

**Controls.** Click the lawn, then WASD or arrow keys. `C` for the overview shot, `R` to
regrow, drag to look around in 3D. On a phone there is a pad.

## Put it in your README

A GitHub Action mows your graph every night and commits the picture to your profile repo.
No tokens to create, no server, nothing to host. Light and dark, like GitHub's own graph.

1. Make a repo named after you (`you/you`) if you don't have one.
2. Add `.github/workflows/lawn.yml`:

```yaml
name: mow the lawn

on:
  schedule: [{ cron: '0 3 * * *' }]
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
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
```

3. Run it once from the Actions tab, then paste this into your README (swap `USER` for
   your login):

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/USER/USER/output/lawn-dark.svg">
  <img alt="my GitHub contribution graph as a half-mowed lawn" src="https://raw.githubusercontent.com/USER/USER/output/lawn.svg">
</picture>
```

The site's **copy workflow** and **copy markdown** buttons fill in your username for you.

Want it to move? Add `?animate=1` to an output line and the mower drives the half-mowed
row on a loop, like the snake. Every option, one per output line:

| option | values | what it does |
| --- | --- | --- |
| `theme` | `light`, `dark` | GitHub's dark ramp on `#0D1117` |
| `animate` | `1` | the mower mows the row on an 8 s loop |
| `year` | `2025` | a calendar year instead of the rolling 52 weeks |
| `mowed` | `0`..`1`, `as-is` | how much is already cut (default `0.5`) |
| `mower` | `0` | park the mower off the picture |
| `caption` | text, or `0` | replace "1,234 contributions in the last year" |

More in [`action/README.md`](action/README.md). Prefer a file? The site has
**download svg** and **download png**, and the end card downloads the lawn exactly as you
mowed it.

## Run it locally

```
npm install
npm run dev
```

Open the URL Vite prints, type a username into the box above the lawn, press **mow it**.
`?user=torvalds` in the address bar does the same. `?year=2025` picks a calendar year.

## How it works

- **Your data, no login.** The site reads the public contribution graph through a
  CORS-open mirror, so it works as a static page on GitHub Pages. Paste a fine-grained
  token with no permissions under "or paste a token" and it talks to GitHub's GraphQL API
  directly instead, private contributions included. The token stays in your browser and
  never touches a URL.
- **One sim, two renderers.** A pure, DOM-free model in `src/core` drives a hand-drawn
  canvas and a cel-shaded Three.js scene. Grass height and density follow the actual
  count, not just GitHub's four levels, and the best 3% of your days grow dandelions.
- **The README picture is the board.** The Action renders through the same code as the
  site with zero dependencies, so what lands in your profile is exactly what you mowed.

Developer notes, URL flags and the screenshot recipe: [`docs/DEV.md`](docs/DEV.md).

## Credits

Inspired by the [contribution snake](https://github.com/Platane/snk). Drawn in
[Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) by Patrick Wagesreiter
(SIL Open Font License 1.1), embedded in the exported SVG. Built with
[three.js](https://threejs.org/). MIT.
