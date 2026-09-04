import { MONTH_NAMES, seasonIndexOfCol, describeCell } from '../core/lawn.js';
import {
  INK, PAPER, CREAM, ORANGE, PENCIL, DIRT, AUTUMN_BLADE, FLOWERS,
  tileColor, stripe, bladeColor, clipColor, mix,
} from '../core/palette.js';

// GitHub-ish geometry: square day cells with a small gap.
const CELL = 16;
const GAP = 3;
const PITCH = CELL + GAP;      // 19
const R = 3;                   // corner radius
const OX = 48;                 // grid origin: room for Mon/Wed/Fri on the left
const OY = 58;                 //              room for month labels on top
const PAD_R = 22;
const PAD_B = 66;              // legend strip
const FONT = "'Patrick Hand', cursive";

const BLADES = [0, 3, 5, 7, 10];
const HEIGHT = [0, 6, 10, 13, 17];

export class Renderer2D {
  constructor(canvas, lawn) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
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
    this.setLawn(lawn);
  }

  /** Canvas size follows lawn.cols, so a 53-week year gets a wider board. */
  setLawn(lawn) {
    this.lawn = lawn;
    this.width = OX + lawn.cols * PITCH + PAD_R;
    this.height = OY + lawn.rows * PITCH + PAD_B;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = '100%';
    this.canvas.style.aspectRatio = `${this.width} / ${this.height}`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.reset();
  }

  reset() {
    this.clippings.length = 0;
    this.popups.length = 0;
    this.tracks.length = 0;
    this.puffs.length = 0;
    this.tag.life = 0;
    this.tag.x = 0;
    this.tag.y = 0;
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

  // --- one day ----------------------------------------------------------

  /** The GitHub tile underneath the grass. Void cells are drawn as nothing. */
  drawTile(x, y, cell, season) {
    if (cell.void) return;
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

  /** One blade, curving as it goes up. Returns its tip. */
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
    if (cell.void || cell.level === 0) return;
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
      // a few autumn blades have turned
      const turned = season === 3 && this.rnd() < 0.15;
      const tip = this.blade(bx, base, h, lean, w, turned ? AUTUMN_BLADE : color);
      if (cell.level === 4 && !cell.mowed && i % 4 === 1) {
        ctx.fillStyle = turned ? AUTUMN_BLADE : color;
        ctx.beginPath();
        ctx.arc(tip[0], tip[1], 1.3, 0, 7);
        ctx.fill();
      }
      // snow settles on the tallest winter blades
      if (season === 0 && cell.level >= 3 && !cell.mowed && i % 3 === 0) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(tip[0], tip[1] - 0.4, 1.5, 0, 7);
        ctx.fill();
      }
    }

    // spring puts a couple of flowers in the thin grass
    if (season === 1 && cell.level <= 2 && !cell.mowed) {
      for (let f = 0; f < 2; f++) {
        ctx.fillStyle = FLOWERS[Math.floor(this.rnd() * FLOWERS.length)];
        ctx.beginPath();
        ctx.arc(cx + (this.rnd() - 0.5) * CELL * 0.7, base - 2 - this.rnd() * h0, 1.5, 0, 7);
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
      if (!c || c.void) continue;
      const season = seasonIndexOfCol(lawn, c.col);
      sum += c.count;
      // clippings come out of the chute, on the mower's right
      const cx = this.tileX(c.col) + CELL / 2;
      const cy = this.tileY(c.row) + CELL / 2;
      const col = clipColor(c.level, season);
      const n = 2 + 2 * c.level;
      for (let k = 0; k < n; k++) {
        this.clippings.push({
          x: cx, y: cy,
          vx: (Math.random() - 0.5) * 2.4 - Math.sin(m.angle) * 2.4,
          vy: (Math.random() - 0.5) * 2.4 + Math.cos(m.angle) * 2.4,
          s: 2 + Math.random(),
          life: 16 + Math.random() * 10,
          c: col,
        });
      }
    }
    if (quiet) return;
    const last = lawn.cells[lawn.lastMowed];
    if (last && !last.void) {
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

  /**
   * A riding mower seen from above: wide deck with a side chute, small front
   * wheels, big rear wheels, seat and driver. Same silhouette as the 3D one.
   * Local space: +x is forward, +y is the mower's right.
   */
  mower(dt) {
    const { ctx, lawn } = this;
    const m = lawn.mower;
    const mx = this.px(m.x);
    const my = this.py(m.z);
    const S = 1.25;

    // tyre tracks from the rear wheels
    if (Math.abs(m.vel) > 0.02) {
      this.tracks.push({ x: mx, y: my, a: m.angle, life: 1 });
      if (this.tracks.length > 90) this.tracks.shift();
    }
    ctx.lineWidth = 2;
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const t = this.tracks[i];
      t.life -= dt * 0.7;
      if (t.life <= 0) { this.tracks.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(44,44,42,${0.13 * t.life})`;
      const nx = -Math.sin(t.a) * 10, ny = Math.cos(t.a) * 10;
      ctx.beginPath();
      ctx.moveTo(t.x + nx, t.y + ny); ctx.lineTo(t.x + nx * 1.02, t.y + ny * 1.02);
      ctx.moveTo(t.x - nx, t.y - ny); ctx.lineTo(t.x - nx * 1.02, t.y - ny * 1.02);
      ctx.stroke();
    }

    // exhaust, back left
    if (m.acc > 0 && Math.random() < 0.45) {
      this.puffs.push({
        x: mx - Math.cos(m.angle) * 11 + Math.sin(m.angle) * 6,
        y: my - Math.sin(m.angle) * 11 - Math.cos(m.angle) * 6,
        r: 1.6, life: 1,
      });
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt * 1.6; p.r += dt * 14; p.y -= dt * 12;
      if (p.life <= 0) { this.puffs.splice(i, 1); continue; }
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
    ctx.fillStyle = '#4A4A46';
    this.box(-1, -10, 13, 20, 3);
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
      ctx.moveTo(6 + Math.cos(this.spin + o) * 6.5, Math.sin(this.spin + o) * 6.5);
      ctx.lineTo(6 - Math.cos(this.spin + o) * 6.5, -Math.sin(this.spin + o) * 6.5);
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
    this.box(-4.5, -6.5, 12, 13, 3.5);
    ctx.fill(); ink(1.5); ctx.stroke();
    ctx.fillStyle = '#2C2C2A';
    this.box(5.6, -4.5, 1.8, 9, 0.8); ctx.fill();          // grille
    ctx.fillStyle = CREAM;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(4.4, s * 5, 1.2, 0, 7); ctx.fill();
      ink(0.8); ctx.stroke();
    }

    // rear body / fender plate
    ctx.fillStyle = '#C24E27';
    this.box(-13, -7.5, 9, 15, 3);
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
    this.box(-12.5, -4.5, 7, 9, 2);
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
    const x = Math.max(4, Math.min(this.width - w - 4, this.tag.x));
    const y = Math.max(4, Math.min(this.height - h - 4, this.tag.y));

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
    const { ctx, lawn } = this;
    const y = OY + lawn.rows * PITCH + 28;
    const right = OX + lawn.cols * PITCH - GAP;
    ctx.font = `15px ${FONT}`;
    ctx.textBaseline = 'middle';
    const wMore = ctx.measureText('more').width;
    const wLess = ctx.measureText('less').width;
    const x0 = right - wMore - 26 - (4 * PITCH - GAP);
    ctx.fillStyle = PENCIL;
    ctx.fillText('less', x0 - wLess - 26, y + CELL / 2 + 1);
    ctx.fillText('more', right - wMore, y + CELL / 2 + 1);
    for (let l = 1; l <= 4; l++) {
      this.seed = l * 977 + this.boil * 17 + 3;
      const x = x0 + (l - 1) * PITCH;
      const fake = { col: l, row: 0, level: l, mowed: false, mowT: 0, count: 0, void: false };
      this.drawTile(x, y, fake, 2);
      this.drawGrass(x, y, fake, 2, 1.3);
    }
  }

  // --- frame ------------------------------------------------------------

  draw(ts) {
    const { ctx, lawn } = this;
    const cols = lawn.cols;
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
    for (const ms of lawn.monthStarts) {
      // GitHub skips a month that only owns a column or two at either end
      if (ms.span < 3) continue;
      ctx.fillText(MONTH_NAMES[ms.month].slice(0, 3), this.tileX(ms.col), OY - 22);
    }

    // fence ticks + rule above the grid
    ctx.strokeStyle = PENCIL; ctx.lineWidth = 1.1;
    const gw = cols * PITCH - GAP;
    for (let f = 0; f <= gw / 14; f++) this.line(OX + f * 14, OY - 16, OX + f * 14, OY - 9, 0.7);
    this.line(OX, OY - 12, OX + gw, OY - 12, 0.8);

    // dirt bed under the tiles
    ctx.fillStyle = mix(DIRT, PAPER, 0.62);
    this.roundedPath(OX - 5, OY - 5, gw + 10, lawn.rows * PITCH - GAP + 10, 8, 1.1);
    ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.stroke();

    // tiles first, then grass, so tufts spill over their neighbours
    for (const c of lawn.cells) {
      this.seed = (c.col * 31 + c.row * 7) * 131 + this.boil * 17 + 1;
      this.drawTile(this.tileX(c.col), this.tileY(c.row), c, seasonIndexOfCol(lawn, c.col));
    }
    for (const c of lawn.cells) {
      if (c.void || !c.level) continue;
      this.seed = (c.col * 31 + c.row * 7) * 131 + this.boil * 17 + 1;
      this.rnd(); this.rnd();
      this.drawGrass(this.tileX(c.col), this.tileY(c.row), c, seasonIndexOfCol(lawn, c.col));
    }

    // seasonal dressing, only on bare tiles so it never hides grass
    for (const c of lawn.cells) {
      if (c.void || c.level !== 0) continue;
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

    // weekday labels last, with a paper halo, so the parked mower never hides them
    ctx.font = `15px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.strokeStyle = PAPER;
    ['Mon', 'Wed', 'Fri'].forEach((d, i) => {
      const y = this.tileY(1 + i * 2) + CELL / 2 + 1;
      ctx.strokeText(d, 4, y);
      ctx.fillStyle = PENCIL;
      ctx.fillText(d, 4, y);
    });
    ctx.textBaseline = 'alphabetic';

    this.drawPopups(dt);
    this.drawTag(dt);
    this.drawLegend();
  }
}
