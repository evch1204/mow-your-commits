// Every texture in the 3D scene is drawn here, with a pen, on a canvas: the
// grass cards, the trees, the hills, the sky props, the farm props and the
// month signs. Nothing is loaded from disk, so the whole diorama ships in the
// bundle and the ink matches the flat view's ink exactly.
//
// Cards are drawn WHITE on transparent wherever a colour has to come from the
// scene (`instanceColor` or the material tint) and INK where a line must stay
// a line. Ink over white multiplies to ink; white over green comes out green.

import * as THREE from 'three';
import { INK, CREAM } from '../core/palette.js';
import { MONTH_NAMES } from '../core/lawn.js';
import { CARD, STUBBLE } from './theme.js';

/** Deterministic wobble, so a card looks hand-drawn but never flickers. */
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
}

/** A stroked path that wanders a little off the straight line between points. */
function wobble(c, pts, jitter, rnd) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    c.quadraticCurveTo(
      (x0 + x1) / 2 + (rnd() - 0.5) * jitter,
      (y0 + y1) / 2 + (rnd() - 0.5) * jitter,
      x1, y1,
    );
  }
}

const cache = new Map();

/** Every texture is built once and shared; a board rebuild must not free them. */
function cached(key, make) {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}

/** The set a dispose pass has to leave alone. */
export function sharedTextures() {
  return new Set(cache.values());
}

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// --- grass cards -------------------------------------------------------

/**
 * One blade: a tapered white stroke. Level 1 has no outline (the grammar says
 * so); everything above it is a filled silhouette instead.
 */
function blade(c, x, y, h, lean, w, rnd) {
  c.lineCap = 'round';
  c.lineWidth = w;
  wobble(c, [[x, y], [x + lean * 0.4, y - h * 0.55], [x + lean, y - h]], w * 0.8, rnd);
  c.stroke();
}

/**
 * A lobed silhouette: `n` overlapping arcs along a ragged top, filled white and
 * outlined in ink. This is what makes a bush a bush and a hedge a hedge from
 * fifty units away.
 */
function lobes(c, cx, base, w, h, n, rnd, wall = 0.55) {
  const pts = [];
  pts.push([cx - w / 2, base]);
  for (let i = 0; i <= n * 3; i++) {
    const t = i / (n * 3);
    const x = cx - w / 2 + t * w;
    // `wall` decides the profile: 0.55 is a dome (a bush), 0.16 climbs almost
    // straight up and runs flat and lumpy across the top (a hedge)
    const arc = Math.min(1, Math.sin(t * Math.PI) ** wall);
    const bump = Math.sin(t * Math.PI * n * 1.15) * h * 0.14;
    pts.push([x, base - (arc * h * 0.92 + bump) + (rnd() - 0.5) * h * 0.05]);
  }
  pts.push([cx + w / 2, base]);
  wobble(c, pts, w * 0.035, rnd);
  c.closePath();
}

