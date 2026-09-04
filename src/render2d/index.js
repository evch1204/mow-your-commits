import { COLS, ROWS, MONTH_NAMES, seasonOfCol, SEASON_OF_MONTH } from '../core/lawn.js';

const CW = 12;   // cell width px
const CH = 22;   // cell height px
const OX = 28;   // grid origin
const OY = 64;
const FONT = "'Patrick Hand', cursive";

export class Renderer2D {
  constructor(canvas, lawn) {
    this.canvas = canvas;
    this.lawn = lawn;
    this.ctx = canvas.getContext('2d');
    this.width = OX * 2 + COLS * CW;
    this.height = OY + ROWS * CH + 44;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = this.width * dpr;
    canvas.height = this.height * dpr;
    canvas.style.width = '100%';
    canvas.style.aspectRatio = `${this.width} / ${this.height}`;
    this.ctx.scale(dpr, dpr);
    this.boil = 0;
    this.lastBoil = 0;
    this.seed = 1;
    this.spin = 0;
    this.clippings = [];
  }

  setLawn(lawn) { this.lawn = lawn; }

  onMowed(indices) {
    const m = this.lawn.mower;
    for (const i of indices) {
      const c = this.lawn.cells[i];
      const cx = OX + c.col * CW + CW / 2;
      const cy = OY + c.row * CH + CH / 2;
      for (let k = 0; k < 3; k++) {
        this.clippings.push({
          x: cx, y: cy,
          vx: (Math.random() - 0.5) * 2 - Math.sin(m.angle) * 2,
          vy: (Math.random() - 0.5) * 2 + Math.cos(m.angle) * 2,
          life: 14,
        });
      }
    }
  }

  rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  wob(v, a) { return v + (this.rnd() - 0.5) * a; }

