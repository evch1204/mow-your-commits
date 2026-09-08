// Everything the page needs to hand the lawn to somebody else: links back to
// the site, the markdown to paste in a README, the workflow to copy, and a
// clipboard helper. Small and dependency-free; the only DOM it touches is the
// clipboard and the button it flashes "copied!" on.

import { formatTime } from './core/lawn.js';

export const SITE = 'https://evch1204.github.io/mow-your-commits/';
export const REPO = 'https://github.com/evch1204/mow-your-commits';

/** The `USER/USER` profile repo the Action commits into. */
const RAW = 'https://raw.githubusercontent.com';

/**
 * A GitHub login is ASCII letters, digits and hyphens, 39 characters at most.
 * `?user=` is a stranger's URL and it ends up in a filename, a raw.github URL
 * and an SVG caption, so keep only the part that could actually be a login.
 * A pasted profile URL still gives us one.
 */
export function cleanUser(name) {
  const s = String(name == null ? '' : name).trim();
  const m = /github\.com\/([^/?#]+)/i.exec(s);
  const raw = (m ? m[1] : s).replace(/^@/, '');
  return (/[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?/.exec(raw) || [''])[0].slice(0, 39);
}

/**
 * Whose lawn is on screen: ?user= wins, then the loader input if it exists
 * (plan B owns #user; this must keep working when it doesn't). '' for the demo.
 */
export function currentUser() {
  const fromUrl = new URLSearchParams(location.search).get('user');
  if (fromUrl) return cleanUser(fromUrl);
  const input = document.getElementById('user');
  return cleanUser(input && input.value);
}

/** A link that opens the site on somebody's own graph. */
export function shareUrl(user) {
  return user ? SITE + '?user=' + encodeURIComponent(user) : SITE;
}

/** The `<picture>` block that goes in a profile README. */
export function markdownSnippet(user) {
  const u = cleanUser(user) || 'YOUR-USERNAME';
  return `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${RAW}/${u}/${u}/output/lawn-dark.svg">
  <img alt="my GitHub contribution graph as a half-mowed lawn" src="${RAW}/${u}/${u}/output/lawn.svg">
</picture>`;
}

/** The workflow users drop in `.github/workflows/lawn.yml`. */
export function workflowYaml() {
  return `name: mow the lawn

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
          github_user_name: \${{ github.repository_owner }}
          outputs: |
            dist/lawn.svg
            dist/lawn-dark.svg?theme=dark

      - uses: crazy-max/ghaction-github-pages@v4
        with: { target_branch: output, build_dir: dist }
        env: { GITHUB_TOKEN: "\${{ secrets.GITHUB_TOKEN }}" }`;
}

/**
 * Copy `text`, flashing the button that asked for it. Falls back to a prompt
 * on browsers (or insecure origins) without the async clipboard.
 */
export function copy(text, btn, label) {
  const was = label || (btn && btn.textContent) || '';
  const done = () => {
    if (!btn) return;
    btn.textContent = 'copied!';
    setTimeout(() => { btn.textContent = was; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => window.prompt('copy this', text));
  } else {
    window.prompt('copy this', text);
  }
}

/** "1,234" without leaning on Intl, so the string is the same everywhere. */
function commas(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The line the end card copies. It always ends in a link, so whoever reads it
 * can go and mow their own graph - that is the whole point of the button.
 */
export function bragText(lawn, user, when, whose = 'my') {
  return 'I mowed ' + whose + ' GitHub lawn: ' + commas(lawn.totalContributions)
    + ' contributions ' + when + ', cut in ' + formatTime(lawn.time)
    + ' 🌱🚜 mow yours: ' + shareUrl(user);
}

export function xUrl(text) {
  return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
}

export function redditUrl(url, title) {
  return 'https://www.reddit.com/submit?url=' + encodeURIComponent(url)
    + '&title=' + encodeURIComponent(title);
}