/** The tuft card for one grass level: sprouts, tuft, bush or hedge. */
export function tuftCard(level) {
  return cached('tuft' + level, () => {
    const W = 160;
    const H = Math.round(W * (CARD[level].h / CARD[level].w));
    return canvasTexture(W, H, (c) => {
      const rnd = rng(1009 + level * 7717);
      const base = H - 2;
      c.strokeStyle = INK;
      c.lineJoin = 'round';
      c.lineCap = 'round';

      if (level === 1) {
        // sprouts: three thin blades, no outline. Tinted by instanceColor.
        c.strokeStyle = '#FFFFFF';
        for (let i = 0; i < 3; i++) {
          const x = W * (0.28 + i * 0.22);
          blade(c, x, base, H * (0.72 + rnd() * 0.28), (i - 1) * 16, 13, rnd);
        }
        // one thin ink hair per blade so it still reads against a pale tile
        c.strokeStyle = 'rgba(44,44,42,0.55)';
        for (let i = 0; i < 3; i++) {
          const x = W * (0.28 + i * 0.22);
          blade(c, x, base, H * (0.6 + rnd() * 0.2), (i - 1) * 14, 3, rnd);
        }
        return;
      }

      if (level === 2) {
        // tuft: five blades standing out of a small filled clump
        c.strokeStyle = '#FFFFFF';
        c.lineWidth = 11;
        for (let i = 0; i < 5; i++) {
          const x = W * (0.2 + i * 0.15);
          blade(c, x, base - 6, H * (0.55 + rnd() * 0.42), (i - 2) * 13, 11, rnd);
        }
        c.strokeStyle = INK;
        c.lineWidth = 3.4;
        for (let i = 0; i < 5; i++) {
          const x = W * (0.2 + i * 0.15);
          blade(c, x, base - 6, H * (0.5 + rnd() * 0.36), (i - 2) * 12, 3.4, rnd);
        }
        c.fillStyle = '#FFFFFF';
        lobes(c, W / 2, base, W * 0.72, H * 0.3, 2, rnd);
        c.fill();
        c.lineWidth = 4.2;
        c.stroke();
        return;
      }

      // bush and hedge: a filled silhouette, inner strokes, and (hedge) seeds
      const n = level === 3 ? 3 : 5;
      const bodyH = level === 3 ? H * 0.9 : H * 0.78;
      c.fillStyle = '#FFFFFF';
      lobes(c, W / 2, base, W * 0.94, bodyH, n, rnd, level === 3 ? 0.55 : 0.12);
      c.fill();
      c.lineWidth = level === 3 ? 5.2 : 5.8;
      c.stroke();

      // the inner strokes are semi-transparent black: white * tint is the
      // grass green, grey * tint is a darker version of the same green
      c.strokeStyle = 'rgba(30,34,26,0.34)';
      c.lineWidth = level === 3 ? 4.2 : 4.6;
      const strokes = level === 3 ? 5 : 8;
      for (let i = 0; i < strokes; i++) {
        const x = W * (0.16 + (i / (strokes - 1)) * 0.68) + (rnd() - 0.5) * 8;
        const top = base - bodyH * (0.28 + rnd() * 0.45);
        wobble(c, [[x, base - 6], [x + (rnd() - 0.5) * 12, (base + top) / 2], [x, top]], 7, rnd);
        c.stroke();
      }

      if (level === 4) {
        // two or three seed heads on wire stems, over the top of the hedge
        c.strokeStyle = 'rgba(44,44,42,0.82)';
        c.lineWidth = 3.2;
        c.fillStyle = '#FFFFFF';
        for (let i = 0; i < 3; i++) {
          const x = W * (0.26 + i * 0.24);
          const top = base - H * (0.94 + rnd() * 0.05);
          c.beginPath();
          c.moveTo(x, base - bodyH * 0.8);
          c.quadraticCurveTo(x + (rnd() - 0.5) * 16, (base - bodyH + top) / 2, x, top);
          c.stroke();
          c.beginPath();
          c.ellipse(x, top + 6, 7.5, 14, (rnd() - 0.5) * 0.5, 0, 7);
          c.fill();
          c.stroke();
        }
      }
    });
  });
}

/** What is left after a cut: a few short nicks in the tile. */
export function stubbleCard() {
  return cached('stubble', () => {
    const W = 160, H = Math.round(W * (STUBBLE.h / STUBBLE.w));
    return canvasTexture(W, H, (c) => {
      const rnd = rng(60613);
      c.lineCap = 'round';
      c.strokeStyle = '#FFFFFF';
      c.lineWidth = 9;
      for (let i = 0; i < 6; i++) {
        const x = W * (0.1 + i * 0.16);
        blade(c, x, H - 2, H * (0.5 + rnd() * 0.45), (i % 2 ? 6 : -6), 9, rnd);
      }
      c.strokeStyle = 'rgba(44,44,42,0.5)';
      c.lineWidth = 2.6;
      for (let i = 0; i < 6; i++) {
        const x = W * (0.1 + i * 0.16);
        blade(c, x, H - 2, H * (0.42 + rnd() * 0.4), (i % 2 ? 5 : -5), 2.6, rnd);
      }
    });
  });
}

