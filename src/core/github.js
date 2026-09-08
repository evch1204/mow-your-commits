// Real GitHub contribution data. Pure: no DOM, `fetch` and `localStorage` are
// injected, so every function in here runs (and is tested) under plain node.
//
// Source: https://github-contributions-api.jogruber.de/v4/<login>[?y=all|last|YYYY]
// It scrapes the public profile and is the only CORS-open public mirror, so a
// static page can call it directly. Shape:
//   { total: { "2011": 2087, ..., "2026": 2697 }, contributions: [{ date, count, level }] }
// `level` is 0..4, GitHub's own per-year quartiles, and is 0 iff count is 0.
// Years come newest-first with days ascending inside a year, so the list needs
// a sort. The `total` keys are exactly the years the profile picker shows.

export const API = 'https://github-contributions-api.jogruber.de/v4/';

/** Kinds of GithubError: what the UI turns into a sentence. */
export const ERROR_KINDS = ['invalid', 'notfound', 'ratelimited', 'network', 'malformed', 'token'];

export class GithubError extends Error {
  constructor(kind, message, extra = {}) {
    super(message || kind);
    this.name = 'GithubError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

// GitHub logins: 1-39 of [A-Za-z0-9-], no leading or trailing hyphen, no "--".
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * Anything a visitor might paste into the box -> a bare login.
 *   'torvalds', ' @Torvalds ', 'https://github.com/torvalds/',
 *   'github.com/torvalds?tab=repositories', 'http://www.github.com/torvalds#x'
 * Everything else (other hosts, spaces, empty, malformed logins) -> null.
 * Case is preserved; the API is case-insensitive.
 */
export function parseUserInput(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^@+/, '');
  s = s.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '');   // scheme
  s = s.replace(/^www\./i, '');
  if (/^github\.com(\/|$)/i.test(s)) s = s.slice(10).replace(/^\/+/, '');
  s = s.split('?')[0].split('#')[0];                    // query, hash
  s = s.split('/')[0];                                  // first path segment
  return LOGIN.test(s) ? s : null;
}

/**
 * A day with contributions must be mowable, so a level of 0 (or garbage) next
 * to a positive count is pulled up to 1. Empty days stay at 0.
 */
export function clampLevel(level, count) {
  if (!(count > 0)) return 0;
  const l = Math.round(Number(level));
  return Number.isFinite(l) ? Math.max(1, Math.min(4, l)) : 1;
}

function badShape(json) {
  return !json || typeof json !== 'object' || Array.isArray(json)
    || !Array.isArray(json.contributions)
    || !json.total || typeof json.total !== 'object' || Array.isArray(json.total);
}

/**
 * jogruber JSON -> { days, years, totals }.
 * days: [{date, count, level}] sorted ascending, days after `today` dropped
 * (GitHub leaves the rest of the current year blank, the API zero-fills it).
 * years: the `total` keys as numbers, newest first, zero years kept - that is
 * exactly the profile's year picker. totals: { year: n }.
 * @param {string|null} today ISO date, inclusive cut-off.
 */
export function normaliseApi(json, today = null) {
  if (badShape(json)) throw new GithubError('malformed', 'unexpected contributions payload');

  const days = [];
  for (const d of json.contributions) {
    if (!d || typeof d.date !== 'string' || !d.date) continue;
    if (today && d.date > today) continue;
    const count = Number(d.count) > 0 ? Math.round(Number(d.count)) : 0;
    days.push({ date: d.date, count, level: clampLevel(d.level, count) });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const totals = {};
  const years = [];
  for (const key of Object.keys(json.total)) {
    const y = Number(key);
    if (!Number.isInteger(y) || y < 2000 || y > 3000) continue;   // skips "lastYear"
    totals[y] = Number(json.total[key]) || 0;
    years.push(y);
  }
  years.sort((a, b) => b - a);

  return { days, years, totals };
}

// --- fetching --------------------------------------------------------------

const TIMEOUT = 15000;

function mapStatus(status) {
  if (status === 404) return new GithubError('notfound', 'no such GitHub user');
  if (status === 429) return new GithubError('ratelimited', 'too many requests');
  if (status === 400) return new GithubError('invalid', 'the API rejected that name');
  return new GithubError('network', 'the contributions API answered ' + status, { status });
}

async function getJson(url, doFetch, signal) {
  let res;
  try {
    res = await doFetch(url, {
      signal: signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(TIMEOUT)
        : undefined),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    // offline, DNS, CORS, abort: all indistinguishable from here
    throw new GithubError('network', 'could not reach the contributions API', { cause: err });
  }
  if (!res.ok) throw mapStatus(res.status);
  try {
    return await res.json();
  } catch (err) {
    throw new GithubError('malformed', 'the contributions API sent non-JSON', { cause: err });
  }
}

/**
 * The two public calls, in parallel: y=all for the calendar years and the year
 * list, y=last for GitHub's rolling window (its levels are quartiles over that
 * window, which is what the default profile view shows). If y=last alone fails
 * the result still resolves with last === null and main.js re-levels a window
 * of the full history instead.
 * @returns {Promise<{login, days, years, totals, last, fetchedAt}>}
 */
export async function fetchContributions(login, opts = {}) {
  const doFetch = opts.fetch || globalThis.fetch;
  const today = opts.today || null;
  const url = (y) => API + encodeURIComponent(login) + '?y=' + y;
  const get = (y) => getJson(url(y), doFetch, opts.signal);

  const [all, last] = await Promise.allSettled([get('all'), get('last')]);
  if (all.status === 'rejected') throw all.reason;

  const data = normaliseApi(all.value, today);
  data.login = login;
  data.last = null;
  if (last.status === 'fulfilled') {
    try { data.last = normaliseApi(last.value, today).days; } catch { data.last = null; }
  }
  data.fetchedAt = Date.now();
  return data;
}

// --- cache -----------------------------------------------------------------
// One entry per login in localStorage. Days are stored as [date, count, level]
// triplets: torvalds' 16 years come to ~130 KB that way, and a warm reload
// then costs no request at all.

export const CACHE_VERSION = 1;
export const CACHE_PREFIX = 'mow:gh:v' + CACHE_VERSION + ':';
export const CACHE_TTL = 3600e3;          // an hour, same as the API's own cache
export const STALE_OK = 7 * 86400e3;      // older than fresh, still better than nothing
export const MAX_CACHED = 6;

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }   // private mode throws
}

