// The loader form: everything that turns "torvalds" into a lawn and everything
// the page says while it happens. This is the only file in plan B that touches
// the DOM; src/core/github.js stays pure.

import {
  parseUserInput, fetchContributions, fetchViaGraphql, readCache, writeCache,
  TOKEN_PREFIX,
} from './core/github.js';
import { isoDay } from './core/lawn.js';

// The optional token lives here and nowhere else: not in the URL, not on any
// server of ours, not in the status line. "forget" deletes it.
const TOKEN_KEY = 'mow:gh:token';

const DEMO_LINE = 'demo lawn (not yours) \u00b7 type a username to mow your own';
const TITLE = 'mow your commits';
const SLOW_AFTER = 8000;

const $ = (id) => document.getElementById(id);

let els = null;
let hooks = { onData() {}, onDemo() {} };
let seq = 0;             // bumped per request, so a stale response is ignored
let loaded = null;       // the login on screen, or null for the demo

/** Set the form's state (idle | loading | ok | error) and its status line. */
export function setStatus(state, text) {
  if (!els) return;
  els.form.dataset.state = state;
  if (text !== undefined) els.status.textContent = text;
}

function busy(on) {
  els.load.disabled = on;
  els.load.textContent = on ? 'fetching' : 'mow it';
}

function readToken() {
  try { return (localStorage.getItem(TOKEN_KEY) || '').trim() || null; } catch { return null; }
}

function storeToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    return true;
  } catch { return false; }
}

/** Reflect whether a token is saved. The token itself is never shown. */
function paintToken() {
  const has = !!readToken();
  els.forget.hidden = !has;
  els.tokenSummary.textContent = has ? 'token saved (or paste a token)' : 'or paste a token';
}

/**
 * With a token, ask GitHub itself (private contributions included, no shared
 * rate limit). If GitHub is merely unreachable or busy, fall back to the
 * public mirror; a rejected token is the visitor's problem, so it is raised.
 */
async function fetchFor(login, today) {
  const token = readToken();
  if (token) {
    try {
      return await fetchViaGraphql(login, token, { today });
    } catch (err) {
      if (err && (err.kind === 'token' || err.kind === 'notfound')) throw err;
      return await fetchContributions(login, { today });
    }
  }
  return fetchContributions(login, { today });
}

function possessive(name) {
  return /s$/i.test(name) ? name + "'" : name + "'s";
}

