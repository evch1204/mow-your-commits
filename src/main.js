import {
  createLawn, resetLawn, placeMower, tick, progress, monthAt, seasonIndexAt,
  describeCell, formatTime, assignLevels, isoDay,
  MONTH_NAMES, SEASON_WORD, ROWS, DEFAULT_SEED,
} from './core/lawn.js';
import { daysForYear, daysForRolling } from './core/contrib.js';
import { initLoader, loadUser, setStatus, restoreStatus } from './loader.js';
import { Renderer2D } from './render2d/index.js';
import { Renderer3D } from './render3d/index.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || DEFAULT_SEED;
const autodrive = params.get('autodrive') === '1';
const finishNow = params.get('finish') === '1';   // debug: jump to the end card
const startCol = params.has('start') ? Number(params.get('start')) : null;
const startYaw = params.has('yaw') ? Number(params.get('yaw')) : 0;
const startDist = params.has('dist') ? Number(params.get('dist')) : 0;
const startCam = params.get('cam') === 'overview' ? 1 : 0;

const TODAY = isoDay(new Date());

// Which years the picker offers. Without an account it is the last six; with
// one it is exactly the years that profile's year picker shows.
function demoYears() {
  const y0 = new Date().getFullYear();
  const list = [null];
  for (let y = y0; y > y0 - 6; y--) list.push(y);
  return list;
}

let source = null;              // null = the demo lawn, else a loaded account
let years = demoYears();
let loadedOnce = 0;

const askedYear = params.has('year') ? Number(params.get('year')) : null;
let year = years.includes(askedYear) ? askedYear : null;

/** The rolling window. Prefer the API's own y=last (GitHub's own quartiles). */
function rollingDays() {
  if (source.last) return daysForRolling(source.last);
  const win = daysForRolling(source.days).map((d) => ({ ...d }));
  assignLevels(win);            // y=last was unavailable; re-level the window
  return win;
}

/** null year = rolling last 52 weeks, otherwise one calendar year. */
function lawnFor(y) {
  if (!source) return createLawn(null, { seed, year: y });
  return y === null
    ? createLawn(rollingDays(), { year: null })
    : createLawn(daysForYear(source.days, y, TODAY), { year: y });
}

let lawn = lawnFor(year);

const flat = new Renderer2D(document.getElementById('flat'), lawn);
const deep = new Renderer3D(document.getElementById('deep'), lawn);
const renderers = { flat, deep };
let active = 'flat';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const tagEl = $('tag');
const endcard = $('endcard');
const camBtn = $('cam');
const yearsEl = $('years');

const input = { up: false, down: false, left: false, right: false };
const keymap = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};

const nf = new Intl.NumberFormat('en-US');
let tagUntil = 0;
let endShown = false;
let auto = 0;

// --- input ---------------------------------------------------------------

stage.addEventListener('keydown', (e) => {
  const k = keymap[e.key];
  if (k) { input[k] = true; e.preventDefault(); return; }
  if (e.key === 'c' || e.key === 'C') { setCamera(deep.toggleCamera()); e.preventDefault(); }
  if (e.key === 'r' || e.key === 'R') { regrow(); e.preventDefault(); }
});
stage.addEventListener('keyup', (e) => { const k = keymap[e.key]; if (k) input[k] = false; });
stage.addEventListener('pointerdown', () => stage.focus());
window.addEventListener('blur', () => { for (const k in input) input[k] = false; });

for (const b of document.querySelectorAll('#pad button')) {
  const key = b.dataset.key;
  const on = (v) => (e) => {
    e.preventDefault();
    e.stopPropagation();          // never reaches the 3D orbit handler
    input[key] = v;
    if (v) b.dataset.on = '1'; else delete b.dataset.on;
    if (v && b.setPointerCapture && e.pointerId !== undefined) b.setPointerCapture(e.pointerId);
  };
  b.addEventListener('pointerdown', on(true));
  b.addEventListener('pointerup', on(false));
  b.addEventListener('pointercancel', on(false));
  b.addEventListener('pointerleave', on(false));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}

// --- views ---------------------------------------------------------------

for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}
camBtn.addEventListener('click', () => setCamera(deep.toggleCamera()));
$('regrow').addEventListener('click', regrow);
$('regrow2').addEventListener('click', regrow);
$('brag').addEventListener('click', copyBrag);

function setView(name) {
  active = name;
  document.body.dataset.view = name;
  for (const b of document.querySelectorAll('[data-view]')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === name));
  }
  camBtn.hidden = name !== 'deep';
  if (name === 'deep') deep.resize();
}

