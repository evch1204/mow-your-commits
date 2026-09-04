import * as THREE from 'three';
import {
  COLS, ROWS, MONTH_NAMES, SEASONS, SEASON_OF_MONTH,
  seasonIndexOfCol, monthAt,
} from '../core/lawn.js';
import {
  INK, CREAM, DIRT, tileColor, stripe, bladeColor, clipColor,
} from '../core/palette.js';

const FONT = "'Patrick Hand', cursive";

// Four tuft builds so a level-4 week is a hedge and a level-1 week is sprouts.
const TUFT_BLADES = [3, 5, 8, 12];
const TUFT_HEIGHT = [0.35, 0.6, 0.9, 1.25];
const MOWED_SCALE = 0.18;

// world x = cell x - COLS/2, world z = cell z - ROWS/2
const wx = (x) => x - COLS / 2;
const wz = (z) => z - ROWS / 2;

const BOIL = (k) => `
transformed += ${k.toFixed(3)} * vec3(
  sin(position.y * 9.0 + position.z * 3.0 + uSeed), 0.0,
  cos(position.x * 7.0 + position.y * 4.0 + uSeed * 1.7));
`;

const SWAY = `
#ifdef USE_INSTANCING
  vec3 iw = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ys = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
#else
  vec3 iw = vec3(0.0);
  float ys = 1.0;
#endif
float sw = sin(uTime * 1.6 + iw.x * 0.7 + iw.z * 0.4) * transformed.y * transformed.y * 0.12 * ys;
transformed.x += sw;
transformed.z += sw * 0.5;
`;

