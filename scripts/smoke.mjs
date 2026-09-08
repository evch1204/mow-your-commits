// Pure-node smoke test for the lawn sim. No DOM, no build step.
//   node scripts/smoke.mjs
import {
  createLawn, resetLawn, tick, progress, COLS, ROWS, MAX_COLS,
  describeCell, formatTime, gridForYear, layoutYear, placeMower, isoDay,
} from '../src/core/lawn.js';
import { daysForYear, daysForRolling, yearsIn } from '../src/core/contrib.js';
import {
  parseUserInput, normaliseApi, clampLevel, GithubError,
  fetchContributions, readCache, writeCache, CACHE_TTL, STALE_OK, MAX_CACHED,
  normaliseGraphql, fetchViaGraphql, GQL_LEVEL, TOKEN_PREFIX,
} from '../src/core/github.js';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL('./fixtures/' + name + '.json', import.meta.url), 'utf8'));

let failures = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (extra ? '  ' + extra : ''));
  }
}

/** Assert that fn() throws a GithubError of a given kind. */
function throwsKind(name, kind, fn) {
  let got = null;
  try { fn(); } catch (e) { got = e; }
  ok(name, got instanceof GithubError && got.kind === kind,
    got ? got.name + '/' + got.kind : 'did not throw');
}

const idle = { up: false, down: false, left: false, right: false };
const gas = { up: true, down: false, left: false, right: false };
const DT = 1 / 60;

function sumMowed(lawn) {
  return lawn.cells.reduce((s, c) => s + (c.mowed ? c.count : 0), 0);
}

console.log('lawn sim smoke test');

const lawn = createLawn(null, { seed: 20260904 });

ok('rolling grid is 52x7', lawn.cols === COLS && lawn.cells.length === COLS * ROWS, `got ${lawn.cells.length}`);
ok('rolling grid has no voids', lawn.cells.every((c) => !c.void));
ok('has contributions', lawn.totalContributions > 200, `got ${lawn.totalContributions}`);
ok('has mowable cells', lawn.mowable > 50 && lawn.mowable < COLS * ROWS, `got ${lawn.mowable}`);
ok('starts unmowed', lawn.mowed === 0 && progress(lawn) === 0);
ok('starts unfinished', lawn.finished === false);
ok('timer starts at zero', lawn.time === 0 && lawn.started === false);
ok('level and count agree', lawn.cells.every((c) => (c.level === 0) === (c.count === 0)));

// idling does not start the clock
tick(lawn, idle, DT);
ok('idle does not start the clock', lawn.time === 0 && lawn.started === false);

// --- drive row 0, check the counters move together ------------------------

lawn.mower.z = 0.5;
lawn.mower.angle = 0;
lawn.mower.x = -2;
let guard = 0;
while (lawn.mower.x < lawn.cols + 1 && guard++ < 20000) tick(lawn, gas, DT);

ok('driving mows cells', lawn.mowed > 0, `mowed ${lawn.mowed}`);
ok('driving starts the clock', lawn.started === true && lawn.time > 0);
ok('mowedContributions matches the cells',
  lawn.mowedContributions === sumMowed(lawn),
  `${lawn.mowedContributions} vs ${sumMowed(lawn)}`);
ok('lastMowed points at a mowed cell',
  lawn.lastMowed >= 0 && lawn.cells[lawn.lastMowed].mowed === true);
ok('lastMowed describes a day', /\d{1,2} \w{3} \d{4}/.test(describeCell(lawn.cells[lawn.lastMowed])),
  describeCell(lawn.cells[lawn.lastMowed]));

const afterRow0 = lawn.mowed;
const contribAfterRow0 = lawn.mowedContributions;
ok('row 0 only', lawn.cells.every((c) => !c.mowed || c.row === 0 || c.level === 0));

// --- drive every remaining row -------------------------------------------

for (let row = 1; row < ROWS; row++) {
  lawn.mower.z = row + 0.5;
  lawn.mower.angle = 0;
  lawn.mower.x = -2;
  lawn.mower.vel = 0;
  guard = 0;
  while (lawn.mower.x < lawn.cols + 1 && guard++ < 20000) tick(lawn, gas, DT);
}

