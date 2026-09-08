# Plan B - real GitHub data (`feat/github-data`)

A visitor types `torvalds`, `@torvalds` or `https://github.com/torvalds/` and the lawn becomes
their real contribution graph, with the year list showing the years their profile shows.
Username only, no token, no backend. Optional pasted token for GitHub GraphQL directly.

## 1. Review of the current state

- Data is fake: `src/main.js:26` `createLawn(null, { seed, year })` and `:131` in `pickYear`.
  `generateFakeData` (`src/core/lawn.js:337`) is the only source.
- The year list is invented: `src/main.js:17-20` builds `[null, 2026..2021]`. The comment at
  `:17` and `:25` already says "with real data this becomes the account's years".
- `src/core/contrib.js` is written for a proxy that returns GitHub's HTML (`:47-51`,
  `parseContributions` uses `DOMParser`, so it cannot run in node). `daysForYear` (`:58`)
  and `yearsIn` (`:64`) are good and already tested (`scripts/smoke.mjs:176-197`); keep them.
- `createLawn` takes `{date, level, count}` per grid cell and makes a cell mowable iff
  `level > 0` (`src/core/lawn.js:155`). `layoutYear` (`:92`) zero-fills missing dates, so
  future days of the current year would become bare dirt, not the blank GitHub leaves them.
- An all-zero lawn is born `finished` (`:179`), and `updateHud` (`src/main.js:203`) then shows
  the end card immediately. Real accounts have empty years (octocat 2019-2026), so that path
  will be hit.
- `README.md` "Real data" section describes the proxy approach; it will be wrong after this.

### Verified API facts (curl, 2026-09-08)

`https://github-contributions-api.jogruber.de/v4/<login>[?y=all|last|YYYY]`, scrapes the
public profile, README says results cached 1 h, "uncached requests limited to 10 per 10 s
per IP". Observed:

- `200`, `Content-Type: application/json`, `Access-Control-Allow-Origin: *` on every
  response incl. errors; `OPTIONS` preflight answers `204` with `Allow-Methods: GET,...`.
  No `Access-Control-Expose-Headers`, so JS cannot read `RateLimit`, `Retry-After`,
  `age`, `x-cache` (they exist on the wire: `RateLimit-Policy: "10-in-10sec"`, `x-cache: HIT`).
- Body: `{ total: { "2011": 2087, ..., "2026": 2697 }, contributions: [{ date, count, level }] }`.
  `level` is 0..4, GitHub's own per-year quartiles (2024: L1 1-13, L2 14-27, L3 29-41,
  L4 42-55; 2025: L1 1-9 ... L4 31-61). `level === 0` iff `count === 0` (checked on 5,844 days).
- `y=all` (247 KB for torvalds, 16 years) is **years newest-first, days ascending inside a
  year** - not globally sorted. Every calendar year is complete (365/366 entries), including
  the current year through 31 Dec with `count: 0` for future days (114 future zeros today).
  `total` keys = exactly the years the GitHub profile picker shows, zero years included
  (octocat: `"2013": 0, "2019": 0 ... "2026": 0`).
- `y=last` returns 367 days from the Sunday 53 weeks back to today (UTC); `total.lastYear`.
  Levels are quartiles over that window, i.e. what the default profile view shows.
- `y=1999` is `200` with 365 zeros, so never trust arbitrary years; use the `total` keys.
- Errors: `404 {"error":"GitHub user \"x\" not found."}` (orgs too: `github` -> 404);
  `400 {"error":"Invalid request","issues":[...]}` for bad `y` or bad login chars;
  `429 {"error":"Too many requests, please try again later."}` after the 10th uncached
  call in 10 s (`Retry-After: 2`). Login is case-insensitive (`Torvalds` -> 200).
  A user with no contributions ever (`ghost`) is `200 {"total":{},"contributions":[]}`.

