// Everything the page says about the run in progress: the strip of fields over
// the board, the last-mowed tag inside it, and the end card. Rewritten every
// frame, so the elements are looked up once and the strings are cheap.

import {
  progress, monthAt, seasonIndexAt, tempAt, formatTime, periodLabel,
  MONTH_NAMES, SEASON_WORD,
} from '../core/lawn.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');

/** How big a run has to get before the HUD bothers to mention it. */
const COMBO_FROM = 3;

let els = null;
let onFinish = () => {};
let tagUntil = 0;
let endShown = false;
let shownCombo = 0;

/** "-2 °C" with a real minus sign, so the HUD lines up. */
function degrees(t) {
  return (t < 0 ? '−' : '') + Math.abs(t) + ' °C';
}

export function initHud(hooks = {}) {
  els = {
    stage: $('stage'),
    pct: $('pct'), bar: $('barfill'), month: $('month'), weather: $('weather'),
    temp: $('temp'), mowed: $('cmowed'), timer: $('timer'),
    combo: $('combo'), comboField: $('combofield'),
    tag: $('tag'), endcard: $('endcard'), endline: $('endline'), endnote: $('endnote'),
    total: $('total'), ctotal: $('ctotal'), span: $('span'),
  };
  onFinish = hooks.onFinish || (() => {});
}

/** The lede and the "/ 1,234" half of the contributions field. */
export function setTotals(lawn) {
  els.total.textContent = nf.format(lawn.totalContributions);
  els.ctotal.textContent = nf.format(lawn.totalContributions);
  els.span.textContent = periodLabel(lawn);
}

/** The little card in the corner of the 3D view: the day you just cut. */
export function showTag(text) {
  if (!text) return;
  els.tag.textContent = text;
  els.tag.hidden = false;
  tagUntil = 2.5;
}

/** Take down the end card and the tag: this run is over, or replaced. */
export function clearRunState() {
  els.endcard.hidden = true;
  els.tag.hidden = true;
  els.comboField.hidden = true;
  endShown = false;
  tagUntil = 0;
  shownCombo = 0;
}

/**
 * The combo field only appears once a run is worth chasing, and jumps every
 * time it climbs. Restarting the animation needs the class off, a reflow, and
 * the class back on; without the reflow the browser folds the two changes into
 * one frame and nothing moves.
 */
function paintCombo(lawn) {
  const combo = lawn.combo || 0;
  if (combo < COMBO_FROM) {
    els.comboField.hidden = true;
    shownCombo = 0;
    return;
  }
  els.comboField.hidden = false;
  if (combo === shownCombo) return;
  els.combo.textContent = 'x' + combo;
  if (combo > shownCombo) {
    els.combo.classList.remove('pulse');
    void els.combo.offsetWidth;
    els.combo.classList.add('pulse');
  }
  shownCombo = combo;
}

export function updateHud(lawn, dt) {
  const pct = Math.round(progress(lawn) * 100);
  els.pct.textContent = pct + '%';
  els.bar.style.width = pct + '%';
  els.month.textContent = MONTH_NAMES[monthAt(lawn, lawn.mower.x)];
  els.weather.textContent = SEASON_WORD[seasonIndexAt(lawn, lawn.mower.x)];
  els.temp.textContent = degrees(tempAt(lawn, lawn.mower.x));
  els.mowed.textContent = nf.format(lawn.mowedContributions);
  els.timer.textContent = formatTime(lawn.time);
  paintCombo(lawn);

  if (tagUntil > 0) {
    tagUntil -= dt;
    if (tagUntil <= 0) els.tag.hidden = true;
  }

  // an account can have a year with nothing in it: that is not a win
  if (lawn.finished && lawn.mowable > 0 && !endShown) {
    endShown = true;
    els.comboField.hidden = true;
    els.endline.textContent = `${nf.format(lawn.totalContributions)} contributions `
      + `${periodLabel(lawn)} · mowed in ${formatTime(lawn.time)}`;
    const best = (lawn.bestCombo || 0) >= COMBO_FROM ? ` · best combo x${lawn.bestCombo}` : '';
    els.endnote.textContent = `${lawn.cols} weeks · ${lawn.rows} rows · 1 riding mower${best}`;
    // The card is absolutely positioned inside #stage, which on a phone is the
    // sideways-scrolling box the board lives in: it is pinned to the board's
    // left edge and scrolls away with it. You finish the year at the far right,
    // so without this the whole payoff lands ~300px off screen.
    els.stage.scrollLeft = 0;
    els.endcard.hidden = false;
    onFinish(lawn);
  }
}

/** True while the end card is up, so the board stops chasing the mower. */
export function endCardUp() {
  return !els.endcard.hidden;
}
