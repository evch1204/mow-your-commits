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
