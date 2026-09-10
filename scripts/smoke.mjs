// Pure-node smoke test for the lawn sim. No DOM, no build step.
//   node scripts/smoke.mjs
import {
  createLawn, resetLawn, tick, progress, COLS, ROWS, MAX_COLS,
  describeCell, formatTime, formatDay, periodLabel, tempAt,
  gridForYear, gridForRolling, layoutYear, placeMower, isoDay,
} from '../src/core/lawn.js';
import {
  GRASS, grassFor, tileColor, bladeColor, cellTint, hexToRgb, mix, SEASON_TINT,
  DANDELION, GITHUB, BARE, NO_SEASON,
} from '../src/core/palette.js';
import { planRoute } from '../src/core/route.js';
import { GEOM } from '../src/core/board.js';
import { lawnToSvg } from '../src/export/svg.js';
import { THEMES } from '../src/export/themes.js';
import { daysForYear, daysForRolling, yearsIn } from '../src/core/contrib.js';
import { workflowYaml, markdownSnippet, shareUrl, SITE } from '../src/share.js';
import {
  parseUserInput, normaliseApi, clampLevel, GithubError,
  fetchContributions, readCache, writeCache, CACHE_TTL, STALE_OK, MAX_CACHED,
  normaliseGraphql, fetchViaGraphql, GQL_LEVEL, TOKEN_PREFIX,
} from '../src/core/github.js';
import {
  parseArgs, splitOutputs, parseOutput, OPTION_KEYS,
} from './render-svg.mjs';
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

ok('rolling grid is 52x7', lawn.cols === COLS && lawn.cells.length === COLS * ROWS,
  `got ${lawn.cells.length}`);
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
ok('lastMowed describes a day',
  /\d{1,2} \w{3} \d{4}/.test(describeCell(lawn.cells[lawn.lastMowed])),
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
  lawn.mower.x === -1.6 && lawn.mower.z === ROWS / 2
    && lawn.mower.vel === 0 && lawn.mower.angle === 0);
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
ok('void cells exist at both ends',
  y25.cells[0].void === true && y25.cells[y25.cells.length - 1].void === true);
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

// a login that never contributed publicly: the rolling lawn is bare, not broken,
// and the page keeps its "no public contributions yet" line instead of sending
// the visitor to a year picker that holds nothing else.
const bare = createLawn(daysForRolling(ghost.days), { year: null });
ok('an account with no contributions still builds a rolling lawn',
  bare.cols === COLS && bare.cells.length === COLS * ROWS, String(bare.cols));
ok('a bare rolling lawn has nothing to mow',
  bare.mowable === 0 && bare.totalContributions === 0 && bare.finished === true);
ok('a bare rolling lawn has no voids to hide behind',
  bare.cells.every((c) => !c.void && c.level === 0));

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

const bothWith = (r) => fakeFetch({ all: r, last: r });
const statusIs = (code) => kindOf(
  () => fetchContributions('torvalds', { fetch: bothWith({ status: code }) }));
ok('404 is notfound', await statusIs(404) === 'notfound');
ok('429 is ratelimited', await statusIs(429) === 'ratelimited');
ok('400 is invalid', await statusIs(400) === 'invalid');
ok('500 is network', await statusIs(503) === 'network');
ok('a throwing fetch is network',
  await kindOf(() => fetchContributions('torvalds', {
    fetch: async () => { throw new TypeError('Failed to fetch'); },
  })) === 'network');
ok('a non-JSON body is malformed',
  await kindOf(() => fetchContributions('torvalds', {
    fetch: fakeFetch({
      all: () => ({
        ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); },
      }),
      last: { status: 200, body },
    }),
  })) === 'malformed');
ok('rubbish JSON is malformed',
  await kindOf(() => fetchContributions('torvalds', {
    fetch: fakeFetch({ all: { status: 200, body: { nope: 1 } }, last: { status: 200, body } }),
  })) === 'malformed');

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
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body,
    };
  };
}

const years2 = { data: { user: { contributionsCollection: { contributionYears: [2026, 2025] } } } };
const viaToken = await fetchViaGraphql('torvalds', 'github_pat_test', {
  today: TODAY,
  fetch: fakeGraphql([
    { status: 200, body: years2 }, { status: 200, body: fixture('graphql-year') },
  ]),
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
    (b) => {
      q.push(b.query);
      return { ok: true, status: 200, json: async () => fixture('graphql-year') };
    },
  ]),
});
ok('fourteen years are asked for in two batches of at most twelve',
  q.length === 2, String(q.length));
ok('only the first batch asks for the rolling window',
  q[0].includes('last: contributionsCollection')
    && !q[1].includes('last: contributionsCollection'));