/** The meadow outside the fence: a denser scribble of the same hand. */
export function meadowCard() {
  return cached('meadowCard', () => canvasTexture(128, 96, (c) => {
    const rnd = rng(31337);
    c.lineCap = 'round';
    for (const [style, w, n] of [['#FFFFFF', 10, 11], ['rgba(44,44,42,0.42)', 2.6, 11]]) {
      c.strokeStyle = style;
      const r2 = rng(31337);
      for (let i = 0; i < n; i++) {
        const x = 10 + r2() * 108;
        blade(c, x, 94, 30 + r2() * 58, (r2() - 0.5) * 26, w, rnd);
      }
    }
  }));
}

/** The flat dark disc a hedge stands on. */
export function blobTexture() {
  return cached('blob', () => canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(38,42,30,0.85)');
    g.addColorStop(0.6, 'rgba(38,42,30,0.5)');
    g.addColorStop(1, 'rgba(38,42,30,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  }));
}

/** One stamp of a tyre ribbon: a flattened, nicked band. */
export function trackTexture() {
  return cached('track', () => canvasTexture(32, 32, (c) => {
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillRect(2, 0, 28, 32);
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.moveTo(2, 4 + i * 8);
      c.lineTo(30, 8 + i * 8);
      c.stroke();
    }
  }));
}

// --- hills, trees, meadow ----------------------------------------------

/** A hand-drawn ridge line: white below, ink along the top, a scribble or two. */
export function hillTexture(spec) {
  return cached('hill' + spec.z, () => canvasTexture(1024, 256, (c) => {
    const rnd = rng(spec.seed);
    const pts = [[-8, 260]];
    let x = -8;
    let y = 150;
    while (x < 1032) {
      const step = 90 + rnd() * 150;
      x += step;
      y = 60 + rnd() * 120;
      pts.push([x, y]);
    }
    pts.push([1032, 260]);
    c.fillStyle = '#FFFFFF';
    // a pencil ridge, not a marker one: at 170 units wide a 7 px line on this
    // canvas is a rope across the sky
    c.strokeStyle = `rgba(44,44,42,${spec.ink})`;
    c.lineWidth = 4.5;
    c.lineJoin = 'round';
    wobble(c, pts, 26, rnd);
    c.closePath();
    c.fill();
    c.stroke();
    // a couple of scribbles for slope, well inside the ridge
    c.strokeStyle = `rgba(44,44,42,${spec.ink * 0.55})`;
    c.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      const sx = 40 + rnd() * 940;
      const sy = 180 + rnd() * 60;
      wobble(c, [[sx, sy], [sx + 24, sy - 14], [sx + 52, sy - 4]], 14, rnd);
      c.stroke();
    }
  }));
}

const TRUNK = (c, x, top, bottom, w) => {
  c.strokeStyle = INK;
  c.lineCap = 'round';
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(x, bottom);
  c.lineTo(x, top);
  c.stroke();
};

/**
 * Three tree shapes x three season faces. `season` is 'bare' (winter, which
 * carries its own snow line), 'leafy' or 'autumn'.
 */