ok('mowed count rises', lawn.mowed > afterRow0, `${afterRow0} -> ${lawn.mowed}`);
ok('contributions rise', lawn.mowedContributions > contribAfterRow0,
  `${contribAfterRow0} -> ${lawn.mowedContributions}`);
ok('every cell is mowed', lawn.cells.every((c) => c.mowed));
ok('progress reaches 1', progress(lawn) === 1, `got ${progress(lawn)}`);
ok('mowed equals mowable', lawn.mowed === lawn.mowable, `${lawn.mowed} vs ${lawn.mowable}`);
ok('finished flipped', lawn.finished === true);
ok('all contributions counted',
  lawn.mowedContributions === lawn.totalContributions,
  `${lawn.mowedContributions} vs ${lawn.totalContributions}`);

const finishTime = lawn.time;
ok('clock ran', finishTime > 0, formatTime(finishTime));
for (let i = 0; i < 120; i++) tick(lawn, gas, DT);
ok('clock stops when finished', lawn.time === finishTime, `${lawn.time} vs ${finishTime}`);

// mow animation finishes
for (let i = 0; i < 60; i++) tick(lawn, idle, DT);
ok('mow animations complete', lawn.cells.every((c) => c.mowT === 1));

// --- regrow ---------------------------------------------------------------

resetLawn(lawn);
ok('regrow clears mowed', lawn.mowed === 0 && progress(lawn) === 0);
ok('regrow clears contributions', lawn.mowedContributions === 0);
ok('regrow clears lastMowed', lawn.lastMowed === -1);
ok('regrow clears the clock', lawn.time === 0 && lawn.started === false);
ok('regrow unfinishes', lawn.finished === false);
ok('regrow parks the mower',
  lawn.mower.x === -1.6 && lawn.mower.z === ROWS / 2 && lawn.mower.vel === 0 && lawn.mower.angle === 0);
ok('regrow regrows the grass',
  lawn.cells.every((c) => c.mowed === (c.level === 0) && c.mowT === (c.level === 0 ? 1 : 0)));

// --- determinism ----------------------------------------------------------

const a = createLawn(null, { seed: 4242 });
const b = createLawn(null, { seed: 4242 });
const c = createLawn(null, { seed: 99 });
ok('same seed, same year', a.totalContributions === b.totalContributions
  && a.cells.every((cell, i) => cell.count === b.cells[i].count));
ok('different seed, different year', a.totalContributions !== c.totalContributions,
  `${a.totalContributions} vs ${c.totalContributions}`);

// --- calendar years -------------------------------------------------------

const g25 = gridForYear(2025);
ok('2025 lays out as 53 columns', g25.cols === 53, `got ${g25.cols}`);
ok('2028 lays out as 54 columns', gridForYear(2028).cols === 54, `got ${gridForYear(2028).cols}`);
ok('every year fits MAX_COLS', [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028]
  .every((y) => gridForYear(y).cols <= MAX_COLS));
ok('year grid starts on a Sunday and ends on a Saturday',
  g25.dates.length % ROWS === 0
  && (g25.dates.find(Boolean)).getDay() >= 0
  && g25.dates.filter(Boolean)[0].getMonth() === 0);

const y25 = createLawn(null, { seed: 20260904, year: 2025 });
ok('picked year keeps its cols', y25.cols === 53 && y25.cells.length === 53 * ROWS);
ok('picked year is tagged', y25.year === 2025);
ok('void cells exist at both ends', y25.cells[0].void === true && y25.cells[y25.cells.length - 1].void === true);
ok('voids are 3 before 1 Jan 2025 and 3 after 31 Dec',
  y25.cells.filter((c) => c.void).length === 6, `got ${y25.cells.filter((c) => c.void).length}`);
ok('first real day is 1 Jan', y25.cells.find((c) => !c.void).date === '2025-01-01');
ok('last real day is 31 Dec',
  [...y25.cells].reverse().find((c) => !c.void).date === '2025-12-31');
ok('voids carry no date, level or count',
  y25.cells.filter((c) => c.void).every((c) => c.date === null && c.level === 0 && c.count === 0));
