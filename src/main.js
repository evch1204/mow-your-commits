import {
  createLawn, resetLawn, placeMower, tick, progress, monthAt, seasonIndexAt,
  describeCell, formatTime, tempAt, periodLabel, assignLevels, isoDay,
  MONTH_NAMES, SEASON_WORD, ROWS, DEFAULT_SEED,
} from './core/lawn.js';
import { daysForYear, daysForRolling } from './core/contrib.js';
import { initLoader, loadUser, setStatus, restoreStatus } from './loader.js';
import { Renderer2D } from './render2d/index.js';
import { Renderer3D } from './render3d/index.js';
import { lawnToSvg } from './export/svg.js';
import { svgToPngBlob, download, downloadSvg } from './export/png.js';
import {
  currentUser, markdownSnippet, workflowYaml, copy, bragText, xUrl,
} from './share.js';

const params = new URLSearchParams(location.search);
// ?seed=0 is a seed like any other, so ask whether it is there rather than
// whether it is truthy; junk (?seed=abc) still falls back.
const askedSeed = params.has('seed') ? Number(params.get('seed')) : NaN;
const seed = Number.isFinite(askedSeed) ? askedSeed : DEFAULT_SEED;
const autodrive = params.get('autodrive') === '1';
const finishNow = params.get('finish') === '1';   // debug: jump to the end card
const startCol = params.has('start') ? Number(params.get('start')) : null;
const startYaw = params.has('yaw') ? Number(params.get('yaw')) : 0;
const startDist = params.has('dist') ? Number(params.get('dist')) : 0;
const startCam = params.get('cam') === 'overview' ? 1 : 0;
const ogShot = params.get('og') === '1';    // debug: strip the page down to the board

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
// the HUD is rewritten every frame, so its seven fields are looked up once
const hud = {
  pct: $('pct'), bar: $('barfill'), month: $('month'), weather: $('weather'),
  temp: $('temp'), mowed: $('cmowed'), timer: $('timer'),
};

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

// `button[...]`, not a bare `[data-view]`: <body data-view> carries the same
// attribute, so the loose selector also bound this listener to the whole page.
for (const b of document.querySelectorAll('button[data-view]')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}
camBtn.addEventListener('click', () => setCamera(deep.toggleCamera()));
$('regrow').addEventListener('click', regrow);
$('regrow2').addEventListener('click', regrow);
$('brag').addEventListener('click', copyBrag);

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
  yearsEl.style.maxHeight = '';
  if (stacked || active !== 'flat' || !room) return;
  if (yearsEl.scrollHeight > room + OVERHANG) yearsEl.style.maxHeight = room + 'px';
}

