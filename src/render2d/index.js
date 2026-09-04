import {
  COLS, ROWS, MONTH_NAMES, seasonIndexOfCol, describeCell,
} from '../core/lawn.js';
import {
  INK, PAPER, CREAM, ORANGE, PENCIL, DIRT,
  tileColor, stripe, bladeColor, clipColor, mix,
} from '../core/palette.js';

// GitHub-ish geometry: square day cells with a small gap.
const CELL = 16;
const GAP = 3;
const PITCH = CELL + GAP;      // 19
const R = 3;                   // corner radius
const OX = 42;                 // grid origin: room for Mon/Wed/Fri on the left
const OY = 58;                 //              room for month labels on top
const PAD_R = 22;
const PAD_B = 66;              // legend strip
const FONT = "'Patrick Hand', cursive";

const BLADES = [0, 3, 5, 7, 10];
const HEIGHT = [0, 6, 10, 13, 17];

export class Renderer2D {
  constructor(canvas, lawn) {
    this.canvas = canvas;
    this.lawn = lawn;
    this.ctx = canvas.getContext('2d');
    this.width = OX + COLS * PITCH + PAD_R;
    this.height = OY + ROWS * PITCH + PAD_B;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    canvas.width = Math.round(this.width * dpr);
    canvas.height = Math.round(this.height * dpr);
    canvas.style.width = '100%';
    canvas.style.aspectRatio = `${this.width} / ${this.height}`;
    this.ctx.scale(dpr, dpr);

    this.boil = 0;
    this.lastBoil = 0;
    this.seed = 1;
    this.spin = 0;
    this.clippings = [];
    this.popups = [];
    this.tracks = [];
    this.puffs = [];
    this.tag = { x: 0, y: 0, text: '', life: 0 };
    this.lastTs = 0;
  }

  setLawn(lawn) { this.lawn = lawn; }

  reset() {
    this.clippings.length = 0;
    this.popups.length = 0;
    this.tracks.length = 0;
    this.puffs.length = 0;
    this.tag.life = 0;
  }

  // --- geometry ---------------------------------------------------------

  tileX(col) { return OX + col * PITCH; }
  tileY(row) { return OY + row * PITCH; }
  px(x) { return OX + x * PITCH - GAP / 2; }
  py(z) { return OY + z * PITCH - GAP / 2; }

  // --- doodle primitives ------------------------------------------------

  rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  wob(v, a) { return v + (this.rnd() - 0.5) * a; }

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

  // --- one day ----------------------------------------------------------