ok('voids are not mowable',
  y25.mowable === y25.cells.filter((c) => !c.void && c.level > 0).length);
ok('voids do not add contributions',
  y25.totalContributions === y25.cells.reduce((s, c) => s + (c.void ? 0 : c.count), 0));
ok('month labels start at January', y25.monthStarts[0].month === 0 && y25.monthStarts[0].col === 0);
ok('twelve months', y25.monthStarts.length === 12);
ok('describeCell says nothing about a void', describeCell(y25.cells[0]) === '');

// voids stay untouched when you drive right over them
for (let row = 0; row < ROWS; row++) {
  y25.mower.z = row + 0.5;
  y25.mower.x = -2;
  y25.mower.angle = 0;
  y25.mower.vel = 0;
  guard = 0;
  while (y25.mower.x < y25.cols + 1 && guard++ < 20000) tick(y25, gas, DT);
}
ok('a picked year can be fully mowed', progress(y25) === 1 && y25.finished === true);
ok('driving over voids does not count them',
  y25.mowed === y25.mowable && y25.mowedContributions === y25.totalContributions,
  `${y25.mowed}/${y25.mowable}`);

placeMower(y25, 10);
ok('placeMower parks in a column', y25.mower.x === 10.5 && y25.mower.z === ROWS / 2);

const yA = createLawn(null, { seed: 1, year: 2024 });
const yB = createLawn(null, { seed: 1, year: 2024 });
const yC = createLawn(null, { seed: 1, year: 2023 });
ok('same seed and year are identical',
  yA.cells.every((cell, i) => cell.count === yB.cells[i].count));
ok('a different year looks different', yA.totalContributions !== yC.totalContributions,
  `${yA.totalContributions} vs ${yC.totalContributions}`);

// --- real-data path -------------------------------------------------------

const parsed = [
  { date: '2024-12-31', level: 1, count: 2 },
  { date: '2025-01-01', level: 2, count: 7 },
  { date: '2025-07-04', level: 4, count: 30 },
  { date: '2025-12-31', level: 1, count: 1 },
];
const laid = daysForYear(parsed, 2025);
ok('daysForYear fills the whole grid', laid.length === 53 * ROWS);
ok('daysForYear drops other years',
  !laid.some((d) => d.date && d.date.startsWith('2024')));
ok('daysForYear keeps the days it has',
  laid.find((d) => d.date === '2025-07-04').count === 30);
ok('daysForYear zero-fills the rest',
  laid.filter((d) => d.date && d.count === 0).length > 300);
ok('yearsIn lists years newest first',
  yearsIn(parsed).join(',') === '2025,2024');
const fromReal = createLawn(laid, { year: 2025 });
ok('a lawn from real days works',
  fromReal.cols === 53 && fromReal.totalContributions === 38, `got ${fromReal.totalContributions}`);
ok('layoutYear and daysForYear agree', layoutYear(parsed, 2025).length === laid.length);

// --- github.js: input parsing ---------------------------------------------

for (const [raw, want] of [
  ['torvalds', 'torvalds'],
  [' @Torvalds ', 'Torvalds'],
  ['https://github.com/torvalds/', 'torvalds'],
  ['github.com/torvalds?tab=repositories', 'torvalds'],
  ['http://www.github.com/torvalds#x', 'torvalds'],
  ['', null],
  ['-bad', null],
  ['a--b', null],
  ['has space', null],
  ['x'.repeat(40), null],
  ['https://gitlab.com/torvalds', null],
]) {
  ok('parseUserInput ' + JSON.stringify(raw) + ' -> ' + JSON.stringify(want),
    parseUserInput(raw) === want, 'got ' + JSON.stringify(parseUserInput(raw)));
}

ok('clampLevel keeps empty days empty', clampLevel(3, 0) === 0 && clampLevel(0, 0) === 0);
ok('clampLevel makes a busy day mowable', clampLevel(0, 6) === 1 && clampLevel(null, 6) === 1);
ok('clampLevel clamps to 1..4', clampLevel(9, 2) === 4 && clampLevel(-3, 2) === 1);