/** N tapered, 3-segment blades in a ring. Normals point up so cel shading stays flat. */
function tuftGeometry(blades, height, seed) {
  let s = seed;
  const rnd = () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
  const SEG = 3;
  const pos = [];
  const idx = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd() * 0.9;
    const r = 0.05 + rnd() * 0.3;
    const x0 = Math.cos(a) * r, z0 = Math.sin(a) * r;
    const h = height * (0.65 + rnd() * 0.6);
    const lean = 0.12 + rnd() * 0.34;
    const lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
    const w0 = 0.05 + rnd() * 0.025;
    const px = -Math.sin(a), pz = Math.cos(a);
    const base = pos.length / 3;
    for (let g = 0; g <= SEG; g++) {
      const t = g / SEG;
      const bend = t * t;
      const cx = x0 + lx * bend, cz = z0 + lz * bend;
      const w = w0 * (1 - t * 0.9);
      pos.push(cx - px * w, h * t, cz - pz * w);
      pos.push(cx + px * w, h * t, cz + pz * w);
    }
    for (let g = 0; g < SEG; g++) {
      const a0 = base + g * 2;
      idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  geo.setIndex(idx);
  return geo;
}

export class Renderer3D {
  constructor(canvas, lawn) {
    this.canvas = canvas;
    this.lawn = lawn;
    this.shaders = [];
    this.seedVal = 0;
    this.lastBoil = 0;
    this.time = 0;
    this.clippings = [];
    this.popups = [];
    this.anim = new Set();
    this.camMode = 0;   // 0 chase, 1 overview
    this.camBlend = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SEASONS[3].sky);
    this.skyTarget = new THREE.Color(SEASONS[3].sky);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.camera.position.set(wx(-9), 6, wz(ROWS / 2));
    this.lookAt = new THREE.Vector3(0, 0.5, 0);
    this.resize();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa0b080, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(6, 14, 10);
    this.scene.add(sun);

    // three-step gradient map = cel shading
    const grad = new THREE.DataTexture(
      new Uint8Array([120, 120, 120, 255, 205, 205, 205, 255, 255, 255, 255, 255]),
      3, 1, THREE.RGBAFormat,
    );
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.needsUpdate = true;
    this.grad = grad;
    this.inkMat = this.wobbly(new THREE.MeshBasicMaterial({ color: 0x2c2c2a, side: THREE.BackSide }));

    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();

    this.buildGround();
    this.buildTiles();
    this.buildGrass();
    this.buildFence();
    this.buildWeather();
    this.buildMower();
    this.applyLawn();
  }

  // --- doodle helpers --------------------------------------------------

  /** Per-vertex jitter that re-seeds a few times per second ("boiling"). */
  wobbly(mat, opts = {}) {
    const boil = opts.boil === undefined ? 0.025 : opts.boil;
    mat.onBeforeCompile = (s) => {
      s.uniforms.uSeed = { value: 0 };
      s.uniforms.uTime = { value: 0 };
      s.vertexShader = 'uniform float uSeed;\nuniform float uTime;\n' + s.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' + (opts.sway ? SWAY : '') + BOIL(boil),
      );
      this.shaders.push(s);
    };
    return mat;
  }

  toon(hex) {
    return this.wobbly(new THREE.MeshToonMaterial({ color: hex, gradientMap: this.grad }));
  }

  /** Mesh + inverted-hull outline. */
  inked(geo, mat, scale = 1.07) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    const o = new THREE.Mesh(geo, this.inkMat);
    o.scale.setScalar(scale);
    g.add(o);
    return g;
  }

  canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  sprite(tex, x, y, z, s) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    sp.position.set(x, y, z);
    sp.scale.set(s, s, 1);
    this.scene.add(sp);
    return sp;
  }

  // --- scene ------------------------------------------------------------

  buildGround() {
    const base = this.inked(new THREE.BoxGeometry(COLS + 1.6, 0.7, ROWS + 1.5), this.toon(DIRT), 1.015);
    base.position.y = -0.35;
    this.scene.add(base);
  }

  /** One instanced rounded-ish box per day. Gaps show the dirt, so the grid reads. */
  buildTiles() {
    const geo = new THREE.BoxGeometry(0.86, 0.14, 0.86);
    const mat = this.wobbly(new THREE.MeshToonMaterial({ gradientMap: this.grad }), { boil: 0.008 });
    this.tiles = new THREE.InstancedMesh(geo, mat, COLS * ROWS);
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.tiles);
  }

  buildGrass() {
    const mat = this.wobbly(new THREE.MeshToonMaterial({
      gradientMap: this.grad, side: THREE.DoubleSide,
    }), { sway: true, boil: 0.012 });
    this.grassMat = mat;
    this.grass = [];
    for (let l = 0; l < 4; l++) {
      const geo = tuftGeometry(TUFT_BLADES[l], TUFT_HEIGHT[l], 7919 + l * 131);
      const im = new THREE.InstancedMesh(geo, mat, COLS * ROWS);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.frustumCulled = false;
      this.scene.add(im);
      this.grass.push(im);
    }
    this.slotOf = new Int16Array(COLS * ROWS);
  }

  buildFence() {
    this.fenceZ = wz(-1.7);
    const wood = this.toon(0x8b6b43);
    this.wood = wood;
    for (let f = 0; f <= COLS; f += 4) {
      const post = this.inked(new THREE.BoxGeometry(0.22, 1.3, 0.22), wood, 1.12);
      post.position.set(wx(f), 0.65, this.fenceZ);
      this.scene.add(post);
    }
    for (const y of [0.5, 1.0]) {
      const rail = this.inked(new THREE.BoxGeometry(COLS + 0.4, 0.12, 0.12), wood, 1.08);
      rail.position.set(0, y, this.fenceZ);
      this.scene.add(rail);
    }
    this.signs = [];
    const build = () => this.buildSigns();
    build();
    if (document.fonts && document.fonts.load) document.fonts.load(`64px ${FONT}`).then(build, () => {});
  }

  buildSigns() {
    for (const s of this.signs) this.scene.remove(s);
    this.signs = [];
    for (const ms of this.lawn.monthStarts) {
      const x = wx(ms.col + 2.1);
      const tex = this.canvasTexture(256, 256, (g) => {
        g.clearRect(0, 0, 256, 256);
        g.fillStyle = CREAM; g.fillRect(8, 72, 240, 112);
        g.lineWidth = 8; g.strokeStyle = INK; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(14, 76); g.lineTo(244, 74); g.lineTo(242, 182); g.lineTo(12, 180); g.closePath(); g.stroke();
        g.fillStyle = INK; g.font = `64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(MONTH_NAMES[ms.month].slice(0, 3), 128, 130);
      });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      pl.position.set(x, 1.9, this.fenceZ - 0.05);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), this.wood);
      st.position.set(x, 1.2, this.fenceZ - 0.1);
      this.scene.add(pl, st);
      this.signs.push(pl, st);
    }
  }

  buildWeather() {
    const fz = this.fenceZ;
    const sunTex = this.canvasTexture(128, 128, (g) => {
      g.lineWidth = 6; g.strokeStyle = INK; g.fillStyle = '#FAC775';
      g.beginPath(); g.arc(64, 64, 30, 0, 7); g.fill(); g.stroke();
      for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28; g.beginPath(); g.moveTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40); g.lineTo(64 + Math.cos(a + 0.15) * 58, 64 + Math.sin(a + 0.15) * 58); g.stroke(); }
    });
    const cloudTex = this.canvasTexture(128, 128, (g) => {
      g.lineWidth = 6; g.strokeStyle = INK; g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(40, 74, 22, 0, 7); g.arc(66, 58, 28, 0, 7); g.arc(92, 76, 22, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.fillRect(30, 72, 70, 22);
    });
    const treeTex = this.canvasTexture(128, 128, (g) => {
      g.lineWidth = 6; g.strokeStyle = INK; g.lineCap = 'round';
      g.beginPath(); g.moveTo(64, 124); g.lineTo(64, 60); g.moveTo(64, 86); g.lineTo(38, 54); g.moveTo(64, 74); g.lineTo(92, 40); g.moveTo(64, 60); g.lineTo(52, 24); g.stroke();
    });

    // Find column ranges for each season so props land in the right place.
    const ranges = [[], [], [], []];
    for (let x = 0; x < COLS; x++) ranges[SEASON_OF_MONTH[this.lawn.monthOfCol[x]]].push(x);
    const mid = (r) => (r.length ? wx(r[Math.floor(r.length / 2)]) : 0);
    const span = (r) => (r.length ? [wx(r[0]), wx(r[r.length - 1] + 1)] : [0, 1]);

    this.sun = this.sprite(sunTex, mid(ranges[2]), 7, fz - 9, 5);
    this.sprite(cloudTex, mid(ranges[1]) - 3, 6, fz - 8, 4.5);
    this.sprite(cloudTex, mid(ranges[1]) + 3, 5.2, fz - 7, 3.5);
    for (const dx of [-3, 1, 4]) this.sprite(treeTex, mid(ranges[1]) + dx, 2.2, fz - 3, 4.5);

    const [w0, w1] = span(ranges[0]);
    const n = 160;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = w0 + Math.random() * (w1 - w0); pos[i * 3 + 1] = Math.random() * 8; pos[i * 3 + 2] = fz - 6 + Math.random() * 12; }
    this.snowGeo = new THREE.BufferGeometry();
    this.snowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(this.snowGeo, new THREE.PointsMaterial({ color: 0x85b7eb, size: 3, sizeAttenuation: false, depthWrite: false })));

    const [a0, a1] = span(ranges[3]);
    this.leaves = [];
    const leafGeo = new THREE.PlaneGeometry(0.28, 0.18);
    for (let l = 0; l < 36; l++) {
      const lm = new THREE.Mesh(leafGeo, new THREE.MeshBasicMaterial({ color: [0xd85a30, 0xef9f27, 0xba7517][l % 3], side: THREE.DoubleSide }));
      lm.position.set(a0 + Math.random() * (a1 - a0), Math.random() * 6, fz - 4 + Math.random() * 10);
      lm.userData.v = 0.01 + Math.random() * 0.02;
      this.scene.add(lm);
      this.leaves.push(lm);
    }
  }

  buildMower() {
    const g = new THREE.Group();
    const body = this.inked(new THREE.BoxGeometry(0.95, 0.42, 1.25), this.toon(0xd85a30), 1.08);
    body.position.y = 0.42; g.add(body);
    const cab = this.inked(new THREE.BoxGeometry(0.7, 0.36, 0.55), this.toon(0xfac775), 1.1);
    cab.position.set(0, 0.8, -0.2); g.add(cab);
    const head = this.inked(new THREE.SphereGeometry(0.17, 10, 8), this.toon(0xf5c4b3), 1.12);
    head.position.set(0, 1.12, -0.2); g.add(head);

    // a tiny ink face, because everything here is a doodle
    const faceTex = this.canvasTexture(64, 64, (ctx) => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(24, 26, 4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(42, 26, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(33, 34, 11, 0.35, Math.PI - 0.35); ctx.stroke();
    });
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false }),
    );
    face.position.set(0, 1.13, -0.02);
    g.add(face);

    this.deck = this.inked(new THREE.CylinderGeometry(0.58, 0.58, 0.14, 16), this.toon(0x444441), 1.08);
    this.deck.position.set(0, 0.2, 0.55); g.add(this.deck);
    const wg = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 12); wg.rotateZ(Math.PI / 2);
    this.wheels = [];
    for (const p of [[-0.5, 0.2, -0.4], [0.5, 0.2, -0.4], [-0.5, 0.2, 0.45], [0.5, 0.2, 0.45]]) {
      const w = this.inked(wg, this.toon(0x2c2c2a), 1.1);
      w.position.set(p[0], p[1], p[2]); g.add(w); this.wheels.push(w);
    }
    this.mower = g;
    this.tilt = 0;
    this.scene.add(g);
    this.clipGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    this.clipMats = new Map();
  }

  // --- lawn sync --------------------------------------------------------

  cellScaleY(c) {
    if (!c.mowed) return 1;
    const e = Math.min(1, c.mowT);
    const squash = Math.sin(Math.PI * e) * 0.16;
    return Math.max(0.06, 1 + (MOWED_SCALE - 1) * ease(e) - squash);
  }

  setCell(i) {
    const c = this.lawn.cells[i];
    const d = this.dummy;
    const season = seasonIndexOfCol(this.lawn, c.col);
    const col = this.tmpColor;

    // tile
    d.position.set(wx(c.col + 0.5), 0.07, wz(c.row + 0.5));
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    this.tiles.setMatrixAt(i, d.matrix);
    let tc = tileColor(c.level, season, c.mowed && c.mowT > 0.35);
    if (c.mowed && c.level > 0 && c.col % 2 === 0 && c.mowT > 0.35) tc = stripe(tc);
    col.set(tc);
    this.tiles.setColorAt(i, col);

    // grass
    if (c.level > 0) {
      const mesh = this.grass[c.level - 1];
      const slot = this.slotOf[i];
      const ys = this.cellScaleY(c);
      const xz = 1 + Math.sin(Math.PI * Math.min(1, c.mowT)) * (c.mowed ? 0.22 : 0);
      d.position.set(wx(c.col + 0.5), 0.14, wz(c.row + 0.5));
      d.rotation.set(0, c.rot, 0);
      d.scale.set(xz, ys, xz);
      d.updateMatrix();
      mesh.setMatrixAt(slot, d.matrix);
      col.set(c.mowed ? tileColor(c.level, season, true) : bladeColor(c.level, season));
      mesh.setColorAt(slot, col);
    }
  }

  /** Call after createLawn / resetLawn / setLawn to push all cells to the GPU. */
  applyLawn() {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < this.lawn.cells.length; i++) {
      const l = this.lawn.cells[i].level;
      this.slotOf[i] = l > 0 ? counts[l - 1]++ : -1;
    }
    for (let l = 0; l < 4; l++) this.grass[l].count = counts[l];
    for (let i = 0; i < this.lawn.cells.length; i++) this.setCell(i);
    this.anim.clear();
    this.flagDirty();
  }

  setLawn(lawn) {
    this.lawn = lawn;
    this.buildSigns();
    this.applyLawn();
  }

  reset() {
    for (const c of this.clippings) this.scene.remove(c);
    this.clippings.length = 0;
    for (const p of this.popups) this.scene.remove(p.sp);
    this.popups.length = 0;
    this.applyLawn();
  }

  flagDirty() {
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    for (const m of this.grass) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  clipMat(hex) {
    let m = this.clipMats.get(hex);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex) }); this.clipMats.set(hex, m); }
    return m;
  }

  /** @param quiet true for the end-card confetti: clippings only, no label. */
  onMowed(indices, quiet) {
    const m = this.lawn.mower;
    let sum = 0;
    for (const i of indices) {
      const c = this.lawn.cells[i];
      const season = seasonIndexOfCol(this.lawn, c.col);
      sum += c.count;
      this.anim.add(i);
      this.setCell(i);
      const mat = this.clipMat(clipColor(c.level, season));
      const n = 3 + 2 * c.level;
      for (let k = 0; k < n; k++) {
        const cm = new THREE.Mesh(this.clipGeo, mat);
        cm.position.set(wx(c.col + 0.5), 0.35, wz(c.row + 0.5));
        cm.userData.v = new THREE.Vector3(
          (Math.random() - 0.5) * 0.14 - Math.cos(m.angle) * 0.07,
          0.09 + Math.random() * 0.07,
          (Math.random() - 0.5) * 0.14 - Math.sin(m.angle) * 0.07,
        );
        cm.userData.life = 28;
        this.scene.add(cm);
        this.clippings.push(cm);
      }
    }
    if (sum > 0 && !quiet) this.spawnPopup(sum);
    if (indices.length) this.flagDirty();
  }

  spawnPopup(n) {
    const tex = this.canvasTexture(256, 128, (g) => {
      g.clearRect(0, 0, 256, 128);
      g.font = `84px ${FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.lineJoin = 'round';
      g.strokeStyle = '#FBF9F2'; g.strokeText('+' + n, 128, 66);
      g.fillStyle = INK; g.fillText('+' + n, 128, 64);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    const m = this.lawn.mower;
    const jitter = (this.popups.length % 3) - 1;
    sp.position.set(wx(m.x) - Math.sin(m.angle) * jitter * 0.9, 2.1 + jitter * 0.25, wz(m.z) + Math.cos(m.angle) * jitter * 0.9);
    sp.scale.set(2.4, 1.2, 1);
    sp.renderOrder = 10;
    this.scene.add(sp);
    this.popups.push({ sp, t: 0 });
    if (this.popups.length > 8) {
      const old = this.popups.shift();
      this.scene.remove(old.sp);
      old.sp.material.map.dispose();
      old.sp.material.dispose();
    }
  }

  // --- camera -----------------------------------------------------------

  toggleCamera() { this.camMode = this.camMode ? 0 : 1; return this.camMode; }
  setCamera(mode) { this.camMode = mode === 'overview' ? 1 : 0; }

  // --- frame -------------------------------------------------------------

  resize() {
    const w = this.canvas.clientWidth || 720;
    const h = this.canvas.clientHeight || 440;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  draw(ts) {
    const { lawn, mower } = this;
    const m = lawn.mower;
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 1 / 60;
    this.lastTs = ts;
    this.time += dt;

    if (ts - this.lastBoil > 110) { this.seedVal += 1.7; this.lastBoil = ts; }
    for (const s of this.shaders) {
      s.uniforms.uSeed.value = this.seedVal;
      s.uniforms.uTime.value = this.time;
    }

    // cells still playing their mow animation
    if (this.anim.size) {
      for (const i of Array.from(this.anim)) {
        this.setCell(i);
        if (lawn.cells[i].mowT >= 1) this.anim.delete(i);
      }
      this.flagDirty();
    }

    // mower pose. lawn heading (cos a, sin a) in (x, z) -> three rotation.y = pi/2 - a
    mower.position.set(wx(m.x), Math.abs(Math.sin(ts * 0.02)) * Math.abs(m.vel) * 0.25, wz(m.z));
    mower.rotation.y = Math.PI / 2 - m.angle;
    this.tilt += (m.acc * 18 - this.tilt) * 0.15;
    mower.rotation.x = -this.tilt;
    for (const w of this.wheels) w.rotation.x += m.vel * 4;
    this.deck.rotation.y += Math.abs(m.vel) * 2 + 0.04;

    // clippings
    for (let i = this.clippings.length - 1; i >= 0; i--) {
      const c = this.clippings[i];
      c.position.add(c.userData.v);
      c.userData.v.y -= 0.008;
      c.rotation.x += 0.2; c.rotation.z += 0.15;
      if (--c.userData.life <= 0) { this.scene.remove(c); this.clippings.splice(i, 1); }
    }

    // +N popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt / 0.9;
      p.sp.position.y += dt * 1.5;
      p.sp.material.opacity = p.t < 0.6 ? 1 : Math.max(0, 1 - (p.t - 0.6) / 0.4);
      if (p.t >= 1) {
        this.scene.remove(p.sp);
        p.sp.material.map.dispose();
        p.sp.material.dispose();
        this.popups.splice(i, 1);
      }
    }

    // weather
    const pos = this.snowGeo.attributes.position.array;
    for (let s = 0; s < pos.length / 3; s++) {
      pos[s * 3 + 1] -= 0.02;
      pos[s * 3] += Math.sin(ts * 0.002 + s) * 0.005;
      if (pos[s * 3 + 1] < 0) pos[s * 3 + 1] = 8;
    }
    this.snowGeo.attributes.position.needsUpdate = true;
    this.leaves.forEach((lf, i) => {
      lf.position.y -= lf.userData.v;
      lf.position.x += Math.sin(ts * 0.003 + i) * 0.01;
      lf.rotation.x += 0.03; lf.rotation.z += 0.02;
      if (lf.position.y < 0.1) lf.position.y = 6;
    });
    this.sun.material.rotation += 0.004;

    // sky follows the month under the mower
    this.skyTarget.set(SEASONS[SEASON_OF_MONTH[monthAt(lawn, m.x)]].sky);
    this.scene.background.lerp(this.skyTarget, this.snapped ? 0.03 : 1);

    // camera: chase <-> overview, blended so it feels like one camera
    this.camBlend += (this.camMode - this.camBlend) * (this.snapped ? Math.min(1, dt * 3.4) : 1);
    const b = this.camBlend;
    const cx = wx(m.x) - Math.cos(m.angle) * 8.2;
    const cz = wz(m.z) - Math.sin(m.angle) * 8.2;
    const ox = 0, oy = 17, oz = 21;
    const tx = cx + (ox - cx) * b;
    const ty = 6.4 + (oy - 6.4) * b;
    const tz = cz + (oz - cz) * b;
    const cam = this.camera;
    // snap on the very first frame, otherwise a single-frame render (or a
    // headless screenshot) would show the camera still flying in
    const s = this.snapped ? Math.min(1, dt * 4.5) : 1;
    this.snapped = true;
    cam.position.x += (tx - cam.position.x) * s;
    cam.position.y += (ty - cam.position.y) * s;
    cam.position.z += (tz - cam.position.z) * s;

    const lx = wx(m.x) + Math.cos(m.angle) * 3.4;
    const lz = wz(m.z) + Math.sin(m.angle) * 3.4;
    this.lookAt.x += (lx + (0 - lx) * b - this.lookAt.x) * s;
    this.lookAt.y += (0.1 + (0 - 0.1) * b - this.lookAt.y) * s;
    this.lookAt.z += (lz + (0 - lz) * b - this.lookAt.z) * s;
    cam.lookAt(this.lookAt);

    this.renderer.render(this.scene, cam);
  }

  dispose() { this.renderer.dispose(); }
}

function ease(t) { return t * t * (3 - 2 * t); }