const cacheKey = (login) => CACHE_PREFIX + String(login).toLowerCase();
const pack = (days) => days.map((d) => [d.date, d.count, d.level]);
const unpack = (rows) => (Array.isArray(rows)
  ? rows.map((r) => ({ date: r[0], count: r[1] || 0, level: r[2] || 0 }))
  : null);

function cacheKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith('mow:gh:v')) keys.push(k);
  }
  return keys;
}

/** @returns {{data, fresh, age}|null} - `fresh` means no request is needed. */
export function readCache(login, now = Date.now(), storage = defaultStorage()) {
  if (!storage) return null;
  let raw;
  try { raw = storage.getItem(cacheKey(login)); } catch { return null; }
  if (!raw) return null;
  let entry;
  try { entry = JSON.parse(raw); } catch { return null; }
  if (!entry || entry.v !== CACHE_VERSION || !Array.isArray(entry.days)) return null;
  const age = now - (entry.at || 0);
  if (age < 0 || age > STALE_OK) return null;
  return {
    fresh: age < CACHE_TTL,
    age,
    data: {
      login: entry.login,
      days: unpack(entry.days) || [],
      last: unpack(entry.last),
      years: Array.isArray(entry.years) ? entry.years : [],
      totals: entry.totals || {},
      fetchedAt: entry.at,
    },
  };
}

export function writeCache(login, data, now = Date.now(), storage = defaultStorage()) {
  if (!storage) return false;
  const value = JSON.stringify({
    v: CACHE_VERSION, at: now, login,
    years: data.years, totals: data.totals,
    days: pack(data.days), last: data.last ? pack(data.last) : null,
  });
  const key = cacheKey(login);
  const evict = () => {
    let keys = cacheKeys(storage).filter((k) => k !== key);
    if (keys.length < MAX_CACHED) return;
    const aged = keys.map((k) => {
      let at = 0;
      try { at = (JSON.parse(storage.getItem(k)) || {}).at || 0; } catch { at = 0; }
      return { k, at };
    }).sort((a, b) => a.at - b.at);
    for (const e of aged.slice(0, aged.length - (MAX_CACHED - 1))) {
      try { storage.removeItem(e.k); } catch { /* ignore */ }
    }
  };
  try {
    evict();
    storage.setItem(key, value);
    return true;
  } catch {
    // quota: drop every lawn we've cached and keep only this one
    try {
      for (const k of cacheKeys(storage)) storage.removeItem(k);
      storage.setItem(key, value);
      return true;
    } catch { return false; }
  }
}

export function clearCache(storage = defaultStorage()) {
  if (!storage) return;
  try { for (const k of cacheKeys(storage)) storage.removeItem(k); } catch { /* ignore */ }
}

// --- the optional token path ----------------------------------------------
// A fine-grained PAT with no permissions reads public calendars straight from
// GitHub; the token owner's own calendar also carries private contributions,
// which is the whole point. Cost is 1 point per request of the 5,000/h budget.
// api.github.com allows Authorization from any origin, so no proxy is needed.

export const GRAPHQL = 'https://api.github.com/graphql';

/** The shapes GitHub hands out. Classic, fine-grained, OAuth and app tokens. */
export const TOKEN_PREFIX = /^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/;

export const GQL_LEVEL = {
  NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4,
};

const CAL = 'contributionCalendar { totalContributions weeks'
  + ' { contributionDays { date contributionCount contributionLevel } } }';

const Q_YEARS = 'query Years($login: String!)'
  + ' { user(login: $login) { contributionsCollection { contributionYears } } }';