Alternatives checked: `https://github-contributions.vercel.app/api/v1/<login>` (sallar) has
the data (`{years:[{year,total,range}], contributions:[{date,count,color,intensity}]}`) but
sends **no** `Access-Control-Allow-Origin`, so it is unusable from a static page.
`https://github.com/users/<login>/contributions` likewise has no CORS header (and sets
cookies). `https://api.github.com/graphql` preflight allows `Authorization` from any origin
and answers unauthenticated POSTs with `403`, so the token path works browser-side.
Decision: jogruber is the only CORS-open public source; the token/GraphQL path is the fallback.

## 2. Design goals, ranked

1. Type a name, see your real lawn in under a second on a warm cache; no account, no token.
2. Exactly GitHub's numbers: its levels, its year list, its rolling window, future days blank.
3. Honest states: the demo is labelled demo, loading is visible, every failure says what to do.
4. Zero secrets in URLs; the optional token lives in localStorage only and is explained.
5. Pure, node-testable parsing; the third-party API can vanish without breaking the demo.

## 3. Changes, file by file

### `src/core/github.js` (new, pure, no DOM; `fetch` injectable)

```js
export const API = 'https://github-contributions-api.jogruber.de/v4/';
export const CACHE_VERSION = 1, CACHE_TTL = 3600e3, STALE_OK = 7 * 86400e3, MAX_CACHED = 6;

export class GithubError extends Error { constructor(kind, msg, extra) {...} } // kind below
// kinds: 'invalid' (bad input) | 'notfound' | 'ratelimited' | 'network' | 'malformed' | 'token'

/** 'torvalds' | '@torvalds' | 'https://github.com/torvalds/' | 'github.com/torvalds?tab=x'
 *  -> 'torvalds'; anything else -> null. GitHub rule: 1-39 [A-Za-z0-9-], no leading/trailing
 *  or double hyphen. Trims, strips a leading '@', strips scheme/www/github.com/, takes the
 *  first path segment, ignores query/hash. */
export function parseUserInput(raw) {...}

/** jogruber JSON -> { days, years, totals }. days: [{date,count,level}] sorted ascending,
 *  future dates (> today, ISO string) dropped, level clamped; years: numbers from
 *  Object.keys(total) newest first (zero years kept); totals: {year: n}. Throws
 *  GithubError('malformed') unless body has array `contributions` and object `total`. */
export function normaliseApi(json, today) {...}

/** GraphQL -> same shape. contributionLevel NONE..FOURTH_QUARTILE -> 0..4. */
export function normaliseGraphql(json, today) {...}

export function clampLevel(level, count) {
  if (!(count > 0)) return 0;
  const l = Math.round(Number(level));
  return Number.isFinite(l) ? Math.max(1, Math.min(4, l)) : 1;   // count>0 must be mowable
}

/** Both public calls in parallel; `last` is optional (falls back to a window of `all`). */
export async function fetchContributions(login, { fetch = globalThis.fetch, today, signal } = {}) {
  const [all, last] = await Promise.allSettled([get('all'), get('last')]);
  if (all.status === 'rejected') throw all.reason;
  const data = normaliseApi(all.value, today);
  data.last = last.status === 'fulfilled' ? normaliseApi(last.value, today).days : null;
  return data;   // { login, days, years, totals, last, fetchedAt }
}
```

`get(y)` does `fetch(API + encodeURIComponent(login) + '?y=' + y, { signal })` with a 15 s
`AbortSignal.timeout` when none is passed. Mapping: `res.status 404 -> notfound`, `429 ->
ratelimited`, `400 -> invalid`, other `!ok -> network`, `fetch` throwing (offline, CORS, abort)
`-> network`, JSON parse failure or bad shape `-> malformed`. Levels are GitHub's own
(recommended: they are exactly what the profile shows and are per-year quartiles, which
`assignLevels` cannot reproduce); `clampLevel` only guards against garbage.

Cache (localStorage, injectable `storage` for tests): key `mow:gh:v1:<login lowercase>`,
value `{ v: 1, at: Date.now(), login, years, totals, days: [[date,count,level],...],
last: [...] }` (triplets, ~130 KB for torvalds). `readCache(login, now)` returns
`{ data, fresh }` where `fresh = now - at < CACHE_TTL`; a stale entry younger than
`STALE_OK` is used only if the network call fails. `writeCache` evicts the oldest `mow:gh:`
entries beyond `MAX_CACHED` and, on `QuotaExceededError`, clears all `mow:gh:` keys and
retries once; every storage call is try/catch (private mode).

