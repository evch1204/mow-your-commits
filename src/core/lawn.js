// Lawn model. Pure data + simulation, no rendering, no DOM.
// Coordinates are in "cell units": x in [0, lawn.cols], z in [0, lawn.rows].
// Cell (col, row) has its center at (col + 0.5, row + 0.5).

export const ROWS = 7;

/** Columns in the rolling "last year" view. */
export const COLS = 52;

/** A calendar year needs 53, sometimes 54, columns. Size GPU buffers for this. */
export const MAX_COLS = 54;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// 0 winter, 1 spring, 2 summer, 3 autumn (northern hemisphere)
export const SEASON_OF_MONTH = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0];

export const SEASONS = [
  { name: 'winter', ground: '#E9EEEA', grass: '#A9C4B8', sky: '#E4EDF3' },
  { name: 'spring', ground: '#DDEBC8', grass: '#97C459', sky: '#EAF3FB' },
  { name: 'summer', ground: '#CFE3B0', grass: '#639922', sky: '#DDEFFB' },
  { name: 'autumn', ground: '#EBE3B8', grass: '#A0A33A', sky: '#F5E7D2' },
];

/** What the HUD says is happening, one word per season. */
export const SEASON_WORD = ['snowing', 'fresh', 'sunny', 'leaves falling'];

const MAX_SPEED = 0.24;    // cells per frame at 60fps
const MIN_SPEED = -0.13;
const ACCEL = 0.015;
const REVERSE = 0.009;
const DRAG = 0.92;
const TURN = 0.052;
const MOW_RADIUS = 0.67;   // distance from blade center that counts
const BLADE_OFFSET = 0.55; // blade sits this far ahead of mower center
const MOW_ANIM = 0.25;     // seconds for one cell's mow animation

export const DEFAULT_SEED = 20260904;

// --- grids ---------------------------------------------------------------

export function isoDay(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
}

/**
 * GitHub's calendar-year layout: from the Sunday of the week containing 1 Jan
 * to the Saturday of the week containing 31 Dec. 53 columns, sometimes 54.
 * Days outside the year are "void" and come back as null.
 * @returns {{cols: number, dates: Array<Date|null>}}
 */
export function gridForYear(year) {
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const start = addDays(jan1, -jan1.getDay());
  const end = addDays(dec31, 6 - dec31.getDay());
  const n = Math.round((end - start) / 86400000) + 1;
  const dates = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(start, i);
    dates.push(d < jan1 || d > dec31 ? null : d);
  }
  return { cols: n / ROWS, dates };
}

/** The rolling last 52 weeks, ending today, starting on a Sunday. */
export function gridForRolling() {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  let start = addDays(end, -(COLS * ROWS - 1));
  start = addDays(start, -start.getDay());
  const dates = [];
  for (let i = 0; i < COLS * ROWS; i++) dates.push(addDays(start, i));
  return { cols: COLS, dates };
}

const VOID_DAY = { date: null, level: 0, count: 0, void: true };

/** Pad a Jan 1 .. Dec 31 list into the 53/54-column grid, adding void cells. */
export function layoutYear(days, year) {
  const byDate = new Map();
  for (const d of days) if (d && d.date) byDate.set(d.date, d);
  return gridForYear(year).dates.map((d) => {
    if (!d) return { ...VOID_DAY };
    const iso = isoDay(d);
    return byDate.get(iso) || { date: iso, level: 0, count: 0 };
  });
}

// --- the lawn -------------------------------------------------------------

/**
 * Build a lawn from a contribution list.
 * @param {Array<{date: string|null, level: number, count?: number, void?: boolean}>} data
 *   One entry per grid cell, oldest first, column-major (7 per week).
 *   Pass null to generate fake data.
 * @param {{seed?: number, year?: number|null}} opts
 */