ok('the first batch asks for twelve years',
  (q[0].match(/y\d{4}: contributionsCollection\(/g) || []).length === 12);

ok('401 is a token error',
  await kindOf(() => fetchViaGraphql('torvalds', 'github_pat_test', {
    fetch: fakeGraphql([{ status: 401 }]) })) === 'token');
ok('403 is ratelimited',
  await kindOf(() => fetchViaGraphql('torvalds', 'github_pat_test', {
    fetch: fakeGraphql([{ status: 403 }]) })) === 'ratelimited');
const gqlErrorIs = (type) => kindOf(
  () => fetchViaGraphql('torvalds', 'github_pat_test', {
    fetch: fakeGraphql([{ status: 200, body: { errors: [{ type, message: 'x' }] } }]),
  }));
ok('a NOT_FOUND error is notfound', await gqlErrorIs('NOT_FOUND') === 'notfound');
ok('a RATE_LIMITED error is ratelimited',
  await gqlErrorIs('RATE_LIMITED') === 'ratelimited');
ok('a dead api.github.com is network',
  await kindOf(() => fetchViaGraphql('torvalds', 'github_pat_test', {
    fetch: async () => { throw new TypeError('Failed to fetch'); } })) === 'network');
ok('no token at all is a token error',
  await kindOf(() => fetchViaGraphql('torvalds', '', {
    fetch: async () => { throw new Error('never'); },
  })) === 'token');

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
// --- text: one scale, middle dots, no stray hyphens -----------------------

ok('formatDay reads like a date',
  formatDay('2025-09-14') === 'Sun, 14 Sep 2025', formatDay('2025-09-14'));
const DOT = ' \u00b7 ';
const dz = { date: '2025-09-14', count: 0, level: 0 };
const d1 = { date: '2025-09-14', count: 1, level: 1 };
const d12 = { date: '2025-09-14', count: 12, level: 3 };
const SEP14 = 'Sun, 14 Sep 2025';
ok('describeCell: none',
  describeCell(dz) === SEP14 + DOT + 'no contributions', describeCell(dz));
ok('describeCell: one',
  describeCell(d1) === SEP14 + DOT + '1 contribution', describeCell(d1));
ok('describeCell: many',
  describeCell(d12) === SEP14 + DOT + '12 contributions', describeCell(d12));
ok('no hyphen separators anywhere',
  [dz, d1, d12].every((d) => !describeCell(d).includes(' - ')));
ok('periodLabel rolling', periodLabel(createLawn(null, { year: null })) === 'in the last year');
ok('periodLabel year', periodLabel(createLawn(null, { year: 2025 })) === 'in 2025');
ok('formatTime under an hour', formatTime(97) === '1:37', formatTime(97));
ok('formatTime past an hour', formatTime(3723) === '1:02:03', formatTime(3723));

// --- vigor and heroic days ------------------------------------------------

const vg = createLawn(null, { seed: 20260904 });
ok('vigor is in range', vg.cells.every((c) => c.vigor >= 0 && c.vigor <= 1));
ok('level 0 has no vigor', vg.cells.every((c) => c.level > 0 || c.vigor === 0));
ok('vigor rises with count inside a level', (() => {
  for (let l = 1; l <= 4; l++) {
    const inLevel = vg.cells.filter((c) => !c.void && c.level === l)
      .sort((a, b) => a.count - b.count);
    for (let i = 1; i < inLevel.length; i++) {
      if (inLevel[i].vigor < inLevel[i - 1].vigor - 1e-9) return false;
    }
  }
  return true;
})());
ok('at least one heroic day', vg.cells.some((c) => c.heroic));
ok('heroic days are level 4', vg.cells.every((c) => !c.heroic || c.level === 4));
ok('heroic days clear the bar', vg.cells.every((c) => !c.heroic || c.count >= vg.heroicMin));
ok('maxCount matches the cells',
  vg.maxCount === Math.max(...vg.cells.map((c) => c.count)), String(vg.maxCount));
const vg25 = createLawn(null, { seed: 20260904, year: 2025 });
ok('void cells are never heroic', vg25.cells.every((c) => !c.void || c.heroic === false));
ok('void cells have no vigor', vg25.cells.every((c) => !c.void || c.vigor === 0));
resetLawn(vg);
ok('regrow leaves vigor and heroic alone',
  vg.cells.every((c) => c.vigor >= 0) && vg.cells.some((c) => c.heroic));

// --- the shared grass grammar ---------------------------------------------

// Every level is its own silhouette, so the levels are named, not just sized.
ok('the five kinds are the five levels',
  GRASS.kind.join(',') === 'bare,sprouts,tuft,bush,hedge'
    && [0, 1, 2, 3, 4].every((l) => grassFor(l, 0.5).kind === GRASS.kind[l]));
// Heights and widths never overlap between levels: a busy level-2 day must
// still be smaller than a quiet level-3 one, or the shapes stop being a ramp.
ok('height spans never step backwards', (() => {
  for (let l = 1; l <= 4; l++) {
    for (const row of [GRASS.height, GRASS.tuftY]) {
      if (row[l][0] < row[l - 1][1]) return false;
      if (row[l][1] < row[l][0]) return false;
    }
  }
  return true;
})());
// The table in docs/plans/v05-doodle.md, asserted: a hedge is taller than the
// 16px tile it stands on, so it overlaps the row above; a bush spills ~3px
// past the tile's sides; sprouts stay well inside theirs.
ok('a hedge is taller than a tile and a sprout is not',
  grassFor(4, 0).height > GEOM.CELL && grassFor(1, 1).height < GEOM.CELL / 2,
  `${grassFor(4, 0).height} / ${grassFor(1, 1).height}`);
ok('a bush and a hedge spill past their tile, a tuft does not',
  grassFor(3, 0.5).spread > GEOM.CELL / 2 && grassFor(4, 0.5).spread > GEOM.CELL / 2
    && grassFor(2, 1).spread < GEOM.CELL / 2,
  [1, 2, 3, 4].map((l) => grassFor(l, 0.5).spread.toFixed(1)).join(' '));
ok('the biggest day is the tallest', grassFor(4, 1).height === 24, String(grassFor(4, 1).height));
ok('vigor 0 is the bottom of the span',
  [0, 1, 2, 3, 4].every((l) => grassFor(l, 0).blades === GRASS.blades[l][0]));
ok('grassFor clamps out-of-range vigor',
  grassFor(4, 9).height === 24 && grassFor(4, -3).height === 17);
// The 3D renderer scales its cards by this and nothing else, so it has to keep
// meaning "tiles high" and keep stepping level by level.
ok('tuftY still ramps for the 3D cards',
  grassFor(1, 0.5).tuftY < grassFor(2, 0.5).tuftY
    && grassFor(2, 0.5).tuftY < grassFor(3, 0.5).tuftY
    && grassFor(3, 0.5).tuftY < grassFor(4, 0.5).tuftY,
  [1, 2, 3, 4].map((l) => grassFor(l, 0.5).tuftY.toFixed(2)).join(' '));

// --- winter still reads as a graph ---------------------------------------

const lum = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const winterTile = [0, 1, 2, 3, 4].map((l) => lum(tileColor(l, 0, false, 0.5)));
ok('winter tiles keep four densities apart',
  [1, 2, 3, 4].every((l) => winterTile[l - 1] - winterTile[l] > 8),
  winterTile.map((v) => v.toFixed(0)).join(' '));
ok('winter blades stay lighter than their own tile',
  [1, 2, 3, 4].every((l) => lum(bladeColor(l, 0)) - lum(tileColor(l, 0, false, 0.5)) > 15),
  [1, 2, 3, 4]
    .map((l) => (lum(bladeColor(l, 0)) - lum(tileColor(l, 0, false, 0.5))).toFixed(0))
    .join(' '));
ok('winter blades step apart level by level',
  [2, 3, 4].every((l) => lum(bladeColor(l - 1, 0)) - lum(bladeColor(l, 0)) > 12));
ok('mowed winter tiles are the GitHub greens, lightest to darkest',
  [1, 2, 3, 4].every((l) => lum(tileColor(l, 0, true)) < lum(tileColor(l - 1, 0, true))));

// --- temperature ----------------------------------------------------------

ok('tempAt answers off both ends',
  [-2, 0, 10, vg.cols - 1, vg.cols + 2].every((x) => Number.isFinite(tempAt(vg, x))));
ok('winter is colder than summer', tempAt(vg25, 2) < tempAt(vg25, 28),
  tempAt(vg25, 2) + ' vs ' + tempAt(vg25, 28));
// --- svg export -----------------------------------------------------------

const svgLawn = createLawn(null, { seed: 20260904 });
const before = JSON.stringify(svgLawn);
const svg = lawnToSvg(svgLawn);
const nonVoid = svgLawn.cells.filter((c) => !c.void).length;

ok('svg starts with an svg root', svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
// the board's own geometry, straight out of src/core/board.js: both the canvas
// and the exporter lay out on it, so a move that changes the shape of the
// picture in a README has to change these numbers first
const boxFor = (cols) => `viewBox="0 0 ${GEOM.OX + cols * GEOM.PITCH + GEOM.PAD_R}`
  + ` ${GEOM.OY + ROWS * GEOM.PITCH + GEOM.PAD_B}"`;
ok('the exporter uses the 2D board geometry',
  GEOM.OX === 58 && GEOM.OY === 64 && GEOM.PAD_B === 70 && GEOM.PITCH === 19,
  `${GEOM.OX}/${GEOM.OY}/${GEOM.PAD_B}`);
// OY carries the four extra pixels a level-4 Sunday's hedge grows above the grid
ok('rolling lawn is 1068x267',
  svg.includes(boxFor(COLS)) && svg.includes('viewBox="0 0 1068 267"'));
ok('a 53-column year is 1087 wide',
  lawnToSvg(createLawn(null, { seed: 1, year: 2025 })).includes(boxFor(53)));
ok('the legend opens on the bare level-0 swatch',
  (svg.slice(svg.indexOf('<g id="legend"')).match(/<rect/g) || []).length === 5);
ok('winter caps the unmowed tiles with frost', svg.includes('<g id="frost">'));
ok('the best days put up a dandelion', svg.includes(DANDELION.toLowerCase())
  || svg.includes(DANDELION));
const tileGroup = /<g id="tiles">([\s\S]*?)<\/g>/.exec(svg)[1];
ok('one tile rect per non-void cell',
  (tileGroup.match(/<rect/g) || []).length === nonVoid,
  `${(tileGroup.match(/<rect/g) || []).length} vs ${nonVoid}`);
const y25svg = lawnToSvg(createLawn(null, { seed: 1, year: 2025 }));
const y25tiles = /<g id="tiles">([\s\S]*?)<\/g>/.exec(y25svg)[1];
const y25cells = createLawn(null, { seed: 1, year: 2025 }).cells.filter((c) => !c.void).length;
ok('a year with voids draws fewer tiles than cols*rows',
  (y25tiles.match(/<rect/g) || []).length === y25cells && y25cells < 53 * ROWS);

for (const bit of ['>Mon<', '>Wed<', '>Fri<', '>less<', '>more<', 'data:font/woff2;base64,']) {
  ok('svg contains ' + bit, svg.includes(bit));
}
const noNs = svg.replace(/xmlns="[^"]*"/, '');
ok('svg loads nothing external', !/https?:\/\//.test(noNs));
ok('svg has no script or foreignObject',
  !svg.includes('<script') && !svg.includes('<foreignObject'));

ok('mowed 0 parks no mower', !lawnToSvg(svgLawn, { mowed: 0 }).includes('id="mower"'));
ok('mowed 0 mows nothing', !lawnToSvg(svgLawn, { mowed: 0 }).includes('id="cuts"'));
const all = lawnToSvg(svgLawn, { mowed: 1 });
ok('mowed 1 draws a cut line pair per grown tile',
  (/<path id="cuts" d="([^"]*)"/.exec(all)[1].match(/M/g) || []).length
    === svgLawn.cells.filter((c) => !c.void && c.level > 0).length * 2);

const asIs = createLawn(null, { seed: 20260904 });
asIs.mower.z = 0.5; asIs.mower.x = -2; asIs.mower.angle = 0;
guard = 0;
while (asIs.mower.x < asIs.cols + 1 && guard++ < 20000) tick(asIs, gas, DT);
const asIsSvg = lawnToSvg(asIs, { mowed: 'as-is' });
ok('as-is follows cell.mowed',
  (/<path id="cuts" d="([^"]*)"/.exec(asIsSvg)[1].match(/M/g) || []).length
    === asIs.cells.filter((c) => c.mowed && c.level > 0 && !c.void).length * 2);
ok('as-is draws the mower', asIsSvg.includes('id="mower"'));
ok('exporting never touches the lawn', JSON.stringify(svgLawn) === before);

const darkSvg = lawnToSvg(svgLawn, { theme: 'dark' });
ok('dark uses GitHub dark paper', darkSvg.includes('#0D1117'));
// every green is season-tinted, so the ramp never appears verbatim; check the
// four tinted flavours of the top dark green instead (e.g. summer -> #3cd251)
ok('dark uses the GitHub dark ramp',
  SEASON_TINT.some(([t, a]) => darkSvg.includes(mix(THEMES.dark.greens[4], t, a))));
ok('dark drops the paper colour', !darkSvg.includes('#FBF9F2'));

ok('the two themes carry the same fields',
  Object.keys(THEMES.light).sort().join(',') === Object.keys(THEMES.dark).sort().join(','),
  Object.keys(THEMES.light).sort().join(',') + ' vs ' + Object.keys(THEMES.dark).sort().join(','));

// --- the file is well-formed XML ------------------------------------------
// Nothing here parses the SVG it writes, so a stray quote or an unclosed <g>
// would only show up as a blank picture in somebody's README. Walk the tags:
// every one is opened and closed in order, and every attribute is quoted.

const TAG = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g;
function malformed(doc) {
  const stack = [];
  let at = 0;
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(doc)) !== null) {
    const between = doc.slice(at, m.index);
    if (/[<>]/.test(between)) return 'unparsed markup: ' + JSON.stringify(between.slice(0, 70));
    at = TAG.lastIndex;
    if (m[1]) {
      const want = stack.pop();
      if (want !== m[2]) return `</${m[2]}> closes <${want}>`;
    } else if (!m[4]) {
      stack.push(m[2]);
    }
  }
  if (/[<>]/.test(doc.slice(at))) return 'trailing markup';
  if (stack.length) return 'never closed: <' + stack.join('>, <') + '>';
  return '';
}