Token path: `fetchViaGraphql(login, token, { fetch, today })`. Two POSTs to
`https://api.github.com/graphql` with `Authorization: bearer <token>`:

```graphql
query Years($login: String!) { user(login: $login) { contributionsCollection { contributionYears } } }
```
then one request with an alias per year (cap 12 per request, loop if more) plus the rolling
window (no `from`/`to` = GitHub's last year):
```graphql
query Cal($login: String!) { user(login: $login) {
  last: contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } }
  y2025: contributionsCollection(from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z") { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } }
  ...
} }
```
Errors: `401` -> `token` ("token rejected"); `errors[].type === 'NOT_FOUND'` -> `notfound`;
`403`/`RATE_LIMITED` -> `ratelimited`; else as above. A fine-grained PAT with no permissions
reads public calendars; the token owner's own calendar includes private contributions (which
is the point of the path). Cost: 1 point per request of the 5,000/h budget.

### `src/core/contrib.js`

- `daysForYear(days, year, today = null)`: after `layoutYear`, entries with `date > today`
  become `{ date: null, level: 0, count: 0, void: true }` (GitHub leaves future days blank).
- New `daysForRolling(days)`: `gridForRolling().dates` mapped through a `Map` by ISO date,
  missing -> `{ date, level: 0, count: 0 }`; 364 entries, Sunday-aligned, so the API's 367-day
  `y=last` and its UTC "tomorrow" both fit `createLawn(days, { year: null })`.
- `fetchContributions(username, proxyUrl)` and the proxy comment are deleted;
  `parseContributions` stays (extension use, README mentions it). Update the header comment.

### `index.html` - the form, directly above `.stats` inside `.wrap`

```html
<form id="loader" data-state="idle" autocomplete="off">
  <label for="user" class="sr">GitHub username</label>
  <input id="user" name="user" placeholder="github username or profile link"
         spellcheck="false" autocapitalize="none" maxlength="120" />
  <button id="load" type="submit">mow it</button>
  <button id="demo" type="button" hidden>back to the demo</button>
  <span id="loadstate" role="status" aria-live="polite">demo lawn (not yours) &middot; type a username to mow your own</span>
  <details id="tokenbox">
    <summary>or paste a token</summary>
    <p>Optional. A fine-grained GitHub token with no permissions reads your public graph
       straight from GitHub (and your private contributions if you view your own account).
       It is stored only in this browser (localStorage), sent only to api.github.com, never
       put in a URL. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">make one</a></p>
    <input id="token" type="password" placeholder="github_pat_..." autocomplete="off" />
    <button id="savetoken" type="button">save</button>
    <button id="forgettoken" type="button" hidden>forget</button>
  </details>
</form>
```

Layout (desktop): one row, wraps on narrow screens.
```
[ github username or profile link      ] [mow it] [back to the demo]  demo lawn (not yours) · type a username...
  ▸ or paste a token
```
CSS, in the existing look (all new selectors, nothing existing touched):
`#loader { display:flex; flex-wrap:wrap; gap:6px 10px; align-items:center; font-size:17px }`,
`#user { font:inherit; width:min(340px,100%); padding:3px 12px 5px; border:2px solid var(--ink);
border-radius:9px; background:#fff; color:var(--ink); transform:rotate(-0.4deg) }`,
`#user:focus { outline:none; box-shadow:0 0 0 3px #97C459 }`, `#loadstate { color:var(--pencil) }`,
`#loader[data-state="loading"] #loadstate::after { content:'...'; animation: dots 1s steps(4) infinite }`
(with `@keyframes dots { to { content:'' } }` approximated via a `width`-clipped inline-block),
`#loader[data-state="error"] #loadstate { color:#D85A30 }`,
`#loader[data-state="ok"] #loadstate { color:var(--green) }`,
`#tokenbox { flex-basis:100%; font-size:15px; color:var(--pencil) } #tokenbox p { margin:4px 0 6px }`,
`#token { font:inherit; width:min(300px,100%); ...same border as #user }`,
`.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0) }`,
`#years button[data-empty="1"] { opacity:.55 }`. Mobile (`max-width:820px`): `#user { flex:1 1 200px }`.

