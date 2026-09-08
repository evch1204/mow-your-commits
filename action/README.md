# the `mow your commits` action

Renders a GitHub contribution graph as a half-mowed doodle lawn and writes it
into your workspace as an SVG. Point a README `<img>` at the result and your
profile grows grass.

No tokens to create, no server, no `npm install` — the renderer imports only
`src/core` and `src/export`, which have zero dependencies.

## use it

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
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

Then in `USER/USER/README.md`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/USER/USER/output/lawn-dark.svg">
  <img alt="my GitHub contribution graph as a half-mowed lawn" src="https://raw.githubusercontent.com/USER/USER/output/lawn.svg">
</picture>
```

## inputs

| input | default | what it does |
| --- | --- | --- |
| `github_user_name` | *required* | the login whose graph gets mowed |
| `github_token` | `${{ github.token }}` | reads the official GraphQL calendar. The default action token is enough for any public profile; leave it out and the render falls back to a public mirror. |
| `outputs` | `dist/lawn.svg` and `dist/lawn-dark.svg?theme=dark` | one file per line, path relative to the workspace, options as a query string |

## output options

| option | values | what it does |
| --- | --- | --- |
| `theme` | `light` (default), `dark` | `dark` uses GitHub's own dark ramp on `#0D1117` |
| `year` | `2025` | a calendar year instead of the rolling 52 weeks |
| `mowed` | `0`..`1` (default `0.5`), `as-is` | how much of the lawn is already cut |
| `mower` | `0` | park the mower off the picture |
| `animate` | `1` | SMIL: the mower drives the half-mowed row on an 8 s loop |
| `caption` | text, or `0` for none | replaces "1,234 contributions in the last year" |

```yaml
outputs: |
  dist/lawn.svg
  dist/lawn-dark.svg?theme=dark
  dist/lawn-2024.svg?year=2024&mowed=1
  dist/lawn-animated.svg?animate=1
```

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
