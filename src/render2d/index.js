// The flat lawn: a hand-drawn sketch of the contribution graph at the real
// graph's proportions. This file is the frame and the layers; the drawing
// itself lives beside it in grass.js, mower.js, weather.js and overlays.js,
// and the five silhouettes are shared with the SVG exporter through
// src/core/grass.js so the README picture is this picture.

import { MONTH_NAMES, SEASON_OF_MONTH, describeCell, seasonIndexOfCol } from '../core/lawn.js';
import { GEOM } from '../core/board.js';
import { Z } from '../core/grass.js';
import { CLIP_MAX, FONT, POPUP_MERGE, clippingCount } from '../core/effects.js';
import {
  DIRT_BY_SEASON, INK, PAPER, PENCIL, clipColor, mix,
} from '../core/palette.js';
import { Pen } from './pen.js';
import { FLASH, drawTile, grassFor2D, popScale } from './grass.js';
import { drawClippings, drawMower, drawTracks, sampleTrack } from './mower.js';
import { buildWeather, drawDressing, drawWeather, seasonGlyph } from './weather.js';
import { drawDayLabels, drawLegend, drawPopups, drawTag } from './overlays.js';

// GitHub-ish geometry: square day cells with a small gap. src/core/board.js
// owns the numbers, so the SVG exporter draws the same board.
const { CELL, GAP, PITCH, R, OX, OY, PAD_R, PAD_B } = GEOM;

/** A retina canvas is worth the pixels here: the whole look is thin ink. */
const DPR_CAP = 3;

export class Renderer2D extends Pen {
  constructor(canvas, lawn) {
    super(canvas.getContext('2d'));
    this.canvas = canvas;
    this.lastBoil = 0;
    this.spin = 0;
    this.clippings = [];
    this.popups = [];
    this.tracks = [];
    this.puffs = [];
    this.weather = [];
    this.cutAt = new Map();
    this.now = 0;
    this.tag = { x: 0, y: 0, text: '', life: 0 };
    this.lastTs = 0;
    this.setLawn(lawn);
  }