function setCamera(mode) {
  camBtn.setAttribute('aria-pressed', String(!!mode));
  camBtn.textContent = mode ? 'chase cam' : 'overview';
}

// --- year picker ---------------------------------------------------------

function labelFor(y) { return y === null ? 'last year' : String(y); }

function buildYears() {
  yearsEl.textContent = '';
  for (const y of years) {
    const b = document.createElement('button');
    b.textContent = labelFor(y);
    b.setAttribute('aria-pressed', String(y === year));
    // a year the account has, but with nothing in it: dimmed, still pickable
    if (source && y !== null && source.totals[y] === 0) b.dataset.empty = '1';
    b.addEventListener('click', () => pickYear(y));
    yearsEl.appendChild(b);
  }
}

function markYears() {
  const kids = yearsEl.children;
  for (let i = 0; i < kids.length; i++) {
    kids[i].setAttribute('aria-pressed', String(years[i] === year));
  }
}

/** Put a freshly built lawn on screen, in both renderers. */
function swapLawn(next, { first = false } = {}) {
  lawn = next;
  flat.setLawn(lawn);
  deep.setLawn(lawn);
  endcard.hidden = true;
  tagEl.hidden = true;
  endShown = false;
  tagUntil = 0;
  auto = 0;
  markYears();
  refreshTotals();
  if (startCol !== null && !Number.isNaN(startCol)) placeMower(lawn, startCol);
  // the debug flags ran against the demo lawn; run them again on the real one
  if (first) {
    if (finishNow) prewarmFinish();
    else if (autodrive) prewarm(3);
  }
}

/** A real account can have years with nothing in them. Say so, or stop saying so. */
function announceYear() {
  if (!source) return;
  // An account with no years at all (never contributed, or all private) has
  // nothing else to offer, so keep its own line instead of sending the visitor
  // to a picker that holds one entry.
  if (lawn.mowable > 0 || years.length <= 1) { restoreStatus(); return; }
  const when = year === null ? 'the last year' : String(year);
  setStatus('ok', 'nothing grew in ' + when + ' - pick another year');
}

/** Keep ?year= pointing at the year actually on screen, wherever it changed. */
function setYearParam() {
  const url = new URL(location.href);
  if (year === null) url.searchParams.delete('year');
  else url.searchParams.set('year', String(year));
  history.replaceState(null, '', url);
}

function pickYear(y) {
  if (y === year) return;
  year = y;
  swapLawn(lawnFor(y));
  setYearParam();
  announceYear();
  stage.focus();
}

function refreshTotals() {
  $('total').textContent = nf.format(lawn.totalContributions);
  $('ctotal').textContent = nf.format(lawn.totalContributions);
  $('span').textContent = year === null ? 'in the last year' : 'in ' + year;
}

// --- actions -------------------------------------------------------------

function regrow() {
  resetLawn(lawn);
  flat.reset();
  deep.reset();
  endcard.hidden = true;
  tagEl.hidden = true;
  endShown = false;
  tagUntil = 0;
  auto = 0;
  stage.focus();
}

function copyBrag() {
  const when = year === null ? 'this year' : String(year);
  const whose = source
    ? (/s$/i.test(source.login) ? source.login + "'" : source.login + "'s")
    : 'my';
  const text = `I mowed ${whose} GitHub lawn: ${nf.format(lawn.totalContributions)} contributions`
    + ` from ${when} in ${formatTime(lawn.time)} - mow-your-commits`;
  const btn = $('brag');
  const done = () => { btn.textContent = 'copied!'; setTimeout(() => { btn.textContent = 'copy brag'; }, 1600); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => window.prompt('copy this', text));
  } else {
    window.prompt('copy this', text);
  }
}

// --- HUD -----------------------------------------------------------------

buildYears();
refreshTotals();
setView(params.get('view') === 'deep' ? 'deep' : 'flat');
deep.setCamera(startCam ? 'overview' : 'chase');
setCamera(startCam);
if (startYaw) deep.setOrbit(startYaw);
if (startDist) deep.setDistance(startDist);
if (startCol !== null && !Number.isNaN(startCol)) placeMower(lawn, startCol);

