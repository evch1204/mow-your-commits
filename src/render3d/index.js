import * as THREE from 'three';
import { COLS, ROWS, MONTH_NAMES, SEASONS, SEASON_OF_MONTH, seasonOfCol, monthAt } from '../core/lawn.js';

const FONT = "'Patrick Hand', cursive";
const LEVEL_HEIGHT = [0, 0.4, 0.6, 0.85, 1.1];
const MOWED_HEIGHT = 0.22;

// world x = cell x - COLS/2, world z = cell z - ROWS/2
const wx = (x) => x - COLS / 2;
const wz = (z) => z - ROWS / 2;

export class Renderer3D {
  constructor(canvas, lawn) {
    this.canvas = canvas;
    this.lawn = lawn;
    this.shaders = [];
    this.seedVal = 0;
    this.lastBoil = 0;
    this.clippings = [];

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SEASONS[3].sky);
    this.skyTarget = new THREE.Color(SEASONS[3].sky);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 300);
    this.camera.position.set(wx(-8), 5, 0);
    this.resize();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa0b080, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(6, 14, 10);
    this.scene.add(sun);

    // three-step gradient map = cel shading
    const grad = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.needsUpdate = true;
    this.grad = grad;
    this.inkMat = this.wobbly(new THREE.MeshBasicMaterial({ color: 0x2c2c2a, side: THREE.BackSide }));

    this.buildGround();
    this.buildGrass();
    this.buildFence();
    this.buildWeather();
    this.buildMower();
    this.applyLawn();
  }

  // --- doodle helpers --------------------------------------------------

  /** Per-vertex jitter that re-seeds a few times per second ("boiling"). */
  wobbly(mat) {
    mat.onBeforeCompile = (s) => {
      s.uniforms.uSeed = { value: 0 };
      s.vertexShader = 'uniform float uSeed;\n' + s.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed += 0.025 * vec3(sin(position.y*9.0+position.z*3.0+uSeed), 0.0, cos(position.x*7.0+position.y*4.0+uSeed*1.7));',
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

  canvasTexture(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'));
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
    const base = this.inked(new THREE.BoxGeometry(COLS + 3, 0.6, ROWS + 3), this.toon(0x9c7a52), 1.02);
    base.position.y = -0.3;
    this.scene.add(base);
    this.colMats = [];
    for (let x = 0; x < COLS; x++) {
      const m = this.toon(0xffffff);
      this.colMats.push(m);
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, ROWS), m);
      b.position.set(wx(x + 0.5), 0.06, 0);
      this.scene.add(b);
    }
  }

  buildGrass() {
    const tex = this.canvasTexture(64, (g) => {
      const blades = [[14, 60, 10, 26], [26, 60, 24, 14], [38, 60, 42, 10], [50, 60, 56, 24], [32, 60, 32, 30]];
      const stroke = (w, c) => {
        g.lineWidth = w; g.strokeStyle = c; g.lineCap = 'round';
        for (const b of blades) { g.beginPath(); g.moveTo(b[0], b[1]); g.quadraticCurveTo(b[0] + (b[2] - b[0]) * 0.3, b[1] - 20, b[2], b[3]); g.stroke(); }
      };
      stroke(7, '#2C2C2A'); stroke(3.5, '#ffffff');
    });
    const mat = this.wobbly(new THREE.MeshToonMaterial({ map: tex, gradientMap: this.grad, alphaTest: 0.5, side: THREE.DoubleSide }));
    const pg = new THREE.PlaneGeometry(1, 1); pg.translate(0, 0.5, 0);
    const pg2 = pg.clone(); pg2.rotateY(Math.PI / 2);
    this.grassA = new THREE.InstancedMesh(pg, mat, COLS * ROWS);
    this.grassB = new THREE.InstancedMesh(pg2, mat, COLS * ROWS);
    this.scene.add(this.grassA, this.grassB);
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    this.white = new THREE.Color(0xffffff);
  }

  setCell(i) {
    const c = this.lawn.cells[i];
    const d = this.dummy;
    d.position.set(wx(c.col + 0.5), 0.1, wz(c.row + 0.5));
    d.rotation.y = c.rot;
    const h = c.level === 0 ? 0.001 : (c.mowed ? MOWED_HEIGHT : LEVEL_HEIGHT[c.level]);
    d.scale.set(1, h, 1);
    d.updateMatrix();
    this.grassA.setMatrixAt(i, d.matrix);
    this.grassB.setMatrixAt(i, d.matrix);
    const season = seasonOfCol(this.lawn, c.col);
    const col = this.tmpColor;
    col.set(c.mowed ? '#C0DD97' : season.grass);
    if (!c.mowed && c.level >= 4) col.multiplyScalar(0.65);
    if (!c.mowed && c.level === 1) col.lerp(this.white, 0.25);
    this.grassA.setColorAt(i, col);
    this.grassB.setColorAt(i, col);
  }

  buildFence() {
    this.fenceZ = wz(-1.6);
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
    if (document.fonts && document.fonts.load) document.fonts.load(`64px ${FONT}`).then(build);
  }

  buildSigns() {
    for (const s of this.signs) this.scene.remove(s);
    this.signs = [];
    for (const ms of this.lawn.monthStarts) {
      const x = wx(ms.col + 2.1);
      const tex = this.canvasTexture(256, (g) => {
        g.clearRect(0, 0, 256, 256);
        g.fillStyle = '#FBF4DD'; g.fillRect(8, 72, 240, 112);
        g.lineWidth = 8; g.strokeStyle = '#2C2C2A'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(14, 76); g.lineTo(244, 74); g.lineTo(242, 182); g.lineTo(12, 180); g.closePath(); g.stroke();
        g.fillStyle = '#2C2C2A'; g.font = `64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
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
    const sunTex = this.canvasTexture(128, (g) => {
      g.lineWidth = 6; g.strokeStyle = '#2C2C2A'; g.fillStyle = '#FAC775';
      g.beginPath(); g.arc(64, 64, 30, 0, 7); g.fill(); g.stroke();
      for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28; g.beginPath(); g.moveTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40); g.lineTo(64 + Math.cos(a + 0.15) * 58, 64 + Math.sin(a + 0.15) * 58); g.stroke(); }
    });
    const cloudTex = this.canvasTexture(128, (g) => {
      g.lineWidth = 6; g.strokeStyle = '#2C2C2A'; g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(40, 74, 22, 0, 7); g.arc(66, 58, 28, 0, 7); g.arc(92, 76, 22, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.fillRect(30, 72, 70, 22);
    });
    const treeTex = this.canvasTexture(128, (g) => {
      g.lineWidth = 6; g.strokeStyle = '#2C2C2A'; g.lineCap = 'round';
      g.beginPath(); g.moveTo(64, 124); g.lineTo(64, 60); g.moveTo(64, 86); g.lineTo(38, 54); g.moveTo(64, 74); g.lineTo(92, 40); g.moveTo(64, 60); g.lineTo(52, 24); g.stroke();
    });

    // Find column ranges for each season so props land in the right place.
    const ranges = [[], [], [], []];
    for (let x = 0; x < COLS; x++) ranges[SEASON_OF_MONTH[this.lawn.monthOfCol[x]]].push(x);
    const mid = (r) => r.length ? wx(r[Math.floor(r.length / 2)]) : 0;
    const span = (r) => r.length ? [wx(r[0]), wx(r[r.length - 1] + 1)] : [0, 1];

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
    this.scene.add(new THREE.Points(this.snowGeo, new THREE.PointsMaterial({ color: 0x85b7eb, size: 0.16 })));

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
    this.clipGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    this.clipMat = new THREE.MeshBasicMaterial({ color: 0x97c459 });
  }

  // --- lawn sync --------------------------------------------------------

  /** Call after createLawn / resetLawn / setLawn to push all cells to the GPU. */
  applyLawn() {
    for (let x = 0; x < COLS; x++) this.colMats[x].color.set(seasonOfCol(this.lawn, x).ground);
    for (let i = 0; i < this.lawn.cells.length; i++) this.setCell(i);
    this.flagDirty();
  }

  setLawn(lawn) {
    this.lawn = lawn;
    this.buildSigns();
    this.applyLawn();
  }

  flagDirty() {
    this.grassA.instanceMatrix.needsUpdate = this.grassB.instanceMatrix.needsUpdate = true;
    if (this.grassA.instanceColor) this.grassA.instanceColor.needsUpdate = true;
    if (this.grassB.instanceColor) this.grassB.instanceColor.needsUpdate = true;
  }

  onMowed(indices) {
    const m = this.lawn.mower;
    for (const i of indices) {
      this.setCell(i);
      const c = this.lawn.cells[i];
      for (let k = 0; k < 4; k++) {
        const cm = new THREE.Mesh(this.clipGeo, this.clipMat);
        cm.position.set(wx(c.col + 0.5), 0.4, wz(c.row + 0.5));
        cm.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.12 + Math.sin(m.angle) * 0.08, 0.08 + Math.random() * 0.06, (Math.random() - 0.5) * 0.12 - Math.cos(m.angle) * 0.08);
        cm.userData.life = 26;
        this.scene.add(cm);
        this.clippings.push(cm);
      }
    }
    if (indices.length) this.flagDirty();
  }

  // --- frame -------------------------------------------------------------

  resize() {
    const w = this.canvas.clientWidth || 680;
    const h = this.canvas.clientHeight || 420;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  draw(ts) {
    const { lawn, mower } = this;
    const m = lawn.mower;

    if (ts - this.lastBoil > 110) {
      this.seedVal += 1.7; this.lastBoil = ts;
      for (const s of this.shaders) s.uniforms.uSeed.value = this.seedVal;
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
      if (--c.userData.life <= 0) { this.scene.remove(c); this.clippings.splice(i, 1); }
    }

    // weather
    const pos = this.snowGeo.attributes.position.array;
    for (let s = 0; s < pos.length / 3; s++) { pos[s * 3 + 1] -= 0.02; pos[s * 3] += Math.sin(ts * 0.002 + s) * 0.005; if (pos[s * 3 + 1] < 0) pos[s * 3 + 1] = 8; }
    this.snowGeo.attributes.position.needsUpdate = true;
    this.leaves.forEach((lf, i) => { lf.position.y -= lf.userData.v; lf.position.x += Math.sin(ts * 0.003 + i) * 0.01; lf.rotation.x += 0.03; lf.rotation.z += 0.02; if (lf.position.y < 0.1) lf.position.y = 6; });
    this.sun.material.rotation += 0.004;

    // sky follows the month under the mower
    this.skyTarget.set(SEASONS[SEASON_OF_MONTH[monthAt(lawn, m.x)]].sky);
    this.scene.background.lerp(this.skyTarget, 0.03);

    // chase camera
    const cam = this.camera;
    const tx = wx(m.x) - Math.cos(m.angle) * 6.5;
    const tz = wz(m.z) - Math.sin(m.angle) * 6.5;
    cam.position.x += (tx - cam.position.x) * 0.06;
    cam.position.z += (tz - cam.position.z) * 0.06;
    cam.position.y += (4.8 - cam.position.y) * 0.06;
    cam.lookAt(wx(m.x), 0.6, wz(m.z));

    this.renderer.render(this.scene, cam);
  }

  dispose() { this.renderer.dispose(); }
}
