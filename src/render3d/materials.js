// The doodle look, as materials: the "boiling" vertex jitter every line in the
// scene rides on, the wind sway the grass adds to it, cel shading through a
// three-step gradient map, and the inverted-hull outline.

import * as THREE from 'three';
import { INK_HEX } from './theme.js';

/** Per-vertex jitter, re-seeded a few times per second: a line that boils. */
export const BOIL = (k) => `
transformed += ${k.toFixed(3)} * vec3(
  sin(position.y * 9.0 + position.z * 3.0 + uSeed), 0.0,
  cos(position.x * 7.0 + position.y * 4.0 + uSeed * 1.7));
`;

/** Wind, leaning an instanced tuft further the taller it is. */
export const SWAY = `
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

/**
 * A billboard that keeps its feet on the ground: the quad is built in view
 * space around the instance's own world position, so a tree card faces the
 * camera however far the visitor orbits, but never tips backwards like a
 * THREE.Sprite does. `position.y` runs 0..1, so the card grows upward from
 * where it is planted.
 */
const BILLBOARD_VERT = `
#include <common>
#include <fog_pars_vertex>
attribute vec2 aSize;
attribute float aPhase;
uniform float uSeed;
uniform float uTime;
uniform float uSpin;
varying vec2 vUv;
varying float vPhase;
void main() {
  vUv = uv;
  vPhase = aPhase;
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  vec4 mv = modelViewMatrix * vec4(ip, 1.0);
  float boil = sin(uSeed * 1.3 + aPhase * 6.28 + position.y * 3.0) * 0.012;
  // uSpin is 0 for everything but the windmill, and turns the card about its
  // own middle rather than about its feet
  vec2 q = vec2(position.x + boil, position.y - 0.5);
  float cs = cos(uSpin), sn = sin(uSpin);
  q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
  mv.x += q.x * aSize.x;
  mv.y += (q.y + 0.5) * aSize.y;
  #ifdef USE_FOG
    vFogDepth = -mv.z;
  #endif
  gl_Position = projectionMatrix * mv;
}`;

/**
 * One card, three season faces, mixed in the shader. Cross-fading trees as
 * three stacked transparent sprites cost three draw calls each and sorted
 * badly against one another; mixing the faces here keeps every tree of a shape
 * in one alpha-tested instanced mesh, so the whole treeline is three calls.
 */
const TREE_FRAG = `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D tA;
uniform sampler2D tB;
uniform sampler2D tC;
uniform vec3 uW;
uniform vec3 uTint;
varying vec2 vUv;
varying float vPhase;
void main() {
  vec4 a = texture2D(tA, vUv);
  vec4 b = texture2D(tB, vUv);
  vec4 c = texture2D(tC, vUv);
  vec4 col = a * uW.x + b * uW.y + c * uW.z;
  float w = max(uW.x + uW.y + uW.z, 0.001);
  if (col.a < 0.42 * w) discard;
  gl_FragColor = vec4(col.rgb / w * uTint, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

const CARD_FRAG = `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D tA;
uniform vec3 uTint;
uniform float uCut;
uniform float uAlpha;
varying vec2 vUv;
varying float vPhase;
void main() {
  vec4 col = texture2D(tA, vUv);
  float a = col.a * uAlpha;
  if (a < uCut) discard;
  gl_FragColor = vec4(col.rgb * uTint, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

/** Shared boil/sway uniforms live on every compiled shader; see `tick`. */
export class Materials {
  constructor() {
    this.shaders = [];
    this.billboards = [];

    // three-step gradient map = cel shading
    const grad = new THREE.DataTexture(
      new Uint8Array([120, 120, 120, 255, 205, 205, 205, 255, 255, 255, 255, 255]),
      3, 1, THREE.RGBAFormat,
    );
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.needsUpdate = true;
    this.grad = grad;

    this.ink = this.wobbly(
      new THREE.MeshBasicMaterial({ color: INK_HEX, side: THREE.BackSide }),
    );
  }

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
      this.shaders.push({ s, mat });
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
    const o = new THREE.Mesh(geo, this.ink);
    o.scale.setScalar(scale);
    g.add(o);
    return g;
  }

  /** An instanced ground-planted billboard with three season faces. */
  seasonCard(a, b, c) {
    return this.billboard(TREE_FRAG, { tA: a, tB: b, tC: c, uW: new THREE.Vector3(0, 1, 0) });
  }

  /**
   * An instanced ground-planted billboard with one face. Alpha-tested by
   * default (hard doodle edges, no sorting); `fade` makes it a blended card
   * whose `uAlpha` a season weight can drive.
   */
  card(tex, opts = {}) {
    const m = this.billboard(CARD_FRAG, {
      tA: tex, uCut: opts.fade ? 0.02 : 0.42, uAlpha: 1,
    });
    if (opts.fade) { m.transparent = true; m.depthWrite = false; }
    return m;
  }

  billboard(frag, extra) {
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSeed: { value: 0 }, uTime: { value: 0 }, uSpin: { value: 0 },
        uTint: { value: new THREE.Color(0xffffff) },
      },
    ]);
    for (const k of Object.keys(extra)) uniforms[k] = { value: extra[k] };
    const m = new THREE.ShaderMaterial({
      uniforms, fog: true, vertexShader: BILLBOARD_VERT, fragmentShader: frag,
    });
    this.billboards.push(m);
    return m;
  }

  /**
   * Mark a material dead, so `tick` stops writing uniforms into a shader whose
   * mesh has been thrown away. A year switch rebuilds the whole board, and
   * without this the two lists grew by a dozen entries per switch.
   */
  static forget(mat) { if (mat) mat.userData.gone = true; }

  /** One place that pushes the frame's boil seed and clock into every shader. */
  tick(seed, time) {
    this.shaders = this.shaders.filter((e) => !e.mat.userData.gone);
    this.billboards = this.billboards.filter((m) => !m.userData.gone);
    for (const e of this.shaders) {
      e.s.uniforms.uSeed.value = seed;
      e.s.uniforms.uTime.value = time;
    }
    for (const m of this.billboards) {
      m.uniforms.uSeed.value = seed;
      m.uniforms.uTime.value = time;
    }
  }
}

/**
 * The per-instance size and phase a billboard material needs. Sizes are half
 * widths and full heights in world units, so a card of `w` x `h` is planted at
 * its instance position and grows up from it.
 */
export function billboardAttributes(mesh, sizes, phases) {
  mesh.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 2));
  mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
}

/** A quad whose x runs -0.5..0.5 and whose y runs 0..1: a card on its feet. */
export function cardQuad() {
  const g = new THREE.PlaneGeometry(1, 1);
  g.translate(0, 0.5, 0);
  return g;
}
