// Everything the page needs to hand the lawn to somebody else: links back to
// the site, the markdown to paste in a README, the workflow to copy, and a
// clipboard helper. Small and dependency-free; the only DOM it touches is the
// clipboard and the button it flashes "copied!" on.

import { formatTime } from './core/lawn.js';
import { parseUserInput } from './core/github.js';

export const SITE = 'https://evch1204.github.io/mow-your-commits/';

/** The `USER/USER` profile repo the Action commits into. */
const RAW = 'https://raw.githubusercontent.com';

const GH = 'https://github.com';

/** Where the workflow has to land for GitHub to run it. */
export const WORKFLOW_PATH = '.github/workflows/lawn.yml';

/**
 * Whose lawn is on screen. The loader puts the login it actually resolved in
 * the box, so that is the truth; `?user=` is the fallback for a page whose
 * form has not loaded yet. Everything here goes through `parseUserInput`, the
 * one sanitiser in the project: a stranger's `?user=` ends up in a filename,
 * a raw.githubusercontent URL and an SVG caption. '' for the demo.
 */
export function currentUser() {
  const input = typeof document === 'undefined' ? null : document.getElementById('user');
  const typed = input && input.value ? parseUserInput(input.value) : null;
  if (typed) return typed;
  const search = typeof location === 'undefined' ? '' : location.search;
  return parseUserInput(new URLSearchParams(search).get('user')) || '';
}

/** Only these travel in a share link; every debug flag stays at home. */
const SHARE_FLAGS = ['user', 'year', 'seed'];

/**
 * A link that opens the site on the lawn you are looking at. The page keeps
 * `?user=` and `?year=` in the address bar in step with the screen, so the
 * live query string is what a share link carries.
 * @param search override for tests; defaults to `location.search`.
 */
export function shareUrl(user, search) {
  const live = new URLSearchParams(
    search === undefined ? (typeof location === 'undefined' ? '' : location.search) : search,
  );
  const login = parseUserInput(user) || parseUserInput(live.get('user'));
  const out = new URLSearchParams();
  for (const key of SHARE_FLAGS) {
    if (key === 'user') { if (login) out.set('user', login); continue; }
    const v = live.get(key);
    // a seed only picks a fake lawn, so it means nothing next to an account
    if (v && /^\d+$/.test(v) && !(key === 'seed' && login)) out.set(key, v);
  }
  const q = out.toString();
  return q ? SITE + '?' + q : SITE;
}

/** The `<picture>` block that goes in a profile README. */
export function markdownSnippet(user) {
  const u = parseUserInput(user) || 'YOUR-USERNAME';
  return `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${RAW}/${u}/${u}/output/lawn-dark.svg">
  <img alt="my GitHub contribution graph as a lawn, mowed by a little tractor" src="${RAW}/${u}/${u}/output/lawn.svg">
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
            dist/lawn.svg?animate=1
            dist/lawn-dark.svg?theme=dark&animate=1

      - uses: crazy-max/ghaction-github-pages@v4
        with: { target_branch: output, build_dir: dist }
        env: { GITHUB_TOKEN: "\${{ secrets.GITHUB_TOKEN }}" }`;
}

// --- the three-click install ----------------------------------------------
// Four links into github.com that between them put the lawn in a README
// without anybody copying a file by hand. Each takes whatever the visitor
// typed, runs it through `parseUserInput` (a login, an @handle or a profile
// link all land on the same bare login) and returns '' for anything else, so
// the page can tell "no account yet" from "here is your button".

/** The bare login, or '' if there is not one. */
function login(user) {
  return parseUserInput(user) || '';
}

/**
 * Step 1. GitHub's own new-file editor pre-fills from the query string:
 * `?filename=` names the path and `?value=` fills the buffer, so this opens a
 * "commit new file" page with `.github/workflows/lawn.yml` already written.
 * Nothing is committed until the visitor presses GitHub's own commit button.
 */
export function newWorkflowUrl(user) {
  const u = login(user);
  if (!u) return '';
  return `${GH}/${u}/${u}/new/main?filename=${encodeURIComponent(WORKFLOW_PATH)}`
    + `&value=${encodeURIComponent(workflowYaml())}`;
}

/** Step 2. The workflow's own page, where "Run workflow" lives. */
export function actionsUrl(user) {
  const u = login(user);
  return u ? `${GH}/${u}/${u}/actions/workflows/lawn.yml` : '';
}

/** Step 3. The profile README, open in GitHub's editor, ready for a paste. */
export function editReadmeUrl(user) {
  const u = login(user);
  return u ? `${GH}/${u}/${u}/edit/main/README.md` : '';
}

/**
 * The escape hatch under step 3: no `you/you` repo yet. `github.com/new` takes
 * `owner`, `name`, `description` and `visibility` as pre-fills (GitHub added
 * them in April 2023), and quietly ignores any it cannot honour - so the worst
 * case is the ordinary new-repo form.
 */
export function newRepoUrl(user) {
  const u = login(user);
  if (!u) return '';
  const q = new URLSearchParams({
    owner: u,
    name: u,
    description: 'my GitHub contribution graph, as a lawn, mowed nightly',
    visibility: 'public',
  });
  return `${GH}/new?${q}`;
}

/**
 * Remember what a button said before it started flashing at people. Reading it
 * back off the button loses the real label as soon as somebody clicks twice
 * inside the flash, which leaves the button reading "copied!" forever.
 */
const flashing = new WeakMap();

function flash(btn, message, label) {
  if (!btn) return;
  const live = flashing.get(btn);
  if (live) clearTimeout(live.timer);
  const was = live ? live.was : (label || btn.textContent);
  btn.textContent = message;
  flashing.set(btn, {
    was,
    timer: setTimeout(() => { btn.textContent = was; flashing.delete(btn); }, 1600),
  });
}

/**
 * Copy `text`, flashing the button that asked for it. Falls back to a prompt
 * on browsers (or insecure origins) without the async clipboard.
 */
export function copy(text, btn, label) {
  const done = () => flash(btn, 'copied!', label);
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
 * A long run of back-to-back cuts is the thing worth boasting about, so the
 * best combo joins in once it is big enough to be an achievement.
 */
export function bragText(lawn, user, when, whose = 'my') {
  const best = (lawn && lawn.bestCombo) || 0;
  return 'I mowed ' + whose + ' GitHub lawn: ' + commas(lawn.totalContributions)
    + ' contributions ' + when + ', cut in ' + formatTime(lawn.time)
    + (best >= 5 ? ' (best combo x' + best + ')' : '')
    + ' 🌱🚜 mow yours: ' + shareUrl(user);
}

export function xUrl(text) {
  return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
}

