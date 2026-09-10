// The URL flags and the two prewarms behind them. Everything in here exists so
// that a headless browser (or a curious visitor) can put the lawn into a known
// state before the first paint. Nothing else in the app reads `location`.

import { tick, ROWS, DEFAULT_SEED } from '../core/lawn.js';

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

/** A finite `?name=` number, or `fallback` for a missing or junk one. */
function num(name, fallback) {
  if (!params.has(name)) return fallback;
  const n = Number(params.get(name));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Every flag the page understands, read once. `seed`, `view`, `user` and
 * `year` are for anybody; the rest are debug handles, listed in docs/DEV.md.
 * `?seed=0` is a seed like any other, hence `num` rather than a truthiness
 * test, and `?year=` is only a request - main.js checks it against the years
 * the account actually has.
 */
export const flags = {
  seed: num('seed', DEFAULT_SEED),
  view: params.get('view') === 'deep' ? 'deep' : 'flat',
  user: params.get('user') || '',
  year: params.has('year') ? num('year', null) : null,
  autodrive: params.get('autodrive') === '1',
  finish: params.get('finish') === '1',   // jump straight to the end card
  start: num('start', null),              // park the mower in a column
  yaw: num('yaw', 0),
  dist: num('dist', 0),
  cam: params.get('cam') === 'overview' ? 'overview' : 'chase',
  og: params.get('og') === '1',           // strip the page down to the board
  sound: params.get('sound') !== '0',     // ?sound=0 keeps a screenshot silent
};

/**
 * ?autodrive=1 steering: a demo lap that stays on the lawn. Hold a heading
 * (down the year, then a U-turn and back up it) and lean into it to keep the
 * middle rows, so a headless screenshot never catches the mower parked out in
 * the meadow with nothing to mow.
 */
let autoDir = 1;
export function autoDrive(lawn, input) {
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

/**
 * ?autodrive=1 : hold the gas for the first couple of seconds. Headless Chrome
 * barely runs requestAnimationFrame under --virtual-time-budget, so those
 * seconds are stepped synchronously before the first paint, and stop short of
 * the far end of the year so the chase camera still has lawn in front of it;
 * the shot gets mowed tiles, clippings, the +N popup and the last-mowed tag.
 */
export function prewarm({ lawn, input, flat, deep, seconds, onMowed }) {
  const DT = 1 / 60;
  const steps = Math.round(seconds / DT);
  let recent = [];
  for (let i = 0; i < steps; i++) {
    autoDrive(lawn, input);
    const mowed = tick(lawn, input, DT);
    flat.sampleTrack();     // no frames run in here, so lay the tyre trail by hand
    if (mowed.length) {
      if (i > steps - 20) recent = recent.concat(mowed);
      else recent.length = 0;
    }
  }
  deep.applyLawn();
  if (recent.length) onMowed(recent);
}

/** ?finish=1 : sweep every row before the first paint, so the end card is up. */
export function prewarmFinish(lawn, deep) {
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