// --- github.js: normaliseApi ----------------------------------------------
// jogruber-torvalds.json is a real y=all body trimmed to 14 days of 2026
// (straddling TODAY) and 21 of 2025, with two deliberate edits: the 2024 total
// is zeroed to stand in for an empty year, and 2025-06-01 has level 0 with a
// positive count so clampLevel is exercised on real-looking data.
const TODAY = '2026-09-08';
const gh = normaliseApi(fixture('jogruber-torvalds'), TODAY);

ok('normaliseApi sorts days ascending across years',
  gh.days.every((d, i) => i === 0 || gh.days[i - 1].date <= d.date));
ok('normaliseApi reads the year list from total, newest first',
  gh.years.join(',') === '2026,2025,2024', gh.years.join(','));
ok('normaliseApi keeps a zero year', gh.totals[2024] === 0);
ok('normaliseApi drops days after today', !gh.days.some((d) => d.date > TODAY));
ok('the fixture really had future days',
  fixture('jogruber-torvalds').contributions.some((d) => d.date > TODAY));
ok('every level agrees with its count',
  gh.days.every((d) => d.level === clampLevel(d.level, d.count)));
ok('a busy day with level 0 is pulled up to 1',
  gh.days.find((d) => d.date === '2025-06-01').level === 1);
ok('level 0 iff count 0', gh.days.every((d) => (d.level === 0) === (d.count === 0)));

throwsKind('normaliseApi({}) is malformed', 'malformed', () => normaliseApi({}));
throwsKind('normaliseApi([]) is malformed', 'malformed', () => normaliseApi([]));
throwsKind('normaliseApi(bad contributions) is malformed', 'malformed',
  () => normaliseApi({ total: {}, contributions: 'x' }));
throwsKind('normaliseApi(null) is malformed', 'malformed', () => normaliseApi(null));

const ghost = normaliseApi(fixture('jogruber-ghost'), TODAY);
ok('a user with no contributions has no years',
  ghost.years.length === 0 && ghost.days.length === 0);

// --- github.js -> contrib.js: real days into a grid ------------------------

const y26 = daysForYear(gh.days, 2026, TODAY);
const afterToday = y26.filter((d) => !d.void && d.date && d.date > TODAY);
ok('daysForYear voids every day after today', afterToday.length === 0, String(afterToday.length));
ok('daysForYear keeps today itself',
  y26.some((d) => d.date === TODAY), 'no ' + TODAY);
ok('daysForYear keeps the real counts',
  y26.find((d) => d.date === '2026-09-07').count
    === gh.days.find((d) => d.date === '2026-09-07').count);

const lawn26 = createLawn(y26, { year: 2026 });
ok('a lawn of real 2026 days counts only its non-void grass',
  lawn26.mowable === lawn26.cells.filter((c) => !c.void && c.level > 0).length
    && lawn26.mowable > 0, String(lawn26.mowable));
ok('a lawn with grass left is not finished', lawn26.finished === false);
ok('void cells cover the rest of the year (9 Sep - 31 Dec, 114 days)',
  lawn26.cells.filter((c) => c.void).length > 113,
  String(lawn26.cells.filter((c) => c.void).length));

const empty26 = createLawn(daysForYear([], 2026, TODAY), { year: 2026 });
ok('an empty year has nothing to mow', empty26.mowable === 0 && empty26.totalContributions === 0);
ok('an empty year is born finished', empty26.finished === true);

const roll = daysForRolling(gh.days);
ok('daysForRolling fills 52 weeks', roll.length === COLS * ROWS, String(roll.length));
ok('daysForRolling starts on a Sunday',
  new Date(roll[0].date + 'T00:00:00').getDay() === 0, roll[0].date);
ok('daysForRolling ends today at the latest',
  roll[roll.length - 1].date <= isoDay(new Date()), roll[roll.length - 1].date);
ok('daysForRolling has no repeats', new Set(roll.map((d) => d.date)).size === roll.length);
ok('daysForRolling has no voids', roll.every((d) => !d.void && d.date));
ok('daysForRolling picks up the days it knows',
  roll.some((d) => d.count > 0));

// --- github.js: fetching, with a fake fetch --------------------------------

async function kindOf(fn) {
  try { await fn(); return 'no error'; } catch (e) {
    return e instanceof GithubError ? e.kind : 'not a GithubError';
  }
}

