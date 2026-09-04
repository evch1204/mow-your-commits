// Lawn model. Pure data + simulation, no rendering.
// Coordinates are in "cell units": x in [0, COLS], z in [0, ROWS].
// Cell (col, row) has its center at (col + 0.5, row + 0.5).

export const COLS = 52;
export const ROWS = 7;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// 0 winter, 1 spring, 2 summer, 3 autumn (northern hemisphere)
export const SEASON_OF_MONTH = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0];

export const SEASONS = [
  { name: 'winter', ground: '#E9EEEA', grass: '#A9C4B8', sky: '#EEF2F5' },
  { name: 'spring', ground: '#DDEBC8', grass: '#97C459', sky: '#EAF3FB' },
  { name: 'summer', ground: '#CFE3B0', grass: '#639922', sky: '#F7F1D8' },
  { name: 'autumn', ground: '#EBE3B8', grass: '#A0A33A', sky: '#F8EEDD' },
];

const MAX_SPEED = 0.2;     // cells per frame at 60fps
const MIN_SPEED = -0.12;
const ACCEL = 0.013;
const REVERSE = 0.008;
const DRAG = 0.92;
const TURN = 0.05;
const MOW_RADIUS = 0.67;   // distance from blade center that counts
const BLADE_OFFSET = 0.55; // blade sits this far ahead of mower center

/**
 * Build a lawn from a contribution list.
 * @param {Array<{date: string, level: number, count?: number}>} data
 *   One entry per day, oldest first, 364 or 371 entries. `level` is 0-4 like GitHub.
 *   Pass null to generate fake data.
 */
export function createLawn(data) {
  const days = data || generateFakeData();
  const cells = [];
  const monthOfCol = [];
  const monthStarts = []; // [{col, month}] where a new month begins

  let mowable = 0;
  let lastMonth = -1;

  for (let col = 0; col < COLS; col++) {
    const first = days[col * ROWS];
    const d = first ? new Date(first.date + 'T00:00:00') : new Date();
    const month = d.getMonth();
    monthOfCol.push(month);
    if (month !== lastMonth) {
      monthStarts.push({ col, month });
      lastMonth = month;
    }
    for (let row = 0; row < ROWS; row++) {
      const day = days[col * ROWS + row];
      const level = day ? Math.max(0, Math.min(4, day.level)) : 0;
      cells.push({
        col, row, level,
        date: day ? day.date : null,
        count: day ? day.count || 0 : 0,
        mowed: level === 0,
        mowT: 0,           // 0..1 mowing animation progress
        rot: hash(col * 31 + row * 7) * 3,
      });
      if (level > 0) mowable++;
    }
  }

  return {
    cells,
    mowable,
    mowed: 0,
    monthOfCol,
    monthStarts,
    mower: { x: -1.6, z: ROWS / 2, angle: 0, vel: 0, acc: 0 },
    totalContributions: days.reduce((s, d) => s + (d.count || 0), 0),
  };
}

export function resetLawn(lawn) {
  lawn.mowed = 0;
  for (const c of lawn.cells) {
    c.mowed = c.level === 0;
    c.mowT = 0;
  }
  lawn.mower.x = -1.6;
  lawn.mower.z = ROWS / 2;
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

  let turn = 0;
  if (input.left) turn = -1;
  if (input.right) turn = 1;
  m.angle += turn * TURN * Math.min(1, Math.abs(m.vel) * 8 + 0.3) * k;

  m.x += Math.cos(m.angle) * m.vel * k;
  m.z += Math.sin(m.angle) * m.vel * k;
  m.x = Math.max(-2, Math.min(COLS + 2, m.x));
  m.z = Math.max(-1.2, Math.min(ROWS + 1.2, m.z));

  const bx = m.x + Math.cos(m.angle) * BLADE_OFFSET;
  const bz = m.z + Math.sin(m.angle) * BLADE_OFFSET;
  const r2 = MOW_RADIUS * MOW_RADIUS;
  const newlyMowed = [];

  for (let i = 0; i < lawn.cells.length; i++) {
    const c = lawn.cells[i];
    if (c.mowed) {
      if (c.mowT < 1) c.mowT = Math.min(1, c.mowT + 0.2 * k);
      continue;
    }
    const dx = c.col + 0.5 - bx;
    const dz = c.row + 0.5 - bz;
    if (dx * dx + dz * dz < r2) {
      c.mowed = true;
      lawn.mowed++;
      newlyMowed.push(i);
    }
  }
  return newlyMowed;
}

export function progress(lawn) {
  return lawn.mowable ? lawn.mowed / lawn.mowable : 0;
}

export function monthAt(lawn, x) {
  const col = Math.max(0, Math.min(COLS - 1, Math.floor(x)));
  return lawn.monthOfCol[col];
}

export function seasonAt(lawn, x) {
  return SEASONS[SEASON_OF_MONTH[monthAt(lawn, x)]];
}

export function seasonOfCol(lawn, col) {
  return SEASONS[SEASON_OF_MONTH[lawn.monthOfCol[col]]];
}

/** Deterministic fake year, so the demo looks the same every load. */
export function generateFakeData() {
  const days = [];
  const start = new Date();
  start.setDate(start.getDate() - COLS * ROWS + 1);
  let s = 11;
  for (let i = 0; i < COLS * ROWS; i++) {
    const col = Math.floor(i / ROWS);
    const row = i % ROWS;
    const season = 0.45 + 0.55 * Math.sin((col / COLS) * Math.PI * 2 + 4);
    s = (s * 16807) % 2147483647;
    const r = (s / 2147483647) * season;
    let level = r < 0.12 ? 0 : r < 0.4 ? 1 : r < 0.62 ? 2 : r < 0.85 ? 3 : 4;
    if ((row === 0 || row === 6) && s % 3 === 0) level = Math.max(0, level - 1);
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({ date: d.toISOString().slice(0, 10), level, count: level * 3 });
  }
  return days;
}

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