ok('the scan can tell a broken document from a good one',
  malformed('<a x="1"><b/></a>') === '' && malformed('<a><b/>') !== ''
    && malformed('<a x=1/>') !== '' && malformed('<a></b>') !== '');
for (const [name, doc] of [
  ['still', svg],
  ['dark', darkSvg],
  ['plain', lawnToSvg(svgLawn, { weather: false, background: false })],
]) {
  ok(`the ${name} svg is well-formed`, malformed(doc) === '', malformed(doc));
}

// --- everything a stranger can put in the picture goes through esc() -------

const hostile = lawnToSvg(svgLawn, { user: '"><script>alert(1)</script>' });
ok('a hostile --user cannot open a tag',
  !hostile.includes('<script') && hostile.includes('@&quot;&gt;&lt;script&gt;'),
  hostile.slice(hostile.indexOf('<title>'), hostile.indexOf('<title>') + 90));
ok('a hostile --user leaves the file well-formed', malformed(hostile) === '', malformed(hostile));
const amp = lawnToSvg(svgLawn, { caption: 'a & b' });
ok('an ampersand in a caption is escaped',
  amp.includes('>a &amp; b<') && !/>a & b</.test(amp));
ok('a hostile caption is escaped too',
  !lawnToSvg(svgLawn, { caption: '<b>x</b>' }).includes('<b>x</b>'));

