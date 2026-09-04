// Pure-node smoke test for the lawn sim. No DOM, no build step.
//   node scripts/smoke.mjs
import {
  createLawn, resetLawn, tick, progress, COLS, ROWS, describeCell, formatTime,
} from '../src/core/lawn.js';

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

const lawn = createLawn(null, 20260904);

ok('grid is 52x7', lawn.cells.length === COLS * ROWS, `got ${lawn.cells.length}`);
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
while (lawn.mower.x < COLS + 1 && guard++ < 20000) tick(lawn, gas, DT);

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
  while (lawn.mower.x < COLS + 1 && guard++ < 20000) tick(lawn, gas, DT);
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

const a = createLawn(null, 4242);
const b = createLawn(null, 4242);
const c = createLawn(null, 99);
ok('same seed, same year', a.totalContributions === b.totalContributions
  && a.cells.every((cell, i) => cell.count === b.cells[i].count));
ok('different seed, different year', a.totalContributions !== c.totalContributions,
  `${a.totalContributions} vs ${c.totalContributions}`);

console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
