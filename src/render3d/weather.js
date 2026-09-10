// Weather is whatever season the mower is standing in, eased across the border:
// four weights that drive the sky dome, the fog, the lights, the meadow colour,
// the snow, the blossom, the leaves, the fluff, and the props on the skyline.

import * as THREE from 'three';
import { seasonIndexAt } from '../core/lawn.js';
import { PETAL, SKY_TOP, SKY_HORIZON, MEADOW_BY_SEASON, SUN_LIGHT } from '../core/palette.js';
import {
  HEMI, DIR_INTENSITY, AUTUMN_TRIO, LEAF_N, FOG_NEAR, FOG_FAR, SKY_DIST, SKY_RISE,
} from './theme.js';
import { flakeTexture, fluffTexture, leafTexture, sunTexture, cloudTexture } from './doodle.js';
import { stepProps } from './board.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * The four seasons of sky, ground and light as THREE.Colors, plus the scratch
 * colours updateWeather mixes them into. Built once: every frame blends the
 * same five palettes.
 */
export function buildColors(r) {
  r.topColors = SKY_TOP.map((h) => new THREE.Color(h));
  r.horizonColors = SKY_HORIZON.map((h) => new THREE.Color(h));
  r.hemiColors = HEMI.map((h) => new THREE.Color(h));
  r.meadowColors = MEADOW_BY_SEASON.map((h) => new THREE.Color(h));
  r.sunColors = SUN_LIGHT.map((h) => new THREE.Color(h));
  r.cTop = new THREE.Color();
  r.cHorizon = new THREE.Color();
  r.cHemi = new THREE.Color();
  r.cMeadow = new THREE.Color();
  r.cSun = new THREE.Color();
}

/**
 * A gradient dome instead of a flat clear colour, plus distance fog in the same
 * horizon colour, so the meadow dissolves into the sky rather than ending on a
 * hard line.
 */