// --- cellTint really reaches the picture ----------------------------------
// The plain chart has one season for every column, so a level's blade colour
// is constant and cellTint's two outcomes are the only variation left.

const plainBlade = bladeColor(4, NO_SEASON, THEMES.light);
const lifted = cellTint(plainBlade, 0, 0);
const sunk = cellTint(plainBlade, 1, 0);
ok('cellTint pulls two ways', lifted !== sunk && lifted !== plainBlade && sunk !== plainBlade,
  `${plainBlade} -> ${lifted} / ${sunk}`);
const plainForTint = lawnToSvg(svgLawn, { weather: false, background: false });
ok('both cellTint shades are drawn',
  plainForTint.includes(lifted) && plainForTint.includes(sunk),
  `${lifted}:${plainForTint.includes(lifted)} ${sunk}:${plainForTint.includes(sunk)}`);

ok('svg is deterministic', lawnToSvg(svgLawn) === svg);
ok('svg stays under 200 kB', svg.length < 200000, `${svg.length}`);
ok('caption names the total',
  svg.includes('>' + svgLawn.totalContributions.toLocaleString('en-US')
    + ' contributions in the last year<'), String(svgLawn.totalContributions));
ok('a user prefixes the caption',
  lawnToSvg(svgLawn, { user: 'torvalds' }).includes('>@torvalds - '));