function ago(ms) {
  const h = ms / 3600e3;
  if (h < 1) return 'a few minutes ago';
  if (h < 36) return Math.max(1, Math.round(h)) + (Math.round(h) === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}

function summarise(login, data) {
  if (!data.years.length) return login + ' \u00b7 no public contributions yet';
  const n = data.years.length;
  return login + ' \u00b7 ' + n + (n === 1 ? ' year' : ' years')
    + ' \u00b7 since ' + data.years[data.years.length - 1];
}

function messageFor(err, login) {
  switch (err && err.kind) {
    case 'notfound':
      return 'no GitHub user called "' + login + '" (organisations have no lawn)';
    case 'ratelimited':
      return 'too many lawns at once - wait 10 seconds and try again';
    case 'invalid':
      return "that doesn't look like a GitHub username";
    case 'malformed':
      return 'the API answered something odd - try again in a minute';
    case 'token':
      return 'GitHub rejected that token - check it or forget it';
    default:
      return "couldn't reach the contributions API - check your connection,"
        + ' or paste a token to go straight to GitHub';
  }
}

/** Put ?user= in the URL (and take ?seed= out; it only drives the demo). */
function syncUrl(login) {
  const url = new URL(location.href);
  if (login) {
    url.searchParams.set('user', login);
    url.searchParams.delete('seed');
  } else {
    url.searchParams.delete('user');
  }
  history.replaceState(null, '', url);
}

function show(login, data, fromUrl) {
  loaded = login;
  els.user.value = login;
  els.demo.hidden = false;
  document.body.dataset.source = 'user';
  document.title = login + ' - ' + TITLE;
  if (!fromUrl || new URLSearchParams(location.search).get('user') !== login) syncUrl(login);
  // Status first: onData may replace it (an empty year says so).
  setStatus('ok', summarise(login, data));
  hooks.onData({ ...data, login });
}

/**
 * Load one account and hand it to main.js. Never throws: every failure ends as
 * a sentence in the status line with the demo lawn still on screen.
 * @returns the data shown, or null.
 */
export async function loadUser(raw, { fromUrl = false } = {}) {
  if (!els) return null;
  const login = parseUserInput(raw);
  if (!login) {
    setStatus('error', "that doesn't look like a GitHub username");
    return null;
  }

  const mine = ++seq;
  els.user.value = login;
  setStatus('loading', 'fetching ' + possessive(login) + ' lawn');
  busy(true);
  const slow = setTimeout(() => {
    if (mine === seq) els.status.textContent =
      'fetching ' + possessive(login) + ' lawn (the API is slow today)';
  }, SLOW_AFTER);
  const done = () => { clearTimeout(slow); if (mine === seq) busy(false); };

  const cached = readCache(login);
  if (cached && cached.fresh) {
    done();
    show(login, cached.data, fromUrl);
    return cached.data;
  }

  try {
    const data = await fetchFor(login, isoDay(new Date()));
    if (mine !== seq) return null;
    writeCache(login, data);
    done();
    show(login, data, fromUrl);
    return data;
  } catch (err) {
    if (mine !== seq) return null;
    done();
    if (cached) {                       // stale, but better than nothing
      show(login, cached.data, fromUrl);
      setStatus('ok', 'showing ' + login + ' from ' + ago(cached.age) + ' (API unreachable)');
      return cached.data;
    }
    setStatus('error', messageFor(err, login));
    return null;
  }
}

/** Drop the loaded account and put the demo lawn back. */
export function backToDemo() {
  seq++;                                // abandon anything in flight
  loaded = null;
  busy(false);
  els.demo.hidden = true;
  els.user.value = '';
  document.body.dataset.source = 'demo';
  document.title = TITLE;
  syncUrl(null);
  setStatus('idle', DEMO_LINE);
  hooks.onDemo();
}

/** Which login is on screen, or null while the demo is showing. */
export function currentLogin() { return loaded; }

export function initLoader(next = {}) {
  els = {
    form: $('loader'),
    user: $('user'),
    load: $('load'),
    demo: $('demo'),
    status: $('loadstate'),
    tokenbox: $('tokenbox'),
    tokenSummary: $('tokenbox').querySelector('summary'),
    token: $('token'),
    save: $('savetoken'),
    forget: $('forgettoken'),
  };
  if (!els.form) return;
  hooks = { onData: next.onData || (() => {}), onDemo: next.onDemo || (() => {}) };

  // A token must never live in a URL. If someone links one, drop it on sight.
  const here = new URL(location.href);
  if (here.searchParams.has('token')) {
    here.searchParams.delete('token');
    history.replaceState(null, '', here);
  }

  document.body.dataset.source = 'demo';
  setStatus('idle', DEMO_LINE);

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    loadUser(els.user.value);
  });
  els.demo.addEventListener('click', backToDemo);

  paintToken();
  els.save.addEventListener('click', () => {
    const value = els.token.value.trim();
    if (!value) { setStatus('error', 'paste a token first'); return; }
    if (!TOKEN_PREFIX.test(value)) {
      setStatus('error', "that isn't a GitHub token (they start with github_pat_ or ghp_)");
      return;
    }
    els.token.value = '';
    if (!storeToken(value)) {
      setStatus('error', 'this browser will not let the page store the token');
      return;
    }
    paintToken();
    setStatus('ok', 'token saved in this browser - it goes only to api.github.com');
    if (loaded) loadUser(loaded);
  });
  els.forget.addEventListener('click', () => {
    els.token.value = '';
    storeToken(null);
    paintToken();
    setStatus('idle', 'token forgotten');
  });
}