  /** The GitHub tile underneath the grass. */
  drawTile(x, y, cell, season) {
    const { ctx } = this;
    const under = tileColor(cell.level, season, false);
    const over = tileColor(cell.level, season, true);
    const t = cell.mowed ? Math.min(1, cell.mowT * 1.4) : 0;
    let fill = cell.level === 0 ? under : mix(under, over, t);
    if (cell.mowed && cell.level > 0 && cell.col % 2 === 0) fill = mix(fill, stripe(fill), t * 0.75);

    ctx.fillStyle = fill;
    this.roundedPath(x, y, CELL, CELL, R, 0.7);
    ctx.fill();
    ctx.strokeStyle = `rgba(44,44,42,${cell.level === 0 ? 0.3 : 0.22})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (cell.level === 0) {
      // bare dirt: a couple of pebbles. This is what gives the graph its shape.
      ctx.fillStyle = 'rgba(44,44,42,0.28)';
      for (let p = 0; p < 2; p++) {
        ctx.beginPath();
        ctx.arc(x + 4 + this.rnd() * 8, y + 5 + this.rnd() * 7, 0.9, 0, 7);
        ctx.fill();
      }
    } else if (cell.mowed && t >= 1) {
      // the cut: two faint passes across the tile
      ctx.strokeStyle = 'rgba(255,255,255,0.24)';
      ctx.lineWidth = 1;
      this.line(x + 2, y + 6, x + CELL - 2, y + 6, 0.5);
      this.line(x + 2, y + 11, x + CELL - 2, y + 11, 0.5);
    }
  }

  /** One blade, curving as it goes up. */
  blade(bx, by, h, lean, w, color) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(this.wob(bx, 0.5), by);
    ctx.quadraticCurveTo(
      this.wob(bx + lean * 0.35, 0.8), this.wob(by - h * 0.62, 0.8),
      this.wob(bx + lean, 0.6), this.wob(by - h, 0.6),
    );
    ctx.stroke();
    return [bx + lean, by - h];
  }

  /** Overgrown tuft standing on the tile, overflowing into the gaps. */
  drawGrass(x, y, cell, season, scale = 1) {
    if (cell.level === 0) return;
    const { ctx } = this;
    const shrink = cell.mowed ? Math.max(0.12, 1 - cell.mowT) : 1;
    const n = Math.max(1, Math.round(BLADES[cell.level] * (cell.mowed ? 0.5 : 1)));
    const h0 = HEIGHT[cell.level] * shrink * scale;
    if (h0 < 1.2) return;

    const cx = x + CELL / 2;
    const base = y + CELL - 1;
    const spread = (cell.level >= 3 ? CELL * 0.68 : CELL * 0.44) * scale;
    const color = bladeColor(cell.level, season);
    const w = 1.25 + cell.level * 0.22;
    ctx.lineCap = 'round';

    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1);
      const bx = cx - spread + f * spread * 2 + (this.rnd() - 0.5) * 2;
      const h = h0 * (0.72 + this.rnd() * 0.5);
      const lean = (this.rnd() - 0.5) * (5 + cell.level);
      const tip = this.blade(bx, base, h, lean, w, color);
      if (cell.level === 4 && !cell.mowed && i % 4 === 1) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(tip[0], tip[1], 1.3, 0, 7);
        ctx.fill();
      }
    }
    ctx.lineCap = 'butt';
  }

  // --- events -----------------------------------------------------------

  /** @param quiet true for the end-card confetti: clippings only, no label. */
  onMowed(indices, quiet) {
    const { lawn } = this;
    const m = lawn.mower;
    let sum = 0;
    for (const i of indices) {
      const c = lawn.cells[i];
      const season = seasonIndexOfCol(lawn, c.col);
      sum += c.count;
      const cx = this.tileX(c.col) + CELL / 2;
      const cy = this.tileY(c.row) + CELL / 2;
      const col = clipColor(c.level, season);
      const n = 2 + 2 * c.level;
      for (let k = 0; k < n; k++) {
        this.clippings.push({
          x: cx, y: cy,
          vx: (Math.random() - 0.5) * 3.4 - Math.cos(m.angle) * 1.6,
          vy: (Math.random() - 0.5) * 3.4 - Math.sin(m.angle) * 1.6,
          s: 2 + Math.random(),
          life: 16 + Math.random() * 10, max: 26,
          c: col,
        });
      }
    }
    if (quiet) return;
    const last = lawn.cells[lawn.lastMowed];
    if (last) {
      this.tag.text = describeCell(last);
      this.tag.life = 2;
      if (!this.tag.x) { this.tag.x = this.px(m.x); this.tag.y = this.py(m.z); }
    }
    if (sum > 0) {
      // stagger, so a burst of labels does not stack into one blob
      const j = this.popups.length % 3;
      this.popups.push({
        x: this.px(m.x) + (j - 1) * 20,
        y: this.py(m.z) - 10 - j * 9,
        n: sum, t: 0,
      });
    }
  }

  // --- mower ------------------------------------------------------------

  mower(dt) {
    const { ctx, lawn } = this;
    const m = lawn.mower;
    const mx = this.px(m.x);
    const my = this.py(m.z);

    // tyre tracks
    if (Math.abs(m.vel) > 0.02) {
      this.tracks.push({ x: mx, y: my, a: m.angle, life: 1 });
      if (this.tracks.length > 90) this.tracks.shift();
    }
    ctx.lineWidth = 1.4;
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const t = this.tracks[i];
      t.life -= dt * 0.7;
      if (t.life <= 0) { this.tracks.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(44,44,42,${0.13 * t.life})`;
      const nx = -Math.sin(t.a) * 5.5, ny = Math.cos(t.a) * 5.5;
      ctx.beginPath();
      ctx.moveTo(t.x + nx, t.y + ny); ctx.lineTo(t.x + nx * 1.02, t.y + ny * 1.02);
      ctx.moveTo(t.x - nx, t.y - ny); ctx.lineTo(t.x - nx * 1.02, t.y - ny * 1.02);
      ctx.stroke();
    }