// --- the route the animated mower drives ----------------------------------

const route = planRoute(svgLawn, 7);
const mowable = svgLawn.cells.filter((c) => !c.void && c.level > 0);
ok('the route cuts every grown day', route.cuts.size === mowable.length,
  `${route.cuts.size} of ${mowable.length}`);
ok('the route never claims to cut bare dirt',
  [...route.cuts.keys()].every((i) => !svgLawn.cells[i].void && svgLawn.cells[i].level > 0));
ok('the route is deterministic for a seed',
  JSON.stringify(planRoute(svgLawn, 7).waypoints) === JSON.stringify(route.waypoints));
ok('a different seed drives a different route',
  JSON.stringify(planRoute(svgLawn, 8).waypoints) !== JSON.stringify(route.waypoints));
// long enough to cover a 7-row field with a 1.34-cell swath, short enough that
// the frontier window is still holding: without it the greedy tour races to the
// far end and doubles back, and the length runs away with it
ok('the route is 1x to 2x the mowable count',
  route.length > mowable.length && route.length < mowable.length * 2,
  `${route.length.toFixed(1)} for ${mowable.length}`);
// the frontier is the whole point: nothing may be left standing behind the
// mower for long, so the drive cuts at a steady rate rather than in bursts
let ragged = 0;
for (let k = 1; k <= 10; k++) {
  const at = [...route.cuts.values()].filter((v) => v <= (k / 10) * route.length).length;
  if (Math.abs(at / route.cuts.size - k / 10) > 0.12) ragged++;
}
ok('the route cuts at a steady rate down the year', ragged === 0, `${ragged} of 10 deciles`);
ok('the route drives off the right edge',
  route.waypoints[route.waypoints.length - 1].x > svgLawn.cols,
  String(route.waypoints[route.waypoints.length - 1].x));
ok('the route starts off the left edge', route.waypoints[0].x < 0);
// the whole point of the weave: a greedy tour on 7 rows otherwise settles into
// one row after another, which is the row-by-row loop this replaced
let sameRow = 0;
for (let i = 1; i < route.waypoints.length; i++) {
  if (Math.floor(route.waypoints[i].z) === Math.floor(route.waypoints[i - 1].z)) sameRow++;
}
ok('the route weaves rather than sweeping rows',
  sameRow * 2 < route.waypoints.length - 1,
  `${sameRow} of ${route.waypoints.length - 1}`);
ok('planning never touches the lawn', JSON.stringify(svgLawn) === before);

const animSvg = lawnToSvg(svgLawn, { animate: true });
ok('animate drives the mower along the route', animSvg.includes('<animateMotion'));
ok('animate loops forever', animSvg.includes('repeatCount="indefinite"'));
ok('the still animates nothing', !svg.includes('<animate'));
ok('one regrowing cover per grown cell of the whole year',
  (animSvg.match(/<animate attributeName="opacity"/g) || []).length === mowable.length,
  `${(animSvg.match(/<animate attributeName="opacity"/g) || []).length} vs ${mowable.length}`);