### `src/loader.js` (new, all DOM for the form)

```js
import { parseUserInput, fetchContributions, fetchViaGraphql, readCache, writeCache, GithubError } from './core/github.js';
const TOKEN_KEY = 'mow:gh:token';
export function initLoader({ onData, onDemo }) {...}   // wires form, token box, ?user=
export async function loadUser(raw, { fromUrl = false } = {}) {...}
export function setStatus(state, text) {...}            // form.dataset.state + #loadstate text
```

`loadUser` flow: `login = parseUserInput(raw)`; null -> `setStatus('error', 'that doesn\'t look
like a GitHub username')`. Else `setStatus('loading', 'fetching ' + login + '\'s lawn')`,
disable `#load`, bump a `seq` counter so a stale response is ignored. Cache fresh -> use it
without a request. Otherwise: token saved -> `fetchViaGraphql`, else `fetchContributions`;
on `network`/`ratelimited` with a token saved, retry via GraphQL; on failure with a stale
cache entry, use it and say `showing torvalds from 3 days ago (API unreachable)`.
Success: `writeCache`, `onData({ login, ...data })`, `setStatus('ok', "torvalds · 16 years ·
since 2011")` (`"· no public contributions yet"` when `years.length === 0`, then `onData` is
still called so the picker shows just "last year" and the lawn is bare), `#demo.hidden = false`,
`document.title = login + ' - mow your commits'`, URL `?user=<login>` via `history.replaceState`
(drop `seed`, keep `view`/`year` if valid). `#user.value = login`.
Error copy by kind: `notfound` "no GitHub user called \"xyz\" (organisations have no lawn)";
`ratelimited` "too many lawns at once - wait 10 seconds and try again"; `network` "couldn't
reach the contributions API - check your connection, or paste a token to go straight to GitHub";
`malformed` "the API answered something odd - try again in a minute"; `token` "GitHub rejected
that token - check it or forget it". The demo lawn stays on screen during and after a failure.
`#demo` click: `onDemo()`, status back to the demo line, `#demo.hidden = true`, URL drops
`user`, title restored. Token box: `save` stores `#token.value.trim()` (must start with
`ghp_`/`github_pat_`, else error) and clears the field; `forget` removes it; on init, if a token
exists show `forget` and summary text "token saved (or paste a token)". Never echo the token.
Defensive: on init, if the URL has `token=`, delete it with `replaceState` before anything else.

### `src/main.js`

- Imports: `daysForYear, daysForRolling, yearsIn` from `./core/contrib.js`; `initLoader,
  loadUser` from `./loader.js`; `isoDay` from `./core/lawn.js`.
- Replace `YEARS`/`THIS_YEAR` (`:17-20`) with `let source = null` (demo) and
  `let years = demoYears()` (same `[null, 2026..2021]` list). `buildYears`/`markYears` read
  `years`; buttons get `data-empty="1"` when `source && source.totals[y] === 0`.
- `function lawnFor(y)`: `source ? createLawn(y === null ? daysForRolling(source.last ||
  source.days) : daysForYear(source.days, y, TODAY), { year: y }) : createLawn(null, { seed,
  year: y })`, `TODAY = isoDay(new Date())`. When `source.last` is null (y=last failed) the
  rolling days come from `source.days` re-levelled with `assignLevels` on the window.
- `function swapLawn(next, { first = false })`: the body of `pickYear` from `:131-140`
  (setLawn both, hide endcard/tag, `endShown=false`, `tagUntil=0`, `auto=0`,
  `markYears`, `refreshTotals`) plus: when `first` re-apply `placeMower(startCol)`,
  `prewarmFinish()` / `prewarm(3)` so `?user=torvalds&autodrive=1` screenshots work. The
  mower is parked at the start, timer is 0 (new lawn object); held keys keep working.