/** One aliased contributionsCollection per year, plus GitHub's rolling window. */
function calQuery(years, withLast) {
  const parts = [];
  if (withLast) parts.push('last: contributionsCollection { ' + CAL + ' }');
  for (const y of years) {
    parts.push('y' + y + ': contributionsCollection(from: "' + y + '-01-01T00:00:00Z"'
      + ', to: "' + y + '-12-31T23:59:59Z") { ' + CAL + ' }');
  }
  return 'query Cal($login: String!) { user(login: $login) { ' + parts.join(' ') + ' } }';
}

function sortDays(days) {
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return days;
}

function calendarDays(node, today) {
  const weeks = node && node.contributionCalendar && node.contributionCalendar.weeks;
  if (!Array.isArray(weeks)) return null;
  const days = [];
  for (const w of weeks) {
    for (const d of (w && w.contributionDays) || []) {
      if (!d || typeof d.date !== 'string' || !d.date) continue;
      if (today && d.date > today) continue;
      const count = Number(d.contributionCount) > 0 ? Math.round(Number(d.contributionCount)) : 0;
      const lvl = GQL_LEVEL[d.contributionLevel];
      days.push({ date: d.date, count, level: clampLevel(lvl === undefined ? 1 : lvl, count) });
    }
  }
  return sortDays(days);
}

/**
 * A GraphQL calendar response -> the same { days, years, totals, last } the
 * public API path produces. `last:` is the rolling window; `y2025:` and friends
 * are calendar years.
 */
export function normaliseGraphql(json, today = null) {
  const user = json && json.data && json.data.user;
  if (!user || typeof user !== 'object') {
    throw new GithubError('malformed', 'unexpected GraphQL payload');
  }
  const totals = {};
  const years = [];
  let days = [];
  let last = null;
  for (const key of Object.keys(user)) {
    if (key === 'last') { last = calendarDays(user[key], today); continue; }
    const m = /^y(\d{4})$/.exec(key);
    if (!m) continue;
    const block = calendarDays(user[key], today);
    if (!block) continue;
    const y = Number(m[1]);
    years.push(y);
    totals[y] = Number(user[key].contributionCalendar.totalContributions) || 0;
    days = days.concat(block);
  }
  if (!years.length && !last) throw new GithubError('malformed', 'no calendars in the response');
  years.sort((a, b) => b - a);
  return { days: sortDays(days), years, totals, last };
}

async function graphql(query, login, token, doFetch, signal) {
  let res;
  try {
    res = await doFetch(GRAPHQL, {
      method: 'POST',
      headers: { authorization: 'bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { login } }),
      signal: signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(TIMEOUT)
        : undefined),
    });
  } catch (err) {
    throw new GithubError('network', 'could not reach api.github.com', { cause: err });
  }
  if (res.status === 401) throw new GithubError('token', 'GitHub rejected that token');
  if (res.status === 403) throw new GithubError('ratelimited', 'GitHub says slow down');
  if (!res.ok) throw mapStatus(res.status);

  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new GithubError('malformed', 'api.github.com sent non-JSON', { cause: err });
  }
  if (json && Array.isArray(json.errors) && json.errors.length) {
    const types = json.errors.map((e) => e && e.type);
    if (types.includes('NOT_FOUND')) throw new GithubError('notfound', 'no such GitHub user');
    if (types.includes('RATE_LIMITED')) throw new GithubError('ratelimited', 'GitHub says slow down');
    if (types.includes('FORBIDDEN')) throw new GithubError('token', 'that token is not allowed to read this');
    throw new GithubError('malformed', (json.errors[0] && json.errors[0].message) || 'GraphQL error');
  }
  return json;
}

/**
 * The whole history through GitHub's own API. One request for the year list,
 * then one per batch of 12 years (plus the rolling window on the first).
 * @returns {Promise<{login, days, years, totals, last, fetchedAt}>}
 */
export async function fetchViaGraphql(login, token, opts = {}) {
  if (!token) throw new GithubError('token', 'no token saved');
  const doFetch = opts.fetch || globalThis.fetch;
  const today = opts.today || null;

  const yjson = await graphql(Q_YEARS, login, token, doFetch, opts.signal);
  const raw = yjson && yjson.data && yjson.data.user
    && yjson.data.user.contributionsCollection
    && yjson.data.user.contributionsCollection.contributionYears;
  if (!Array.isArray(raw)) throw new GithubError('malformed', 'no year list in the response');

  const years = raw.map(Number).filter(Number.isInteger).sort((a, b) => b - a);
  const out = { login, days: [], years, totals: {}, last: null, fetchedAt: Date.now() };

  const batches = [];
  for (let i = 0; i < years.length; i += 12) batches.push(years.slice(i, i + 12));
  if (!batches.length) batches.push([]);

  for (let i = 0; i < batches.length; i++) {
    const json = await graphql(calQuery(batches[i], i === 0), login, token, doFetch, opts.signal);
    const part = normaliseGraphql(json, today);
    out.days = out.days.concat(part.days);
    Object.assign(out.totals, part.totals);
    if (part.last) out.last = part.last;
  }
  for (const y of years) if (out.totals[y] === undefined) out.totals[y] = 0;
  sortDays(out.days);
  return out;
}
