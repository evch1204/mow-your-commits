# the `mow your commits` action

Renders a GitHub contribution graph as a doodle lawn and writes it into your
workspace as an SVG. By default the mower drives the whole year on a loop
(`animate=1`); drop that and you get a still, half-mowed board. The picture is
transparent, so it sits on GitHub's own background whichever theme the reader
is on, and the run seeds itself from the date, so it mows a different route
every night. Point a README `<img>` at the result and your profile grows grass.

No tokens to create, no server, no `npm install` — the renderer imports only
`src/core` and `src/export`, which have zero dependencies.

## use it

The short way: open [the site](https://evch1204.github.io/mow-your-commits/), type your
username, and press the three buttons under the lawn. The first one opens GitHub's own
new-file editor with the workflow below already written into it, the second opens the
Actions tab so you can run it once, and the third copies the `<picture>` block and opens
your profile README. Nothing is committed that you do not commit yourself.

The long way, if you would rather see what you are pasting:

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
            dist/lawn.svg?animate=1
            dist/lawn-dark.svg?theme=dark&animate=1

      - uses: crazy-max/ghaction-github-pages@v4
        with: { target_branch: output, build_dir: dist }
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
```

Then in `USER/USER/README.md`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/USER/USER/output/lawn-dark.svg">
  <img alt="my GitHub contribution graph as a lawn, mowed by a little tractor" src="https://raw.githubusercontent.com/USER/USER/output/lawn.svg">
</picture>
```

## inputs

| input | default | what it does |
| --- | --- | --- |
| `github_user_name` | *required* | the login whose graph gets mowed |
| `github_token` | `${{ github.token }}` | reads the official GraphQL calendar. The default action token is enough for any public profile; leave it out and the render falls back to a public mirror. |
| `outputs` | `dist/lawn.svg?animate=1` and `dist/lawn-dark.svg?theme=dark&animate=1` | one file per line, path relative to the workspace, options as a query string |

## output options

| option | values | what it does |
| --- | --- | --- |
| `theme` | `light` (default), `dark` | `dark` uses GitHub's own dark ramp on `#0D1117` |
| `year` | `2025` | a calendar year instead of the rolling 52 weeks |
| `mowed` | `0`..`1` (default `0.5`), `as-is` | how much of the lawn is already cut |
| `mower` | `0` | park the mower off the picture. Ignored under `animate`: the animation *is* the mower driving. |
| `animate` | `1` | SMIL: the mower mows the whole year, drives off the edge, and the lawn regrows. It mows one of two ways, picked by the night's seed — round the outside and inward, like a ride-on, or stripe by stripe with a loop turn at each end, like a tractor — slows through the thick weeks, and stops for a breather once or twice on the way. `mowed` and `mower` are ignored. Roughly a 40-55 s loop and 300-500 kB, depending on how busy the year is. |
| `weather` | `0` | no seasons: no month doodles, frost, flakes, leaves or blossom, one neutral bed, and GitHub's exact greens. Dandelions stay: they are data, not weather. |
| `bg` | `0` (default), `1`, `paper` | what is painted behind the board: `0` nothing, so the picture is transparent and takes the reader's own README background; `1` GitHub's canvas for the theme (`#FFFFFF` or `#0D1117`); `paper` the site's cream sheet |
| `caption` | text, or `0` for none | replaces "1,234 contributions in the last year" |

```yaml
outputs: |
  dist/lawn.svg?animate=1
  dist/lawn-dark.svg?theme=dark&animate=1
  dist/lawn-2024.svg?year=2024&mowed=1
  dist/lawn-plain.svg?weather=0
  dist/lawn-sheet.svg?bg=paper
```

## the nightly route

The animated picture is drawn from a seed, and without `--seed` that seed is
the UTC day number. A workflow on the usual `cron: '0 3 * * *'` therefore mows a
route nobody has seen before every morning — a different way round, a different
hand on the weave, a different place to stop — while two runs on the same day
still write the same bytes. The seed is in the Action log (`  seed 20706`), so a
picture you liked can be rendered again by hand with `--seed`.

## where the data comes from

1. `POST https://api.github.com/graphql`, `contributionsCollection` — the same
   call GitHub's own graph makes. Exact counts, official levels, no third party.
2. If there is no token, or the call fails, `github-contributions-api.jogruber.de`.

Private contributions show up only if "include private contributions on my
profile" is on, exactly like the graph on your profile page.

## fonts

The SVG embeds the Latin subset of **Patrick Hand** by Patrick Wagesreiter
(SIL Open Font License 1.1) as a `data:` URI, because an `<img>` SVG in a README
cannot load anything external. That is most of the file size.

## running it by hand

```
node scripts/render-svg.mjs --user torvalds --outputs "out/lawn.svg"
node scripts/render-svg.mjs --demo --outputs "out/a.svg\nout/b.svg?theme=dark"
```