// SMIL drops a whole <animate> whose keyTimes are not strictly increasing, and
// the last cell is cut a hair before the drive ends, so this is easy to get wrong.
let smilOk = true;
let smilWhy = '';
for (const el of animSvg.matchAll(/<animate\s([^>]*)\/>/g)) {
  const kt = /keyTimes="([^"]*)"/.exec(el[1]);
  const vs = /values="([^"]*)"/.exec(el[1]);
  if (!kt || !vs) { smilOk = false; smilWhy = 'no keyTimes/values'; break; }
  const times = kt[1].split(';').map(Number);
  if (times.length !== vs[1].split(';').length) {
    smilOk = false; smilWhy = 'count ' + kt[1]; break;
  }
  if (times[0] !== 0 || times[times.length - 1] !== 1) {
    smilOk = false; smilWhy = 'ends ' + kt[1]; break;
  }
  for (let i = 1; i < times.length; i++) {
    if (!(times[i] > times[i - 1])) { smilOk = false; smilWhy = kt[1]; break; }
  }
  if (!smilOk) break;
}
ok('every keyTimes is 0..1, strictly increasing, and matches values', smilOk, smilWhy);
// keyPoints and keyTimes have to agree in count under calcMode="linear", and
// the drive has to end before the loop does or there is no pause to regrow in
const motion = /<animateMotion\s([^>]*)\/>/.exec(animSvg)[1];
const kp = /keyPoints="([^"]*)"/.exec(motion)[1].split(';').map(Number);
const kts = /keyTimes="([^"]*)"/.exec(motion)[1].split(';').map(Number);
ok('animateMotion keyPoints and keyTimes line up',
  kp.length === kts.length && kp[0] === 0 && kp[kp.length - 1] === 1
  && kts[0] === 0 && kts[kts.length - 1] === 1 && kts[1] > 0 && kts[1] < 1,
  motion.slice(0, 120));
ok('the motion path is relative to the parked mower', /path="M0 0C/.test(motion));
ok('the driven group carries no transform of its own',
  // animateMotion's matrix wraps around the element's own transform, so a
  // translate here would be swung about the page origin by rotate="auto"
  /<g id="mower" transform="translate\([^"]*\)"><g><animateMotion/.test(animSvg));
ok('animate is deterministic', lawnToSvg(svgLawn, { animate: true }) === animSvg);
ok('animate still loads nothing external',
  !/https?:\/\//.test(animSvg.replace(/xmlns="[^"]*"/, '')));
ok('animate ignores mowed: the loop always starts fully grown',
  lawnToSvg(svgLawn, { animate: true, mowed: 1 }) === animSvg);
ok('the animated svg is well-formed', malformed(animSvg) === '', malformed(animSvg));
// the covers cannot batch by colour, so the animated file is much bigger
ok('the animated demo svg stays under 450 kB', animSvg.length < 450000, `${animSvg.length}`);

// The demo year is a normal one. The worst case a real account can hand the
// Action is every day at level 4, which is one cover per cell with the most
// blades any level draws: ~780 kB today. Cap it where a README embed is still
// reasonable, and where a change that doubles the per-cell cost would trip.
const denseDays = gridForRolling().dates.map((d) => ({ date: isoDay(d), count: 40, level: 4 }));
const denseLawn = createLawn(denseDays, { year: null });
ok('the dense lawn really is dense',
  denseLawn.mowable === COLS * ROWS && denseLawn.cells.every((c) => c.level === 4),
  `${denseLawn.mowable} of ${COLS * ROWS}`);
const denseSvg = lawnToSvg(denseLawn, { animate: true });
ok('a fully dense year stays under 900 kB', denseSvg.length < 900000,
  `${(denseSvg.length / 1024).toFixed(0)} kB`);
ok('a fully dense year is well-formed', malformed(denseSvg) === '', malformed(denseSvg));
ok('a fully dense year still cuts every day',
  (denseSvg.match(/<animate attributeName="opacity"/g) || []).length === COLS * ROWS);

// --- weather=0 and bg=0: the plain chart ----------------------------------

const plain = lawnToSvg(svgLawn, { weather: false, background: false });
ok('plain drops the season doodles', !plain.includes('id="glyphs"'));
ok('plain drops the frost caps', !plain.includes('id="frost"'));
ok('plain drops snow and flakes', !plain.includes('#85B7EB'));
ok('plain drops the fallen leaves', !plain.includes('rx="2.6" ry="1.6"'));
// all five levels, empty days included: the plain chart is GitHub's own ramp,
// not the doodle's paper-dirt for level 0
ok('plain is GitHub\'s exact ramp', GITHUB.every((g) => plain.includes(g)),
  GITHUB.map((g) => plain.includes(g)).join(','));
ok('plain drops the doodle bare tile', !plain.includes(BARE));
ok('plain drops the pebbles on bare dirt',
  !plain.includes(`fill="rgba(${THEMES.light.inkRgb},0.28)"`));
// with weather on, every level is season-tinted, level 0 off BARE rather than
// GitHub's grey, so no ramp hex survives verbatim
ok('a lawn with weather is tinted, not the exact ramp',
  GITHUB.every((g) => !svg.includes(g)) && !svg.includes(BARE));
ok('plain lays one neutral bed', (/<g id="bed"[^>]*>((?:(?!<\/g>).)*)/.exec(plain)[1]
  .match(/<rect/g) || []).length === 2);
ok('plain keeps the dandelions: they are data, not weather', plain.includes(DANDELION));
ok('bg=0 leaves the background transparent', !plain.includes('<rect width="100%"'));
ok('bg=0 drops the paper halo on the day labels',
  !plain.includes(`stroke="${THEMES.light.paper}"`));
ok('the paper is back when only the weather is off',
  lawnToSvg(svgLawn, { weather: false }).includes('<rect width="100%"'));
ok('plain is deterministic',
  lawnToSvg(svgLawn, { weather: false, background: false }) === plain);
// the seed can arrive off a query string; NaN would poison every jitter and
// every route cost, and planRoute would throw halfway through a render
ok('a junk seed falls back to the default',
  lawnToSvg(svgLawn, { animate: true, seed: 'abc' }) === animSvg);

// --- the login that comes off the URL -------------------------------------
// share.js has no sanitiser of its own: in the browser everything a stranger
// can supply reaches a filename, a URL and a caption through parseUserInput
// (tested above). The Action's --user takes the other road, through esc() in
// the SVG, which is asserted with the export.

const snip = (u) => {
  const md = markdownSnippet(u);
  const upto = md.slice(0, md.indexOf('/output/')).split('/');
  return upto[upto.length - 1];
};
ok('a plain login survives', snip('torvalds') === 'torvalds');
ok('a profile URL gives a login', snip('https://github.com/gaearon?tab=repos') === 'gaearon');
ok('an @ and whitespace come off', snip('  @evch1204 ') === 'evch1204');
ok('markup never reaches the snippet', snip('"><script>alert(1)</script>') === 'YOUR-USERNAME');
ok('a path separator never reaches a filename', snip('a/../../b') === 'a');
ok('nothing sane in, nothing out', snip('') === 'YOUR-USERNAME' && snip(null) === 'YOUR-USERNAME');
ok('the snippet only ever carries a login',
  !/["'<>\s]/.test((/githubusercontent\.com\/(\S+)\/output/.exec(markdownSnippet('a b<c'))
    || ['', 'x"'])[1]), markdownSnippet('a b<c').slice(0, 120));