  line(x1, y1, x2, y2, a) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(this.wob(x1, a), this.wob(y1, a));
    ctx.quadraticCurveTo(this.wob((x1 + x2) / 2, a * 1.5), this.wob((y1 + y2) / 2, a * 1.5), this.wob(x2, a), this.wob(y2, a));
    ctx.stroke();
  }

  tuft(cx, cy, level, color) {
    const { ctx } = this;
    const n = level;
    const h = 4 + level * 3;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    for (let i = 0; i < n; i++) {
      const bx = n === 1 ? cx : cx - 4 + i * (8 / (n - 1));
      const lean = (this.rnd() - 0.5) * 5;
      this.line(bx, cy, bx + lean, cy - h - this.rnd() * 3, 0.6);
    }
  }

  stubble(cx, cy, color) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    this.line(cx - 4, cy - 2, cx + 4, cy - 2, 0.5);
    this.line(cx - 3, cy, cx + 3, cy, 0.5);
  }

  mower() {
    const { ctx, lawn } = this;
    const m = lawn.mower;
    ctx.save();
    ctx.translate(OX + m.x * CW, OY + m.z * CH);
    ctx.rotate(m.angle);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#2C2C2A';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#D85A30';
    ctx.beginPath();
    ctx.moveTo(this.wob(-7, .6), this.wob(-6, .6));
    ctx.lineTo(this.wob(6, .6), this.wob(-6, .6));
    ctx.lineTo(this.wob(7, .6), this.wob(6, .6));
    ctx.lineTo(this.wob(-7, .6), this.wob(6, .6));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#444441';
    ctx.beginPath(); ctx.arc(this.wob(9, .4), this.wob(0, .4), 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#F1EFE8'; ctx.lineWidth = 1;
    this.line(9 + Math.cos(this.spin) * 4, Math.sin(this.spin) * 4, 9 - Math.cos(this.spin) * 4, -Math.sin(this.spin) * 4, 0.3);
    ctx.strokeStyle = '#2C2C2A'; ctx.lineWidth = 1.6;
    this.line(-7, -3, -16, -5, 0.5); this.line(-7, 3, -16, 5, 0.5); this.line(-16, -5, -16, 5, 0.5);
    ctx.fillStyle = '#2C2C2A';
    for (const p of [[-4, -7], [-4, 7], [5, -7], [5, 7]]) {
      ctx.beginPath(); ctx.ellipse(this.wob(p[0], .4), this.wob(p[1], .4), 2.6, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  draw(ts) {
    const { ctx, lawn } = this;
    if (ts - this.lastBoil > 120) { this.boil++; this.lastBoil = ts; }
    this.seed = this.boil * 7919 + 13;
    this.spin += Math.abs(lawn.mower.vel) * 3 + 0.08;

    ctx.clearRect(0, 0, this.width, this.height);

    // month labels + fence rule
    ctx.font = `13px ${FONT}`; ctx.fillStyle = '#5F5E5A'; ctx.textBaseline = 'top';
    for (const ms of lawn.monthStarts) ctx.fillText(MONTH_NAMES[ms.month].slice(0, 3), OX + ms.col * CW + 1, 42);
    ctx.strokeStyle = '#888780'; ctx.lineWidth = 1.2;
    for (let f = 0; f <= COLS * CW / 10; f++) this.line(OX + f * 10, OY - 10, OX + f * 10, OY - 3, 0.7);
    this.line(OX, OY - 7, OX + COLS * CW, OY - 7, 0.8);

    ctx.textBaseline = 'middle'; ctx.fillStyle = '#888780'; ctx.font = `12px ${FONT}`;
    ['Mon', 'Wed', 'Fri'].forEach((d, i) => ctx.fillText(d, 2, OY + (1 + i * 2) * CH + CH / 2));

    // ground
    for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = seasonOfCol(lawn, x).ground;
      ctx.fillRect(OX + x * CW, OY, CW, ROWS * CH);
    }
    ctx.strokeStyle = '#5F5E5A'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(this.wob(OX - 2, 1), this.wob(OY - 2, 1));
    ctx.lineTo(this.wob(OX + COLS * CW + 2, 1), this.wob(OY - 2, 1));
    ctx.lineTo(this.wob(OX + COLS * CW + 2, 1), this.wob(OY + ROWS * CH + 2, 1));
    ctx.lineTo(this.wob(OX - 2, 1), this.wob(OY + ROWS * CH + 2, 1));
    ctx.closePath(); ctx.stroke();

    // cells
    for (const c of lawn.cells) {
      this.seed = (c.col * 31 + c.row * 7) * 131 + this.boil * 17 + 1;
      const cx = OX + c.col * CW + CW / 2;
      const cy = OY + c.row * CH + CH - 4;
      const season = seasonOfCol(lawn, c.col);
      const sIdx = SEASON_OF_MONTH[lawn.monthOfCol[c.col]];
      if (c.level === 0) {
        ctx.fillStyle = '#D3D1C7';
        ctx.beginPath(); ctx.arc(cx + this.wob(0, 2), cy - 4 + this.wob(0, 2), 1, 0, 7); ctx.fill();
      } else if (c.mowed && c.mowT >= 1) {
        this.stubble(cx, cy, lighten(season.grass));
      } else {
        this.tuft(cx, cy, c.level, c.level >= 4 ? '#27500A' : season.grass);
      }
      if (sIdx === 3 && c.row === 3 && c.col % 5 === 0) {
        ctx.fillStyle = '#D85A30';
        ctx.beginPath(); ctx.ellipse(cx + 3, cy - 10, 2.5, 1.5, 0.6, 0, 7); ctx.fill();
      }
      if (sIdx === 0 && c.col % 3 === 0 && c.row % 2 === 0) {
        ctx.strokeStyle = '#85B7EB'; ctx.lineWidth = 1;
        this.line(cx - 2, cy - 12, cx + 2, cy - 12, 0.3); this.line(cx, cy - 14, cx, cy - 10, 0.3);
      }
    }

    // clippings
    ctx.fillStyle = '#97C459';
    for (let i = this.clippings.length - 1; i >= 0; i--) {
      const q = this.clippings[i];
      q.x += q.vx; q.y += q.vy; q.life--;
      ctx.fillRect(q.x, q.y, 2, 2);
      if (q.life <= 0) this.clippings.splice(i, 1);
    }

    this.mower();

    // legend
    ctx.font = `12px ${FONT}`; ctx.fillStyle = '#888780'; ctx.textBaseline = 'top';
    ctx.fillText('less', OX + COLS * CW - 106, OY + ROWS * CH + 8);
    for (let l = 1; l <= 4; l++) { this.seed = l * 9 + this.boil; this.tuft(OX + COLS * CW - 74 + l * 14, OY + ROWS * CH + 22, l, l === 4 ? '#27500A' : '#639922'); }
    ctx.fillText('more', OX + COLS * CW - 4, OY + ROWS * CH + 8);
  }
}

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 50);
  const g = Math.min(255, ((n >> 8) & 255) + 50);
  const b = Math.min(255, (n & 255) + 50);
  return `rgb(${r},${g},${b})`;
}
