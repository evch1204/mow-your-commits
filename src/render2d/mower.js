// The riding mower and the marks it leaves: exhaust puffs, twin tyre tracks
// and the clippings that come out of the chute.

import { GEOM } from '../core/board.js';
import { CREAM, INK, ORANGE } from '../core/palette.js';

/** Drop a track sample if the mower has moved far enough since the last one. */
export function sampleTrack(r) {
  const m = r.lawn.mower;
  const mx = r.px(m.x), my = r.py(m.z);
  const tail = r.tracks[r.tracks.length - 1];
  if (tail && Math.hypot(mx - tail.x, my - tail.y) <= 3) return;
  r.tracks.push({ x: mx, y: my, a: m.angle, life: 1 });
  if (r.tracks.length > 160) r.tracks.shift();
}

/**
 * Twin tyre tracks, sampled every few pixels of travel and drawn under the
 * grass, so they only show where the lawn has actually been cut.
 */
export function drawTracks(r, dt) {
  const { ctx } = r;
  sampleTrack(r);
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (let i = r.tracks.length - 1; i >= 0; i--) {
    const t = r.tracks[i];
    t.life -= dt / 4;
    if (t.life <= 0) { r.tracks.splice(i, 1); continue; }
    const p = r.tracks[i - 1];
    if (!p) continue;
    if (Math.hypot(t.x - p.x, t.y - p.y) > 40) continue;   // teleport, not a drive
    ctx.strokeStyle = `rgba(44,44,42,${0.15 * t.life})`;
    for (const s of [-1, 1]) {
      const nx = -Math.sin(t.a) * 8.5 * s, ny = Math.cos(t.a) * 8.5 * s;
      const px2 = -Math.sin(p.a) * 8.5 * s, py2 = Math.cos(p.a) * 8.5 * s;
      ctx.beginPath();
      ctx.moveTo(p.x + px2, p.y + py2);
      ctx.lineTo(t.x + nx, t.y + ny);
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

/** Clippings tumbling out of the chute. */
export function drawClippings(r) {
  const { ctx } = r;
  for (let i = r.clippings.length - 1; i >= 0; i--) {
    const q = r.clippings[i];
    q.x += q.vx; q.y += q.vy;
    q.vx *= 0.94; q.vy *= 0.94;
    q.a += 0.2;
    q.life--;
    if (q.life <= 0) { r.clippings.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, q.life / 10);
    ctx.fillStyle = q.c;
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(q.a);
    ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s * 0.7);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

/**
 * A riding mower seen from above: wide deck with a side chute, small front
 * wheels, big rear wheels, seat and driver. Same silhouette as the 3D one.
 * Local space: +x is forward, +y is the mower's right.
 */
export function drawMower(r, dt) {
  const { ctx, lawn } = r;
  const m = lawn.mower;
  const mx = r.px(m.x);
  const my = r.py(m.z);
  const S = GEOM.MOWER_SCALE;

  // exhaust, back left
  if (m.acc > 0 && Math.random() < 0.45) {
    r.puffs.push({
      x: mx - Math.cos(m.angle) * 11 + Math.sin(m.angle) * 6,
      y: my - Math.sin(m.angle) * 11 - Math.cos(m.angle) * 6,
      r: 1.6, life: 1,
    });
  }
  for (let i = r.puffs.length - 1; i >= 0; i--) {
    const p = r.puffs[i];
    p.life -= dt * 1.6; p.r += dt * 14; p.y -= dt * 12;
    if (p.life <= 0) { r.puffs.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(140,138,132,${0.3 * p.life})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
  }

  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(m.angle);
  ctx.scale(S, S);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const ink = (w) => { ctx.strokeStyle = INK; ctx.lineWidth = w; };

  // cutting deck: wider than the body, sticking out both sides
  ctx.fillStyle = '#615F58';
  r.box(0, -9.5, 12, 19, 3);
  ctx.fill(); ink(1.4); ctx.stroke();
  // discharge chute on the right
  ctx.fillStyle = '#3A3A38';
  ctx.beginPath();
  ctx.moveTo(5, 9); ctx.lineTo(10, 9); ctx.lineTo(13, 14.5); ctx.lineTo(7, 14.5);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // spinning blade inside the deck
  ctx.strokeStyle = '#B8B6AE'; ctx.lineWidth = 1.4;
  for (const o of [0, 1.57]) {
    ctx.beginPath();
    ctx.moveTo(6 + Math.cos(r.spin + o) * 6.5, Math.sin(r.spin + o) * 6.5);
    ctx.lineTo(6 - Math.cos(r.spin + o) * 6.5, -Math.sin(r.spin + o) * 6.5);
    ctx.stroke();
  }

  // front wheels (small)
  ctx.fillStyle = '#33332F';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(5.5, s * 8, 2.6, 1.7, 0, 0, 7); ctx.fill();
    ink(1); ctx.stroke();
  }

  // hood
  ctx.fillStyle = ORANGE;
  r.box(-4.5, -6.5, 12, 13, 3.5);
  ctx.fill(); ink(1.5); ctx.stroke();
  ctx.fillStyle = '#2C2C2A';
  r.box(5.6, -4.5, 1.8, 9, 0.8); ctx.fill();          // grille
  ctx.fillStyle = CREAM;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.arc(4.4, s * 5, 1.2, 0, 7); ctx.fill();
    ink(0.8); ctx.stroke();
  }

  // rear body / fender plate
  ctx.fillStyle = '#C24E27';
  r.box(-13, -7.5, 9, 15, 3);
  ctx.fill(); ink(1.5); ctx.stroke();

  // rear wheels (big, chunky, with a cream hub)
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#2C2C2A';
    ctx.beginPath(); ctx.ellipse(-9, s * 9.5, 4.8, 3, 0, 0, 7); ctx.fill();
    ink(1.2); ctx.stroke();
    ctx.strokeStyle = '#55534E'; ctx.lineWidth = 1;
    for (let t = -3; t <= 3; t++) {
      ctx.beginPath();
      ctx.moveTo(-9 + t * 1.4, s * 9.5 - 2.4);
      ctx.lineTo(-9 + t * 1.4, s * 9.5 + 2.4);
      ctx.stroke();
    }
    ctx.fillStyle = CREAM;
    ctx.beginPath(); ctx.ellipse(-9, s * 9.5, 1.5, 1.1, 0, 0, 7); ctx.fill();
    ink(0.8); ctx.stroke();
  }

  // steering wheel on its column
  ink(1.3);
  ctx.beginPath(); ctx.ellipse(-1.5, 0, 3.2, 3.2, 0, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4.4, 0); ctx.lineTo(1.4, 0); ctx.stroke();

  // seat, then the driver on top of it
  ctx.fillStyle = '#3A3A38';
  r.box(-12.5, -4.5, 7, 9, 2);
  ctx.fill(); ink(1.2); ctx.stroke();
  ctx.fillStyle = '#5C8F3A';
  ctx.beginPath(); ctx.ellipse(-7.6, 0, 3.2, 4.4, 0, 0, 7); ctx.fill();
  ink(1.3); ctx.stroke();
  // arms reaching the wheel
  ink(1.5);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-6.4, s * 3.2);
    ctx.quadraticCurveTo(-4.2, s * 3.6, -1.8, s * 2.6);
    ctx.stroke();
  }
  // head with a cap
  ctx.fillStyle = '#F5C4B3';
  ctx.beginPath(); ctx.arc(-6.6, 0, 3, 0, 7); ctx.fill();
  ink(1.3); ctx.stroke();
  ctx.fillStyle = ORANGE;
  ctx.beginPath(); ctx.arc(-6.6, 0, 3, -1.9, 1.9); ctx.closePath();
  ctx.fill(); ink(1.1); ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(-4.6, -1.1, 0.6, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(-4.6, 1.1, 0.6, 0, 7); ctx.fill();

  ctx.restore();
  ctx.lineCap = 'butt';
}