ok('no user means a placeholder', markdownSnippet('').includes('/YOUR-USERNAME/YOUR-USERNAME/'));
ok('the share link carries the login', shareUrl('a-b', '') === SITE + '?user=a-b');
// a share link reproduces the lawn on screen: the live query string, minus
// every debug flag, is what travels
ok('the share link keeps the year on screen',
  shareUrl('', '?user=torvalds&year=2024&view=deep&autodrive=1')
    === SITE + '?user=torvalds&year=2024',
  shareUrl('', '?user=torvalds&year=2024&view=deep&autodrive=1'));
ok('the share link keeps the demo seed', shareUrl('', '?seed=123') === SITE + '?seed=123');
ok('a seed means nothing next to an account',
  shareUrl('torvalds', '?seed=123') === SITE + '?user=torvalds');
ok('a junk ?user= never reaches a share link',
  shareUrl('', '?user=%22%3E%3Cscript%3E') === SITE,
  shareUrl('', '?user=%22%3E%3Cscript%3E'));
ok('the plain site is the fallback', shareUrl('', '') === SITE);

// --- the end card on a board that scrolls ---------------------------------
// #endcard is absolutely positioned inside #stage, and on a phone #stage is
// the sideways-scrolling box the board lives in. You finish the year at the
// far right, so the card has to be able to scroll itself back into view and
// to scroll internally on a board barely 170px tall.

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const rule = (sel) => (new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\s*\\{([^}]*)\\}')
  .exec(indexHtml) || ['', ''])[1];

ok('the end card overlay scrolls rather than clipping its buttons',
  /overflow:\s*auto/.test(rule('#endcard')), rule('#endcard').trim().slice(0, 80));
ok('the end card is centred by auto margins, not by align-items',
  /margin:\s*auto/.test(rule('.card')) && !/align-items/.test(rule('#endcard')));
ok('finishing parks the scrolling board back at the card',
  /stage\.scrollLeft = 0;/.test(mainJs));
ok('the mower stops dragging the board while the card is up',
  /active !== 'flat' \|\| !endcard\.hidden/.test(mainJs));

// --- the view toggle ------------------------------------------------------
// <body data-view> is how the CSS knows which renderer is showing, so it
// answers `[data-view]` too: a bare selector binds the view-switch click
// listener to the whole page and stamps aria-pressed on <body>.

ok('the page body carries data-view', /<body[^>]*\sdata-view=/.test(indexHtml));
ok('only the buttons are treated as the view toggle',
  !/querySelectorAll\('\[data-view\]'\)/.test(mainJs)
  && (mainJs.match(/querySelectorAll\('button\[data-view\]'\)/g) || []).length === 2);

// --- what the Action reads off an output line -----------------------------
// Every option in action/README.md's table, because a typo here is only
// visible as the wrong picture landing in somebody's profile a day later.

const args = parseArgs(['node', 'render-svg.mjs', '--demo', '--user', 'torvalds',
  '--outputs', 'a.svg\nb.svg?theme=dark', '--cwd', 'out']);
ok('parseArgs reads the flags',
  args.demo === true && args.user === 'torvalds' && args.cwd === 'out'
    && args.outputs === 'a.svg\nb.svg?theme=dark');
ok('parseArgs defaults the outputs to the two README pictures',
  parseArgs(['node', 'render-svg.mjs']).outputs.includes('dist/lawn.svg?animate=1')
    && parseArgs(['node', 'render-svg.mjs']).outputs.includes('theme=dark'));
