// Renderer3D: the paper diorama. The lawn, popped up off the page, drawn by
// the same hand as the flat view — ink outlines, flat fills, a line that boils.
//
// This file is the wiring only; the drawing lives next door:
//   theme.js      3D-only colours and numbers
//   materials.js  boil, sway, cel shading, ink hulls, billboard cards
//   doodle.js     every canvas-drawn texture
//   board.js      slab, meadow, fence, signs, hills, trees, props
//   grass.js      day tiles and the doodle grass cards
//   mower.js      the rig
//   weather.js    season weights: sky, fog, snow, leaves, fluff, sky props
//   camera.js     chase <-> overview, orbit, fit
//   effects.js    clippings, puffs, dust, tyre tracks, +N popups
//   post.js       the screen-space sketch pass

import * as THREE from 'three';
import { ROWS, seasonIndexAt } from '../core/lawn.js';
import { SKY_HORIZON } from '../core/palette.js';
import { Materials } from './materials.js';
import { OVER_PITCH, OVER_FALLBACK } from './theme.js';
import { buildBoard, buildSigns } from './board.js';
import { buildTiles, buildGrass, setCell, applyLawn, flagDirty } from './grass.js';
import { buildMower, poseMower } from './mower.js';
import { buildColors, buildSky, buildWeather, updateWeather } from './weather.js';
import { bindOrbit, fitOverview, zoom, resetOrbit, updateCamera } from './camera.js';
import {
  buildEffects, throwClippings, stepParticles, stepTracks, resetEffects,
  spawnPopup, stepPopups,
} from './effects.js';
import { SketchPass } from './post.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** URL flags this renderer owns. Read once, so a share link never carries them. */
function flags() {
  const s = typeof location === 'undefined' ? '' : location.search;
  const p = new URLSearchParams(s);
  return { sketch: p.get('sketch') !== '0', stats: p.get('stats') === '1' };
}

