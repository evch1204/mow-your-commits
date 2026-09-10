// What the mower leaves behind: clippings out of the chute, exhaust puffs, a
// ring of dust off the deck, two tyre ribbons pressed into the grass, and the
// +N label. Every pool is one instanced mesh, so mowing a whole year costs
// four draw calls instead of the two hundred and sixty it used to.

import * as THREE from 'three';
import { CLIP_MAX, FONT, POPUP_MERGE, clippingCount } from '../core/effects.js';
import { INK, ORANGE, clipColor } from '../core/palette.js';
import { seasonIndexOfCol } from '../core/lawn.js';
import { canvasTexture, dustTexture, trackTexture } from './doodle.js';
import { CLIP_POOL, PUFF_POOL, TRACK_LIFE, TRACK_PAIRS, TRACK_STEP, TRACK_HALF, TRACK_Y }
  from './theme.js';

/** A quad that always faces the camera, sized and placed by its own instance. */
const BILLBOARD = `
#include <common>
attribute float aAlpha;
varying float vA;
varying vec2 vUv;
void main() {
  vA = aAlpha;
  vUv = uv;
  float s = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  vec4 mv = modelViewMatrix * vec4(
    instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2], 1.0);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}`;

/** A quad placed by its own instance matrix, in the world. */
const FLAT = `
#include <common>
attribute float aAlpha;
varying float vA;
varying vec2 vUv;
void main() {
  vA = aAlpha;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FADE_FRAG = `
