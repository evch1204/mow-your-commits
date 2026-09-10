// The sketch pass. The scene is rendered into an off-screen target that also
// keeps its depth, and one full-screen shader turns that depth into ink: a
// six-tap difference over linearised depth draws a line wherever the world
// steps away from itself, paper grain multiplies over the top, a faint
// vignette closes the corners, and the whole edge sample wanders on a
// low-frequency noise re-seeded with `uSeed`, so the ink boils like the rest
// of the drawing.
//
// The mower keeps its inverted-hull outlines: those draw the panel lines the
// depth buffer cannot see. The pass is skipped entirely without WebGL2, and
// `?sketch=0` turns it off for comparison shots.

import * as THREE from 'three';
import { INK } from '../core/palette.js';
import { SKETCH } from './theme.js';

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uRes;
uniform vec2 uNearFar;
uniform float uSeed;
uniform float uEdge;
uniform float uThreshold;
uniform float uGrain;
uniform float uVignette;
uniform float uBoil;
uniform vec3 uInk;
varying vec2 vUv;

/** Perspective depth -> distance in world units, so one threshold fits all. */
float lin(vec2 uv) {
  float z = texture2D(tDepth, uv).x;
  float n = uNearFar.x, f = uNearFar.y;
  return (2.0 * n * f) / (f + n - (z * 2.0 - 1.0) * (f - n));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 wob = vec2(noise(vUv * 5.0 + uSeed), noise(vUv * 5.0 + 19.7 + uSeed)) - 0.5;
  vec2 uv = vUv + wob * uBoil * uTexel;

  float d = lin(uv);
  float e = 0.0;
  e += abs(lin(uv + vec2(uTexel.x, 0.0)) - d);
  e += abs(lin(uv - vec2(uTexel.x, 0.0)) - d);
  e += abs(lin(uv + vec2(0.0, uTexel.y)) - d);
  e += abs(lin(uv - vec2(0.0, uTexel.y)) - d);
  e += 0.7 * abs(lin(uv + uTexel) - d);
  e += 0.7 * abs(lin(uv - uTexel) - d);

  // the threshold grows with distance, so a hedge is inked and the hills are not
  float t = uThreshold * d * (1.0 + d * 0.9);
  float edge = smoothstep(t, t * 5.0, e);

  vec3 col = texture2D(tDiffuse, vUv).rgb;
  col = mix(col, uInk, clamp(edge * uEdge, 0.0, 1.0));

  float g = noise(vUv * uRes * 0.5) * 0.6 + noise(vUv * uRes * 0.13) * 0.4;
  col *= 1.0 - uGrain * (0.55 - g);

  float v = distance(vUv, vec2(0.5));
  col *= 1.0 - uVignette * smoothstep(0.40, 0.98, v);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class SketchPass {
  /** @returns a pass, or null when this browser cannot run one. */
  static create(renderer) {
    if (!renderer.capabilities.isWebGL2) return null;
    try {
      return new SketchPass(renderer);
    } catch (err) {
      console.warn('sketch pass unavailable', err);
      return null;
    }
  }

  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      samples: 4,
    });
    this.target.depthTexture = new THREE.DepthTexture(2, 2);
    this.target.depthTexture.type = THREE.UnsignedIntType;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2(1 / 2, 1 / 2) },
        uRes: { value: new THREE.Vector2(2, 2) },
        uNearFar: { value: new THREE.Vector2(0.1, 600) },
        uSeed: { value: 0 },
        uEdge: { value: SKETCH.edge },
        uThreshold: { value: SKETCH.threshold },
        uGrain: { value: SKETCH.grain },
        uVignette: { value: SKETCH.vignette },
        uBoil: { value: SKETCH.boil },
        uInk: { value: new THREE.Color(INK) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h, pixelRatio) {
    const pw = Math.max(2, Math.floor(w * pixelRatio));
    const ph = Math.max(2, Math.floor(h * pixelRatio));
    this.target.setSize(pw, ph);
    this.material.uniforms.uTexel.value.set(1 / pw, 1 / ph);
    this.material.uniforms.uRes.value.set(pw, ph);
  }

  render(scene, camera, seed) {
    const u = this.material.uniforms;
    u.uSeed.value = seed;
    u.uNearFar.value.set(camera.near, camera.far);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    // renderer.info resets on every render(), so grab the scene's own count
    // before the full-screen quad overwrites it with 1
    this.calls = this.renderer.info.render.calls;
    this.tris = this.renderer.info.render.triangles;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.target.depthTexture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