export class Renderer3D {
  constructor(canvas, lawn) {
    this.canvas = canvas;
    this.lawn = lawn;
    this.flags = flags();
    this.seedVal = 0;
    this.lastBoil = 0;
    this.time = 0;
    this.anim = new Set();
    this.cutAt = new Map();

    // camera: chase <-> overview, each with its own look-around offset
    this.camMode = 0;
    this.camBlend = 0;
    this.chase = { yaw: 0, pitch: 0, dist: 9.6 };
    this.over = { yaw: 0, pitch: 0, dist: OVER_FALLBACK };
    this.overFit = OVER_FALLBACK;
    this.overZoomed = false;
    this.CHASE_PITCH = 0.5;
    this.OVER_PITCH = OVER_PITCH;
    this.gasHeld = 0;
    this.signScale = 1;
    this.snapped = false;

    // weather weights: winter, spring, summer, autumn
    this.weatherMix = [0, 0, 0, 0];
    this.weatherMix[seasonIndexAt(lawn, lawn.mower.x)] = 1;
    this.fenceZ = -ROWS / 2 - 1.7;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_HORIZON[2]);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
    this.lookAt = new THREE.Vector3(0, 0.5, 0);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xa0b080, 0.95);
    this.scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.15);
    this.dir.position.set(6, 14, 10);
    this.scene.add(this.dir);

    this.mats = new Materials();
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    this.tmpColorB = new THREE.Color();

    this.post = this.flags.sketch ? SketchPass.create(this.renderer) : null;
    this.resize();

    buildColors(this);
    buildSky(this);
    buildTiles(this);
    buildGrass(this);
    buildWeather(this);
    buildMower(this);
    buildEffects(this);
    buildBoard(this);
    bindOrbit(this);
    this.applyLawn();
  }

  // --- geometry helpers used by every module ---------------------------

  wx(x) { return x - this.lawn.cols / 2; }
  wz(z) { return z - this.lawn.rows / 2; }

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

  // --- public API -------------------------------------------------------

  setLawn(lawn) {
    this.lawn = lawn;
    buildBoard(this);
    this.reset();               // last year's popups and clippings are not this year's
    fitOverview(this);          // a 54-week year needs the camera further back
    this.snapped = false;
    this.weatherMix = [0, 0, 0, 0];
    this.weatherMix[seasonIndexAt(lawn, lawn.mower.x)] = 1;
  }

  reset() {
    resetEffects(this);
    this.applyLawn();
  }

  applyLawn() { applyLawn(this); }

  /** @param quiet true for the end-card confetti: clippings only, no label. */
  onMowed(indices, quiet) {
    const cut = [];
    let sum = 0;
    let heroic = false;
    for (const i of indices) {
      const c = this.lawn.cells[i];
      if (!c || c.void) continue;
      sum += c.count;
      if (c.heroic) heroic = true;
      this.anim.add(i);
      this.cutAt.set(i, this.time);
      setCell(this, i);
      cut.push(c);
    }
    throwClippings(this, cut);
    if (sum > 0 && !quiet) spawnPopup(this, sum, heroic);
    if (indices.length) flagDirty(this);
  }

  toggleCamera() { this.camMode = this.camMode ? 0 : 1; return this.camMode; }
  setCamera(mode) { this.camMode = mode === 'overview' ? 1 : 0; }

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
    this.over.dist = clamp(d, this.overFit * 0.5, this.overFit * 2);
    this.overZoomed = true;
  }

  resize() {
    const w = this.canvas.clientWidth || 720;
    const h = this.canvas.clientHeight || 460;
    this.sizedW = w;
    this.sizedH = h;
    // a new frame shape means a new framing: track it exactly rather than
    // flying the camera to it, or a resize (and a headless screenshot, which
    // runs only a few frames) catches the camera mid-flight
    this.reframed = true;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h, this.renderer.getPixelRatio());
    fitOverview(this);     // a narrower frame needs a longer lens on the year
  }

  /**
   * The stage can change shape without a window resize: switching views, and
   * the letterbox the overview puts on the canvas. Catch it on the frame.
   */
  checkSize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w && h && (w !== this.sizedW || h !== this.sizedH)) this.resize();
  }

  // --- frame -------------------------------------------------------------

  draw(ts) {
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 1 / 60;
    this.lastTs = ts;
    this.time += dt;
    this.checkSize();

    if (ts - this.lastBoil > 110) { this.seedVal += 1.7; this.lastBoil = ts; }
    this.mats.tick(this.seedVal, this.time);

    this.stepMowAnimations();
    poseMower(this);
    stepParticles(this, dt);
    stepTracks(this, dt);
    stepPopups(this, dt);
    updateCamera(this, dt);
    updateWeather(this, dt, this.lookAt.x, this.lookAt.z);
    this.snapped = true;

    if (this.post) this.post.render(this.scene, this.camera, this.seedVal);
    else this.renderer.render(this.scene, this.camera);

    if (this.flags.stats && !this.logged) {
      this.logged = true;
      const info = this.renderer.info.render;
      console.log('[lawn3d] draw calls', this.post ? this.post.calls : info.calls,
        'triangles', this.post ? this.post.tris : info.triangles,
        'sketch', !!this.post);
    }
  }

  /** Cells still playing their mow animation, and the flash that follows it. */
  stepMowAnimations() {
    const cells = this.lawn.cells;
    if (!this.anim.size) return;
    for (const i of Array.from(this.anim)) {
      setCell(this, i);
      const at = this.cutAt.get(i);
      if (cells[i].mowT >= 1 && (at === undefined || this.time - at > 1.2)) {
        this.anim.delete(i);
        this.cutAt.delete(i);
      }
    }
    flagDirty(this);
  }

  // kept for parity with the old class: main.js never calls these, but the
  // orbit binding and the tests reach for them by name
  zoom(d) { zoom(this, d); }
  resetOrbit() { resetOrbit(this); }
  fitOverview() { fitOverview(this); }
  buildSigns() { buildSigns(this); }
}
