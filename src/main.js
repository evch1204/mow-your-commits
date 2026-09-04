import { createLawn, resetLawn, tick, progress, monthAt, MONTH_NAMES } from './core/lawn.js';
import { Renderer2D } from './render2d/index.js';
import { Renderer3D } from './render3d/index.js';

const lawn = createLawn(null); // null = fake year; swap in parseContributions() output later

const flat = new Renderer2D(document.getElementById('flat'), lawn);
const deep = new Renderer3D(document.getElementById('deep'), lawn);
const renderers = { flat, deep };
let active = 'flat';

const stage = document.getElementById('stage');
const pctEl = document.getElementById('pct');
const monEl = document.getElementById('month');
const input = { up: false, down: false, left: false, right: false };
const keymap = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };

stage.addEventListener('keydown', (e) => { const k = keymap[e.key]; if (k) { input[k] = true; e.preventDefault(); } });
stage.addEventListener('keyup', (e) => { const k = keymap[e.key]; if (k) input[k] = false; });
stage.addEventListener('pointerdown', () => stage.focus());

for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}
document.getElementById('regrow').addEventListener('click', () => {
  resetLawn(lawn);
  deep.applyLawn();
});

function setView(name) {
  active = name;
  document.body.dataset.view = name;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === name));
  if (name === 'deep') deep.resize();
}

window.addEventListener('resize', () => deep.resize());

let last = performance.now();
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  const mowed = tick(lawn, input, dt);
  if (mowed.length) { flat.onMowed(mowed); deep.onMowed(mowed); }
  renderers[active].draw(ts);
  pctEl.textContent = Math.round(progress(lawn) * 100) + '%';
  monEl.textContent = MONTH_NAMES[monthAt(lawn, lawn.mower.x)];
}

setView('flat');
requestAnimationFrame(frame);