export function createLawn(data, opts = {}) {
  const seed = opts.seed == null ? DEFAULT_SEED : opts.seed;
  const year = opts.year == null ? null : opts.year;
  const days = data || generateFakeData(seed, year);
  const rows = ROWS;
  const cols = Math.max(1, Math.round(days.length / rows));

  const cells = [];
  const monthOfCol = [];
  const monthStarts = []; // [{col, month, span}] where a new month begins

  let mowable = 0;
  let lastMonth = -1;

  for (let col = 0; col < cols; col++) {
    // A column can start with void cells, so look for the first real day.
    let month = lastMonth < 0 ? 0 : lastMonth;
    for (let row = 0; row < rows; row++) {
      const day = days[col * rows + row];
      if (day && day.date && !day.void) {
        month = new Date(day.date + 'T00:00:00').getMonth();
        break;
      }
    }
    monthOfCol.push(month);
    if (month !== lastMonth) {
      monthStarts.push({ col, month, span: 0 });
      lastMonth = month;
    }

    for (let row = 0; row < rows; row++) {
      const day = days[col * rows + row];
      const isVoid = !day || day.void || !day.date;
      const level = isVoid ? 0 : Math.max(0, Math.min(4, day.level));
      cells.push({
        col, row, level,
        void: isVoid,
        date: isVoid ? null : day.date,
        count: isVoid ? 0 : day.count || 0,
        // void cells and empty days are "already mowed" so tick skips them
        mowed: true,
        mowT: 1,
        rot: hash(col * 31 + row * 7) * 3,
      });
      if (!isVoid && level > 0) {
        cells[cells.length - 1].mowed = false;
        cells[cells.length - 1].mowT = 0;
        mowable++;
      }
    }
  }
  for (let i = 0; i < monthStarts.length; i++) {
    monthStarts[i].span = (i + 1 < monthStarts.length ? monthStarts[i + 1].col : cols) - monthStarts[i].col;
  }

  return {
    seed,
    year,
    cols,
    rows,
    days,
    cells,
    mowable,
    mowed: 0,
    mowedContributions: 0,
    lastMowed: -1,
    time: 0,
    started: false,
    finished: mowable === 0,
    monthOfCol,
    monthStarts,
    mower: { x: -1.6, z: rows / 2, angle: 0, vel: 0, acc: 0, turn: 0 },
    totalContributions: days.reduce((s, d) => s + ((d && !d.void && d.count) || 0), 0),
  };
}

export function resetLawn(lawn) {
  lawn.mowed = 0;
  lawn.mowedContributions = 0;
  lawn.lastMowed = -1;
  lawn.time = 0;
  lawn.started = false;
  lawn.finished = lawn.mowable === 0;
  for (const c of lawn.cells) {
    const grows = !c.void && c.level > 0;
    c.mowed = !grows;
    c.mowT = grows ? 0 : 1;
  }
  lawn.mower.x = -1.6;
  lawn.mower.z = lawn.rows / 2;
  lawn.mower.angle = 0;
  lawn.mower.vel = 0;
  lawn.mower.acc = 0;
  lawn.mower.turn = 0;
}

/** Park the mower at the middle of a column. Used by the ?start= debug flag. */
export function placeMower(lawn, col) {
  lawn.mower.x = Math.max(0, Math.min(lawn.cols - 1, col)) + 0.5;
  lawn.mower.z = lawn.rows / 2;
  lawn.mower.angle = 0;
  lawn.mower.vel = 0;
}

/**
 * Advance the simulation by one frame.
 * @param input {up, down, left, right} booleans
 * @param dt seconds since last frame (physics is tuned for 1/60)
 * @returns array of cell indices mowed this frame
 */
export function tick(lawn, input, dt = 1 / 60) {
  const m = lawn.mower;
  const k = dt * 60;

  let acc = 0;
  if (input.up) acc = ACCEL;
  if (input.down) acc = -REVERSE;
  m.acc = acc;
  m.vel += acc * k;
  m.vel *= Math.pow(DRAG, k);
  m.vel = Math.max(MIN_SPEED, Math.min(MAX_SPEED, m.vel));
  if (!acc && Math.abs(m.vel) < 0.0008) m.vel = 0;

  if (!lawn.started && (acc !== 0 || m.vel !== 0)) lawn.started = true;
  if (lawn.started && !lawn.finished) lawn.time += dt;

  let turn = 0;
  if (input.left) turn = -1;
  if (input.right) turn = 1;
  m.turn = turn;
  // Tighter at low speed so you can line up a pass on a 7-row field.
  const grip = 1.25 - Math.min(0.75, Math.abs(m.vel) * 3.2);
  m.angle += turn * TURN * grip * Math.min(1, Math.abs(m.vel) * 9 + 0.34) * k;

  m.x += Math.cos(m.angle) * m.vel * k;
  m.z += Math.sin(m.angle) * m.vel * k;
  m.x = Math.max(-2, Math.min(lawn.cols + 2, m.x));
  m.z = Math.max(-1.2, Math.min(lawn.rows + 1.2, m.z));

  const bx = m.x + Math.cos(m.angle) * BLADE_OFFSET;
  const bz = m.z + Math.sin(m.angle) * BLADE_OFFSET;
  const r2 = MOW_RADIUS * MOW_RADIUS;
  const newlyMowed = [];

  for (let i = 0; i < lawn.cells.length; i++) {
    const c = lawn.cells[i];
    if (c.mowed) {
      if (c.mowT < 1) c.mowT = Math.min(1, c.mowT + dt / MOW_ANIM);
      continue;
    }
    const dx = c.col + 0.5 - bx;
    const dz = c.row + 0.5 - bz;
    if (dx * dx + dz * dz < r2) {
      c.mowed = true;
      c.mowT = 0;
      lawn.mowed++;
      lawn.mowedContributions += c.count;
      lawn.lastMowed = i;
      newlyMowed.push(i);
    }
  }
  if (!lawn.finished && lawn.mowed >= lawn.mowable) lawn.finished = true;
  return newlyMowed;
}

