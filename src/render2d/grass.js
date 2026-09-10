// One day: the GitHub tile underneath, and the silhouette standing on it.
//
// The shapes themselves live in src/core/grass.js as drawing instructions, so
// this file only decides *when* a day is drawn and replays the result. The SVG
// exporter walks the same instructions in the same order.

import { GEOM } from '../core/board.js';
import { Z, grassOps } from '../core/grass.js';
import { mix, stripe, tileColor } from '../core/palette.js';

const { CELL, R } = GEOM;

/** The tile pops when the mower reveals it: 1.12 -> 1 over 0.3 seconds. */
export const POP = 0.3;
/** ...and flashes white for a moment longer, so you see what you just took. */
export const FLASH = 1.2;

export function popScale(age) {
  if (!(age >= 0) || age >= POP) return 1;
  const t = 1 - age / POP;
  return 1 + 0.12 * t * t;
}

/** The GitHub tile underneath the grass. Void cells are drawn as nothing. */
export function drawTile(pen, x, y, cell, season) {
  if (cell.void) return;
  const { ctx } = pen;
  const under = tileColor(cell.level, season, false, cell.vigor || 0);
  const over = tileColor(cell.level, season, true);
  const t = cell.mowed ? Math.min(1, cell.mowT * 1.4) : 0;
  let fill = cell.level === 0 ? under : mix(under, over, t);
  if (cell.mowed && cell.level > 0 && cell.col % 2 === 0) {
    fill = mix(fill, stripe(fill), t * 0.75);
  }

  ctx.fillStyle = fill;
  pen.roundedPath(x, y, CELL, CELL, R, 0.7);
  ctx.fill();
  ctx.strokeStyle = `rgba(44,44,42,${cell.level === 0 ? 0.3 : 0.22})`;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (cell.level === 0) {
    // bare dirt: a couple of pebbles and, here and there, a dry crack.
    // This is what gives the graph its shape where nothing was committed.
    ctx.fillStyle = 'rgba(44,44,42,0.28)';
    for (let p = 0; p < 2; p++) {
      ctx.beginPath();
      ctx.arc(x + 4 + pen.rnd() * 8, y + 5 + pen.rnd() * 7, 0.9, 0, 7);
      ctx.fill();
    }
    if ((cell.col + cell.row) % 3 === 0) {
      ctx.strokeStyle = 'rgba(44,44,42,0.18)'; ctx.lineWidth = 1;
      const cx = x + 3 + pen.rnd() * 6;
      const cy = y + 4 + pen.rnd() * 6;
      pen.line(cx, cy, cx + 5, cy + 3, 1.2);
    }
  } else if (cell.mowed && t >= 1) {
    // the cut: two faint passes across the tile
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 1;
    pen.line(x + 2, y + 6, x + CELL - 2, y + 6, 0.5);
    pen.line(x + 2, y + 11, x + CELL - 2, y + 11, 0.5);
  }

  // winter: snow settles along the top edge instead of washing the whole tile
  if (season === 0 && !cell.mowed && cell.level > 0) {
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x + 1.5, y + 1, CELL - 3, 2.5);
    ctx.globalAlpha = 1;
  }
}

/** What this day grows, as ops. `scale` is 1 on the board; the legend differs. */
export function grassFor2D(pen, x, y, cell, season, scale = 1) {
  return grassOps(cell, x, y, season, {
    rnd: () => pen.rnd(),
    scale,
    mowT: cell.mowed ? Math.min(1, cell.mowT) : 0,
  });
}

/**
 * Draw one day's grass on its own, for the legend. On the board the renderer
 * batches a whole row by layer instead, so a hedge's fill covers the outline
 * of the bush beside it exactly the way the exported SVG stacks them.
 */
export function drawGrass(pen, x, y, cell, season, scale = 1) {
  const ops = grassFor2D(pen, x, y, cell, season, scale);
  pen.ctx.lineCap = 'round';
  pen.ctx.lineJoin = 'round';
  for (let z = Z.SHADOW; z <= Z.ACCENT; z++) pen.drawOps(ops, z);
  pen.ctx.lineCap = 'butt';
  pen.ctx.lineJoin = 'miter';
}