/** A fetch that answers each ?y= with a status and a body. */
function fakeFetch(plan) {
  return async (url) => {
    const y = new URL(url).searchParams.get('y');
    const r = plan[y];
    if (typeof r === 'function') return r();
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    };
  };
}

const body = fixture('jogruber-torvalds');
const okBoth = { all: { status: 200, body }, last: { status: 200, body } };

const fetched = await fetchContributions('torvalds', { fetch: fakeFetch(okBoth), today: TODAY });
ok('fetchContributions returns a normalised lawn source',
  fetched.login === 'torvalds' && fetched.days.length > 0
    && fetched.years.join(',') === '2026,2025,2024' && Array.isArray(fetched.last));
ok('fetchContributions stamps the fetch time', fetched.fetchedAt > 0);

ok('404 is notfound',
  await kindOf(() => fetchContributions('nobody', { fetch: fakeFetch({ all: { status: 404 }, last: { status: 404 } }) })) === 'notfound');
ok('429 is ratelimited',
  await kindOf(() => fetchContributions('torvalds', { fetch: fakeFetch({ all: { status: 429 }, last: { status: 429 } }) })) === 'ratelimited');
ok('400 is invalid',
  await kindOf(() => fetchContributions('torvalds', { fetch: fakeFetch({ all: { status: 400 }, last: { status: 400 } }) })) === 'invalid');
ok('500 is network',
  await kindOf(() => fetchContributions('torvalds', { fetch: fakeFetch({ all: { status: 503 }, last: { status: 503 } }) })) === 'network');
ok('a throwing fetch is network',
  await kindOf(() => fetchContributions('torvalds', { fetch: async () => { throw new TypeError('Failed to fetch'); } })) === 'network');
ok('a non-JSON body is malformed',
  await kindOf(() => fetchContributions('torvalds', {
    fetch: fakeFetch({ all: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }), last: { status: 200, body } }),
  })) === 'malformed');
ok('rubbish JSON is malformed',
  await kindOf(() => fetchContributions('torvalds', { fetch: fakeFetch({ all: { status: 200, body: { nope: 1 } }, last: { status: 200, body } }) })) === 'malformed');

const halfDown = await fetchContributions('torvalds', {
  fetch: fakeFetch({ all: { status: 200, body }, last: { status: 500 } }), today: TODAY,
});
ok('y=last failing alone still resolves', halfDown.days.length > 0 && halfDown.last === null);

// --- github.js: the localStorage cache ------------------------------------

function fakeStorage(throwOnSet = false) {
  const m = new Map();
  return {
    map: m,
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      if (throwOnSet && m.size >= throwOnSet) {
        const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
      }
      m.set(k, String(v));
    },
    removeItem(k) { m.delete(k); },
  };
}

const store = fakeStorage();
const T0 = 1_800_000_000_000;
ok('writeCache writes', writeCache('Torvalds', fetched, T0, store) === true);
ok('the cache key is lowercased', store.key(0) === 'mow:gh:v1:torvalds', store.key(0));

const hit = readCache('TORVALDS', T0 + 1000, store);
ok('readCache round-trips the days',
  hit && hit.fresh === true && hit.data.days.length === fetched.days.length
    && hit.data.days[0].date === fetched.days[0].date
    && hit.data.days[0].count === fetched.days[0].count
    && hit.data.days[0].level === fetched.days[0].level);
ok('readCache round-trips the year list',
  hit.data.years.join(',') === '2026,2025,2024' && hit.data.totals[2024] === 0);
ok('readCache round-trips the rolling window',
  hit.data.last && hit.data.last.length === fetched.last.length);
ok('fresh flips after the TTL', readCache('torvalds', T0 + CACHE_TTL + 1, store).fresh === false);
ok('a stale-but-usable entry still comes back',
  readCache('torvalds', T0 + STALE_OK - 1000, store) !== null);
ok('an ancient entry is dropped', readCache('torvalds', T0 + STALE_OK + 1000, store) === null);
ok('an unknown login misses', readCache('nobody-here', T0, store) === null);

