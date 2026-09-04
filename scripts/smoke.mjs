// Pure-node smoke test for the lawn sim. No DOM, no build step.
//   node scripts/smoke.mjs
import {
  createLawn, resetLawn, tick, progress, COLS, ROWS, MAX_COLS,
  describeCell, formatTime, gridForYear, layoutYear, placeMower,
} from '../src/core/lawn.js';
import { daysForYear, yearsIn } from '../src/core/contrib.js';

let failures = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (extra ? '  ' + extra : ''));
  }
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

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