uniform sampler2D tMap;
uniform vec3 uColor;
varying float vA;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(tMap, vUv);
  float a = t.a * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * t.rgb, a);
  #include <colorspace_fragment>
}`;

function fadePool(vert, tex, color, n, geo) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: tex }, uColor: { value: new THREE.Color(color) } },
    vertexShader: vert, fragmentShader: FADE_FRAG,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const alpha = new Float32Array(n);
  geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alpha, 1));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = n;
  return { mesh, mat, alpha };
}

export function buildEffects(r) {
  // clippings: opaque little cubes, tinted per level by instanceColor
  r.clips = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.11, 0.11, 0.11),
    new THREE.MeshBasicMaterial(), CLIP_POOL,
  );
  r.clips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  r.clips.frustumCulled = false;
  r.clips.count = CLIP_POOL;
  r.scene.add(r.clips);
  r.clipState = [];
  for (let i = 0; i < CLIP_POOL; i++) {
    r.clipState.push({ live: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), rx: 0, rz: 0 });
  }
  r.clipNext = 0;
  hideAll(r.clips, r.dummy, CLIP_POOL);

  // exhaust puffs and the deck's dust ring share one soft-dot pool
  const puff = fadePool(BILLBOARD, dustTexture(), 0x8c8a84, PUFF_POOL,
    new THREE.PlaneGeometry(1, 1));
  r.puffs = puff.mesh;
  r.puffAlpha = puff.alpha;
  r.scene.add(r.puffs);
  r.puffState = [];
  for (let i = 0; i < PUFF_POOL; i++) {
    r.puffState.push({ live: 0, t: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), s: 0.2 });
  }
  r.puffNext = 0;
  hideAll(r.puffs, r.dummy, PUFF_POOL);
  r.puffAt = 0;

  // tyre tracks: two ribbons stamped into the grass behind the mower
  const trackGeo = new THREE.PlaneGeometry(0.34, 0.3);
  trackGeo.rotateX(-Math.PI / 2);
  const tr = fadePool(FLAT, trackTexture(), 0x2a3222, TRACK_PAIRS * 2, trackGeo);
  r.tracks = tr.mesh;
  r.trackAlpha = tr.alpha;
  r.tracks.renderOrder = 2;
  r.scene.add(r.tracks);
  r.trackAge = new Float32Array(TRACK_PAIRS * 2).fill(1e9);
  r.trackNext = 0;
  r.trackLast = null;
  hideAll(r.tracks, r.dummy, TRACK_PAIRS * 2);

  r.clippings = [];   // kept for the API's sake: the pools above replaced it
  r.popups = [];
}

function hideAll(mesh, d, n) {
  d.position.set(0, -999, 0);
  d.rotation.set(0, 0, 0);
  d.scale.setScalar(0.0001);
  d.updateMatrix();
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, d.matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

/** Cut grass out of the chute on the mower's right. */
export function throwClippings(r, cells) {
  const chute = r.localToWorld(0.66, 0.24, 0.1);
  const right = r.rightVector();
  let made = 0;
  for (const c of cells) {
    const season = seasonIndexOfCol(r.lawn, c.col);
    const hex = clipColor(c.level, season);
    const n = Math.min(clippingCount(c), CLIP_MAX - made);
    for (let k = 0; k < n; k++) {
      const i = r.clipNext = (r.clipNext + 1) % CLIP_POOL;
      const s = r.clipState[i];
      s.live = 28;
      s.p.copy(chute);
      s.v.set(
        right.x * 0.15 + (Math.random() - 0.5) * 0.08,
        0.09 + Math.random() * 0.07,
        right.z * 0.15 + (Math.random() - 0.5) * 0.08,
      );
      s.rx = Math.random() * 6.3;
      s.rz = Math.random() * 6.3;
      r.clips.setColorAt(i, r.tmpColor.set(hex));
      made++;
    }
  }
  if (made) r.clips.instanceColor.needsUpdate = true;
}

function spawnPuff(r, x, y, z, vx, vy, vz, s, life) {
  const i = r.puffNext = (r.puffNext + 1) % PUFF_POOL;
  const p = r.puffState[i];
  p.live = life;
  p.t = life;
  p.p.set(x, y, z);
  p.v.set(vx, vy, vz);
  p.s = s;
}

/** Exhaust while accelerating, plus a ring of dust off the deck over grass. */
export function stepParticles(r, dt) {
  const m = r.lawn.mower;
  const d = r.dummy;

  r.puffAt -= dt;
  if (m.acc > 0 && r.puffAt <= 0) {
    r.puffAt = 0.5;
    const at = r.localToWorld(-0.3, 0.78, -0.12);
    for (let k = 0; k < 3; k++) {
      spawnPuff(r, at.x + (Math.random() - 0.5) * 0.1, at.y + k * 0.06,
        at.z + (Math.random() - 0.5) * 0.1, 0, 0.03, 0, 0.22, 34);
    }
  }
  // dust ring: the deck kicks a little up whenever it is over standing grass
  if (Math.abs(m.vel) > 0.02 && overGrass(r)) {
    const a = Math.random() * Math.PI * 2;
    const at = r.localToWorld(Math.cos(a) * 0.5, 0.14, 0.16 + Math.sin(a) * 0.5);
    spawnPuff(r, at.x, at.y, at.z,
      Math.cos(a) * 0.02, 0.02 + Math.random() * 0.015, Math.sin(a) * 0.02, 0.16, 20);
  }

  for (let i = 0; i < r.puffState.length; i++) {
    const p = r.puffState[i];
    if (p.live <= 0) continue;
    p.p.add(p.v);
    p.live -= 1;
    const k = p.live / p.t;
    const s = p.s * (1 + (1 - k) * 1.5);
    d.position.copy(p.p);
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(p.live > 0 ? s : 0.0001);
    d.updateMatrix();
    r.puffs.setMatrixAt(i, d.matrix);
    r.puffAlpha[i] = Math.max(0, k) * 0.45;
  }
  r.puffs.instanceMatrix.needsUpdate = true;
  r.puffs.geometry.attributes.aAlpha.needsUpdate = true;

  for (let i = 0; i < r.clipState.length; i++) {
    const c = r.clipState[i];
    if (c.live <= 0) continue;
    c.p.add(c.v);
    c.v.y -= 0.008;
    c.rx += 0.2;
    c.rz += 0.15;
    c.live -= 1;
    d.position.copy(c.p);
    d.rotation.set(c.rx, 0, c.rz);
    d.scale.setScalar(c.live > 0 ? 1 : 0.0001);
    d.updateMatrix();
    r.clips.setMatrixAt(i, d.matrix);
  }
  r.clips.instanceMatrix.needsUpdate = true;
}

/** Is the blade standing over grass that has not been cut yet? */
function overGrass(r) {
  const l = r.lawn;
  const col = Math.floor(l.mower.x);
  const row = Math.floor(l.mower.z);
  if (col < 0 || col >= l.cols || row < 0 || row >= l.rows) return false;
  const c = l.cells[col * l.rows + row];
  return !!c && !c.void && c.level > 0 && !c.mowed;
}

/** Two ribbons pressed into the lawn, fading over TRACK_LIFE seconds. */
export function stepTracks(r, dt) {
  const m = r.lawn.mower;
  const d = r.dummy;
  const x = r.wx(m.x);
  const z = r.wz(m.z);
  const moved = r.trackLast ? Math.hypot(x - r.trackLast.x, z - r.trackLast.z) : 1e9;
  if (moved >= TRACK_STEP) {
    r.trackLast = { x, z };
    const right = r.rightVector();
    for (const s of [-1, 1]) {
      const i = r.trackNext = (r.trackNext + 1) % (TRACK_PAIRS * 2);
      d.position.set(x + right.x * TRACK_HALF * s, TRACK_Y, z + right.z * TRACK_HALF * s);
      d.rotation.set(0, Math.PI / 2 - m.angle, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      r.tracks.setMatrixAt(i, d.matrix);
      r.trackAge[i] = 0;
    }
    r.tracks.instanceMatrix.needsUpdate = true;
  }
  let any = false;
  for (let i = 0; i < r.trackAge.length; i++) {
    if (r.trackAge[i] > TRACK_LIFE) { r.trackAlpha[i] = 0; continue; }
    r.trackAge[i] += dt;
    r.trackAlpha[i] = Math.max(0, 1 - r.trackAge[i] / TRACK_LIFE) * 0.8;
    any = true;
  }
  if (any) r.tracks.geometry.attributes.aAlpha.needsUpdate = true;
}

export function resetEffects(r) {
  hideAll(r.clips, r.dummy, CLIP_POOL);
  hideAll(r.puffs, r.dummy, PUFF_POOL);
  hideAll(r.tracks, r.dummy, TRACK_PAIRS * 2);
  for (const s of r.clipState) s.live = 0;
  for (const p of r.puffState) p.live = 0;
  r.trackAge.fill(1e9);
  r.trackAlpha.fill(0);
  r.trackLast = null;
  r.tracks.geometry.attributes.aAlpha.needsUpdate = true;
  for (const p of r.popups) {
    r.scene.remove(p.sp);
    p.sp.material.map.dispose();
    p.sp.material.dispose();
  }
  r.popups.length = 0;
}

/** The label a cut throws up: `+12`, `+40!`, and with a streak, `+12 x4`. */
function popupTexture(n, heroic, combo) {
  const label = '+' + n + (heroic ? '!' : '') + (combo >= 3 ? ` x${combo}` : '');
  return canvasTexture(384, 128, (g) => {
    g.clearRect(0, 0, 384, 128);
    g.font = `84px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.lineJoin = 'round';
    g.strokeStyle = '#FBF9F2'; g.strokeText(label, 192, 66);
    g.fillStyle = n >= 25 || combo >= 3 ? ORANGE : INK;
    g.fillText(label, 192, 64);
    if (n >= 25 || combo >= 3) {
      g.lineWidth = 3; g.strokeStyle = INK; g.strokeText(label, 192, 64);
    }
  });
}