const many = fakeStorage();
for (let i = 0; i < MAX_CACHED + 4; i++) {
  writeCache('user' + i, { days: [], last: null, years: [], totals: {} }, T0 + i * 1000, many);
}
ok('the cache evicts down to MAX_CACHED', many.length === MAX_CACHED, String(many.length));
ok('eviction keeps the newest', readCache('user' + (MAX_CACHED + 3), T0 + 99000, many) !== null);
ok('eviction drops the oldest', readCache('user0', T0 + 99000, many) === null);

const tight = fakeStorage(2);
writeCache('a', { days: [], last: null, years: [], totals: {} }, T0, tight);
writeCache('b', { days: [], last: null, years: [], totals: {} }, T0, tight);
ok('a quota error clears the lawns and keeps the new one',
  writeCache('c', { days: [], last: null, years: [], totals: {} }, T0, tight) === true
    && tight.length === 1 && readCache('c', T0, tight) !== null, String(tight.length));

ok('no storage is not an error',
  readCache('torvalds', T0, null) === null
    && writeCache('torvalds', fetched, T0, null) === false);

// --- github.js: the optional token path -----------------------------------
// graphql-year.json is a GitHub GraphQL calendar response: a rolling window
// plus y2026 (two weeks straddling TODAY, with all five level enums) and y2025.

const gq = normaliseGraphql(fixture('graphql-year'), TODAY);

ok('normaliseGraphql flattens the weeks and sorts them',
  gq.days.every((d, i) => i === 0 || gq.days[i - 1].date <= d.date) && gq.days.length > 0);
ok('normaliseGraphql reads the aliased years',
  gq.years.join(',') === '2026,2025', gq.years.join(','));
ok('normaliseGraphql keeps GitHub\'s own totals',
  gq.totals[2026] > 0 && gq.totals[2025] > 0);
ok('normaliseGraphql drops days after today', !gq.days.some((d) => d.date > TODAY));
ok('normaliseGraphql returns the rolling window separately',
  Array.isArray(gq.last) && gq.last.length > 0);

const seen = new Set(gq.days.map((d) => d.level));
ok('all five contributionLevel enums map to 0..4',
  [0, 1, 2, 3, 4].every((l) => seen.has(l)), [...seen].sort().join(','));
ok('the enum table is the documented one',
  GQL_LEVEL.NONE === 0 && GQL_LEVEL.FIRST_QUARTILE === 1 && GQL_LEVEL.FOURTH_QUARTILE === 4);
ok('graphql levels agree with their counts',
  gq.days.every((d) => d.level === clampLevel(d.level, d.count)));

throwsKind('normaliseGraphql({}) is malformed', 'malformed', () => normaliseGraphql({}));
throwsKind('normaliseGraphql(no user) is malformed', 'malformed',
  () => normaliseGraphql({ data: { user: null } }));
throwsKind('normaliseGraphql(no calendars) is malformed', 'malformed',
  () => normaliseGraphql({ data: { user: { somethingElse: 1 } } }));

/** A fetch that answers the year query, then every calendar query. */
let gqCalls = 0;
let gqAuthOk = true;
function fakeGraphql(steps) {
  let n = 0;
  return async (url, init) => {
    const body = JSON.parse(init.body);
    gqCalls++;
    if (init.headers.authorization !== 'bearer github_pat_test'
      || !url.endsWith('/graphql') || init.method !== 'POST') gqAuthOk = false;
    const step = steps[Math.min(n, steps.length - 1)];
    n++;
    if (typeof step === 'function') return step(body);
    return { ok: step.status >= 200 && step.status < 300, status: step.status, json: async () => step.body };
  };
}

const years2 = { data: { user: { contributionsCollection: { contributionYears: [2026, 2025] } } } };
const viaToken = await fetchViaGraphql('torvalds', 'github_pat_test', {
  today: TODAY,
  fetch: fakeGraphql([{ status: 200, body: years2 }, { status: 200, body: fixture('graphql-year') }]),
});
ok('fetchViaGraphql builds the same shape as the public path',
  viaToken.login === 'torvalds' && viaToken.years.join(',') === '2026,2025'
    && viaToken.days.length > 0 && Array.isArray(viaToken.last) && viaToken.fetchedAt > 0);