export function treeTexture(shape, season) {
  return cached(`tree:${shape}:${season}`, () => canvasTexture(160, 256, (c) => {
    const rnd = rng(shape.length * 977 + season.length * 131 + 17);
    const leaf = season === 'autumn' ? '#EF9F27' : '#5C8F3A';
    c.lineJoin = 'round';
    c.lineCap = 'round';

    if (shape === 'pine') {
      TRUNK(c, 80, 210, 250, 13);
      const green = season === 'autumn' ? '#4E7C3A' : '#3F6F34';
      c.fillStyle = green;
      c.strokeStyle = INK;
      c.lineWidth = 7;
      for (let i = 0; i < 3; i++) {
        const cy = 214 - i * 62;
        const half = 62 - i * 15;
        wobble(c, [[80 - half, cy], [80, cy - 84], [80 + half, cy]], 12, rnd);
        c.closePath();
        c.fill();
        c.stroke();
      }
      if (season === 'bare') {
        c.strokeStyle = 'rgba(255,255,255,0.85)';
        c.lineWidth = 6;
        for (let i = 0; i < 3; i++) {
          const cy = 214 - i * 62;
          const half = 62 - i * 15;
          wobble(c, [[80 - half + 6, cy - 4], [80, cy - 70], [80 + half - 6, cy - 4]], 8, rnd);
          c.stroke();
        }
      }
      return;
    }

    if (shape === 'poplar') {
      c.strokeStyle = INK;
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(80, 250);
      c.lineTo(80, 60);
      c.stroke();
      if (season !== 'bare') {
        c.fillStyle = leaf;
        c.strokeStyle = INK;
        c.lineWidth = 7;
        c.beginPath();
        c.ellipse(80, 132, 30, 92, 0, 0, 7);
        c.fill();
        c.stroke();
        c.strokeStyle = 'rgba(30,34,26,0.26)';
        c.lineWidth = 4;
        for (let i = 0; i < 9; i++) {
          const y = 56 + i * 19 + (rnd() - 0.5) * 8;
          const x = 66 + rnd() * 14;
          wobble(c, [[x, y], [x + 12, y + 9], [x + 22, y - 3]], 9, rnd);
          c.stroke();
        }
      } else {
        c.strokeStyle = INK;
        c.lineWidth = 5;
        for (let i = 0; i < 7; i++) {
          const y = 76 + i * 24;
          const s = i % 2 ? 1 : -1;
          c.beginPath();
          c.moveTo(80, y);
          c.lineTo(80 + s * 26, y - 22);
          c.stroke();
        }
        c.strokeStyle = 'rgba(255,255,255,0.7)';
        c.lineWidth = 4;
        for (let i = 0; i < 4; i++) {
          const y = 84 + i * 44;
          c.beginPath();
          c.moveTo(80, y);
          c.lineTo(80 + (i % 2 ? 22 : -22), y - 18);
          c.stroke();
        }
      }
      return;
    }

    // round canopy
    c.strokeStyle = INK;
    c.lineWidth = 9;
    c.beginPath();
    c.moveTo(80, 250); c.lineTo(80, 120);
    c.moveTo(80, 170); c.lineTo(38, 118);
    c.moveTo(80, 148); c.lineTo(122, 96);
    c.moveTo(80, 122); c.lineTo(62, 62);
    c.stroke();
    if (season === 'bare') {
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(80, 166); c.lineTo(42, 118);
      c.moveTo(80, 144); c.lineTo(119, 98);
      c.moveTo(80, 118); c.lineTo(63, 64);
      c.stroke();
      return;
    }
    c.fillStyle = leaf;
    c.strokeStyle = INK;
    c.lineWidth = 8;
    c.beginPath();
    c.arc(50, 108, 34, 0, 7);
    c.arc(84, 66, 40, 0, 7);
    c.arc(118, 110, 31, 0, 7);
    c.fill();
    c.stroke();
    c.strokeStyle = 'rgba(30,34,26,0.28)';
    c.lineWidth = 5;
    for (let i = 0; i < 6; i++) {
      const sx = 40 + rnd() * 90;
      const sy = 60 + rnd() * 70;
      wobble(c, [[sx, sy], [sx + 20, sy + 14], [sx + 38, sy - 2]], 12, rnd);
      c.stroke();
    }
  }));
}

// --- farm props --------------------------------------------------------