export function buildSky(r) {
  r.skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(SKY_TOP[2]) },
      uHorizon: { value: new THREE.Color(SKY_HORIZON[2]) },
    },
    vertexShader: `
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      varying float vY;
      void main() {
        gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(-0.02, 0.45, vY)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  r.sky = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 12), r.skyMat);
  r.sky.frustumCulled = false;
  r.scene.add(r.sky);
  r.scene.fog = new THREE.Fog(new THREE.Color(SKY_HORIZON[2]), FOG_NEAR, FOG_FAR);
}

export function buildWeather(r) {
  // winter: doodle asterisks, not soft dots
  const N = 420;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 28;
    pos[i * 3 + 1] = Math.random() * 10;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 24;
  }
  r.snowGeo = new THREE.BufferGeometry();
  r.snowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  r.snowMat = new THREE.PointsMaterial({
    map: flakeTexture(), size: 0.5, transparent: true, opacity: 0,
    depthWrite: false, fog: false, alphaTest: 0.05,
  });
  r.snow = new THREE.Points(r.snowGeo, r.snowMat);
  r.snow.frustumCulled = false;
  r.scene.add(r.snow);

  // summer: dandelion fluff drifting upward
  const F = 80;
  const fpos = new Float32Array(F * 3);
  for (let i = 0; i < F; i++) {
    fpos[i * 3] = (Math.random() - 0.5) * 28;
    fpos[i * 3 + 1] = Math.random() * 8;
    fpos[i * 3 + 2] = (Math.random() - 0.5) * 24;
  }
  r.fluffGeo = new THREE.BufferGeometry();
  r.fluffGeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  r.fluffMat = new THREE.PointsMaterial({
    map: fluffTexture(), size: 0.3, transparent: true, opacity: 0,
    depthWrite: false, fog: false,
  });
  r.fluff = new THREE.Points(r.fluffGeo, r.fluffMat);
  r.fluff.frustumCulled = false;
  r.scene.add(r.fluff);

  // autumn leaves, which double as spring blossom. One instanced quad: as 44
  // separate meshes they were a third of the frame's draw calls on their own.
  r.leafMat = new THREE.MeshBasicMaterial({
    map: leafTexture(), side: THREE.DoubleSide, transparent: true, opacity: 0,
  });
  r.leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34, 0.21), r.leafMat, LEAF_N);
  r.leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  r.leaves.frustumCulled = false;
  r.leaves.visible = false;
  r.leafSpring = null;      // which palette the instance colours are holding
  r.leafState = [];
  for (let l = 0; l < LEAF_N; l++) {
    r.leafState.push({
      x: (Math.random() - 0.5) * 26, y: Math.random() * 8, z: (Math.random() - 0.5) * 22,
      rx: Math.random() * 6.28, rz: Math.random() * 6.28,
      v: 0.012 + Math.random() * 0.022,
    });
  }
  r.scene.add(r.leaves);

  // anchored to the camera target, high up behind the fence. Sky props are
  // never fogged, or they would sink into the haze they sit above.
  const sunTex = sunTexture();
  r.sun = sprite(r, sunTex, 0, 7, -14, 5);
  // a second, pale, low sun for the cold months
  r.coldSun = sprite(r, sunTex, 0, 5, -14, 4);
  r.coldSun.material.color.set('#F3EBD8');
  const cloudTex = cloudTexture();
  r.clouds = [
    sprite(r, cloudTex, -7, 6.2, -13, 4.6),
    sprite(r, cloudTex, 5, 7.4, -14, 3.8),
    sprite(r, cloudTex, 12, 5.6, -12, 3.2),
  ];
}

function sprite(r, tex, x, y, z, s) {
  // never depth-tested: a sky prop hangs above the horizon, and a hill line
  // that happens to be nearer must not take a bite out of the sun
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, fog: false, depthTest: false, depthWrite: false,
  }));
  sp.renderOrder = -1;
  sp.position.set(x, y, z);
  sp.scale.set(s, s, 1);
  r.scene.add(sp);
  return sp;
}

export function updateWeather(r, dt, tx, tz) {
  const want = seasonIndexAt(r.lawn, r.lawn.mower.x);
  const k = r.snapped ? Math.min(1, dt * 1.2) : 1;
  const wm = r.weatherMix;
  for (let i = 0; i < 4; i++) wm[i] += ((i === want ? 1 : 0) - wm[i]) * k;

  updateSky(r, wm);
  stepSnow(r, wm, tx, tz);
  stepLeaves(r, wm, tx, tz);
  stepFluff(r, wm, tx, tz);
  updateSkyProps(r, wm);
  stepProps(r, wm);
}

/** Sky, ground, fog and lights all follow the mix. */
function updateSky(r, wm) {
  const top = r.cTop.setRGB(0, 0, 0);
  const horizon = r.cHorizon.setRGB(0, 0, 0);
  const hemi = r.cHemi.setRGB(0, 0, 0);
  const meadow = r.cMeadow.setRGB(0, 0, 0);
  const sunlight = r.cSun.setRGB(0, 0, 0);
  let intensity = 0;
  const add = (dst, src, w) => { dst.r += src.r * w; dst.g += src.g * w; dst.b += src.b * w; };
  for (let i = 0; i < 4; i++) {
    if (wm[i] < 0.002) continue;
    const w = wm[i];
    add(top, r.topColors[i], w);
    add(horizon, r.horizonColors[i], w);
    add(hemi, r.hemiColors[i], w);
    add(meadow, r.meadowColors[i], w);
    add(sunlight, r.sunColors[i], w);
    intensity += DIR_INTENSITY[i] * w;
  }
  r.skyMat.uniforms.uTop.value.copy(top);
  r.skyMat.uniforms.uHorizon.value.copy(horizon);
  r.scene.background.copy(horizon);
  r.scene.fog.color.copy(horizon);
  r.hemi.color.copy(hemi);
  r.hemi.groundColor.copy(meadow);
  r.dir.intensity = intensity || 1;
  r.dir.color.copy(sunlight);
  // the meadow keeps its own colour now; the fog is what makes it a horizon
  r.apronMat.color.copy(meadow);
  if (r.meadowMat) r.meadowMat.uniforms.uTint.value.copy(meadow).multiplyScalar(0.62);
  // the hill lines are the same ground, further away and paler
  if (r.hillMats) {
    for (const m of r.hillMats) {
      const spec = m.userData.spec;
      m.color.copy(meadow).multiplyScalar(spec.mul).lerp(horizon, spec.lerp);
    }
  }
}

/** Snow, always around the mower so it is weather and not scenery. */
function stepSnow(r, wm, tx, tz) {
  r.snowMat.opacity = wm[0];
  r.snow.visible = wm[0] > 0.01;
  if (!r.snow.visible) return;
  const pos = r.snowGeo.attributes.position.array;
  for (let s = 0; s < pos.length / 3; s++) {
    pos[s * 3 + 1] -= 0.024;
    pos[s * 3] += Math.sin(r.time * 1.4 + s) * 0.006;
    const gone = pos[s * 3 + 1] < -0.6
      || Math.abs(pos[s * 3] - tx) > 16 || Math.abs(pos[s * 3 + 2] - tz) > 15;
    if (gone) {
      pos[s * 3] = tx + (Math.random() - 0.5) * 28;
      pos[s * 3 + 1] = 6 + Math.random() * 5;
      pos[s * 3 + 2] = tz + (Math.random() - 0.5) * 24;
    }
  }
  r.snowGeo.attributes.position.needsUpdate = true;
}

/** One pool, autumn leaves or spring blossom, whichever season is nearer. */
function stepLeaves(r, wm, tx, tz) {
  const spring = wm[1] > wm[3];
  const falling = clamp(wm[3] + 0.6 * wm[1], 0, 1);
  r.leafMat.opacity = falling;
  r.leaves.visible = falling > 0.01;
  if (!r.leaves.visible) return;
  if (r.leafSpring !== spring) {       // only at the season border
    r.leafSpring = spring;
    for (let i = 0; i < LEAF_N; i++) {
      r.leaves.setColorAt(i, r.tmpColor.set(spring ? PETAL[i % 2] : AUTUMN_TRIO[i % 3]));
    }
    r.leaves.instanceColor.needsUpdate = true;
  }
  const d = r.dummy;
  for (let i = 0; i < LEAF_N; i++) {
    const lf = r.leafState[i];
    lf.y -= lf.v * (spring ? 0.6 : 1);
    lf.x += Math.sin(r.time * 1.7 + i) * 0.012;
    lf.rx += 0.03; lf.rz += 0.02;
    if (lf.y < 0.1 || Math.abs(lf.x - tx) > 15 || Math.abs(lf.z - tz) > 14) {
      lf.x = tx + (Math.random() - 0.5) * 26;
      lf.y = 5 + Math.random() * 4;
      lf.z = tz + (Math.random() - 0.5) * 22;
    }
    d.position.set(lf.x, lf.y, lf.z);
    d.rotation.set(lf.rx, 0, lf.rz);
    d.scale.setScalar(1);
    d.updateMatrix();
    r.leaves.setMatrixAt(i, d.matrix);
  }
  r.leaves.instanceMatrix.needsUpdate = true;
}

/** Summer: dandelion fluff drifting up out of the grass. */
function stepFluff(r, wm, tx, tz) {
  r.fluffMat.opacity = wm[2];
  r.fluff.visible = wm[2] > 0.01;
  if (!r.fluff.visible) return;
  const fp = r.fluffGeo.attributes.position.array;
  for (let s = 0; s < fp.length / 3; s++) {
    fp[s * 3 + 1] += 0.012;
    fp[s * 3] += Math.sin(r.time * 0.9 + s) * 0.008;
    const gone = fp[s * 3 + 1] > 7
      || Math.abs(fp[s * 3] - tx) > 16 || Math.abs(fp[s * 3 + 2] - tz) > 15;
    if (gone) {
      fp[s * 3] = tx + (Math.random() - 0.5) * 28;
      fp[s * 3 + 1] = 0.2 + Math.random() * 1.2;
      fp[s * 3 + 2] = tz + (Math.random() - 0.5) * 24;
    }
  }
  r.fluffGeo.attributes.position.needsUpdate = true;
}

const fwd = new THREE.Vector3();
const side = new THREE.Vector3();

/**
 * Sun and clouds, hung on the horizon the camera is actually looking at. They
 * used to sit at a fixed spot behind the fence, which put them ninety degrees
 * off frame the moment you drove along the year; now they ride `SKY_DIST`
 * ahead of the camera and `SKY_RISE` above it, which is just over the horizon
 * line from either camera.
 */
function skyPlace(r, sp, along, across, rise, scale) {
  const c = r.camera.position;
  sp.position.set(
    c.x + fwd.x * SKY_DIST * along + side.x * across,
    c.y + SKY_RISE + rise,
    c.z + fwd.z * SKY_DIST * along + side.z * across,
  );
  sp.scale.setScalar(scale);
}

/** Sun, clouds and the treeline: what the season does to the sky. */
function updateSkyProps(r, wm) {
  r.camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  side.set(-fwd.z, 0, fwd.x);

  const sunny = clamp(wm[2] + wm[1] * 0.5 + wm[3] * 0.25, 0, 1);
  r.sun.material.opacity = sunny;
  r.sun.visible = sunny > 0.02;
  r.sun.material.rotation += 0.004;
  // in summer the sun climbs; in the cold months a pale one sits low
  skyPlace(r, r.sun, 1, 15, 2.6 + 1.8 * wm[2], 8 + sunny * 2);
  r.coldSun.material.opacity = 0.45 * wm[0];
  r.coldSun.visible = wm[0] > 0.02;
  skyPlace(r, r.coldSun, 1, 15, 1.0, 7.5);

  // bare and snow-lined, in leaf, or in autumn: one uniform per tree deck
  const inLeaf = clamp(wm[1] + wm[2], 0, 1);
  for (const m of r.treeMats || []) m.uniforms.uW.value.set(wm[0], inLeaf, wm[3]);

  const cloudy = clamp(wm[1] + wm[3] + wm[0] * 0.6, 0, 1);
  r.clouds.forEach((cl, i) => {
    cl.material.opacity = cloudy * 0.95;
    cl.visible = cloudy > 0.02;
    const drift = ((r.time * 1.1 + i * 21) % 62) - 31;
    skyPlace(r, cl, 0.94 + i * 0.05, drift - i * 7, 2.6 + i * 1.1, 8.5 - i * 1.2);
  });
}