const popupScale = (n, combo) =>
  (2.9 + Math.min(1.6, n * 0.04)) * (combo >= 3 ? 1.25 : 1);

/** A bigger day gets a bigger number; a streak gets a multiplier and a size. */
export function spawnPopup(r, n, heroic) {
  const combo = r.lawn.combo || 0;
  const last = r.popups[r.popups.length - 1];
  if (last && last.age < POPUP_MERGE) {
    last.n += n;
    last.heroic = last.heroic || heroic;
    last.combo = combo;
    last.sp.material.map.dispose();
    last.sp.material.map = popupTexture(last.n, last.heroic, combo);
    last.sp.material.needsUpdate = true;
    const s2 = popupScale(last.n, combo);
    last.sp.scale.set(s2, s2 / 3, 1);
    return;
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: popupTexture(n, heroic, combo), transparent: true, depthTest: false, fog: false,
  }));
  const m = r.lawn.mower;
  const j = (r.popups.length % 3) - 1;
  sp.position.set(
    r.wx(m.x) - Math.sin(m.angle) * j * 0.9,
    2.2 + j * 0.25,
    r.wz(m.z) + Math.cos(m.angle) * j * 0.9,
  );
  const s = popupScale(n, combo);
  sp.scale.set(s, s / 3, 1);
  sp.renderOrder = 10;
  r.scene.add(sp);
  r.popups.push({ sp, t: 0, age: 0, n, heroic, combo });
  if (r.popups.length > 8) {
    const old = r.popups.shift();
    r.scene.remove(old.sp);
    old.sp.material.map.dispose();
    old.sp.material.dispose();
  }
}

/** The +N labels, rising and fading. */
export function stepPopups(r, dt) {
  for (let i = r.popups.length - 1; i >= 0; i--) {
    const p = r.popups[i];
    p.age += dt;
    p.t += dt / 0.9;
    p.sp.position.y += dt * 1.5;
    p.sp.material.opacity = p.t < 0.6 ? 1 : Math.max(0, 1 - (p.t - 0.6) / 0.4);
    if (p.t >= 1) {
      r.scene.remove(p.sp);
      p.sp.material.map.dispose();
      p.sp.material.dispose();
      r.popups.splice(i, 1);
    }
  }
}