/** A red doodle barn for the left horizon. */
export function barnTexture() {
  return cached('barn', () => canvasTexture(256, 192, (c) => {
    const rnd = rng(4471);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.fillStyle = '#C0472A';
    c.strokeStyle = INK;
    c.lineWidth = 8;
    wobble(c, [[26, 186], [26, 92], [128, 30], [230, 92], [230, 186]], 6, rnd);
    c.closePath();
    c.fill();
    c.stroke();
    // roof band
    c.fillStyle = '#8E3520';
    wobble(c, [[26, 96], [128, 34], [230, 96], [206, 104], [128, 52], [50, 104]], 5, rnd);
    c.closePath();
    c.fill();
    c.stroke();
    // big doors, cream, with the classic cross brace
    c.fillStyle = CREAM;
    c.fillRect(96, 118, 64, 68);
    c.strokeRect(96, 118, 64, 68);
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(96, 118); c.lineTo(160, 186);
    c.moveTo(160, 118); c.lineTo(96, 186);
    c.moveTo(128, 118); c.lineTo(128, 186);
    c.stroke();
    // hay loft window
    c.fillStyle = CREAM;
    c.beginPath();
    c.arc(128, 76, 14, 0, 7);
    c.fill();
    c.lineWidth = 7;
    c.stroke();
  }));
}

/** The windmill tower; the blades are their own card so they can turn. */
export function millTowerTexture() {
  return cached('mill', () => canvasTexture(128, 256, (c) => {
    const rnd = rng(8821);
    c.lineJoin = 'round';
    c.fillStyle = '#FBF4DD';
    c.strokeStyle = INK;
    c.lineWidth = 8;
    wobble(c, [[30, 250], [46, 74], [82, 74], [98, 250]], 5, rnd);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = '#8E6B45';
    wobble(c, [[40, 78], [64, 40], [88, 78]], 5, rnd);
    c.closePath();
    c.fill();
    c.stroke();
    c.strokeStyle = 'rgba(44,44,42,0.35)';
    c.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      const y = 110 + i * 34;
      c.beginPath();
      c.moveTo(36 + i * 1.5, y);
      c.lineTo(92 - i * 1.5, y + 3);
      c.stroke();
    }
    c.fillStyle = CREAM;
    c.strokeStyle = INK;
    c.lineWidth = 6;
    c.beginPath();
    c.rect(52, 150, 24, 28);
    c.fill();
    c.stroke();
  }));
}

export function millBladeTexture() {
  return cached('millblade', () => canvasTexture(256, 256, (c) => {
    c.translate(128, 128);
    c.strokeStyle = INK;
    c.fillStyle = '#FBF4DD';
    c.lineJoin = 'round';
    for (let i = 0; i < 4; i++) {
      c.rotate(Math.PI / 2);
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(0, -10);
      c.lineTo(112, -22);
      c.lineTo(112, 10);
      c.lineTo(0, 8);
      c.closePath();
      c.fill();
      c.stroke();
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(20, -13); c.lineTo(108, -20);
      c.moveTo(20, 2); c.lineTo(108, 4);
      c.stroke();
    }
    c.fillStyle = INK;
    c.beginPath();
    c.arc(0, 0, 11, 0, 7);
    c.fill();
  }));
}

export function scarecrowTexture() {
  return cached('scarecrow', () => canvasTexture(128, 192, (c) => {
    const rnd = rng(2029);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = INK;
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(64, 188); c.lineTo(64, 70);
    c.moveTo(14, 96); c.lineTo(114, 92);
    c.stroke();
    c.fillStyle = '#5C8F3A';
    c.lineWidth = 7;
    wobble(c, [[34, 92], [94, 90], [88, 150], [40, 152]], 6, rnd);
    c.closePath();
    c.fill();
    c.stroke();
    // straw hands and hem
    c.strokeStyle = '#C99A46';
    c.lineWidth = 5;
    for (const [x, s] of [[18, -1], [110, 1]]) {
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.moveTo(x, 94);
        c.lineTo(x + s * (6 + rnd() * 12), 94 + (i - 1.5) * 9);
        c.stroke();
      }
    }
    // head: a sack with a stitched face
    c.fillStyle = '#E4C98B';
    c.strokeStyle = INK;
    c.lineWidth = 7;
    c.beginPath();
    c.ellipse(64, 48, 27, 30, 0, 0, 7);
    c.fill();
    c.stroke();
    c.fillStyle = INK;
    c.beginPath(); c.arc(54, 44, 4.5, 0, 7); c.fill();
    c.beginPath(); c.arc(74, 44, 4.5, 0, 7); c.fill();
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(52, 60); c.lineTo(60, 64); c.lineTo(68, 58); c.lineTo(76, 62);
    c.stroke();
    // brim
    c.fillStyle = '#C99A46';
    c.lineWidth = 6;
    wobble(c, [[30, 24], [98, 24], [86, 16], [42, 16]], 4, rnd);
    c.closePath();
    c.fill();
    c.stroke();
  }));
}

