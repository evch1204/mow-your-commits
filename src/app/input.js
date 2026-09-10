// Driving the mower: the keyboard, the on-screen pad, and the two shortcuts
// that are not steering. One shared `input` object is what the simulation
// reads every frame, so nothing here has to know about the lawn.

/** What tick() reads. ?autodrive=1 writes to the same four booleans. */
export const input = { up: false, down: false, left: false, right: false };

const keymap = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};

/** Let go of everything. A page that loses focus must not drive on by itself. */
export function releaseKeys() {
  for (const k in input) input[k] = false;
}

/**
 * @param stage the board, which owns the key handlers so the page still
 *   scrolls with the arrows until you click the lawn.
 * @param onCamera C, and the overview button
 * @param onRegrow R, and the regrow buttons
 */
export function initInput({ stage, onCamera, onRegrow }) {
  stage.addEventListener('keydown', (e) => {
    const k = keymap[e.key];
    if (k) { input[k] = true; e.preventDefault(); return; }
    if (e.key === 'c' || e.key === 'C') { onCamera(); e.preventDefault(); }
    if (e.key === 'r' || e.key === 'R') { onRegrow(); e.preventDefault(); }
  });
  stage.addEventListener('keyup', (e) => { const k = keymap[e.key]; if (k) input[k] = false; });
  stage.addEventListener('pointerdown', () => stage.focus());
  window.addEventListener('blur', releaseKeys);

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
}