function setCamera(mode) {
  camBtn.setAttribute('aria-pressed', String(!!mode));
  camBtn.textContent = mode ? 'chase cam' : 'overview';
  // the overview letterboxes the stage (see index.html); the renderer notices
  // the new canvas size on its next frame
  document.body.dataset.cam = mode ? 'overview' : 'chase';
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

/** Take down the end card and the last-mowed tag: this run is over. */
function clearRunState() {
  endcard.hidden = true;
  tagEl.hidden = true;
  endShown = false;
  tagUntil = 0;
}

/** Put a freshly built lawn on screen, in both renderers. */
function swapLawn(next, { first = false } = {}) {
  lawn = next;
  flat.setLawn(lawn);
  deep.setLawn(lawn);
  clearRunState();
  markYears();
  refreshTotals();
  refreshPreview();     // the README picture is of the lawn on screen
  fitYears();           // a wider year brings a taller board
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
  $('span').textContent = periodLabel(lawn);
}

/** "-2 °C" with a real minus sign, so the HUD lines up. */
function degrees(t) {
  return (t < 0 ? '−' : '') + Math.abs(t) + ' °C';
}

// --- actions -------------------------------------------------------------

function regrow() {
  resetLawn(lawn);
  flat.reset();
  deep.reset();
  clearRunState();
  stage.focus();
}

/** "my" for the demo, "torvalds'" for a loaded account. */
function whoseLawn() {
  if (!source) return 'my';
  return /s$/i.test(source.login) ? source.login + "'" : source.login + "'s";
}

function copyBrag() {
  copy(bragText(lawn, currentUser(), periodLabel(lawn), whoseLawn()), $('brag'));
}

// --- share / export ------------------------------------------------------
// index.html is this file's contract: every id it wires up below is assumed to
// be there, the same way #regrow and #total are. The three exceptions are the
// README preview <img>, the workflow listing and the "mow your own" strip,
// which a cut-down page (the og shot, an embed) can be built without; each is
// guarded where it is used, and nowhere else.

let previewUrl = '';

/** The exported picture: this lawn, as a standalone SVG. */
function exportSvg(mowed, opts) {
  return lawnToSvg(lawn, { mowed, user: currentUser(), ...opts });
}

/** Download what you mowed; before you start, the half-mowed still. */
function exportState() { return lawn.mowed > 0 ? 'as-is' : 0.5; }

function exportName() {
  return 'lawn-' + (currentUser() || 'demo') + '-' + (year === null ? 'last' : year);
}

/**
 * The README section's <img>. One object URL at a time, never per frame.
 * This runs at boot, before the render loop starts, so a throw here would take
 * the whole page down with it (no loop, no controls). Hence the try: the
 * picture is worth less than the lawn.
 *
 * Animated, because the workflow the button next to it copies carries
 * `animate=1`: the preview has to be the picture that actually lands in a
 * README. It costs a few hundred kB, but this runs once per lawn, not per
 * frame. The download buttons stay still pictures of the board as you mowed it.
 */
function refreshPreview() {
  const img = $('preview');
  if (!img) return;
  let svg;
  try {
    svg = exportSvg(0.5, { animate: true });
  } catch (err) {
    console.error('could not draw the readme preview', err);
    img.removeAttribute('src');
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.src = previewUrl;
}

/**
 * Rasterising takes a moment, so the button says so while it happens. It is
 * disabled meanwhile: a second click would read "rendering..." as the label to
 * put back and the button would keep saying that forever.
 */
async function renderPng(btn, mowed) {
  if (btn.disabled) return;
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'rendering...';
  try {
    download(await svgToPngBlob(exportSvg(mowed), 2), exportName() + '.png');
  } catch (err) {
    console.error(err);
    window.alert('could not make a png here. the svg download works everywhere.');
  }
  btn.textContent = was;
  btn.disabled = false;
}

$('dlsvg').addEventListener('click', () => {
  downloadSvg(exportSvg(exportState()), exportName() + '.svg');
});
$('dlpng').addEventListener('click', (e) => renderPng(e.currentTarget, exportState()));
$('cpmd').addEventListener('click', (e) => copy(markdownSnippet(currentUser()), e.currentTarget));
$('dlcard').addEventListener('click', (e) => renderPng(e.currentTarget, 'as-is'));

const shareBtn = $('sharex');
shareBtn.addEventListener('click', () => {
  const text = bragText(lawn, currentUser(), periodLabel(lawn), whoseLawn());
  if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
  window.open(xUrl(text), '_blank', 'noopener');
});
if (navigator.share) shareBtn.textContent = 'share';

// optional: the workflow listing and the button that copies it
if ($('yaml')) {
  $('yaml').textContent = workflowYaml();
  $('cpyml').addEventListener('click', (e) => copy(workflowYaml(), e.currentTarget));
}

// optional: the try strip, which is for the demo lawn. Whether an account is on
// screen is body[data-source], which the loader keeps honest: ?user= that failed
// to load still leaves the demo up, and "back to the demo" brings the strip back.
if ($('try')) {
  $('try').hidden = false;
  $('tryme').addEventListener('click', () => {
    // the loader owns the username box; on a page built without it, ask for a
    // name and reload on ?user=
    const box = $('user');
    if (box) {
      box.focus();
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const name = window.prompt('github username');
    if (name && name.trim()) location.search = '?user=' + encodeURIComponent(name.trim());
  });
}

if (ogShot) document.body.dataset.og = '1';


// --- HUD -----------------------------------------------------------------

buildYears();
refreshTotals();
refreshPreview();
setView(params.get('view') === 'deep' ? 'deep' : 'flat');
deep.setCamera(startCam ? 'overview' : 'chase');
setCamera(startCam);
if (startYaw) deep.setOrbit(startYaw);
if (startDist) deep.setDistance(startDist);
if (startCol !== null && !Number.isNaN(startCol)) placeMower(lawn, startCol);

function updateHud(dt) {
  const pct = Math.round(progress(lawn) * 100);
  hud.pct.textContent = pct + '%';
  hud.bar.style.width = pct + '%';
  hud.month.textContent = MONTH_NAMES[monthAt(lawn, lawn.mower.x)];
  hud.weather.textContent = SEASON_WORD[seasonIndexAt(lawn, lawn.mower.x)];
  hud.temp.textContent = degrees(tempAt(lawn, lawn.mower.x));
  hud.mowed.textContent = nf.format(lawn.mowedContributions);
  hud.timer.textContent = formatTime(lawn.time);

  if (tagUntil > 0) {
    tagUntil -= dt;
    if (tagUntil <= 0) tagEl.hidden = true;
  }

  // an account can have a year with nothing in it: that is not a win
  if (lawn.finished && lawn.mowable > 0 && !endShown) {
    endShown = true;
    $('endline').textContent = `${nf.format(lawn.totalContributions)} contributions `
      + `${periodLabel(lawn)} · mowed in ${formatTime(lawn.time)}`;
    $('endnote').textContent = `${lawn.cols} weeks · ${lawn.rows} rows · 1 riding mower`;
    // The card is absolutely positioned inside #stage, which on a phone is the
    // sideways-scrolling box the board lives in: it is pinned to the board's
    // left edge and scrolls away with it. You finish the year at the far right,
    // so without this the whole payoff lands ~300px off screen.
    stage.scrollLeft = 0;
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

window.addEventListener('resize', () => { deep.resize(); fitYears(); });

/**
 * On narrow screens the flat lawn scrolls sideways; keep the mower in frame.
 * While the end card is up the board stays parked at the left, or the card
 * (which scrolls with the board) would be dragged straight back off screen.
 */
function followMower() {
  if (active !== 'flat' || !endcard.hidden) return;
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
 * ?autodrive=1 : hold the gas for the first couple of seconds. Headless Chrome barely
 * runs requestAnimationFrame under --virtual-time-budget, so those 3 seconds
 * are stepped synchronously before the first paint, and stop short of the far
 * end of the year so the chase camera still has lawn in front of it; the shot
 * mowed tiles, clippings, the +N popup and the last-mowed tag.
 */
function prewarm(seconds) {
  const DT = 1 / 60;
  const steps = Math.round(seconds / DT);
  let recent = [];
  for (let i = 0; i < steps; i++) {
    autoDrive();
    const mowed = tick(lawn, input, DT);
    flat.sampleTrack();     // no frames run in here, so lay the tyre trail by hand
    if (mowed.length) {
      if (i > steps - 20) recent = recent.concat(mowed);
      else recent.length = 0;
    }
  }
  deep.applyLawn();
  if (recent.length) showMowed(recent);
}

/**
 * ?autodrive=1 steering: a demo lap that stays on the lawn. Hold a heading
 * (down the year, then a U-turn and back up it) and lean into it to keep the
 * middle rows, so a headless screenshot never catches the mower parked out in
 * the meadow with nothing to mow.
 */
let autoDir = 1;
function autoDrive() {
  const m = lawn.mower;
  if (autoDir > 0 && m.x > lawn.cols - 5) autoDir = -1;
  else if (autoDir < 0 && m.x < 5) autoDir = 1;
  const lean = Math.max(-0.9, Math.min(0.9, (ROWS / 2 - m.z) * 0.4));
  const want = autoDir > 0 ? lean : Math.PI - lean;
  let d = want - m.angle;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  // A U-turn at full throttle has a nine-cell radius, which is wider than the
  // lawn is deep, so the demo used to swing out into the meadow and a headless
  // screenshot could catch it there. Feather the gas and it pivots on the lawn.
  input.up = Math.abs(d) < 0.8;
  input.right = d > 0.03;
  input.left = d < -0.03;
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
let fitted = false;
function frame(ts) {
  requestAnimationFrame(frame);
  // the canvas gets its height from an aspect-ratio, so the first honest
  // measurement is only available after the first layout
  if (!fitted) { fitted = true; fitYears(); }
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;

  if (autodrive && !lawn.finished) autoDrive();

  const mowed = tick(lawn, input, dt);
  if (mowed.length) showMowed(mowed);
  renderers[active].draw(ts);
  updateHud(dt);
  followMower();
}

requestAnimationFrame(frame);