export function snowmanTexture() {
  return cached('snowman', () => canvasTexture(128, 176, (c) => {
    c.lineJoin = 'round';
    c.fillStyle = '#FFFFFF';
    c.strokeStyle = INK;
    c.lineWidth = 7;
    for (const [y, r] of [[142, 30], [96, 24], [56, 19]]) {
      c.beginPath();
      c.arc(64, y, r, 0, 7);
      c.fill();
      c.stroke();
    }
    c.fillStyle = INK;
    for (const [x, y] of [[57, 51], [71, 51], [64, 92], [64, 104], [64, 116]]) {
      c.beginPath(); c.arc(x, y, 3.4, 0, 7); c.fill();
    }
    c.fillStyle = '#D85A30';
    c.beginPath();
    c.moveTo(64, 58); c.lineTo(90, 63); c.lineTo(64, 66);
    c.closePath();
    c.fill();
    c.lineWidth = 4;
    c.stroke();
    // stick arms and a hat
    c.strokeStyle = '#8E6B45';
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(42, 94); c.lineTo(16, 78); c.moveTo(24, 84); c.lineTo(18, 70);
    c.moveTo(86, 94); c.lineTo(112, 78); c.moveTo(104, 84); c.lineTo(110, 70);
    c.stroke();
    c.fillStyle = INK;
    c.fillRect(48, 22, 32, 18);
    c.fillRect(38, 38, 52, 6);
  }));
}

/** Two frames of a bird: the V open and the V flat. */
export function birdTexture(frame) {
  return cached('bird' + frame, () => canvasTexture(64, 32, (c) => {
    c.strokeStyle = INK;
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    if (frame === 0) {
      c.moveTo(6, 22); c.quadraticCurveTo(18, 6, 32, 18);
      c.quadraticCurveTo(46, 6, 58, 22);
    } else {
      c.moveTo(6, 14); c.quadraticCurveTo(18, 20, 32, 15);
      c.quadraticCurveTo(46, 20, 58, 14);
    }
    c.stroke();
  }));
}

// --- sky ---------------------------------------------------------------

export function sunTexture() {
  return cached('sun', () => canvasTexture(128, 128, (c) => {
    c.lineWidth = 6; c.strokeStyle = INK; c.fillStyle = '#FAC775';
    c.beginPath(); c.arc(64, 64, 30, 0, 7); c.fill(); c.stroke();
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * 6.28;
      c.beginPath();
      c.moveTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40);
      c.lineTo(64 + Math.cos(a + 0.15) * 58, 64 + Math.sin(a + 0.15) * 58);
      c.stroke();
    }
  }));
}

export function cloudTexture() {
  return cached('cloud', () => canvasTexture(128, 128, (c) => {
    c.lineWidth = 6; c.strokeStyle = INK; c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(40, 74, 22, 0, 7); c.arc(66, 58, 28, 0, 7); c.arc(92, 76, 22, 0, 7);
    c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.fillRect(30, 72, 70, 22);
  }));
}