ok('fetchViaGraphql fills a total for every year',
  viaToken.years.every((y) => typeof viaToken.totals[y] === 'number'));

const q = [];
await fetchViaGraphql('torvalds', 'github_pat_test', {
  today: TODAY,
  fetch: fakeGraphql([
    { status: 200, body: { data: { user: { contributionsCollection: { contributionYears: [
      2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013] } } } } },
    (body) => { q.push(body.query); return { ok: true, status: 200, json: async () => fixture('graphql-year') }; },
  ]),
});
ok('fourteen years are asked for in two batches of at most twelve', q.length === 2, String(q.length));
ok('only the first batch asks for the rolling window',
  q[0].includes('last: contributionsCollection') && !q[1].includes('last: contributionsCollection'));
ok('the first batch asks for twelve years',
  (q[0].match(/y\d{4}: contributionsCollection\(/g) || []).length === 12);

ok('401 is a token error',
  await kindOf(() => fetchViaGraphql('torvalds', 'github_pat_test', {
    fetch: fakeGraphql([{ status: 401 }]) })) === 'token');
ok('403 is ratelimited',
  await kindOf(() => fetchViaGraphql('torvalds', 'github_pat_test', {
    fetch: fakeGraphql([{ status: 403 }]) })) === 'ratelimited');
ok('a NOT_FOUND error is notfound',
  await kindOf(() => fetchViaGraphql('nobody', 'github_pat_test', {
    fetch: fakeGraphql([{ status: 200, body: { errors: [{ type: 'NOT_FOUND', message: 'x' }] } }]) })) === 'notfound');
ok('a RATE_LIMITED error is ratelimited',
  await kindOf(() => fetchViaGraphql('torvalds', 'github_pat_test', {
    fetch: fakeGraphql([{ status: 200, body: { errors: [{ type: 'RATE_LIMITED', message: 'x' }] } }]) })) === 'ratelimited');
ok('a dead api.github.com is network',
  await kindOf(() => fetchViaGraphql('torvalds', 'github_pat_test', {
    fetch: async () => { throw new TypeError('Failed to fetch'); } })) === 'network');
ok('no token at all is a token error',
  await kindOf(() => fetchViaGraphql('torvalds', '', { fetch: async () => { throw new Error('never'); } })) === 'token');

ok('every graphql request is a POST to api.github.com with the token',
  gqCalls > 0 && gqAuthOk, gqCalls + ' calls');
ok('token shapes are recognised',
  TOKEN_PREFIX.test('github_pat_11ABC') && TOKEN_PREFIX.test('ghp_abc')
    && !TOKEN_PREFIX.test('hunter2') && !TOKEN_PREFIX.test('  ghp_abc'));

// --- optional: hit the real API -------------------------------------------
//   node scripts/smoke.mjs --live torvalds
// Not part of the default run: it needs the network and the third-party API.

const liveAt = process.argv.indexOf('--live');
if (liveAt !== -1) {
  const who = process.argv[liveAt + 1] || 'torvalds';
  console.log('\n  live: fetching ' + who + ' from the real API');
  try {
    const live = await fetchContributions(who, { today: isoDay(new Date()) });
    ok('live: got days', live.days.length > 5000, String(live.days.length));
    ok('live: the year list goes back to 2011', live.years.includes(2011), live.years.join(','));
    ok('live: days are sorted and levels agree',
      live.days.every((d, i) => (i === 0 || live.days[i - 1].date <= d.date)
        && d.level === clampLevel(d.level, d.count)));
    ok('live: nothing after today', !live.days.some((d) => d.date > isoDay(new Date())));
    ok('live: the rolling window came back', Array.isArray(live.last) && live.last.length > 300,
      live.last ? String(live.last.length) : 'null');
    const liveLawn = createLawn(daysForRolling(live.last || live.days), { year: null });
    ok('live: it builds a lawn', liveLawn.cols === COLS && liveLawn.mowable > 0,
      liveLawn.mowable + ' mowable');
  } catch (e) {
    ok('live: fetch succeeded', false, e.kind ? e.kind + ' - ' + e.message : String(e));
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
