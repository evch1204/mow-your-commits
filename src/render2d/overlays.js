// Everything drawn on top of the board: the +N popups, the day label that
// trails the mower, Mon/Wed/Fri down the left and the key bottom right.

import { GEOM } from '../core/board.js';
import { FONT } from '../core/effects.js';
import { CREAM, INK, ORANGE, PAPER, PENCIL } from '../core/palette.js';
import { drawGrass, drawTile } from './grass.js';

const { CELL, GAP, PITCH, OX, OY } = GEOM;

/** A bigger day gets a bigger number; a combo and the best days get shouted. */
export function drawPopups(r, dt) {
  const { ctx } = r;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let i = r.popups.length - 1; i >= 0; i--) {
    const p = r.popups[i];
    p.age += dt;
    p.t += dt / 0.8;
    if (p.t >= 1) { r.popups.splice(i, 1); continue; }
    const a = p.t < 0.7 ? 1 : 1 - (p.t - 0.7) / 0.3;
    // the combo comes from core (builder C); read it defensively, because a
    // branch without it must still draw a plain +N
    const label = '+' + p.n + (p.heroic ? '!' : '') + (p.combo >= 3 ? ` x${p.combo}` : '');
    const y = p.y - 8 - p.t * 30;
    const chase = p.combo >= 3 ? 1 + Math.min(0.5, (p.combo - 2) * 0.09) : 1;
    ctx.font = `${Math.round((22 + Math.min(16, p.n * 0.45)) * chase)}px ${FONT}`;
    ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(251,249,242,${a * 0.95})`;
    ctx.strokeText(label, p.x, y);
    ctx.globalAlpha = a;
    if (p.n >= 25 || p.combo >= 3) {
      ctx.fillStyle = ORANGE;
      ctx.fillText(label, p.x, y);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
      ctx.strokeText(label, p.x, y);
    } else {
      ctx.fillStyle = INK;
      ctx.fillText(label, p.x, y);
    }
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
}

/** Doodle label that trails the mower with the last day it cut. */
export function drawTag(r, dt) {
  const { ctx, lawn } = r;
  if (r.tag.life <= 0 || !r.tag.text) return;
  r.tag.life -= dt;
  const m = lawn.mower;
  const tx = r.px(m.x) + 22;
  const ty = r.py(m.z) + 20;
  r.tag.x += (tx - r.tag.x) * 0.14;
  r.tag.y += (ty - r.tag.y) * 0.14;
  const a = Math.min(1, r.tag.life * 2.5);

  ctx.font = `17px ${FONT}`;
  const w = ctx.measureText(r.tag.text).width + 18;
  const h = 24;
  const x = Math.max(4, Math.min(r.width - w - 4, r.tag.x));
  const y = Math.max(4, Math.min(r.height - h - 4, r.tag.y));

  ctx.globalAlpha = a;
  ctx.fillStyle = CREAM;
  r.roundedPath(x, y, w, h, 6, 0.8);
  ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(r.tag.text, x + 9, y + h / 2 + 1);
  ctx.globalAlpha = 1;
}

/**
 * The slice of the board that is actually on screen, in canvas units. On a
 * phone the board is wider than the stage and scrolls sideways, so anything
 * pinned to the far edge of the bed sits off screen.
 */
export function visibleSpan(r) {
  const stage = r.canvas.parentElement;
  const shown = r.canvas.clientWidth;
  if (!stage || !shown || shown <= stage.clientWidth + 2) return [0, r.width];
  const scale = shown / r.width;               // css px per canvas unit
  const from = stage.scrollLeft / scale;
  return [from, from + stage.clientWidth / scale];
}

/**
 * The key: the five silhouettes, in order, so a stranger can read the board.
 * Its swatches sit on their own pitch, wider than the grid's, because a bush
 * and a hedge spill past the tile they stand on.
 */
export function drawLegend(r) {
  const { ctx, lawn } = r;
  const y = OY + lawn.rows * PITCH + GEOM.LEGEND_DY;
  const gap = GEOM.LEGEND_GAP;
  ctx.font = `${GEOM.LEGEND_SIZE}px ${FONT}`;
  ctx.textBaseline = 'middle';
  const wMore = ctx.measureText('more').width;
  const wLess = ctx.measureText('less').width;
  const swatches = 4 * GEOM.LEGEND_PITCH + CELL;
  // right-align to the bed, or to the visible slice of it when it scrolls,
  // so a narrow screen gets the key instead of a blank strip under the lawn
  const [visL, visR] = visibleSpan(r);
  const right = Math.max(
    visL + 8 + wLess + gap + swatches + gap + wMore,
    Math.min(OX + lawn.cols * PITCH - GAP, visR - 8),
  );
  const x0 = right - wMore - gap - swatches;
  ctx.fillStyle = PENCIL;
  ctx.fillText('less', x0 - wLess - gap, y + CELL / 2 + 1);
  ctx.fillText('more', right - wMore, y + CELL / 2 + 1);
  for (let l = 0; l <= 4; l++) {
    r.seed = l * 977 + r.boil * 17 + 3;
    const x = x0 + l * GEOM.LEGEND_PITCH;
    const fake = {
      col: l, row: 0, level: l, mowed: l === 0, mowT: l === 0 ? 1 : 0,
      count: 0, void: false, vigor: 0.5, heroic: false,
    };
    drawTile(r, x, y, fake, 2);
    drawGrass(r, x, y, fake, 2, GEOM.LEGEND_SCALE);
  }
}

/** Mon / Wed / Fri, with a paper halo, so the parked mower never hides them. */
export function drawDayLabels(r) {
  const { ctx } = r;
  ctx.font = `${GEOM.LABEL_SIZE}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.strokeStyle = PAPER;
  ['Mon', 'Wed', 'Fri'].forEach((d, i) => {
    const y = r.tileY(1 + i * 2) + CELL / 2 + 1;
    ctx.strokeText(d, GEOM.LABEL_X, y);
    ctx.fillStyle = PENCIL;
    ctx.fillText(d, GEOM.LABEL_X, y);
  });
  ctx.textBaseline = 'alphabetic';
}