/** A snowflake as a child draws one: a six-armed asterisk in ink and white. */
export function flakeTexture() {
  return cached('flake', () => canvasTexture(64, 64, (c) => {
    c.translate(32, 32);
    c.lineCap = 'round';
    for (const [style, w] of [['rgba(44,44,42,0.3)', 7], ['#FFFFFF', 5.5]]) {
      c.strokeStyle = style;
      c.lineWidth = w;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        c.beginPath();
        c.moveTo(-Math.cos(a) * 24, -Math.sin(a) * 24);
        c.lineTo(Math.cos(a) * 24, Math.sin(a) * 24);
        c.stroke();
        for (const s of [-1, 1]) {
          c.beginPath();
          c.moveTo(Math.cos(a) * 15 * s, Math.sin(a) * 15 * s);
          c.lineTo(Math.cos(a + 0.9) * 22 * s, Math.sin(a + 0.9) * 22 * s);
          c.moveTo(Math.cos(a) * 15 * s, Math.sin(a) * 15 * s);
          c.lineTo(Math.cos(a - 0.9) * 22 * s, Math.sin(a - 0.9) * 22 * s);
          c.stroke();
        }
      }
    }
  }));
}

export function fluffTexture() {
  return cached('fluff', () => canvasTexture(32, 32, (c) => {
    const g = c.createRadialGradient(16, 14, 1, 16, 14, 12);
    g.addColorStop(0, 'rgba(255,253,245,1)');
    g.addColorStop(0.6, 'rgba(255,253,245,0.85)');
    g.addColorStop(1, 'rgba(255,253,245,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
    c.strokeStyle = 'rgba(44,44,42,0.6)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(16, 22); c.lineTo(16, 29); c.stroke();
  }));
}

/** A leaf with an ink edge and a drawn vein: white, so the instance tints it. */
export function leafTexture() {
  return cached('leaf', () => canvasTexture(64, 40, (c) => {
    c.fillStyle = '#FFFFFF';
    c.strokeStyle = INK;
    c.lineWidth = 4;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(6, 20);
    c.quadraticCurveTo(24, 1, 58, 14);
    c.quadraticCurveTo(30, 39, 6, 20);
    c.closePath();
    c.fill();
    c.stroke();
    c.lineWidth = 2.6;
    c.strokeStyle = 'rgba(44,44,42,0.75)';
    c.beginPath();
    c.moveTo(7, 20);
    c.quadraticCurveTo(32, 18, 57, 14);
    c.stroke();
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      c.beginPath();
      c.moveTo(7 + t * 50, 20 - t * 5);
      c.lineTo(10 + t * 48, 8 + t * 3);
      c.stroke();
    }
  }));
}

/**
 * A month sign. Not cached: the board rebuild disposes it, and a fresh draw is
 * how a sign picks up Patrick Hand once the webfont has actually landed.
 */
export function signTexture(month, font) {
  return canvasTexture(256, 256, (c) => {
    c.clearRect(0, 0, 256, 256);
    c.fillStyle = CREAM; c.fillRect(8, 72, 240, 112);
    c.lineWidth = 8; c.strokeStyle = INK; c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(14, 76); c.lineTo(244, 74); c.lineTo(242, 182); c.lineTo(12, 180);
    c.closePath(); c.stroke();
    c.fillStyle = INK; c.font = `84px ${font}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(MONTH_NAMES[month].slice(0, 3), 128, 130);
  });
}

/** The driver's face. */
export function faceTexture() {
  return cached('face', () => canvasTexture(64, 64, (c) => {
    c.clearRect(0, 0, 64, 64);
    c.fillStyle = INK;
    c.beginPath(); c.arc(24, 28, 4, 0, 7); c.fill();
    c.beginPath(); c.arc(42, 28, 4, 0, 7); c.fill();
    c.strokeStyle = INK; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.arc(33, 34, 11, 0.35, Math.PI - 0.35); c.stroke();
  }));
}

/** Soft dot, for the exhaust puff and the deck's dust ring. */
export function dustTexture() {
  return cached('dust', () => canvasTexture(32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 1, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  }));
}