- `pickYear(y)` -> `year = y; swapLawn(lawnFor(y))` + the existing `replaceState`.
- `initLoader({ onData(data) { source = data; years = [null, ...data.years]; if
  (!years.includes(year)) year = null; buildYears(); swapLawn(lawnFor(year), { first: !loadedOnce++ }); },
  onDemo() { source = null; years = demoYears(); year = years.includes(year) ? year : null;
  buildYears(); swapLawn(lawnFor(year)); } })`. Then `if (params.get('user')) loadUser(params.get('user'), { fromUrl: true })`.
  The demo lawn is built and drawn first exactly as today, so there is never a blank stage.
- `?seed=` keeps working while `source` is null; a loaded user ignores it.
- Empty lawns: in `updateHud`, show the end card only if `lawn.mowable > 0`; when a picked
  year has `mowable === 0`, `setStatus('ok', 'nothing grew in 2019 - pick another year')`.
- `copyBrag`: prefix `I mowed torvalds' GitHub lawn` when a user is loaded.
- Year cap: show every year in `total` (GitHub launched 2008, so at most 19 today); `#years`
  already scrolls at `max-height: 460px` (`index.html:57`) and is a horizontal row on
  mobile. Guard `years = years.slice(0, 21)` and note it in a comment; no UI change.

### `README.md`

Rewrite "Real data": the form, accepted inputs, the API used (with its 10/10 s limit and 1 h
cache), the token path and privacy line, `?user=` in the flags table, `node scripts/smoke.mjs
--live torvalds`. Keep `parseContributions` note for the extension idea.

## 4. Loading UX

- **0-2 s**: the demo lawn stays visible and playable; `#loadstate` reads "fetching torvalds's
  lawn..." (animated dots), `mow it` is disabled and says "fetching". Typical warm-cache
  response is ~150 ms, so most visitors see the swap almost instantly; the stage never blanks.
  After 8 s the status appends " (the API is slow today)"; at 15 s the request aborts -> network error.
- **Success**: lawn swaps, year list rebuilds with the account's years (empty years dimmed),
  status turns green "torvalds · 16 years · since 2011", tab title changes, URL gets `?user=`.
- **Failure**: status turns mower-orange with the copy above; the demo lawn is still there,
  labelled; the input keeps the text so one can fix a typo; `back to the demo` restores the URL.
- **Demo label**: the status line always says "demo lawn (not yours)" when no user is loaded,
  and `body[data-source="demo"|"user"]` is set for A/C to hook into (A may append "(demo)"
  to `#span` if it wants; B does not touch `.lede`).
- **Privacy note** (in `#tokenbox`, quoted above): stored only in this browser, sent only to
  api.github.com, never in a URL, "forget" deletes it. `?token=` is stripped on load.

## 5. Commit sequence

1. `core: github.js - parseUserInput, normaliseApi, clampLevel + fixtures and smoke tests`
2. `core: contrib.js - future days are void, daysForRolling, drop the proxy fetch`
3. `core: github.js - fetchContributions with error taxonomy and localStorage cache`
4. `page: loader form above the stats, doodle styling, token disclosure markup`
5. `loader + main: ?user=, real year list, lawn swap, demo label, empty years`
6. `github: optional token path via GraphQL, save/forget, stripped ?token=`
7. `README: real data section, ?user= flag, --live smoke check`

## 6. Verification

`scripts/smoke.mjs` additions (fixtures in `scripts/fixtures/`, saved from real responses and
trimmed: `jogruber-torvalds.json` = `total` for 2024-2026 plus 21 days of 2025 and 14 of 2026
incl. dates after a fixed `TODAY = '2026-09-08'`; `graphql-year.json` = two weeks of
`contributionDays` with all five level enums; `jogruber-ghost.json` = the empty body):

