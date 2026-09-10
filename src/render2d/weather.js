// The whole year's climate, on screen at once: snow over the winter columns,
// blossom over spring, dandelion fluff over summer, leaves over autumn, plus
// the little season doodle beside the first month of each and the dressing
// scattered on bare tiles.

import { GEOM } from '../core/board.js';
import { SEASON_GLYPH, seasonIndexOfCol } from '../core/lawn.js';
import { AUTUMN_BLADE, DANDELION, FLUFF, INK, ORANGE, PETAL, SUN } from '../core/palette.js';

const { CELL, GAP, PITCH, OY } = GEOM;

/**
 * One persistent particle pool per season, each confined to the columns that
 * season actually owns.
 */
export function buildWeather(r) {
  const { lawn } = r;
  r.weather = [];
  const runs = [[], [], [], []];
  let cur = -1, from = 0;
  for (let c = 0; c <= lawn.cols; c++) {
    const s = c < lawn.cols ? seasonIndexOfCol(lawn, c) : -1;
    if (s !== cur) {
      if (cur >= 0) runs[cur].push([from, c]);
      cur = s; from = c;
    }
  }
  const COUNT = [70, 16, 14, 26];
  for (let s = 0; s < 4; s++) {
    const rs = runs[s];
    const total = rs.reduce((a, run) => a + (run[1] - run[0]), 0);
    if (!total) continue;                       // a season with no columns
    for (let i = 0; i < COUNT[s]; i++) {
      let t = Math.random() * total;
      let run = rs[0];
      for (const q of rs) { t -= q[1] - q[0]; if (t <= 0) { run = q; break; } }
      r.weather.push({
        s, i,
        x0: r.tileX(run[0]) - GAP / 2,
        x1: r.tileX(run[1]) - GAP / 2,
        x: 0, y: 0, r: 0, a: Math.random() * 6.28,
      });
      respawn(r, r.weather[r.weather.length - 1], true);
    }
  }
}

export function respawn(r, p, anywhere) {
  const { lawn } = r;
  const top = OY - 14;
  const bottom = OY + lawn.rows * PITCH - GAP + 6;
  p.x = p.x0 + Math.random() * Math.max(1, p.x1 - p.x0);
  if (p.s === 2) p.y = anywhere ? top + Math.random() * (bottom - top) : bottom;
  else p.y = anywhere ? top + Math.random() * (bottom - top) : top;
  p.r = p.s === 0 ? 1.2 + Math.random() * 1 : p.s === 1 ? 1.4 : p.s === 2 ? 1.3 : 1;
  p.a = Math.random() * 6.28;
}

export function drawWeather(r, dt) {
  const { ctx, lawn } = r;
  if (typeof document !== 'undefined' && document.hidden) return;
  const top = OY - 14;
  const bottom = OY + lawn.rows * PITCH - GAP + 6;
  const LEAF = [ORANGE, '#EF9F27', AUTUMN_BLADE];
  for (const p of r.weather) {
    if (p.s === 0) {
      p.y += 14 * dt;
      p.x += Math.sin(r.now * 1.1 + p.i) * 0.35;
      if (p.y > bottom) respawn(r, p);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    } else if (p.s === 1) {
      p.y += 8 * dt;
      p.x += Math.sin(r.now * 0.9 + p.i) * 0.4;
      if (p.y > bottom) respawn(r, p);
      ctx.fillStyle = PETAL[p.i % 2];
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    } else if (p.s === 2) {
      p.y -= 6 * dt;                                  // fluff rises
      p.x += Math.sin(r.now * 0.8 + p.i) * 0.3;
      if (p.y < top) respawn(r, p);
      ctx.fillStyle = FLUFF;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(44,44,42,0.5)'; ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + p.r); ctx.lineTo(p.x, p.y + p.r + 2.4); ctx.stroke();
    } else {
      p.y += 10 * dt;
      p.a += 2 * dt;
      p.x += Math.sin(r.now * 1.3 + p.i) * 0.5;
      if (p.y > bottom) respawn(r, p);
      ctx.fillStyle = LEAF[p.i % 3];
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 3, 1.8, p.a, 0, 7); ctx.fill();
    }
    if (p.x < p.x0 - 4) p.x = p.x1;
    if (p.x > p.x1 + 4) p.x = p.x0;
  }

  // summer air shimmers just above the top row
  const summer = r.weather.find((p) => p.s === 2);
  if (summer) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    for (const dy of [0, 3]) {
      r.line(summer.x0, OY - 7 + dy, summer.x1, OY - 7 + dy, 1.5);
    }
  }
}

/** A 10px doodle for the season a month belongs to. */
export function seasonGlyph(r, x, y, season) {
  const { ctx } = r;
  const kind = SEASON_GLYPH[season];
  if (kind === 'snow') {
    ctx.strokeStyle = '#85B7EB'; ctx.lineWidth = 1.1;
    for (let k = 0; k < 3; k++) {
      const a = k * 1.047 + 0.3;
      r.line(x - Math.cos(a) * 4, y - Math.sin(a) * 4,
        x + Math.cos(a) * 4, y + Math.sin(a) * 4, 0.5);
    }
  } else if (kind === 'flower') {
    for (let k = 0; k < 5; k++) {
      const a = k * 1.257;
      ctx.fillStyle = PETAL[k % 2];
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 2.8, y + Math.sin(a) * 2.8, 1.6, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = DANDELION;
    ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 7); ctx.fill();
  } else if (kind === 'sun') {
    ctx.fillStyle = SUN;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 0.9;
    for (let k = 0; k < 8; k++) {
      const a = k * 0.785;
      r.line(x + Math.cos(a) * 5, y + Math.sin(a) * 5,
        x + Math.cos(a) * 7, y + Math.sin(a) * 7, 0.4);
    }
  } else {
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.ellipse(x, y, 6, 3.5, -0.4, 0, 7); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    r.line(x - 5, y + 2, x + 5, y - 2, 0.4);
  }
}

/** Seasonal dressing, only on bare tiles so it never hides grass. */
export function drawDressing(r) {
  const { ctx, lawn } = r;
  for (const c of lawn.cells) {
    if (c.void || c.level !== 0) continue;
    const s = seasonIndexOfCol(lawn, c.col);
    if (s !== 0 && s !== 3) continue;
    if ((c.col * 7 + c.row * 3) % 5 !== 0) continue;
    r.seed = (c.col * 17 + c.row * 5) * 71 + r.boil * 13 + 5;
    const cx = r.tileX(c.col) + CELL / 2;
    const cy = r.tileY(c.row) + CELL / 2;
    if (s === 0) {
      ctx.strokeStyle = '#85B7EB'; ctx.lineWidth = 1;
      r.line(cx - 3, cy, cx + 3, cy, 0.3);
      r.line(cx, cy - 3, cx, cy + 3, 0.3);
    } else {
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.ellipse(cx, cy, 2.6, 1.6, 0.6, 0, 7); ctx.fill();
    }
  }
}