function updateHud(dt) {
  $('pct').textContent = Math.round(progress(lawn) * 100) + '%';
  $('month').textContent = MONTH_NAMES[monthAt(lawn, lawn.mower.x)];
  $('weather').textContent = SEASON_WORD[seasonIndexAt(lawn, lawn.mower.x)];
  $('cmowed').textContent = nf.format(lawn.mowedContributions);
  $('timer').textContent = formatTime(lawn.time);

  if (tagUntil > 0) {
    tagUntil -= dt;
    if (tagUntil <= 0) tagEl.hidden = true;
  }

  // an account can have a year with nothing in it: that is not a win
  if (lawn.finished && lawn.mowable > 0 && !endShown) {
    endShown = true;
    $('endline').textContent = `${nf.format(lawn.totalContributions)} contributions`
      + ` - ${lawn.cols} weeks - ${formatTime(lawn.time)}`;
    endcard.hidden = false;
    confetti();
  }
}

/** A short burst of clippings when the lawn is done. */
function confetti() {
  const cells = lawn.cells;
  for (let k = 0; k < 26; k++) {
    const i = Math.floor(Math.random() * cells.length);
    if (cells[i].void) continue;
    flat.onMowed([i], true);
    if (k % 3 === 0) deep.onMowed([i], true);
  }
}

window.addEventListener('resize', () => deep.resize());

/** On narrow screens the flat lawn scrolls sideways; keep the mower in frame. */
function followMower() {
  if (active !== 'flat') return;
  const over = stage.scrollWidth - stage.clientWidth;
  if (over <= 0) return;
  const want = (lawn.mower.x / lawn.cols) * stage.scrollWidth - stage.clientWidth / 2;
  stage.scrollLeft = Math.max(0, Math.min(over, want));
}

// --- loop ----------------------------------------------------------------

function showMowed(indices) {
  flat.onMowed(indices);
  deep.onMowed(indices);
  const text = describeCell(lawn.cells[lawn.lastMowed]);
  if (text) {
    tagEl.textContent = text;
    tagEl.hidden = false;
    tagUntil = 2.5;
  }
}

/**
 * ?autodrive=1 : hold the gas for the first 3 seconds. Headless Chrome barely
 * runs requestAnimationFrame under --virtual-time-budget, so those 3 seconds
 * are stepped synchronously before the first paint; the screenshot then shows
 * mowed tiles, clippings, the +N popup and the last-mowed tag.
 */
function prewarm(seconds) {
  const DT = 1 / 60;
  const steps = Math.round(seconds / DT);
  let recent = [];
  for (let i = 0; i < steps; i++) {
    auto += DT;
    input.up = true;
    const mowed = tick(lawn, input, DT);
    if (mowed.length) {
      if (i > steps - 20) recent = recent.concat(mowed);
      else recent.length = 0;
    }
  }
  deep.applyLawn();
  if (recent.length) showMowed(recent);
}

/** Debug: sweep every row before the first paint so the end card is on screen. */
function prewarmFinish() {
  const DT = 1 / 60;
  for (let row = 0; row < ROWS; row++) {
    lawn.mower.z = row + 0.5;
    lawn.mower.x = -2;
    lawn.mower.angle = 0;
    lawn.mower.vel = 0;
    let guard = 0;
    while (lawn.mower.x < lawn.cols + 1 && guard++ < 20000) tick(lawn, { up: true }, DT);
  }
  deep.applyLawn();
}

if (finishNow) prewarmFinish();
else if (autodrive) prewarm(3);

// --- real data ------------------------------------------------------------
// The demo lawn above is already built and drawn, so the stage is never blank
// while a fetch is in flight; a loaded account swaps it out in place.

initLoader({
  onData(data) {
    source = data;
    years = [null, ...data.years].slice(0, 21);   // GitHub started in 2008
    // ?year= is the page's opening request, not a standing order: honour it for
    // the first account, then leave whatever the visitor picked alone.
    const first = !loadedOnce++;
    if (first && years.includes(askedYear)) year = askedYear;
    else if (!years.includes(year)) year = null;
    buildYears();
    swapLawn(lawnFor(year), { first });
    setYearParam();
    announceYear();
  },
  onDemo() {
    source = null;
    years = demoYears();
    if (!years.includes(year)) year = null;
    buildYears();
    swapLawn(lawnFor(year));
    setYearParam();
  },
});

if (params.get('user')) loadUser(params.get('user'), { fromUrl: true });

let last = performance.now();
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;

  if (autodrive && !lawn.finished) {
    // keep sweeping so the demo never parks in an empty corner
    auto += dt;
    input.up = true;
    input.right = auto > 3 && (auto % 3.4) < 0.62;
  }

  const mowed = tick(lawn, input, dt);
  if (mowed.length) showMowed(mowed);
  renderers[active].draw(ts);
  updateHud(dt);
  followMower();
}

requestAnimationFrame(frame);