export function progress(lawn) {
  return lawn.mowable ? lawn.mowed / lawn.mowable : 1;
}

export function monthAt(lawn, x) {
  const col = Math.max(0, Math.min(lawn.cols - 1, Math.floor(x)));
  return lawn.monthOfCol[col];
}

export function seasonAt(lawn, x) {
  return SEASONS[SEASON_OF_MONTH[monthAt(lawn, x)]];
}

export function seasonIndexAt(lawn, x) {
  return SEASON_OF_MONTH[monthAt(lawn, x)];
}

export function seasonIndexOfCol(lawn, col) {
  return SEASON_OF_MONTH[lawn.monthOfCol[Math.max(0, Math.min(lawn.cols - 1, col))]];
}

export function seasonOfCol(lawn, col) {
  return SEASONS[seasonIndexOfCol(lawn, col)];
}

/** "Tue 14 Mar 2026 - 12 contributions" */
export function describeCell(cell) {
  if (!cell || cell.void || !cell.date) return '';
  const when = formatDate(cell.date);
  if (!cell.count) return when + ' - nothing that day';
  return when + ' - ' + cell.count + ' contribution' + (cell.count === 1 ? '' : 's');
}

export function formatDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' '
    + MONTH_NAMES[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear();
}

/** mm:ss */
export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// --- fake data ----------------------------------------------------------

function lcg(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return function () {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * A deterministic year that looks like a real developer's graph:
 * weekday-heavy, a sparse January, a few multi-week streaks,
 * one vacation gap, and one heroic shipping week.
 * @param year null for the rolling last 52 weeks, or a calendar year.
 */
export function generateFakeData(seed = DEFAULT_SEED, year = null) {
  const grid = year == null ? gridForRolling() : gridForYear(year);
  const cols = grid.cols;
  const rnd = lcg(year == null ? seed : ((seed ^ (year * 2654435761)) >>> 0));

  // Per-week activity level.
  const week = new Array(cols);
  for (let c = 0; c < cols; c++) week[c] = 0.58 + rnd() * 0.45;

  // Three multi-week streaks of heavy work.
  for (let s = 0; s < 3; s++) {
    const at = Math.floor(rnd() * Math.max(1, cols - 8));
    const len = 3 + Math.floor(rnd() * 4);
    for (let c = at; c < at + len && c < cols; c++) week[c] = Math.min(1.5, week[c] + 0.6);
  }
  // One 1-2 week holiday, away from the start.
  const vac = 8 + Math.floor(rnd() * Math.max(1, cols - 18));
  const vacLen = 1 + Math.floor(rnd() * 2);
  for (let c = vac; c < vac + vacLen && c < cols; c++) week[c] = 0.03;
  // One shipping week.
  week[6 + Math.floor(rnd() * Math.max(1, cols - 12))] = 2.4;

  const days = grid.dates.map((d, i) => {
    if (!d) return { ...VOID_DAY };
    const col = Math.floor(i / ROWS);
    const row = i % ROWS;

    let p = week[col];
    if (row === 0 || row === 6) p *= 0.35;                   // weekends
    if (d.getMonth() === 0) p *= 0.5;                        // sparse January
    if (d.getMonth() === 11 && d.getDate() > 22) p *= 0.25;  // holidays

    let count = 0;
    if (rnd() < Math.min(0.96, p * 0.95)) {
      const r = rnd();
      count = Math.max(1, Math.round(p * (1 + r * r * 22)));
    }
    return { date: isoDay(d), level: 0, count };
  });

  assignLevels(days);
  return days;
}

/** GitHub-ish quartiles, so `count` and `level` always agree. Voids stay at 0. */
export function assignLevels(days) {
  const nz = days.map((d) => d.count || 0).filter((c) => c > 0).sort((a, b) => a - b);
  if (!nz.length) {
    for (const d of days) d.level = 0;
    return days;
  }
  const q = (f) => nz[Math.min(nz.length - 1, Math.floor(nz.length * f))];
  const q1 = q(0.28), q2 = q(0.56), q3 = q(0.82);
  for (const d of days) {
    const c = d.void ? 0 : d.count || 0;
    d.level = c === 0 ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4;
  }
  return days;
}

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
