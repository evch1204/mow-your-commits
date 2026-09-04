import * as THREE from 'three';
import {
  ROWS, MAX_COLS, MONTH_NAMES, SEASONS, seasonIndexOfCol, seasonIndexAt,
} from '../core/lawn.js';
import {
  INK, CREAM, DIRT, AUTUMN_BLADE, tileColor, stripe, bladeColor, clipColor,
} from '../core/palette.js';

const FONT = "'Patrick Hand', cursive";
const SLOTS = MAX_COLS * ROWS;

// Four tuft builds so a level-4 week is a hedge and a level-1 week is sprouts.
const TUFT_BLADES = [3, 5, 8, 12];
const TUFT_HEIGHT = [0.35, 0.6, 0.9, 1.25];
const MOWED_SCALE = 0.18;

// Hemisphere light tint per season: cool in winter, warm in summer.
const HEMI = ['#DCE9F4', '#EEF8E6', '#FFF6DE', '#FBEBD6'];
const DIR_INTENSITY = [0.85, 1.1, 1.3, 1.0];
const MEADOW = '#C9DCAE';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => t * t * (3 - 2 * t);

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

    // camera: chase <-> overview, each with its own look-around offset
    this.camMode = 0;
    this.camBlend = 0;
    this.chase = { yaw: 0, pitch: 0, dist: 10.4 };
    this.over = { yaw: 0, pitch: 0, dist: 33 };
    this.CHASE_PITCH = 0.55;
    this.OVER_PITCH = 0.42;
    this.gasHeld = 0;
    this.snapped = false;

    // weather weights: winter, spring, summer, autumn
    this.weatherMix = [0, 0, 0, 0];
    this.weatherMix[seasonIndexAt(lawn, lawn.mower.x)] = 1;
    this.fenceZ = -ROWS / 2 - 1.7;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SEASONS[2].sky);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
    this.lookAt = new THREE.Vector3(0, 0.5, 0);
    this.resize();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xa0b080, 0.95);
    this.scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.15);
    this.dir.position.set(6, 14, 10);
    this.scene.add(this.dir);

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
    this.tmpColorB = new THREE.Color();

    this.buildTiles();
    this.buildGrass();
    this.buildWeather();
    this.buildMower();
    this.buildBoard();
    this.bindOrbit();
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

  /** Flat toon material with no boil, for small machined parts. */
  plain(hex) {
    return new THREE.MeshToonMaterial({ color: hex, gradientMap: this.grad });
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

  sprite(tex, x, y, z, s, parent) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.position.set(x, y, z);
    sp.scale.set(s, s, 1);
    (parent || this.scene).add(sp);
    return sp;
  }

  // --- board: dirt slab, apron, fence, month signs -----------------------

  /** Everything whose size depends on lawn.cols. Rebuilt by setLawn. */
  buildBoard() {
    if (this.board) {
      this.scene.remove(this.board);
      this.board.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    }
    const cols = this.lawn.cols;
    const g = new THREE.Group();
    this.board = g;
    this.scene.add(g);

    // Meadow to the horizon, well below the slab. Both cameras are aimed
    // shallow enough (under the 25 degree half-FOV) that the real horizon line
    // lands inside the frame, so the sky, sun and clouds stay above it.
    this.apronMat = new THREE.MeshToonMaterial({ color: MEADOW, gradientMap: this.grad });
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), this.apronMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, -0.95, 0);
    g.add(apron);

    const base = this.inked(new THREE.BoxGeometry(cols + 1.6, 0.7, ROWS + 1.5), this.toon(DIRT), 1.015);
    base.position.y = -0.35;
    g.add(base);

    this.fenceZ = -ROWS / 2 - 1.7;
    const wood = this.toon(0x8b6b43);
    this.wood = wood;
    for (let f = 0; f <= cols; f += 4) {
      const post = this.inked(new THREE.BoxGeometry(0.22, 1.3, 0.22), wood, 1.12);
      post.position.set(f - cols / 2, 0.65, this.fenceZ);
      g.add(post);
    }
    for (const y of [0.5, 1.0]) {
      const rail = this.inked(new THREE.BoxGeometry(cols + 0.4, 0.12, 0.12), wood, 1.08);
      rail.position.set(0, y, this.fenceZ);
      g.add(rail);
    }

    // a few bare doodle trees along the fence line, whatever the season
    const treeTex = this.canvasTexture(128, 128, (c) => {
      c.lineWidth = 6; c.strokeStyle = INK; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(64, 124); c.lineTo(64, 60);
      c.moveTo(64, 86); c.lineTo(38, 54);
      c.moveTo(64, 74); c.lineTo(92, 40);
      c.moveTo(64, 60); c.lineTo(52, 24);
      c.stroke();
    });
    for (let t = 0; t < 5; t++) {
      const x = (t + 0.5) / 5 * cols - cols / 2 + (t % 2 ? 2 : -2);
      this.sprite(treeTex, x, 2.2, this.fenceZ - 3.4, 4.5, g);
    }

    this.buildSigns();
  }

  /**
   * One sign per month, at the month's first column. Months with fewer than
   * three columns are skipped, and any sign that would crowd its neighbour is
   * dropped, so the first two months never merge.
   */
  buildSigns() {
    const cols = this.lawn.cols;
    if (this.signs) for (const s of this.signs) this.board.remove(s);
    this.signs = [];
    let lastX = -Infinity;
    let n = 0;
    for (const ms of this.lawn.monthStarts) {
      if (ms.span < 3) continue;
      const x = ms.col + 0.6 - cols / 2;
      if (x - lastX < 3.2) continue;
      lastX = x;
      const top = n++ % 2 ? 2.15 : 1.85;   // alternate so a run does not read as a rail
      const tex = this.canvasTexture(256, 256, (c) => {
        c.clearRect(0, 0, 256, 256);
        c.fillStyle = CREAM; c.fillRect(8, 72, 240, 112);
        c.lineWidth = 8; c.strokeStyle = INK; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(14, 76); c.lineTo(244, 74); c.lineTo(242, 182); c.lineTo(12, 180); c.closePath(); c.stroke();
        c.fillStyle = INK; c.font = `64px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(MONTH_NAMES[ms.month].slice(0, 3), 128, 130);
      });
      const pl = new THREE.Mesh(
        new THREE.PlaneGeometry(2.1, 2.1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
      );
      pl.position.set(x, top, this.fenceZ - 0.06);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, top - 0.55, 0.1), this.wood);
      st.position.set(x, (top - 0.55) / 2 + 0.3, this.fenceZ - 0.12);
      this.board.add(pl, st);
      this.signs.push(pl, st);
    }
  }

  // --- day tiles and grass ----------------------------------------------

  /** One instanced box per day. Gaps show the dirt, so the grid reads. */
  buildTiles() {
    const geo = new THREE.BoxGeometry(0.86, 0.14, 0.86);
    const mat = this.wobbly(new THREE.MeshToonMaterial({ gradientMap: this.grad }), { boil: 0.008 });
    this.tiles = new THREE.InstancedMesh(geo, mat, SLOTS);
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tiles.count = 0;
    this.tiles.frustumCulled = false;
    this.scene.add(this.tiles);
    this.tileSlot = new Int16Array(SLOTS);
  }

  buildGrass() {
    const mat = this.wobbly(new THREE.MeshToonMaterial({
      gradientMap: this.grad, side: THREE.DoubleSide,
    }), { sway: true, boil: 0.012 });
    this.grassMat = mat;
    this.grass = [];
    for (let l = 0; l < 4; l++) {
      const geo = tuftGeometry(TUFT_BLADES[l], TUFT_HEIGHT[l], 7919 + l * 131);
      const im = new THREE.InstancedMesh(geo, mat, SLOTS);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.frustumCulled = false;
      this.scene.add(im);
      this.grass.push(im);
    }
    this.slotOf = new Int16Array(SLOTS);

    // spring flowers: tiny dots in the thin grass
    this.flowers = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.05, 6, 4),
      new THREE.MeshBasicMaterial(),
      SLOTS,
    );
    this.flowers.count = 0;
    this.flowers.frustumCulled = false;
    this.scene.add(this.flowers);
    this.flowerSlot = new Int16Array(SLOTS);
  }

  // --- weather ----------------------------------------------------------

  buildWeather() {
    const dot = this.canvasTexture(32, 32, (c) => {
      const g = c.createRadialGradient(16, 16, 1, 16, 16, 15);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(226,240,250,0.95)');
      g.addColorStop(1, 'rgba(226,240,250,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 32, 32);
    });
    const N = 260;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 28;
      pos[i * 3 + 1] = Math.random() * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 24;
    }
    this.snowGeo = new THREE.BufferGeometry();
    this.snowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snowMat = new THREE.PointsMaterial({
      map: dot, size: 0.35, transparent: true, opacity: 0, depthWrite: false,
    });
    this.snow = new THREE.Points(this.snowGeo, this.snowMat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    const leafGeo = new THREE.PlaneGeometry(0.3, 0.19);
    this.leaves = [];
    for (let l = 0; l < 44; l++) {
      const lm = new THREE.Mesh(leafGeo, new THREE.MeshBasicMaterial({
        color: [0xd85a30, 0xef9f27, 0xba7517][l % 3],
        side: THREE.DoubleSide, transparent: true, opacity: 0,
      }));
      lm.position.set((Math.random() - 0.5) * 26, Math.random() * 8, (Math.random() - 0.5) * 22);
      lm.userData.v = 0.012 + Math.random() * 0.022;
      this.scene.add(lm);
      this.leaves.push(lm);
    }

    const sunTex = this.canvasTexture(128, 128, (c) => {
      c.lineWidth = 6; c.strokeStyle = INK; c.fillStyle = '#FAC775';
      c.beginPath(); c.arc(64, 64, 30, 0, 7); c.fill(); c.stroke();
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * 6.28;
        c.beginPath();
        c.moveTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40);
        c.lineTo(64 + Math.cos(a + 0.15) * 58, 64 + Math.sin(a + 0.15) * 58);
        c.stroke();
      }
    });
    const cloudTex = this.canvasTexture(128, 128, (c) => {
      c.lineWidth = 6; c.strokeStyle = INK; c.fillStyle = '#ffffff';
      c.beginPath(); c.arc(40, 74, 22, 0, 7); c.arc(66, 58, 28, 0, 7); c.arc(92, 76, 22, 0, 7);
      c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.fillRect(30, 72, 70, 22);
    });
    // anchored to the camera target, high up behind the fence
    this.sun = this.sprite(sunTex, 0, 7, -14, 5);
    this.clouds = [
      this.sprite(cloudTex, -7, 6.2, -13, 4.6),
      this.sprite(cloudTex, 5, 7.4, -14, 3.8),
      this.sprite(cloudTex, 12, 5.6, -12, 3.2),
    ];
  }

  // --- the riding mower --------------------------------------------------

  buildMower() {
    const g = new THREE.Group();
    const orange = this.toon(0xd85a30);
    const darkOrange = this.toon(0xb84a22);
    const grey = this.toon(0x45454a);
    const rubber = this.toon(0x2c2c2a);
    const creamMat = this.plain(0xfbf4dd);
    const inkPlain = this.plain(0x2c2c2a);

    // hood, front (+z), with a rounded upper deck
    const hood = this.inked(new THREE.BoxGeometry(0.62, 0.28, 0.66), orange, 1.06);
    hood.position.set(0, 0.5, 0.42); g.add(hood);
    const hoodTop = this.inked(new THREE.BoxGeometry(0.5, 0.12, 0.54), orange, 1.07);
    hoodTop.position.set(0, 0.68, 0.4); g.add(hoodTop);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.04), inkPlain);
    grille.position.set(0, 0.46, 0.76); g.add(grille);
    for (const s of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), creamMat);
      lamp.position.set(s * 0.17, 0.62, 0.72); g.add(lamp);
    }

    // cutting deck: wider than the body, with a discharge chute on the right
    this.deck = this.inked(new THREE.CylinderGeometry(0.56, 0.56, 0.11, 18), grey, 1.05);
    this.deck.position.set(0, 0.18, 0.16); g.add(this.deck);
    const chute = this.inked(new THREE.BoxGeometry(0.2, 0.13, 0.3), grey, 1.08);
    chute.position.set(0.58, 0.2, 0.1);
    chute.rotation.y = -0.5; g.add(chute);
    this.chute = chute;

    // wheels: small at the front, big at the back. That is the signature.
    const fw = new THREE.CylinderGeometry(0.14, 0.14, 0.1, 12); fw.rotateZ(Math.PI / 2);
    this.frontWheels = [];
    for (const s of [-1, 1]) {
      const w = this.inked(fw, rubber, 1.1);
      w.position.set(s * 0.36, 0.14, 0.62); g.add(w); this.frontWheels.push(w);
    }
    const rw = new THREE.CylinderGeometry(0.3, 0.3, 0.19, 10); rw.rotateZ(Math.PI / 2);
    const tread = new THREE.TorusGeometry(0.28, 0.055, 4, 10); tread.rotateY(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.11, 0.11, 0.21, 10); hub.rotateZ(Math.PI / 2);
    this.rearWheels = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.add(this.inked(rw, rubber, 1.06));
      w.add(new THREE.Mesh(tread, inkPlain));
      w.add(new THREE.Mesh(hub, creamMat));
      w.position.set(s * 0.44, 0.3, -0.5); g.add(w); this.rearWheels.push(w);
    }

    // fender plate, seat, steering wheel
    const fender = this.inked(new THREE.BoxGeometry(0.92, 0.08, 0.52), darkOrange, 1.05);
    fender.position.set(0, 0.44, -0.44); g.add(fender);
    const seat = this.inked(new THREE.BoxGeometry(0.38, 0.09, 0.36), grey, 1.07);
    seat.position.set(0, 0.53, -0.44); g.add(seat);
    const back = this.inked(new THREE.BoxGeometry(0.38, 0.34, 0.09), grey, 1.07);
    back.position.set(0, 0.72, -0.63); g.add(back);
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.07), inkPlain);
    column.position.set(0, 0.74, 0.1); column.rotation.x = -0.42; g.add(column);
    const wheelGeo = new THREE.TorusGeometry(0.13, 0.026, 5, 12);
    const steer = new THREE.Mesh(wheelGeo, inkPlain);
    steer.position.set(0, 0.94, 0.02); steer.rotation.x = -1.15; g.add(steer);
    this.steer = steer;

    // driver
    const driver = new THREE.Group();
    const torso = this.inked(new THREE.BoxGeometry(0.3, 0.34, 0.24), this.toon(0x5c8f3a), 1.06);
    torso.position.set(0, 0.86, -0.36); driver.add(torso);
    const armGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.42, 6);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, this.plain(0x5c8f3a));
      arm.position.set(s * 0.15, 0.92, -0.17);
      arm.rotation.set(-1.05, 0, s * 0.16);
      driver.add(arm);
    }
    const head = this.inked(new THREE.SphereGeometry(0.15, 10, 8), this.toon(0xf5c4b3), 1.09);
    head.position.set(0, 1.14, -0.33); driver.add(head);
    const cap = this.inked(new THREE.CylinderGeometry(0.155, 0.155, 0.08, 10), orange, 1.08);
    cap.position.set(0, 1.24, -0.33); driver.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.15), this.plain(0xd85a30));
    brim.position.set(0, 1.21, -0.21); driver.add(brim);
    const faceTex = this.canvasTexture(64, 64, (c) => {
      c.clearRect(0, 0, 64, 64);
      c.fillStyle = INK;
      c.beginPath(); c.arc(24, 28, 4, 0, 7); c.fill();
      c.beginPath(); c.arc(42, 28, 4, 0, 7); c.fill();
      c.strokeStyle = INK; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.arc(33, 34, 11, 0.35, Math.PI - 0.35); c.stroke();
    });
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.26),
      new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false }),
    );
    face.position.set(0, 1.13, -0.19);
    driver.add(face);
    g.add(driver);
    this.driver = driver;

    // exhaust pipe, back left
    const pipe = this.inked(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 8), grey, 1.1);
    pipe.position.set(-0.3, 0.62, -0.12); g.add(pipe);

    this.mower = g;
    this.tilt = 0;
    this.lean = 0;
    this.scene.add(g);

    this.clipGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    this.clipMats = new Map();
    this.puffGeo = new THREE.SphereGeometry(0.07, 6, 5);
    this.puffMat = new THREE.MeshBasicMaterial({ color: 0x8c8a84, transparent: true, opacity: 0.4 });
    this.puffAt = 0;
  }

  // --- look-around -------------------------------------------------------

  bindOrbit() {
    const c = this.canvas;
    const pointers = new Map();
    let pinch = 0;
    const cam = () => (this.camMode ? this.over : this.chase);

    c.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) pinch = this.pinchDistance(pointers);
      if (c.setPointerCapture) c.setPointerCapture(e.pointerId);
      // NB: we deliberately do not preventDefault, so the stage still focuses
    });
    c.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 2) {
        const d = this.pinchDistance(pointers);
        if (pinch) this.zoom((pinch - d) * 0.02);
        pinch = d;
        return;
      }
      const k = cam();
      k.yaw += dx * 0.006;
      k.pitch = clamp(k.pitch + dy * 0.005, -0.5, 0.75);
    });
    const end = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', end);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY * 0.004); }, { passive: false });
    c.addEventListener('dblclick', () => this.resetOrbit());
  }

  pinchDistance(pointers) {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  zoom(d) {
    if (this.camMode) this.over.dist = clamp(this.over.dist * (1 + d), 25, 60);
    else this.chase.dist = clamp(this.chase.dist * (1 + d), 4, 14);
  }

  resetOrbit() {
    this.chase.yaw = this.chase.pitch = 0;
    this.over.yaw = this.over.pitch = 0;
    this.chase.dist = 10.4;
    this.over.dist = 33;
  }

  /** Debug hook for ?yaw=<degrees>. */
  setOrbit(yawDeg, pitchDeg = 0) {
    const y = yawDeg * Math.PI / 180;
    this.chase.yaw = y;
    this.over.yaw = y;
    this.chase.pitch = this.over.pitch = pitchDeg * Math.PI / 180;
  }

  /** Debug hook for ?dist=<units>. */
  setDistance(d) {
    this.chase.dist = clamp(d, 4, 14);
    this.over.dist = clamp(d, 25, 60);
  }

  toggleCamera() { this.camMode = this.camMode ? 0 : 1; return this.camMode; }
  setCamera(mode) { this.camMode = mode === 'overview' ? 1 : 0; }

  // --- lawn sync --------------------------------------------------------

  /**
   * Mower-local (x right, y up, z forward) to world, without needing the
   * group's matrix: the sim may have moved the mower since the last draw.
   */
  localToWorld(x, y, z) {
    const m = this.lawn.mower;
    const sa = Math.sin(m.angle), ca = Math.cos(m.angle);
    return new THREE.Vector3(
      this.wx(m.x) + x * sa + z * ca,
      y,
      this.wz(m.z) - x * ca + z * sa,
    );
  }

  rightVector() {
    const a = this.lawn.mower.angle;
    return { x: Math.sin(a), z: -Math.cos(a) };
  }

  cellScaleY(c) {
    if (!c.mowed) return 1;
    const e = Math.min(1, c.mowT);
    return Math.max(0.06, 1 + (MOWED_SCALE - 1) * ease(e) - Math.sin(Math.PI * e) * 0.16);
  }

  wx(x) { return x - this.lawn.cols / 2; }
  wz(z) { return z - this.lawn.rows / 2; }

  setCell(i) {
    const c = this.lawn.cells[i];
    if (c.void) return;
    const d = this.dummy;
    const season = seasonIndexOfCol(this.lawn, c.col);
    const col = this.tmpColor;

    // tile
    const ts = this.tileSlot[i];
    if (ts >= 0) {
      d.position.set(this.wx(c.col + 0.5), 0.07, this.wz(c.row + 0.5));
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.tiles.setMatrixAt(ts, d.matrix);
      let tc = tileColor(c.level, season, c.mowed && c.mowT > 0.35);
      if (c.mowed && c.level > 0 && c.col % 2 === 0 && c.mowT > 0.35) tc = stripe(tc);
      col.set(tc);
      this.tiles.setColorAt(ts, col);
    }

    // grass
    if (c.level > 0) {
      const mesh = this.grass[c.level - 1];
      const slot = this.slotOf[i];
      const ys = this.cellScaleY(c);
      const xz = 1 + Math.sin(Math.PI * Math.min(1, c.mowT)) * (c.mowed ? 0.22 : 0);
      d.position.set(this.wx(c.col + 0.5), 0.14, this.wz(c.row + 0.5));
      d.rotation.set(0, c.rot, 0);
      d.scale.set(xz, ys, xz);
      d.updateMatrix();
      mesh.setMatrixAt(slot, d.matrix);
      if (c.mowed) {
        col.set(tileColor(c.level, season, true));
      } else {
        col.set(bladeColor(c.level, season));
        // one autumn tuft in five has turned brown
        if (season === 3 && (c.col * 7 + c.row * 13) % 5 === 0) {
          col.lerp(this.tmpColorB.set(AUTUMN_BLADE), 0.55);
        }
      }
      mesh.setColorAt(slot, col);
    }

    // spring flowers sit in the thin grass
    const fs = this.flowerSlot[i];
    if (fs >= 0) {
      const show = !c.mowed && season === 1;
      d.position.set(
        this.wx(c.col + 0.5) + (c.rot % 1 - 0.5) * 0.4,
        show ? 0.34 : -9,
        this.wz(c.row + 0.5) + ((c.rot * 3) % 1 - 0.5) * 0.4,
      );
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(show ? 1 : 0.0001);
      d.updateMatrix();
      this.flowers.setMatrixAt(fs, d.matrix);
      this.flowers.setColorAt(fs, col.set((c.col + c.row) % 2 ? '#F6C3D4' : '#FFFDF5'));
    }
  }

  /** Call after createLawn / resetLawn / setLawn to push all cells to the GPU. */
  applyLawn() {
    const cells = this.lawn.cells;
    const counts = [0, 0, 0, 0];
    let tiles = 0;
    let flowers = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      this.tileSlot[i] = c.void ? -1 : tiles++;
      this.slotOf[i] = !c.void && c.level > 0 ? counts[c.level - 1]++ : -1;
      const springy = !c.void && c.level > 0 && c.level <= 2
        && seasonIndexOfCol(this.lawn, c.col) === 1;
      this.flowerSlot[i] = springy ? flowers++ : -1;
    }
    this.tiles.count = tiles;
    this.flowers.count = flowers;
    for (let l = 0; l < 4; l++) this.grass[l].count = counts[l];
    for (let i = 0; i < cells.length; i++) this.setCell(i);
    this.anim.clear();
    this.flagDirty();
  }

  setLawn(lawn) {
    this.lawn = lawn;
    this.buildBoard();
    this.applyLawn();
    this.snapped = false;
    this.weatherMix = [0, 0, 0, 0];
    this.weatherMix[seasonIndexAt(lawn, lawn.mower.x)] = 1;
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
    this.flowers.instanceMatrix.needsUpdate = true;
    if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true;
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
    // clippings fly out of the chute on the mower's right
    const chute = this.localToWorld(0.66, 0.24, 0.1);
    const right = this.rightVector();
    let sum = 0;
    for (const i of indices) {
      const c = this.lawn.cells[i];
      if (!c || c.void) continue;
      const season = seasonIndexOfCol(this.lawn, c.col);
      sum += c.count;
      this.anim.add(i);
      this.setCell(i);
      const mat = this.clipMat(clipColor(c.level, season));
      const n = 3 + 2 * c.level;
      for (let k = 0; k < n; k++) {
        const cm = new THREE.Mesh(this.clipGeo, mat);
        cm.position.copy(chute);
        cm.userData.v = new THREE.Vector3(
          right.x * 0.15 + (Math.random() - 0.5) * 0.08,
          0.09 + Math.random() * 0.07,
          right.z * 0.15 + (Math.random() - 0.5) * 0.08,
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
    const j = (this.popups.length % 3) - 1;
    sp.position.set(
      this.wx(m.x) - Math.sin(m.angle) * j * 0.9,
      2.2 + j * 0.25,
      this.wz(m.z) + Math.cos(m.angle) * j * 0.9,
    );
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

  // --- frame -------------------------------------------------------------

  resize() {
    const w = this.canvas.clientWidth || 720;
    const h = this.canvas.clientHeight || 460;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Weather is whatever season the mower is standing in, eased across the border. */
  updateWeather(dt, tx, tz, camY) {
    const want = seasonIndexAt(this.lawn, this.lawn.mower.x);
    const k = this.snapped ? Math.min(1, dt * 1.2) : 1;
    const wm = this.weatherMix;
    for (let i = 0; i < 4; i++) wm[i] += ((i === want ? 1 : 0) - wm[i]) * k;

    // sky, ground and lights all follow the mix
    const sky = this.tmpColor.setRGB(0, 0, 0);
    const hemi = this.tmpColorB.setRGB(0, 0, 0);
    let intensity = 0;
    for (let i = 0; i < 4; i++) {
      if (wm[i] < 0.002) continue;
      const sc = this.skyColors[i], hc = this.hemiColors[i], w = wm[i];
      sky.r += sc.r * w; sky.g += sc.g * w; sky.b += sc.b * w;
      hemi.r += hc.r * w; hemi.g += hc.g * w; hemi.b += hc.b * w;
      intensity += DIR_INTENSITY[i] * w;
    }
    this.scene.background.copy(sky);
    this.hemi.color.copy(hemi);
    this.dir.intensity = intensity || 1;
    // the apron reads as a horizon when it sits between the grass and the sky
    this.apronMat.color.copy(this.meadow).lerp(sky, 0.3 + wm[0] * 0.4);

    // snow, always around the mower so it is weather and not scenery
    this.snowMat.opacity = wm[0];
    this.snow.visible = wm[0] > 0.01;
    if (this.snow.visible) {
      const pos = this.snowGeo.attributes.position.array;
      for (let s = 0; s < pos.length / 3; s++) {
        pos[s * 3 + 1] -= 0.024;
        pos[s * 3] += Math.sin(this.time * 1.4 + s) * 0.006;
        if (pos[s * 3 + 1] < -0.6 || Math.abs(pos[s * 3] - tx) > 16 || Math.abs(pos[s * 3 + 2] - tz) > 15) {
          pos[s * 3] = tx + (Math.random() - 0.5) * 28;
          pos[s * 3 + 1] = 6 + Math.random() * 5;
          pos[s * 3 + 2] = tz + (Math.random() - 0.5) * 24;
        }
      }
      this.snowGeo.attributes.position.needsUpdate = true;
    }

    // leaves
    const leafy = wm[3];
    for (let i = 0; i < this.leaves.length; i++) {
      const lf = this.leaves[i];
      lf.visible = leafy > 0.01;
      lf.material.opacity = leafy;
      if (!lf.visible) continue;
      lf.position.y -= lf.userData.v;
      lf.position.x += Math.sin(this.time * 1.7 + i) * 0.012;
      lf.rotation.x += 0.03; lf.rotation.z += 0.02;
      if (lf.position.y < 0.1 || Math.abs(lf.position.x - tx) > 15 || Math.abs(lf.position.z - tz) > 14) {
        lf.position.set(tx + (Math.random() - 0.5) * 26, 5 + Math.random() * 4, tz + (Math.random() - 0.5) * 22);
      }
    }

    // sun and clouds hang high behind the fence, anchored to where you are
    const sunny = clamp(wm[2] + wm[1] * 0.5, 0, 1);
    this.sun.material.opacity = sunny;
    this.sun.visible = sunny > 0.02;
    this.sun.material.rotation += 0.004;
    // Sky props hang a little above the camera's own height, so they are always
    // on the sky side of the horizon whichever camera you are on.
    this.sun.position.set(tx + 11, camY + 1.4, this.fenceZ - 9);
    this.sun.scale.setScalar(3.6 + sunny * 1.0);
    const cloudy = clamp(wm[1] + wm[3] + wm[0] * 0.6, 0, 1);
    this.clouds.forEach((cl, i) => {
      cl.material.opacity = cloudy * 0.95;
      cl.visible = cloudy > 0.02;
      const drift = ((this.time * 0.25 + i * 9) % 30) - 15;
      cl.position.set(tx + drift + i * 3 - 6, camY + 0.6 + i * 0.7, this.fenceZ - 7 - i * 2);
    });
  }

  draw(ts) {
    const { lawn, mower } = this;
    const m = lawn.mower;
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 1 / 60;
    this.lastTs = ts;
    this.time += dt;

    if (!this.skyColors) {
      this.skyColors = SEASONS.map((s) => new THREE.Color(s.sky));
      this.hemiColors = HEMI.map((h) => new THREE.Color(h));
      this.meadow = new THREE.Color(MEADOW);
    }

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
    const idle = Math.sin(this.time * 60) * 0.004;
    mower.position.set(this.wx(m.x), idle + Math.abs(m.vel) * 0.06, this.wz(m.z));
    mower.rotation.y = Math.PI / 2 - m.angle;
    this.tilt += (m.acc * 18 - this.tilt) * 0.15;
    this.lean += ((m.turn || 0) * Math.min(1, Math.abs(m.vel) * 6) * 0.16 - this.lean) * 0.12;
    mower.rotation.x = -this.tilt;
    mower.rotation.z = this.lean;
    mower.updateMatrixWorld();
    for (const w of this.frontWheels) w.rotation.x += m.vel * 8;
    for (const w of this.rearWheels) w.rotation.x += m.vel * 3.7;   // bigger wheel, slower roll
    this.deck.rotation.y += Math.abs(m.vel) * 2 + 0.04;
    this.steer.rotation.z = -(m.turn || 0) * 0.5;
    this.driver.position.y = Math.sin(this.time * 9) * 0.008;

    // exhaust puffs while accelerating
    this.puffAt -= dt;
    if (m.acc > 0 && this.puffAt <= 0) {
      this.puffAt = 0.5;
      const at = this.localToWorld(-0.3, 0.78, -0.12);
      for (let k = 0; k < 3; k++) {
        const p = new THREE.Mesh(this.puffGeo, this.puffMat.clone());
        p.position.copy(at).add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.1, k * 0.06, (Math.random() - 0.5) * 0.1,
        ));
        p.userData.v = new THREE.Vector3(0, 0.03 + Math.random() * 0.02, 0);
        p.userData.life = 34;
        p.userData.puff = true;
        this.scene.add(p);
        this.clippings.push(p);
      }
    }

    // clippings and puffs share one loop
    for (let i = this.clippings.length - 1; i >= 0; i--) {
      const c = this.clippings[i];
      c.position.add(c.userData.v);
      if (c.userData.puff) {
        c.scale.multiplyScalar(1.035);
        c.material.opacity = Math.max(0, c.userData.life / 34) * 0.4;
      } else {
        c.userData.v.y -= 0.008;
        c.rotation.x += 0.2; c.rotation.z += 0.15;
      }
      if (--c.userData.life <= 0) {
        this.scene.remove(c);
        if (c.userData.puff) c.material.dispose();
        this.clippings.splice(i, 1);
      }
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

    // --- camera: chase <-> overview, each with its own look-around offset ---
    if (m.acc > 0) this.gasHeld += dt; else this.gasHeld = 0;
    if (this.gasHeld > 0.5 && !this.camMode) {
      // driving pulls the framing back behind the mower
      const k = Math.min(1, dt / 1.5 * 2.2);
      this.chase.yaw += (0 - this.chase.yaw) * k;
      this.chase.pitch += (0 - this.chase.pitch) * k;
    }

    this.camBlend += (this.camMode - this.camBlend) * (this.snapped ? Math.min(1, dt * 3.4) : 1);
    const b = this.camBlend;

    const cYaw = m.angle + this.chase.yaw;
    const cPitch = clamp(this.CHASE_PITCH + this.chase.pitch, 0.14, 1.31);
    const cd = this.chase.dist;
    const chaseX = this.wx(m.x) - Math.cos(cYaw) * cd * Math.cos(cPitch);
    const chaseY = cd * Math.sin(cPitch);
    const chaseZ = this.wz(m.z) - Math.sin(cYaw) * cd * Math.cos(cPitch);

    const oPitch = clamp(this.OVER_PITCH + this.over.pitch, 0.2, 1.31);
    const od = this.over.dist;
    const overX = Math.sin(this.over.yaw) * od * Math.cos(oPitch);
    const overY = od * Math.sin(oPitch);
    const overZ = Math.cos(this.over.yaw) * od * Math.cos(oPitch);

    const tx = chaseX + (overX - chaseX) * b;
    const ty = chaseY + (overY - chaseY) * b;
    const tz = chaseZ + (overZ - chaseZ) * b;

    const cam = this.camera;
    // snap on the very first frame, otherwise a single-frame render (or a
    // headless screenshot) would show the camera still flying in
    const s = this.snapped ? Math.min(1, dt * 4.5) : 1;
    cam.position.x += (tx - cam.position.x) * s;
    cam.position.y += (ty - cam.position.y) * s;
    cam.position.z += (tz - cam.position.z) * s;

    // look ahead of the mower when you are behind it; swing the aim onto the
    // mower itself as you orbit around, so it never slides out of frame
    const ahead = 3.4 * Math.max(0, Math.cos(this.chase.yaw));
    const lx = this.wx(m.x) + Math.cos(m.angle) * ahead;
    const lz = this.wz(m.z) + Math.sin(m.angle) * ahead;
    this.lookAt.x += (lx + (0 - lx) * b - this.lookAt.x) * s;
    this.lookAt.y += (1.95 + (5 - 1.95) * b - this.lookAt.y) * s;
    this.lookAt.z += (lz + (0 - lz) * b - this.lookAt.z) * s;
    cam.lookAt(this.lookAt);

    this.updateWeather(dt, this.lookAt.x, this.lookAt.z, cam.position.y);
    this.snapped = true;

    this.renderer.render(this.scene, cam);
  }

  dispose() { this.renderer.dispose(); }
}