  /** Canvas size follows lawn.cols, so a 53-week year gets a wider board. */
  setLawn(lawn) {
    this.lawn = lawn;
    this.width = OX + lawn.cols * PITCH + PAD_R;
    this.height = OY + lawn.rows * PITCH + PAD_B;
    const dpr = Math.min(
      DPR_CAP, (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
    );
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = '100%';
    this.canvas.style.aspectRatio = `${this.width} / ${this.height}`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // a hedge overlaps the row above it, so the grass is drawn row by row from
    // the top down; the rows are bucketed once instead of per frame
    this.rows = Array.from({ length: lawn.rows }, () => []);
    for (let i = 0; i < lawn.cells.length; i++) {
      const c = lawn.cells[i];
      if (!c.void && c.level > 0) this.rows[c.row].push(c);
    }
    buildWeather(this);
    this.reset();
  }

  reset() {
    this.clippings.length = 0;
    this.popups.length = 0;
    this.tracks.length = 0;
    this.puffs.length = 0;
    this.cutAt.clear();
    this.tag.life = 0;
    this.tag.x = 0;
    this.tag.y = 0;
  }

  // --- geometry ---------------------------------------------------------

  tileX(col) { return OX + col * PITCH; }
  tileY(row) { return OY + row * PITCH; }
  px(x) { return OX + x * PITCH - GAP / 2; }
  py(z) { return OY + z * PITCH - GAP / 2; }

  // --- events -----------------------------------------------------------

  /** @param quiet true for the end-card confetti: clippings only, no label. */
  onMowed(indices, quiet) {
    const { lawn } = this;
    const m = lawn.mower;
    const sa = Math.sin(m.angle), ca = Math.cos(m.angle);
    // the chute sits on the mower's right, in mower-local (forward, right)
    const S = GEOM.MOWER_SCALE;
    const chuteX = this.px(m.x) + (6 * ca - 12 * sa) * S;
    const chuteY = this.py(m.z) + (6 * sa + 12 * ca) * S;
    let sum = 0;
    let heroic = false;
    for (const i of indices) {
      const c = lawn.cells[i];
      if (!c || c.void) continue;
      const season = seasonIndexOfCol(lawn, c.col);
      sum += c.count;
      if (c.heroic) heroic = true;
      this.cutAt.set(i, this.now);
      const col = clipColor(c.level, season);
      const n = clippingCount(c);
      for (let k = 0; k < n; k++) {
        this.clippings.push({
          x: chuteX, y: chuteY,
          vx: -sa * 2.6 + ca * 0.6 + (Math.random() - 0.5) * 2.4,
          vy: ca * 2.6 + sa * 0.6 + (Math.random() - 0.5) * 2.4,
          s: 2.5 + Math.random() * 1.5,
          a: Math.random() * 6.28,
          life: 22 + Math.random() * 12,
          c: col,
        });
      }
    }
    if (this.clippings.length > CLIP_MAX) {
      this.clippings.splice(0, this.clippings.length - CLIP_MAX);
    }
    if (quiet) return;
    const last = lawn.cells[lawn.lastMowed];
    if (last && !last.void) {
      this.tag.text = describeCell(last);
      this.tag.life = 2;
      if (!this.tag.x) { this.tag.x = this.px(m.x); this.tag.y = this.py(m.z); }
    }
    if (sum > 0) {
      // builder C maintains lawn.combo in tick(); a branch without it is a 0
      const combo = lawn.combo || 0;
      const top = this.popups[this.popups.length - 1];
      if (top && top.age < POPUP_MERGE) {
        top.n += sum;
        top.heroic = top.heroic || heroic;
        top.combo = Math.max(top.combo, combo);
      } else {
        const j = this.popups.length % 3;
        this.popups.push({
          x: this.px(m.x) + (j - 1) * 36,
          y: this.py(m.z) - 10 - j * 9,
          n: sum, t: 0, age: 0, heroic, combo,
        });
      }
    }
  }

  sampleTrack() { sampleTrack(this); }

  // --- frame ------------------------------------------------------------

  draw(ts) {
    const { ctx, lawn } = this;
    const dt = Math.min(0.05, this.lastTs ? (ts - this.lastTs) / 1000 : 1 / 60);
    this.lastTs = ts;
    this.now += dt;
    if (ts - this.lastBoil > 120) { this.boil++; this.lastBoil = ts; }
    this.spin += Math.abs(lawn.mower.vel) * 6 + 0.1;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawHeader();
    this.drawTiles();
    // tracks sit under the grass, so they only show where you have cut
    drawTracks(this, dt);
    this.drawTufts();
    drawDressing(this);
    drawWeather(this, dt);
    drawMower(this, dt);
    drawClippings(this);
    drawDayLabels(this);

    drawPopups(this, dt);
    drawTag(this, dt);
    drawLegend(this);
  }

  /** Month labels across the top, like GitHub, and the fence under them. */
  drawHeader() {
    const { ctx, lawn } = this;
    const cols = lawn.cols;
    this.seed = this.boil * 7919 + 13;
    ctx.font = `${GEOM.MONTH_SIZE}px ${FONT}`;
    ctx.fillStyle = PENCIL;
    ctx.textBaseline = 'alphabetic';
    let lastSeason = -1;
    for (const ms of lawn.monthStarts) {
      // GitHub skips a month that only owns a column or two at either end
      if (ms.span < 3) continue;
      const name = MONTH_NAMES[ms.month].slice(0, 3);
      const lx = this.tileX(ms.col);
      ctx.fillStyle = PENCIL;
      ctx.fillText(name, lx, OY + GEOM.MONTH_DY);
      // the first month of a season carries its little weather doodle
      const s = SEASON_OF_MONTH[ms.month];
      if (s !== lastSeason) {
        seasonGlyph(this, lx + ctx.measureText(name).width + 10, OY + GEOM.GLYPH_DY, s);
        ctx.fillStyle = PENCIL;
        lastSeason = s;
      }
    }

    // fence ticks + rule above the grid
    ctx.strokeStyle = PENCIL; ctx.lineWidth = GEOM.FENCE_W;
    const gw = cols * PITCH - GAP;
    const step = GEOM.FENCE_STEP;
    for (let f = 0; f <= gw / step; f++) {
      this.line(OX + f * step, OY + GEOM.FENCE_TOP, OX + f * step, OY + GEOM.FENCE_BOT, 0.7);
    }
    this.line(OX, OY + GEOM.FENCE_RULE, OX + gw, OY + GEOM.FENCE_RULE, 0.8);

    // dirt bed under the tiles, coloured by the climate of each column
    this.drawBed(gw, lawn.rows * PITCH - GAP);
  }

  /**
   * The bed the tiles sit in, coloured by climate: cold grey soil under the
   * winter columns, warm brown under summer, blending one column either side
   * of a season change so the year reads as a strip of ground.
   */
  drawBed(gw, gh) {
    const { ctx, lawn } = this;
    const bi = GEOM.BED_INSET;
    const x0 = OX - bi, y0 = OY - bi, w = gw + bi * 2, h = gh + bi * 2;
    const soil = (s) => mix(DIRT_BY_SEASON[s], PAPER, 0.58);

    ctx.save();
    this.roundedPath(x0, y0, w, h, GEOM.BED_R, 1.1);
    ctx.clip();
    for (let c = 0; c < lawn.cols; c++) {
      const s = seasonIndexOfCol(lawn, c);
      const prev = seasonIndexOfCol(lawn, Math.max(0, c - 1));
      ctx.fillStyle = prev === s ? soil(s) : mix(soil(prev), soil(s), 0.5);
      const bx = c === 0 ? x0 : this.tileX(c) - GAP / 2;
      const bw = (c === lawn.cols - 1 ? x0 + w : this.tileX(c + 1) - GAP / 2) - bx;
      ctx.fillRect(bx, y0, bw, h);
    }
    // the tiles are set into the bed, so the top edge catches a shadow
    ctx.fillStyle = 'rgba(44,44,42,0.08)';
    ctx.fillRect(x0, y0, w, 2);
    ctx.restore();

    this.roundedPath(x0, y0, w, h, GEOM.BED_R, 1.1);
    ctx.strokeStyle = INK; ctx.lineWidth = GEOM.BED_W; ctx.stroke();
  }

  /** Every tile, popping and flashing where the mower has just been. */
  drawTiles() {
    const { ctx, lawn } = this;
    for (let i = 0; i < lawn.cells.length; i++) {
      const c = lawn.cells[i];
      this.seedCell(c.col, c.row);
      const x = this.tileX(c.col);
      const y = this.tileY(c.row);
      const at = this.cutAt.get(i);
      const age = at === undefined ? -1 : this.now - at;
      if (age > FLASH) { this.cutAt.delete(i); }
      // the reveal pops: the clean GitHub tile arrives 12% oversized
      const pop = popScale(age);
      if (pop !== 1) {
        ctx.save();
        ctx.translate(x + CELL / 2, y + CELL / 2);
        ctx.scale(pop, pop);
        ctx.translate(-x - CELL / 2, -y - CELL / 2);
      }
      drawTile(this, x, y, c, seasonIndexOfCol(lawn, c.col));
      // ...and flashes for a moment, so you see what you just took
      if (age >= 0 && age <= FLASH) {
        ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - age / FLASH)})`;
        this.roundedPath(x, y, CELL, CELL, R, 0.7);
        ctx.fill();
      }
      if (pop !== 1) ctx.restore();
    }
  }

  /**
   * The grass, row 0..6 top to bottom, so a hedge overlaps the row above it.
   * Within a row every layer is drawn across the whole row before the next
   * one starts, which is exactly how the exporter batches its <path>s: same
   * stacking, same picture.
   */
  drawTufts() {
    const { ctx, lawn } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const row of this.rows) {
      const bag = [];
      for (const c of row) {
        this.seedCell(c.col, c.row);
        this.rnd(); this.rnd();          // the tile's own pebbles ate these
        bag.push(grassFor2D(
          this, this.tileX(c.col), this.tileY(c.row), c, seasonIndexOfCol(lawn, c.col),
        ));
      }
      for (let z = Z.SHADOW; z <= Z.ACCENT; z++) {
        for (const ops of bag) this.drawOps(ops, z);
      }
    }
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }
}