- `parseUserInput`: `'torvalds'`, `' @Torvalds '` -> `'Torvalds'`, `'https://github.com/torvalds/'`,
  `'github.com/torvalds?tab=repositories'`, `'http://www.github.com/torvalds#x'` all -> `'torvalds'`;
  `''`, `'-bad'`, `'a--b'`, `'has space'`, `'x'.repeat(40)`, `'https://gitlab.com/torvalds'` -> `null`.
- `normaliseApi`: days sorted ascending across years; `years` = `[2026, 2025, 2024]` from `total`
  incl. a zero year; every day has `level === clampLevel(level, count)`; no date `> TODAY`;
  `count > 0` with `level: 0` in the fixture becomes 1; `{}`, `[]`, `{ contributions: 'x' }`
  throw `GithubError` with `kind === 'malformed'`; the ghost fixture gives `years.length === 0`.
- `normaliseGraphql`: `NONE..FOURTH_QUARTILE` -> `0..4`, weeks flattened and sorted.
- `daysForYear(days, 2026, TODAY)`: cells after 8 Sep 2026 are `void`, the lawn built from it
  has `mowable` equal to the non-void `level > 0` cells and `finished === false`; a year with
  all zeros yields `mowable === 0`.
- `daysForRolling(last)`: 364 entries, first date is a Sunday, last `<= TODAY`, all dates unique.
- `fetchContributions` with a fake `fetch`: 404 -> `notfound`, 429 -> `ratelimited`, thrown
  fetch -> `network`, `y=last` failing alone still resolves with `last === null`.
- Cache with a `Map`-backed fake storage: round-trip, `fresh` flips after `CACHE_TTL`,
  eviction to `MAX_CACHED`, quota error clears and retries.
- `node scripts/smoke.mjs --live torvalds`: real fetch, asserts `years.includes(2011)` and
  `days.length > 5000`. Not run in CI; documented in README.

Screenshots (recipe from BRIEF, port 4174, `--virtual-time-budget=12000` because the fetch is a
real network round trip):
- `/?user=torvalds&view=flat&autodrive=1` - dense real graph, mowed tiles, status green with
  "16 years", year list `last year, 2026 ... 2011`, `mow it` enabled again.
- `/?user=torvalds&year=2024&view=flat` - Jan-Dec grid, 2024 highlighted, 366 real days.
- `/?user=torvalds&year=2026&view=flat` - days after today drawn as nothing (void), no end card.
- `/?user=octocat&year=2019&view=flat` - bare lawn, no end card, status "nothing grew in 2019",
  empty years dimmed in the picker.
- `/?user=no-such-user-zz-1` - demo lawn still up, orange "no GitHub user called ..." line.
- `/?user=torvalds&view=deep&cam=overview` - 3D rebuilt with the real 52 columns.
- `/?view=flat` - demo lawn, status says "demo lawn (not yours)".
- `/?user=torvalds&view=flat` at `--window-size=390,844` - form wraps, input full width, year chips row.
Also by hand: paste a real token, save, reload (form says "token saved"), load your own login
and see private contributions; DevTools network shows only `api.github.com`; `forget` works.

## 7. Risks and out of scope

- **The third-party API disappears or changes shape.** `API` is one constant; `normaliseApi`
  throws `malformed` rather than rendering garbage; the token path is an independent route;
  the demo is always there; a 7-day stale cache covers short outages. If it dies for good,
  the README's Action (plan C) can also publish a `lawn.json` next to the SVG for the site to read.
- **Rate limit 10/10 s per IP** - shared NAT (offices, Reddit spikes) can hit it; two requests
  per fresh load, cache first, clear copy, and a saved token bypasses it entirely.
- **Timezones**: the API's days are GitHub-UTC; `daysForRolling` keys by ISO date so a UTC
  "tomorrow" is simply dropped. Out of scope: showing today's partial week (rolling grid is A's).
- **Private-only users** look empty (the scraper sees the public profile); the status says
  "no public contributions yet" and the token box is the fix. Orgs are 404 by design.
- Out of scope: OAuth, a proxy, avatars/names from the REST API, changing the rolling grid,
  any `.lede`/`.stats` copy (A), share/export (C).
