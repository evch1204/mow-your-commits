import {
  MONTH_NAMES, SEASON_GLYPH, SEASON_OF_MONTH, seasonIndexOfCol, describeCell,
  hash, lcgStep, lcgFloat,
} from '../core/lawn.js';
import { GEOM, SPREAD } from '../core/board.js';
import { CLIP_MAX, FONT, POPUP_MERGE, clippingCount } from '../core/effects.js';
import {
  INK, PAPER, CREAM, ORANGE, PENCIL, SUN, AUTUMN_BLADE, FLOWERS,
  DANDELION, FLUFF, DIRT_BY_SEASON, PETAL,
  tileColor, stripe, bladeColor, clipColor, cellTint, grassFor, mix,
} from '../core/palette.js';

// GitHub-ish geometry: square day cells with a small gap. src/core/board.js
// owns the numbers, so the SVG exporter draws the same board.
const { CELL, GAP, PITCH, R, OX, OY, PAD_R, PAD_B } = GEOM;

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
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = '100%';
    this.canvas.style.aspectRatio = `${this.width} / ${this.height}`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.buildWeather();
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

  // --- doodle primitives ------------------------------------------------

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
    const under = tileColor(cell.level, season, false, cell.vigor || 0);
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
      // bare dirt: a couple of pebbles and, here and there, a dry crack.
      // This is what gives the graph its shape where nothing was committed.
      ctx.fillStyle = 'rgba(44,44,42,0.28)';
      for (let p = 0; p < 2; p++) {
        ctx.beginPath();
        ctx.arc(x + 4 + this.rnd() * 8, y + 5 + this.rnd() * 7, 0.9, 0, 7);
        ctx.fill();
      }
      if ((cell.col + cell.row) % 3 === 0) {
        ctx.strokeStyle = 'rgba(44,44,42,0.18)'; ctx.lineWidth = 1;
        const cx = x + 3 + this.rnd() * 6;
        const cy = y + 4 + this.rnd() * 6;
        this.line(cx, cy, cx + 5, cy + 3, 1.2);
      }
    } else if (cell.mowed && t >= 1) {
      // the cut: two faint passes across the tile
      ctx.strokeStyle = 'rgba(255,255,255,0.24)';
      ctx.lineWidth = 1;
      this.line(x + 2, y + 6, x + CELL - 2, y + 6, 0.5);
      this.line(x + 2, y + 11, x + CELL - 2, y + 11, 0.5);
    }

    // winter: snow settles along the top edge instead of washing the whole tile
    if (season === 0 && !cell.mowed && cell.level > 0) {
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x + 1.5, y + 1, CELL - 3, 2.5);
      ctx.globalAlpha = 1;
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

  /**
   * Overgrown tuft standing on the tile, overflowing into the gaps.
   * Blade count, height and stroke all come from the day's own count via
   * `vigor`, so a 40-contribution day is visibly rowdier than a 12.
   */
  drawGrass(x, y, cell, season, scale = 1) {
    if (cell.void || cell.level === 0) return;
    const { ctx } = this;
    const shrink = cell.mowed ? Math.max(0.12, 1 - cell.mowT) : 1;
    const g = grassFor(cell.level, cell.vigor || 0);
    const n = Math.max(1, Math.round(g.blades * (cell.mowed ? 0.5 : 1)));
    const h0 = g.height * shrink * scale;
    if (h0 < 1.2) return;

    const cx = x + CELL / 2;
    const base = y + CELL - 1;
    const spread = SPREAD(cell.level) * scale;
    const color = cellTint(bladeColor(cell.level, season), cell.col, cell.row);
    const dark = mix(color, INK, 0.25);
    const bias = (hash(cell.col) - 0.5) * 4;    // the whole patch leans together
    ctx.lineCap = 'round';

    // lay the blades out first, so the two tallest can get a darker tip
    const blades = [];
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1);
      blades.push({
        bx: cx - spread + f * spread * 2 + (this.rnd() - 0.5) * 2,
        h: h0 * (0.8 + this.rnd() * 0.4),
        lean: bias + (this.rnd() - 0.5) * (5 + cell.level),
        turned: season === 3 && this.rnd() < 0.15,
        tall: false,
      });
    }
    if (cell.level >= 3) {
      [...blades].sort((a, b) => b.h - a.h).slice(0, 2).forEach((b) => { b.tall = true; });
    }

    for (let i = 0; i < blades.length; i++) {
      const b = blades[i];
      const c = b.turned ? AUTUMN_BLADE : color;
      const tip = this.blade(b.bx, base, b.h, b.lean, g.width, c);
      if (b.tall && !b.turned) {
        // the top third of the tallest blades falls into shadow
        ctx.strokeStyle = dark; ctx.lineWidth = g.width;
        ctx.beginPath();
        ctx.moveTo(tip[0] - b.lean * 0.22, tip[1] + b.h * 0.3);
        ctx.lineTo(tip[0], tip[1]);
        ctx.stroke();
      }
      if (cell.level === 4 && !cell.mowed && i % 4 === 1) {
        ctx.fillStyle = b.turned ? AUTUMN_BLADE : color;
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

    // the best days of the year put up a dandelion and a seed-head puff
    if (cell.heroic && !cell.mowed && season !== 0) {
      const st = h0 + 5;
      for (let d = 0; d < 2; d++) {
        const dx = cx + (d ? 4.5 : -4) + (this.rnd() - 0.5) * 2;
        const top = base - st * (d ? 0.82 : 1);
        ctx.strokeStyle = INK; ctx.lineWidth = 1;
        this.line(dx, base, dx + bias * 0.4, top, 0.6);
        if (d === 0) {
          ctx.fillStyle = DANDELION;
          ctx.beginPath(); ctx.arc(dx + bias * 0.4, top, 2.4, 0, 7); ctx.fill();
          ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
        } else {
          ctx.fillStyle = FLUFF;
          ctx.beginPath(); ctx.arc(dx + bias * 0.4, top, 2.2, 0, 7); ctx.fill();
          ctx.strokeStyle = INK; ctx.lineWidth = 0.6;
          for (let k = 0; k < 4; k++) {
            const a = k * 1.57 + 0.4;
            ctx.beginPath();
            ctx.moveTo(dx + bias * 0.4 + Math.cos(a) * 1.6, top + Math.sin(a) * 1.6);
            ctx.lineTo(dx + bias * 0.4 + Math.cos(a) * 3.4, top + Math.sin(a) * 3.4);
            ctx.stroke();
          }
        }
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
      const top = this.popups[this.popups.length - 1];
      if (top && top.age < POPUP_MERGE) {
        top.n += sum;
        top.heroic = top.heroic || heroic;
      } else {
        const j = this.popups.length % 3;
        this.popups.push({
          x: this.px(m.x) + (j - 1) * 36,
          y: this.py(m.z) - 10 - j * 9,
          n: sum, t: 0, age: 0, heroic,
        });
      }
    }
  }

  /**
   * Twin tyre tracks, sampled every few pixels of travel and drawn under the
   * grass, so they only show where the lawn has actually been cut.
   */
  /** Drop a track sample if the mower has moved far enough since the last one. */
  sampleTrack() {
    const m = this.lawn.mower;
    const mx = this.px(m.x), my = this.py(m.z);
    const tail = this.tracks[this.tracks.length - 1];
    if (tail && Math.hypot(mx - tail.x, my - tail.y) <= 3) return;
    this.tracks.push({ x: mx, y: my, a: m.angle, life: 1 });
    if (this.tracks.length > 160) this.tracks.shift();
  }

  drawTracks(dt) {
    const { ctx } = this;
    this.sampleTrack();
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const t = this.tracks[i];
      t.life -= dt / 4;
      if (t.life <= 0) { this.tracks.splice(i, 1); continue; }
      const p = this.tracks[i - 1];
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
    const S = GEOM.MOWER_SCALE;

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
    ctx.fillStyle = '#615F58';
    this.box(0, -9.5, 12, 19, 3);
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

  /** A bigger day gets a bigger number; the best days get an exclamation. */
  drawPopups(dt) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += dt;
      p.t += dt / 0.8;
      if (p.t >= 1) { this.popups.splice(i, 1); continue; }
      const a = p.t < 0.7 ? 1 : 1 - (p.t - 0.7) / 0.3;
      const label = '+' + p.n + (p.heroic ? '!' : '');
      const y = p.y - 8 - p.t * 30;
      ctx.font = `${Math.round(22 + Math.min(16, p.n * 0.45))}px ${FONT}`;
      ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(251,249,242,${a * 0.95})`;
      ctx.strokeText(label, p.x, y);
      ctx.globalAlpha = a;
      if (p.n >= 25) {
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

  /**
   * The slice of the board that is actually on screen, in canvas units. On a
   * phone the board is wider than the stage and scrolls sideways, so anything
   * pinned to the far edge of the bed sits off screen.
   */
  visibleSpan() {
    const stage = this.canvas.parentElement;
    const shown = this.canvas.clientWidth;
    if (!stage || !shown || shown <= stage.clientWidth + 2) return [0, this.width];
    const scale = shown / this.width;               // css px per canvas unit
    const from = stage.scrollLeft / scale;
    return [from, from + stage.clientWidth / scale];
  }

  /** The key doubles as a guide to how grass maps to contribution levels. */
  drawLegend() {
    const { ctx, lawn } = this;
    const y = OY + lawn.rows * PITCH + GEOM.LEGEND_DY;
    const gap = GEOM.LEGEND_GAP;
    ctx.font = `${GEOM.LEGEND_SIZE}px ${FONT}`;
    ctx.textBaseline = 'middle';
    const wMore = ctx.measureText('more').width;
    const wLess = ctx.measureText('less').width;
    const swatches = 5 * PITCH - GAP;
    // right-align to the bed, or to the visible slice of it when it scrolls,
    // so a narrow screen gets the key instead of a blank strip under the lawn
    const [visL, visR] = this.visibleSpan();
    const right = Math.max(
      visL + 8 + wLess + gap + swatches + gap + wMore,
      Math.min(OX + lawn.cols * PITCH - GAP, visR - 8),
    );
    const x0 = right - wMore - gap - swatches;
    ctx.fillStyle = PENCIL;
    ctx.fillText('less', x0 - wLess - gap, y + CELL / 2 + 1);
    ctx.fillText('more', right - wMore, y + CELL / 2 + 1);
    for (let l = 0; l <= 4; l++) {
      this.seed = l * 977 + this.boil * 17 + 3;
      const x = x0 + l * PITCH;
      const fake = {
        col: l, row: 0, level: l, mowed: l === 0, mowT: l === 0 ? 1 : 0,
        count: 0, void: false, vigor: 0.5, heroic: false,
      };
      this.drawTile(x, y, fake, 2);
      this.drawGrass(x, y, fake, 2, GEOM.LEGEND_SCALE);
    }
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

  /** A 10px doodle for the season a month belongs to. */
  seasonGlyph(x, y, season) {
    const { ctx } = this;
    const kind = SEASON_GLYPH[season];
    if (kind === 'snow') {
      ctx.strokeStyle = '#85B7EB'; ctx.lineWidth = 1.1;
      for (let k = 0; k < 3; k++) {
        const a = k * 1.047 + 0.3;
        this.line(x - Math.cos(a) * 4, y - Math.sin(a) * 4,
          x + Math.cos(a) * 4, y + Math.sin(a) * 4, 0.5);
      }
    } else if (kind === 'flower') {
      for (let k = 0; k < 5; k++) {
        const a = k * 1.257;
        ctx.fillStyle = PETAL[k % 2];
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * 2.8, y + Math.sin(a) * 2.8, 1.6, 0, 7); ctx.fill();
      }
      ctx.fillStyle = DANDELION;
      ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 7); ctx.fill();
    } else if (kind === 'sun') {
      ctx.fillStyle = SUN;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 0.9;
      for (let k = 0; k < 8; k++) {
        const a = k * 0.785;
        this.line(x + Math.cos(a) * 5, y + Math.sin(a) * 5,
          x + Math.cos(a) * 7, y + Math.sin(a) * 7, 0.4);
      }
    } else {
      ctx.fillStyle = ORANGE;
      ctx.beginPath(); ctx.ellipse(x, y, 6, 3.5, -0.4, 0, 7); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1;
      this.line(x - 5, y + 2, x + 5, y - 2, 0.4);
    }
  }

  // --- the year's weather, laid out over its own columns -----------------

  /**
   * One persistent particle pool per season, each confined to the columns
   * that season actually owns, so the whole year's climate is on screen at
   * once: snow over winter, petals over spring, fluff over summer, leaves
   * over autumn.
   */
  buildWeather() {
    const { lawn } = this;
    this.weather = [];
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
      const total = rs.reduce((a, r) => a + (r[1] - r[0]), 0);
      if (!total) continue;                       // a season with no columns
      for (let i = 0; i < COUNT[s]; i++) {
        let t = Math.random() * total;
        let run = rs[0];
        for (const r of rs) { t -= r[1] - r[0]; if (t <= 0) { run = r; break; } }
        this.weather.push({
          s, i,
          x0: this.tileX(run[0]) - GAP / 2,
          x1: this.tileX(run[1]) - GAP / 2,
          x: 0, y: 0, r: 0, a: Math.random() * 6.28,
        });
        this.respawn(this.weather[this.weather.length - 1], true);
      }
    }
  }

  respawn(p, anywhere) {
    const { lawn } = this;
    const top = OY - 14;
    const bottom = OY + lawn.rows * PITCH - GAP + 6;
    p.x = p.x0 + Math.random() * Math.max(1, p.x1 - p.x0);
    if (p.s === 2) p.y = anywhere ? top + Math.random() * (bottom - top) : bottom;
    else p.y = anywhere ? top + Math.random() * (bottom - top) : top;
    p.r = p.s === 0 ? 1.2 + Math.random() * 1 : p.s === 1 ? 1.4 : p.s === 2 ? 1.3 : 1;
    p.a = Math.random() * 6.28;
  }

  drawWeather(dt) {
    const { ctx, lawn } = this;
    if (typeof document !== 'undefined' && document.hidden) return;
    const top = OY - 14;
    const bottom = OY + lawn.rows * PITCH - GAP + 6;
    const LEAF = [ORANGE, '#EF9F27', AUTUMN_BLADE];
    for (const p of this.weather) {
      if (p.s === 0) {
        p.y += 14 * dt;
        p.x += Math.sin(this.now * 1.1 + p.i) * 0.35;
        if (p.y > bottom) this.respawn(p);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      } else if (p.s === 1) {
        p.y += 8 * dt;
        p.x += Math.sin(this.now * 0.9 + p.i) * 0.4;
        if (p.y > bottom) this.respawn(p);
        ctx.fillStyle = PETAL[p.i % 2];
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      } else if (p.s === 2) {
        p.y -= 6 * dt;                                  // fluff rises
        p.x += Math.sin(this.now * 0.8 + p.i) * 0.3;
        if (p.y < top) this.respawn(p);
        ctx.fillStyle = FLUFF;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(44,44,42,0.5)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(p.x, p.y + p.r); ctx.lineTo(p.x, p.y + p.r + 2.4); ctx.stroke();
      } else {
        p.y += 10 * dt;
        p.a += 2 * dt;
        p.x += Math.sin(this.now * 1.3 + p.i) * 0.5;
        if (p.y > bottom) this.respawn(p);
        ctx.fillStyle = LEAF[p.i % 3];
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 3, 1.8, p.a, 0, 7); ctx.fill();
      }
      if (p.x < p.x0 - 4) p.x = p.x1;
      if (p.x > p.x1 + 4) p.x = p.x0;
    }

    // summer air shimmers just above the top row
    const summer = this.weather.find((p) => p.s === 2);
    if (summer) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      for (const dy of [0, 3]) {
        this.line(summer.x0, OY - 7 + dy, summer.x1, OY - 7 + dy, 1.5);
      }
    }
  }

  // --- frame ------------------------------------------------------------

  draw(ts) {
    const { ctx, lawn } = this;
    const cols = lawn.cols;
    const dt = Math.min(0.05, this.lastTs ? (ts - this.lastTs) / 1000 : 1 / 60);
    this.lastTs = ts;
    this.now += dt;
    if (ts - this.lastBoil > 120) { this.boil++; this.lastBoil = ts; }
    this.spin += Math.abs(lawn.mower.vel) * 6 + 0.1;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, this.width, this.height);

    // month labels across the top, like GitHub
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
        this.seasonGlyph(lx + ctx.measureText(name).width + 10, OY + GEOM.GLYPH_DY, s);
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

    // tiles first, then grass, so tufts spill over their neighbours
    for (let i = 0; i < lawn.cells.length; i++) {
      const c = lawn.cells[i];
      this.seed = (c.col * 31 + c.row * 7) * 131 + this.boil * 17 + 1;
      this.drawTile(this.tileX(c.col), this.tileY(c.row), c, seasonIndexOfCol(lawn, c.col));
      // a fresh cut flashes for a moment, so you see what you just took
      const at = this.cutAt.get(i);
      if (at !== undefined) {
        const age = this.now - at;
        if (age > 1.2) { this.cutAt.delete(i); continue; }
        ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - age / 1.2)})`;
        this.roundedPath(this.tileX(c.col), this.tileY(c.row), CELL, CELL, R, 0.7);
        ctx.fill();
      }
    }

    // tracks sit under the grass, so they only show where you have cut
    this.drawTracks(dt);

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

    this.drawWeather(dt);
    this.mower(dt);

    // clippings tumbling out of the chute
    for (let i = this.clippings.length - 1; i >= 0; i--) {
      const q = this.clippings[i];
      q.x += q.vx; q.y += q.vy;
      q.vx *= 0.94; q.vy *= 0.94;
      q.a += 0.2;
      q.life--;
      if (q.life <= 0) { this.clippings.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, q.life / 10);
      ctx.fillStyle = q.c;
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.a);
      ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s * 0.7);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // weekday labels last, with a paper halo, so the parked mower never hides them
    ctx.font = `${GEOM.LABEL_SIZE}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.strokeStyle = PAPER;
    ['Mon', 'Wed', 'Fri'].forEach((d, i) => {
      const y = this.tileY(1 + i * 2) + CELL / 2 + 1;
      ctx.strokeText(d, GEOM.LABEL_X, y);
      ctx.fillStyle = PENCIL;
      ctx.fillText(d, GEOM.LABEL_X, y);
    });
    ctx.textBaseline = 'alphabetic';

    this.drawPopups(dt);
    this.drawTag(dt);
    this.drawLegend();
  }
}