    // exhaust
    if (m.acc > 0 && Math.random() < 0.4) {
      this.puffs.push({
        x: mx - Math.cos(m.angle) * 12, y: my - Math.sin(m.angle) * 12,
        r: 1.6, life: 1,
      });
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt * 1.6; p.r += dt * 14; p.y -= dt * 12;
      if (p.life <= 0) { this.puffs.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(140,138,132,${0.28 * p.life})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(m.angle);
    ctx.scale(1.85, 1.85);
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.moveTo(this.wob(-7, .5), this.wob(-6, .5));
    ctx.lineTo(this.wob(6, .5), this.wob(-6, .5));
    ctx.lineTo(this.wob(7, .5), this.wob(6, .5));
    ctx.lineTo(this.wob(-7, .5), this.wob(6, .5));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // cutting deck
    ctx.fillStyle = '#444441';
    ctx.beginPath(); ctx.arc(this.wob(9, .3), this.wob(0, .3), 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#F1EFE8'; ctx.lineWidth = 0.8;
    this.line(9 + Math.cos(this.spin) * 4, Math.sin(this.spin) * 4, 9 - Math.cos(this.spin) * 4, -Math.sin(this.spin) * 4, 0.3);
    this.line(9 + Math.cos(this.spin + 1.6) * 4, Math.sin(this.spin + 1.6) * 4, 9 - Math.cos(this.spin + 1.6) * 4, -Math.sin(this.spin + 1.6) * 4, 0.3);
    // handle
    ctx.strokeStyle = INK; ctx.lineWidth = 1.0;
    this.line(-7, -3, -16, -5, 0.4); this.line(-7, 3, -16, 5, 0.4); this.line(-16, -5, -16, 5, 0.4);
    // little face on the cab
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(1.5, -2.4, 0.8, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(1.5, 2.4, 0.8, 0, 7); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(2.4, 0, 2.6, -1.0, 1.0); ctx.stroke();
    // wheels
    ctx.fillStyle = INK;
    for (const p of [[-4, -7], [-4, 7], [5, -7], [5, 7]]) {
      ctx.beginPath(); ctx.ellipse(this.wob(p[0], .3), this.wob(p[1], .3), 2.6, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // --- overlays ---------------------------------------------------------

  drawPopups(dt) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt / 0.7;
      if (p.t >= 1) { this.popups.splice(i, 1); continue; }
      const a = p.t < 0.7 ? 1 : 1 - (p.t - 0.7) / 0.3;
      ctx.font = `26px ${FONT}`;
      ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(251,249,242,${a * 0.95})`;
      ctx.strokeText('+' + p.n, p.x, p.y - 8 - p.t * 26);
      ctx.fillStyle = `rgba(44,44,42,${a})`;
      ctx.fillText('+' + p.n, p.x, p.y - 8 - p.t * 26);
    }
    ctx.textAlign = 'left';
  }

  /** Doodle label that trails the mower with the last day it cut. */
  drawTag(dt) {
    const { ctx, lawn } = this;
    if (this.tag.life <= 0 || !this.tag.text) return;
    this.tag.life -= dt;
    const m = lawn.mower;
    const tx = this.px(m.x) + 22;
    const ty = this.py(m.z) + 20;
    this.tag.x += (tx - this.tag.x) * 0.14;
    this.tag.y += (ty - this.tag.y) * 0.14;
    const a = Math.min(1, this.tag.life * 2.5);

    ctx.font = `17px ${FONT}`;
    const w = ctx.measureText(this.tag.text).width + 18;
    const h = 24;
    let x = this.tag.x;
    const y = Math.max(4, Math.min(this.height - h - 4, this.tag.y));
    x = Math.max(4, Math.min(this.width - w - 4, x));

    ctx.globalAlpha = a;
    ctx.fillStyle = CREAM;
    this.roundedPath(x, y, w, h, 6, 0.8);
    ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.fillText(this.tag.text, x + 9, y + h / 2 + 1);
    ctx.globalAlpha = 1;
  }

  /** The key doubles as a guide to how grass maps to contribution levels. */
  drawLegend() {
    const { ctx } = this;
    const y = OY + ROWS * PITCH + 28;
    const right = OX + COLS * PITCH - GAP;
    ctx.font = `15px ${FONT}`;
    ctx.textBaseline = 'middle';
    const wMore = ctx.measureText('more').width;
    const wLess = ctx.measureText('less').width;
    const x0 = right - wMore - 16 - (4 * PITCH - GAP);
    ctx.fillStyle = PENCIL;
    ctx.fillText('less', x0 - wLess - 16, y + CELL / 2 + 1);
    ctx.fillText('more', right - wMore, y + CELL / 2 + 1);
    for (let l = 1; l <= 4; l++) {
      this.seed = l * 977 + this.boil * 17 + 3;
      const x = x0 + (l - 1) * PITCH;
      const fake = { col: l, row: 0, level: l, mowed: false, mowT: 0, count: 0 };
      this.drawTile(x, y, fake, 2);
      this.drawGrass(x, y, fake, 2, 0.8);
    }
  }

  // --- frame ------------------------------------------------------------

  draw(ts) {
    const { ctx, lawn } = this;
    const dt = Math.min(0.05, this.lastTs ? (ts - this.lastTs) / 1000 : 1 / 60);
    this.lastTs = ts;
    if (ts - this.lastBoil > 120) { this.boil++; this.lastBoil = ts; }
    this.spin += Math.abs(lawn.mower.vel) * 4 + 0.08;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, this.width, this.height);

    // month labels across the top, like GitHub
    this.seed = this.boil * 7919 + 13;
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = PENCIL;
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < lawn.monthStarts.length; i++) {
      const ms = lawn.monthStarts[i];
      const next = lawn.monthStarts[i + 1];
      // GitHub skips a month that only owns a column or two at either end
      if (((next ? next.col : COLS) - ms.col) < 3) continue;
      ctx.fillText(MONTH_NAMES[ms.month].slice(0, 3), this.tileX(ms.col), OY - 22);
    }

    // fence ticks + rule above the grid
    ctx.strokeStyle = PENCIL; ctx.lineWidth = 1.1;
    const gw = COLS * PITCH - GAP;
    for (let f = 0; f <= gw / 14; f++) this.line(OX + f * 14, OY - 16, OX + f * 14, OY - 9, 0.7);
    this.line(OX, OY - 12, OX + gw, OY - 12, 0.8);

    // dirt bed under the tiles
    ctx.fillStyle = mix(DIRT, PAPER, 0.62);
    this.roundedPath(OX - 5, OY - 5, gw + 10, ROWS * PITCH - GAP + 10, 8, 1.1);
    ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();

    // tiles first, then grass, so tufts spill over their neighbours
    for (const c of lawn.cells) {
      this.seed = (c.col * 31 + c.row * 7) * 131 + this.boil * 17 + 1;
      this.drawTile(this.tileX(c.col), this.tileY(c.row), c, seasonIndexOfCol(lawn, c.col));
    }
    for (const c of lawn.cells) {
      if (!c.level) continue;
      this.seed = (c.col * 31 + c.row * 7) * 131 + this.boil * 17 + 1;
      this.rnd(); this.rnd();
      this.drawGrass(this.tileX(c.col), this.tileY(c.row), c, seasonIndexOfCol(lawn, c.col));
    }

    // seasonal dressing, only on bare tiles so it never hides grass
    for (const c of lawn.cells) {
      if (c.level !== 0) continue;
      const s = seasonIndexOfCol(lawn, c.col);
      if (s !== 0 && s !== 3) continue;
      if ((c.col * 7 + c.row * 3) % 5 !== 0) continue;
      this.seed = (c.col * 17 + c.row * 5) * 71 + this.boil * 13 + 5;
      const cx = this.tileX(c.col) + CELL / 2;
      const cy = this.tileY(c.row) + CELL / 2;
      if (s === 0) {
        ctx.strokeStyle = '#85B7EB'; ctx.lineWidth = 1;
        this.line(cx - 3, cy, cx + 3, cy, 0.3);
        this.line(cx, cy - 3, cx, cy + 3, 0.3);
      } else {
        ctx.fillStyle = ORANGE;
        ctx.beginPath(); ctx.ellipse(cx, cy, 2.6, 1.6, 0.6, 0, 7); ctx.fill();
      }
    }

    this.mower(dt);

    // clippings on top of the lawn
    for (let i = this.clippings.length - 1; i >= 0; i--) {
      const q = this.clippings[i];
      q.x += q.vx; q.y += q.vy;
      q.vx *= 0.94; q.vy *= 0.94;
      q.life--;
      if (q.life <= 0) { this.clippings.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, q.life / 10);
      ctx.fillStyle = q.c;
      ctx.fillRect(q.x, q.y, q.s, q.s);
      ctx.globalAlpha = 1;
    }

    // weekday labels last, so the parked mower never sits on top of them
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = PENCIL;
    ctx.textBaseline = 'middle';
    ['Mon', 'Wed', 'Fri'].forEach((d, i) => {
      ctx.fillText(d, 4, this.tileY(1 + i * 2) + CELL / 2 + 1);
    });
    ctx.textBaseline = 'alphabetic';

    this.drawPopups(dt);
    this.drawTag(dt);
    this.drawLegend();
  }
}