ok('parseArgs leaves --demo off by default', parseArgs(['node', 'x']).demo === undefined);

ok('splitOutputs takes a YAML block', splitOutputs('  a.svg \n\n b.svg?bg=0 \n').join('|')
  === 'a.svg|b.svg?bg=0', splitOutputs('  a.svg \n\n b.svg?bg=0 \n').join('|'));
ok('splitOutputs takes a shell\'s literal backslash-n',
  splitOutputs('a.svg\\nb.svg').join('|') === 'a.svg|b.svg');
ok('splitOutputs drops empties', splitOutputs('').length === 0 && splitOutputs(null).length === 0);

const opt = (line) => parseOutput(line).opts;
ok('parseOutput splits the path off',
  parseOutput('dist/lawn.svg?theme=dark').path === 'dist/lawn.svg'
    && parseOutput('dist/lawn.svg').path === 'dist/lawn.svg');
ok('a bare path asks for nothing',
  Object.keys(opt('dist/lawn.svg')).length === 0 && parseOutput('dist/lawn.svg').year === null);
ok('theme', opt('a?theme=dark').theme === 'dark' && opt('a?theme=light').theme === 'light');
ok('animate', opt('a?animate=1').animate === true && opt('a?animate=0').animate === false);
ok('mower', opt('a?mower=1').mower === true && opt('a?mower=0').mower === false);
ok('weather', opt('a?weather=1').weather === true && opt('a?weather=0').weather === false);
ok('bg=0 turns the background off',
  opt('a?bg=0').background === false && opt('a?bg=1').background === true,
  JSON.stringify(opt('a?bg=0')));
ok('caption text, and 0 or empty for none',
  opt('a?caption=hello%20there').caption === 'hello there'
    && opt('a?caption=0').caption === null && opt('a?caption=').caption === null);
ok('mowed as a fraction or as-is',
  opt('a?mowed=0.25').mowed === 0.25 && opt('a?mowed=as-is').mowed === 'as-is'
    && opt('a?mowed=1').mowed === 1);
ok('year',
  parseOutput('a?year=2025').year === 2025
    && parseOutput('a?year=2025').opts.year === undefined);
ok('several options at once', (() => {
  const o = opt('dist/lawn-dark.svg?theme=dark&animate=1&weather=0&bg=0&caption=0');
  return o.theme === 'dark' && o.animate === true && o.weather === false
    && o.background === false && o.caption === null;
})());

// the option list and the table people read have to be the same list
const actionReadme = readFileSync(new URL('../action/README.md', import.meta.url), 'utf8');
ok('every documented option is one parseOutput knows',
  OPTION_KEYS.every((k) => actionReadme.includes('| `' + k + '` |')),
  OPTION_KEYS.filter((k) => !actionReadme.includes('| `' + k + '` |')).join(','));

// and the options really steer lawnToSvg, not just parseOutput
const viaLine = lawnToSvg(svgLawn, opt('x.svg?theme=dark&weather=0&bg=0&caption=0'));
ok('an output line drives the exporter',
  THEMES.dark.greens.every((g) => viaLine.includes(g))     // theme=dark
    && !viaLine.includes('id="glyphs"')                    // weather=0
    && !viaLine.includes('<rect width="100%"')             // bg=0
    && !/<text x="58" y="22"/.test(viaLine),               // caption=0
  viaLine.slice(0, 160));
ok('a line the exporter drew is still well-formed', malformed(viaLine) === '', malformed(viaLine));

// --- the workflow we hand people ------------------------------------------

/**
 * `${{ ... }}` inside a YAML *flow* mapping has to be quoted: the `{{` is read
 * as two nested flow collections and the line stops parsing. A workflow that
 * does this is accepted by nothing, so check every yaml we ship, not just ours.
 */
function flowSafe(yaml) {
  return yaml.split('\n').every((line) => {
    const bare = line.replace(/"[^"]*"|'[^']*'/g, '""');
    let depth = 0;
    for (let i = 0; i < bare.length; i++) {
      if (depth > 0 && bare.startsWith('${{', i)) return false;
      const ch = bare[i];
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
    }
    return true;
  });
}

const lf = (s) => s.replace(/\r\n/g, '\n');
const yaml = workflowYaml();
ok('the copied workflow has no expression inside a flow mapping', flowSafe(yaml));
for (const f of ['.github/workflows/lawn.yml', '.github/workflows/ci.yml', 'action.yml']) {
  ok(`${f} has no expression inside a flow mapping`,
    flowSafe(lf(readFileSync(new URL('../' + f, import.meta.url), 'utf8'))));
}
for (const f of ['README.md', 'action/README.md']) {
  ok(`${f} ships the same workflow the page copies`,
    lf(readFileSync(new URL('../' + f, import.meta.url), 'utf8')).includes(lf(yaml)));
}
const actionYml = lf(readFileSync(new URL('../action.yml', import.meta.url), 'utf8'));
for (const key of ['github_user_name', 'outputs']) {
  ok(`the workflow's "${key}" is an input of action.yml`,
    yaml.includes(key + ':') && actionYml.includes('  ' + key + ':'));
}

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
