// The hand that draws everything else: a jitter stream and the four wobbly
// primitives the whole flat renderer is built out of, plus the replay of the
// drawing instructions src/core/grass.js hands back.
//
// Renderer2D extends this, and every other module in src/render2d takes the
// renderer as its "pen", so nothing has to thread `ctx` and a seed by hand.

import { lcgFloat, lcgStep } from '../core/lawn.js';

export class Pen {
  constructor(ctx) {
    this.ctx = ctx;
    this.seed = 1;
    this.boil = 0;
  }

  /**
   * The shared jitter stream, stepped by hand: every tile re-seeds it (so a
   * doodle is stable for a tile within a boil frame), which a fresh `rng`
   * closure per tile per frame would only do by allocating one.
   */
  rnd() {
    this.seed = lcgStep(this.seed);
    return lcgFloat(this.seed);
  }

  wob(v, a) { return v + (this.rnd() - 0.5) * a; }

  /** Re-seed for one cell, so its doodle holds still between boil frames. */
  seedCell(col, row, salt = 1) {
    this.seed = (col * 31 + row * 7) * 131 + this.boil * 17 + salt;
  }

  line(x1, y1, x2, y2, a) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(this.wob(x1, a), this.wob(y1, a));
    ctx.quadraticCurveTo(
      this.wob((x1 + x2) / 2, a * 1.5), this.wob((y1 + y2) / 2, a * 1.5),
      this.wob(x2, a), this.wob(y2, a),
    );
    ctx.stroke();
  }

  /** Wobbly rounded rectangle path (not stroked or filled). */
  roundedPath(x, y, w, h, r, a) {
    const { ctx } = this;
    const W = (v) => this.wob(v, a);
    ctx.beginPath();
    ctx.moveTo(W(x + r), W(y));
    ctx.lineTo(W(x + w - r), W(y));
    ctx.quadraticCurveTo(x + w, y, W(x + w), W(y + r));
    ctx.lineTo(W(x + w), W(y + h - r));
    ctx.quadraticCurveTo(x + w, y + h, W(x + w - r), W(y + h));
    ctx.lineTo(W(x + r), W(y + h));
    ctx.quadraticCurveTo(x, y + h, W(x), W(y + h - r));
    ctx.lineTo(W(x), W(y + r));
    ctx.quadraticCurveTo(x, y, W(x + r), W(y));
    ctx.closePath();
  }

  /** Plain (non-wobbly) rounded rect, for the mower's machined parts. */
  box(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Replay one layer of a cell's grass ops. The SVG exporter walks the same
   * list in the same order, which is the whole reason the ops exist.
   */
  drawOps(ops, z) {
    const { ctx } = this;
    for (const op of ops) {
      if (op.z !== z) continue;
      if (op.alpha != null && op.alpha < 1) ctx.globalAlpha = op.alpha;
      if (op.t === 'oval') {
        ctx.beginPath();
        ctx.ellipse(op.x, op.y, Math.abs(op.rx), Math.abs(op.ry), 0, 0, 7);
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.w; ctx.stroke(); }
      } else {
        ctx.beginPath();
        for (const seg of op.d) {
          if (seg[0] === 'M') ctx.moveTo(seg[1], seg[2]);
          else if (seg[0] === 'L') ctx.lineTo(seg[1], seg[2]);
          else if (seg[0] === 'Q') ctx.quadraticCurveTo(seg[1], seg[2], seg[3], seg[4]);
          else ctx.closePath();
        }
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
        if (op.stroke && op.w > 0) {
          ctx.strokeStyle = op.stroke; ctx.lineWidth = op.w; ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }
}
