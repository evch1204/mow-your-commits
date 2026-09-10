// The wiring. Everything with a job of its own lives next door: the four
// booleans the mower steers by in app/input.js, the strip over the board and
// the end card in app/hud.js, the README strips in app/readme.js, and the URL
// flags with their prewarms in app/debug.js. What is left here is the page's
// own state - which lawn, which year, which renderer - and the frame loop.

import './style.css';
import {
  createLawn, resetLawn, placeMower, tick, describeCell, assignLevels, isoDay,
} from './core/lawn.js';
import { daysForYear, daysForRolling } from './core/contrib.js';
import { initLoader, loadUser, setStatus, restoreStatus } from './loader.js';
import { Renderer2D } from './render2d/index.js';
import { Renderer3D } from './render3d/index.js';
import { input, initInput } from './app/input.js';
import {
  initHud, setTotals, updateHud, showTag, clearRunState, endCardUp,
} from './app/hud.js';
import { initReadme, refreshPreview, updateInstall } from './app/readme.js';
import { flags, autoDrive, prewarm, prewarmFinish } from './app/debug.js';
import { initSound, drive, cut, fanfare } from './sound.js';

const TODAY = isoDay(new Date());
const seed = flags.seed;

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

const askedYear = flags.year;
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
const camBtn = $('cam');
const yearsEl = $('years');

// --- views ---------------------------------------------------------------

function setView(name) {
  active = name;
  document.body.dataset.view = name;
  for (const b of document.querySelectorAll('button[data-view]')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === name));
  }
  camBtn.hidden = name !== 'deep';
  if (name === 'deep') deep.resize();
  fitYears();
}

function setCamera(mode) {
  camBtn.setAttribute('aria-pressed', String(!!mode));
  camBtn.textContent = mode ? 'chase cam' : 'overview';
  // the overview letterboxes the stage (see style.css); the renderer notices
  // the new canvas size on its next frame
  document.body.dataset.cam = mode ? 'overview' : 'chase';
}

function toggleCamera() { setCamera(deep.toggleCamera()); }

/**
 * The flat board is a 4:1 strip about 230px tall, but a real account brings
 * sixteen years: left alone the list towers beside the lawn and leaves a hole
 * where the page should end, so cap it at the height of the board. The demo's
 * six years overhang by a row and that reads as deliberate, so leave a little
 * slack rather than making the short list scroll for nothing.
 * On a phone the years are a scrolling row instead, so leave that alone.
 */
const OVERHANG = 60;
function fitYears() {
  const stacked = typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 820px)').matches;
  const room = stage.clientHeight;
  // Measure through the cap rather than dropping it first: clearing max-height
  // let the list tower for a frame, which reflowed the page and flashed the
  // document's vertical scrollbar on every year click. scrollHeight already
  // reports the full content height under an overflow clip, and the style is
  // only touched when the answer actually changes.
  const want = stacked || active !== 'flat' || !room
    || yearsEl.scrollHeight <= room + OVERHANG ? '' : room + 'px';
  if (yearsEl.style.maxHeight !== want) yearsEl.style.maxHeight = want;
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
  clearRunState();
  markYears();
  setTotals(lawn);
  refreshPreview();     // the README picture is of the lawn on screen
  updateInstall();      // and its buttons point at whoever is loaded
  fitYears();           // a wider year brings a taller board
  if (flags.start !== null) placeMower(lawn, flags.start);
  // the debug flags ran against the demo lawn; run them again on the real one
  if (first) {
    if (flags.finish) prewarmFinish(lawn, deep);
    else if (flags.autodrive) prewarm(prewarmArgs(3));
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
  stage.focus({ preventScroll: true });
}

// --- actions -------------------------------------------------------------

function regrow() {
  resetLawn(lawn);
  flat.reset();
  deep.reset();
  clearRunState();
  stage.focus({ preventScroll: true });
}

/** "my" for the demo, "torvalds'" for a loaded account. */
function whoseLawn() {
  if (!source) return 'my';
  return /s$/i.test(source.login) ? source.login + "'" : source.login + "'s";
}

/** The payoff: a burst of clippings, and the four notes to go with it. */
function confetti() {
  const cells = lawn.cells;
  for (let k = 0; k < 26; k++) {
    const i = Math.floor(Math.random() * cells.length);
    if (cells[i].void) continue;
    flat.onMowed([i], true);
    if (k % 3 === 0) deep.onMowed([i], true);
  }
  fanfare();
}

function showMowed(indices) {
  flat.onMowed(indices);
  deep.onMowed(indices);
  cut(indices.some((i) => lawn.cells[i].heroic));
  showTag(describeCell(lawn.cells[lawn.lastMowed]));
}

function prewarmArgs(seconds) {
  return { lawn, input, flat, deep, seconds, onMowed: showMowed };
}

// --- boot ----------------------------------------------------------------

initInput({ stage, onCamera: toggleCamera, onRegrow: regrow });
initHud({ onFinish: confetti });
initReadme({ lawn: () => lawn, year: () => year, whose: whoseLawn });
initSound($('sound'), { restore: flags.sound });

for (const b of document.querySelectorAll('button[data-view]')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}
camBtn.addEventListener('click', toggleCamera);
$('regrow').addEventListener('click', regrow);
$('regrow2').addEventListener('click', regrow);

if (flags.og) document.body.dataset.og = '1';

buildYears();
setTotals(lawn);
refreshPreview();
setView(flags.view);
deep.setCamera(flags.cam);
setCamera(flags.cam === 'overview' ? 1 : 0);
if (flags.yaw) deep.setOrbit(flags.yaw);
if (flags.dist) deep.setDistance(flags.dist);
if (flags.start !== null) placeMower(lawn, flags.start);

if (flags.finish) prewarmFinish(lawn, deep);
else if (flags.autodrive) prewarm(prewarmArgs(3));

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

if (flags.user) loadUser(flags.user, { fromUrl: true });

// --- loop ----------------------------------------------------------------

window.addEventListener('resize', () => { deep.resize(); fitYears(); });

/**
 * On narrow screens the flat lawn scrolls sideways; keep the mower in frame.
 * While the end card is up the board stays parked at the left, or the card
 * (which scrolls with the board) would be dragged straight back off screen.
 */
function followMower() {
  if (active !== 'flat' || endCardUp()) return;
  const over = stage.scrollWidth - stage.clientWidth;
  if (over <= 0) return;
  const want = (lawn.mower.x / lawn.cols) * stage.scrollWidth - stage.clientWidth / 2;
  stage.scrollLeft = Math.max(0, Math.min(over, want));
}

let last = performance.now();
let fitted = false;
function frame(ts) {
  requestAnimationFrame(frame);
  // the canvas gets its height from an aspect-ratio, so the first honest
  // measurement is only available after the first layout
  if (!fitted) { fitted = true; fitYears(); }
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;

  if (flags.autodrive && !lawn.finished) autoDrive(lawn, input);

  const mowed = tick(lawn, input, dt);
  if (mowed.length) showMowed(mowed);
  drive(lawn.mower.vel);
  renderers[active].draw(ts);
  updateHud(lawn, dt);
  followMower();
}

requestAnimationFrame(frame);
