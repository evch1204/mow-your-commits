// Sound, procedurally: an engine hum, a snip per cut, a chime on a heroic day
// and a fanfare at the end. No files to load, a few hundred bytes of code, and
// nothing at all until the visitor asks for it.
//
// Two rules hold this file together. It is off by default and the AudioContext
// is not built until the click that turns it on, because every browser refuses
// to start one without a gesture. And nothing in here may throw: a browser
// without WebAudio, a locked-down localStorage or an exhausted audio graph all
// have to end as silence, never as a broken page.

const KEY = 'mow:sound';

/** The mower's own top speed, so the hum tops out where the throttle does. */
const TOP_SPEED = 0.24;

/** The shortest gap between two cut noises. A wide pass is one snip, not six. */
const CUT_GAP = 0.045;

let ctx = null;
let master = null;
let engine = null;       // { osc, filter, gain }, running from the first "on"
let noise = null;        // one buffer of white noise, reused for every cut
let on = false;
let btn = null;
let lastCut = -1;

function remembered() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

function remember(v) {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode */ }
}

/**
 * Build the audio graph, once, inside a user gesture. The engine oscillator
 * runs for the life of the page at zero gain: starting and stopping an
 * oscillator per keypress clicks, riding its gain does not.
 */
function ensure() {
  if (ctx) return true;
  const AC = typeof window === 'undefined' ? null : (window.AudioContext || window.webkitAudioContext);
  if (!AC) return false;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 48;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 190;
    filter.Q.value = 3.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(master);
    osc.start();
    engine = { osc, filter, gain };

    const len = Math.floor(ctx.sampleRate * 0.4);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  } catch {
    ctx = null;
    return false;
  }
}

/** True only when there is something that can actually make a noise. */
export function isOn() { return on && !!ctx; }

function paint() {
  if (!btn) return;
  btn.textContent = on ? '🔊' : '🔇';
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'turn sound off' : 'turn sound on');
  btn.title = on ? 'sound on' : 'sound off';
}

function setOn(want) {
  on = !!want;
  remember(on);
  if (on && !ensure()) on = false;         // no WebAudio here: stay quiet
  paint();
  if (!ctx) return;
  if (on && ctx.state === 'suspended') ctx.resume().catch(() => {});
  master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.05);
}

export function toggle() { setOn(!on); }

// --- the noises -----------------------------------------------------------

/**
 * One note. Exponential ramps, because a linear fade to zero on a sine is a
 * click; and they cannot touch zero, hence 0.0001 at both ends.
 */
function note(freq, at, dur, type = 'triangle', peak = 0.13) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** The blade going through grass: a band-passed puff of the noise buffer. */
function burst() {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.55;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1150 + Math.random() * 950;
  bp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.15, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.14);
}

/**
 * The hum follows the throttle: faster is higher, louder and brighter.
 * setTargetAtTime rather than a set, so a stutter in the frame rate does not
 * step the pitch.
 */
export function drive(vel) {
  if (!isOn()) return;
  try {
    const s = Math.min(1, Math.abs(vel) / TOP_SPEED);
    const t = ctx.currentTime;
    engine.osc.frequency.setTargetAtTime(46 + s * 80, t, 0.09);
    engine.filter.frequency.setTargetAtTime(180 + s * 920, t, 0.09);
    engine.gain.gain.setTargetAtTime(0.02 + s * 0.055, t, 0.09);
  } catch { /* the graph is gone; the page is not */ }
}

/** A cut. `heroic` (one of the year's best days) adds a two-note chime. */
export function cut(heroic = false) {
  if (!isOn()) return;
  try {
    const now = ctx.currentTime;
    if (now - lastCut < CUT_GAP) return;
    lastCut = now;
    burst();
    if (heroic) {
      note(880, 0.01, 0.2, 'triangle', 0.1);
      note(1318.5, 0.1, 0.26, 'triangle', 0.1);
    }
  } catch { /* ignore */ }
}

/** The lawn is done: C E G C, which is as much fanfare as a toy needs. */
export function fanfare() {
  if (!isOn()) return;
  try {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => note(f, i * 0.13, 0.36, 'triangle', 0.15));
  } catch { /* ignore */ }
}

// --- the button -----------------------------------------------------------

/**
 * Wire the 🔇/🔊 button. A visitor who turned sound on last time gets it back,
 * but not before they touch the page: browsers will not start an AudioContext
 * cold, so the restore waits for the first click or key anywhere.
 * @param restore false for `?sound=0`, which keeps a screenshot silent.
 */
export function initSound(button, { restore = true } = {}) {
  btn = button;
  if (!btn) return;
  paint();
  btn.addEventListener('click', toggle);
  if (!restore || !remembered()) return;

  const go = (e) => {
    document.removeEventListener('pointerdown', go, true);
    document.removeEventListener('keydown', go, true);
    // if the gesture *is* the button, let its own handler do the turning on,
    // or the two would cancel each other out
    if (btn.contains(e.target)) return;
    setOn(true);
  };
  document.addEventListener('pointerdown', go, true);
  document.addEventListener('keydown', go, true);
}
