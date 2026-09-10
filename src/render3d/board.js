// Everything the lawn stands in: the dirt slab it is cut into, the meadow that
// runs to the horizon, the fence and its month signs, three layered hand-drawn
// hill lines, a treeline that changes with the season, and the farm props that
// make the frame worth a screenshot.

import * as THREE from 'three';
import { ROWS } from '../core/lawn.js';
import { FONT } from '../core/effects.js';
import { DIRT, MEADOW_BY_SEASON } from '../core/palette.js';
import { Materials, cardQuad, billboardAttributes } from './materials.js';
import {
  HILLS, MEADOW_CARDS, TREE_SHAPES, FENCE_TREES, MEADOW_TREES, BIRD_N,
} from './theme.js';
import {
  sharedTextures, meadowCard, hillTexture, treeTexture, signTexture,
  barnTexture, millTowerTexture, millBladeTexture, scarecrowTexture,
  snowmanTexture, birdTexture,
} from './doodle.js';

function rng(seed) {
  let s = seed;
  return () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
}

/**
 * An instanced deck of ground-planted billboards. `place(i)` fills in one
 * card: where it stands, how big it is, and a phase so the boil does not move
 * every card in lockstep.
 */
function deck(mat, n, place) {
  const mesh = new THREE.InstancedMesh(cardQuad(), mat, n);
  const sizes = new Float32Array(n * 2);
  const phases = new Float32Array(n);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const c = place(i);
    d.position.set(c.x, c.y, c.z);
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(1);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
    sizes[i * 2] = c.w;
    sizes[i * 2 + 1] = c.h;
    phases[i] = c.phase === undefined ? i * 0.37 : c.phase;
  }
  billboardAttributes(mesh, sizes, phases);
  mesh.frustumCulled = false;
  return mesh;
}

/** Everything whose size depends on lawn.cols. Rebuilt by setLawn. */
export function buildBoard(r) {
  if (r.board) disposeBoard(r);
  const cols = r.lawn.cols;
  const g = new THREE.Group();
  r.board = g;
  r.scene.add(g);

  buildMeadow(r, g, cols);
  buildHills(r, g);

  const slab = new THREE.BoxGeometry(cols + 1.6, 0.7, ROWS + 1.5);
  const base = r.mats.inked(slab, r.mats.toon(DIRT), 1.015);
  base.position.y = -0.35;
  g.add(base);

  buildFence(r, g, cols);
  buildTrees(r, g, cols);
  buildProps(r, g, cols);
  buildSigns(r);
}

/**
 * Materials and textures need disposing by hand or the GPU copy outlives the
 * mesh. Everything the new board rebuilds goes; the doodle module's cached
 * canvases (cards, trees, hills, signs) are shared and stay.
 */
export function disposeBoard(r) {
  const keep = sharedTextures();
  r.scene.remove(r.board);
  r.board.traverse((o) => {
    if (o.isMesh && o.geometry) o.geometry.dispose();
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m || m === r.mats.ink) continue;
      if (m.map && !keep.has(m.map)) m.map.dispose();
      // a sign is the only texture drawn per board, and it hangs off a
      // uniform on the card materials rather than off .map
      const tA = m.uniforms && m.uniforms.tA && m.uniforms.tA.value;
      if (tA && !keep.has(tA)) tA.dispose();
      Materials.forget(m);
      m.dispose();
    }
  });
  r.board = null;
}

/**
 * Meadow to the horizon, well below the slab, plus a few hundred doodle cards
 * scattered over the near part of it so the ground outside the fence is drawn
 * by the same hand as the lawn inside it.
 */
function buildMeadow(r, g, cols) {
  r.apronMat = new THREE.MeshToonMaterial({
    color: new THREE.Color(MEADOW_BY_SEASON[2]), gradientMap: r.mats.grad,
  });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), r.apronMat);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, -0.95, 0);
  g.add(apron);

  r.meadowMat = r.mats.card(meadowCard());
  const rnd = rng(70207);
  const half = cols / 2 + 3;
  const cards = deck(r.meadowMat, MEADOW_CARDS, (i) => {
    // A ring around the board, never on it. Two cards in five are dealt to
    // the long sides rather than left to chance, because driving the year
    // means looking down it: the ground beside the slab is what is in frame
    // for most of a lap, and a random ring left it bare.
    let x;
    let z;
    if (i % 5 < 2) {
      z = (rnd() * 2 - 1) * (ROWS / 2 + 13);
      x = (i % 2 ? -1 : 1) * (half + 1.2 + rnd() * rnd() * 24);
    } else {
      x = (rnd() * 2 - 1) * (half + 26);
      z = r.fenceZ - rnd() * rnd() * 34;
    }
    const s = 0.7 + rnd() * 0.9;
    return { x, y: -0.95, z, w: 1.5 * s, h: 1.0 * s, phase: rnd() };
  });
  r.meadowCards = cards;
  g.add(cards);
}

/**
 * Three hand-drawn ridge lines instead of the old nine spheres. Fog does the
 * distance and the season does the colour, so the skyline reads as pencil on
 * paper rather than as geometry.
 */
function buildHills(r, g) {
  r.hillMats = [];
  for (const spec of HILLS) {
    // not fogged: the layer's own tint is the distance, so a ridge stays a
    // drawn shape instead of dissolving into the haze the meadow needs
    const mat = new THREE.MeshBasicMaterial({
      map: hillTexture(spec), transparent: true, alphaTest: 0.4,
      depthWrite: true, fog: false,
    });
    mat.userData.spec = spec;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, spec.h), mat);
    m.position.set(0, spec.y, spec.z);
    m.renderOrder = -1;
    g.add(m);
    r.hillMats.push(mat);
  }
}

function buildFence(r, g, cols) {
  r.fenceZ = -ROWS / 2 - 1.7;
  const wood = r.mats.toon(0x8b6b43);
  r.wood = wood;
  // one instanced post and one instanced outline, not fourteen inked pairs:
  // a 53-week fence was 28 draw calls of the frame's budget on its own
  const postGeo = new THREE.BoxGeometry(0.22, 1.3, 0.22);
  const nPosts = Math.floor(cols / 4) + 1;
  const posts = new THREE.InstancedMesh(postGeo, wood, nPosts);
  const postInk = new THREE.InstancedMesh(postGeo, r.mats.ink, nPosts);
  for (let i = 0; i < nPosts; i++) {
    const d = r.dummy;
    d.position.set(i * 4 - cols / 2, 0.65, r.fenceZ);
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(1);
    d.updateMatrix();
    posts.setMatrixAt(i, d.matrix);
    d.scale.setScalar(1.12);
    d.updateMatrix();
    postInk.setMatrixAt(i, d.matrix);
  }
  posts.frustumCulled = postInk.frustumCulled = false;
  g.add(posts, postInk);

  for (const y of [0.5, 1.0]) {
    const rail = r.mats.inked(new THREE.BoxGeometry(cols + 0.4, 0.12, 0.12), wood, 1.08);
    rail.position.set(0, y, r.fenceZ);
    g.add(rail);
  }
}

/**
 * Round canopy, pine and poplar, eight along the fence and twenty set back in
 * the meadow. Each shape is one alpha-tested instanced deck whose three season
 * faces are mixed in the fragment shader, so the whole treeline is three draw
 * calls and never sorts wrong against itself.
 */
function buildTrees(r, g, cols) {
  r.treeMats = [];
  const rnd = rng(51001);
  const plan = [];
  for (let t = 0; t < FENCE_TREES; t++) {
    plan.push({
      shape: t % 3,
      x: (t + 0.5) / FENCE_TREES * (cols + 6) - (cols + 6) / 2 + (t % 2 ? 1.6 : -1.6),
      z: r.fenceZ - 3.2 - (t % 2) * 1.4,
      y: -0.2,
      s: 3.6 + (t % 3) * 0.9,
    });
  }
  for (let t = 0; t < MEADOW_TREES; t++) {
    plan.push({
      shape: (t + 1) % 3,
      x: ((t + 0.5) / MEADOW_TREES * 2 - 1) * (cols + 30) + (t % 3 - 1) * 4.5,
      z: r.fenceZ - 8 - (t % 7) * 4.4 - rnd() * 4,
      y: -0.95,
      s: 4 + (t % 4) * 1.3,
    });
  }
  TREE_SHAPES.forEach((shape, si) => {
    const mine = plan.filter((p) => p.shape === si);
    if (!mine.length) return;
    const mat = r.mats.seasonCard(
      treeTexture(shape, 'bare'), treeTexture(shape, 'leafy'), treeTexture(shape, 'autumn'),
    );
    const mesh = deck(mat, mine.length, (i) => {
      const p = mine[i];
      return { x: p.x, y: p.y, z: p.z, w: p.s * 0.625, h: p.s, phase: i * 0.29 };
    });
    g.add(mesh);
    r.treeMats.push(mat);
  });
}

/** A barn, a windmill that turns, a scarecrow, a snowman and five birds. */
function buildProps(r, g, cols) {
  const half = cols / 2;
  const one = (tex, x, y, z, w, h, opts) => {
    const mat = r.mats.card(tex, opts);
    const mesh = deck(mat, 1, () => ({ x, y, z, w, h }));
    g.add(mesh);
    return { mesh, mat };
  };

  const barn = one(barnTexture(), -half - 11, -0.95, r.fenceZ - 20, 8.5, 6.4);
  const mill = one(millTowerTexture(), half + 10, -0.95, r.fenceZ - 17, 3.6, 7.2);
  // the tower's hub sits at 0.79 of its height; the blade card turns about
  // its own middle, so plant it half a card lower than that
  const blades = one(millBladeTexture(), half + 10, -0.95 + 7.2 * 0.79 - 2.6, r.fenceZ - 17.3,
    5.2, 5.2);
  const scarecrow = one(scarecrowTexture(), -half * 0.42, -0.95, r.fenceZ - 1.1, 2.1, 3.15,
    { fade: true });
  const snowman = one(snowmanTexture(), half * 0.34, -0.95, r.fenceZ - 1.0, 1.8, 2.47,
    { fade: true });

  const birdMat = r.mats.seasonCard(birdTexture(0), birdTexture(1), birdTexture(0));
  birdMat.uniforms.uW.value.set(1, 0, 0);
  const birds = deck(birdMat, BIRD_N, (i) => ({
    x: -half + i * 6, y: 11 + (i % 3) * 1.6, z: r.fenceZ - 16 - i * 2.5,
    w: 2.6, h: 1.3, phase: i * 0.61,
  }));
  g.add(birds);

  r.props = {
    barn, mill, blades, scarecrow, snowman,
    birds: { mesh: birds, mat: birdMat, home: [] },
  };
  for (let i = 0; i < BIRD_N; i++) {
    r.props.birds.home.push({ x: -half + i * 6, y: 11 + (i % 3) * 1.6, z: r.fenceZ - 16 - i * 2.5 });
  }
}

/**
 * The props that answer to the season, and the two that move: the windmill's
 * blades and the birds drifting across a spring or summer sky.
 */
export function stepProps(r, wm) {
  const p = r.props;
  if (!p) return;
  p.blades.mat.uniforms.uSpin.value = r.time * 0.55;
  p.snowman.mat.uniforms.uAlpha.value = wm[0];
  p.snowman.mesh.visible = wm[0] > 0.02;
  p.scarecrow.mat.uniforms.uAlpha.value = 1 - wm[0] * 0.85;

  const flying = Math.min(1, wm[1] + wm[2]);
  p.birds.mesh.visible = flying > 0.35;
  if (p.birds.mesh.visible) {
    p.birds.mat.uniforms.uW.value.set(
      Math.sin(r.time * 5.5) > 0 ? 1 : 0, Math.sin(r.time * 5.5) > 0 ? 0 : 1, 0,
    );
    const d = r.dummy;
    const span = r.lawn.cols + 70;
    for (let i = 0; i < p.birds.home.length; i++) {
      const h = p.birds.home[i];
      const x = ((h.x + r.time * 1.7 + i * 13 + span * 2) % span) - span / 2;
      d.position.set(x, h.y + Math.sin(r.time * 0.8 + i) * 0.4, h.z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      p.birds.mesh.setMatrixAt(i, d.matrix);
    }
    p.birds.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * One sign per month, at the month's first column. Months with fewer than
 * three columns are skipped, and any sign that would crowd its neighbour is
 * dropped, so the first two months never merge.
 */
export function buildSigns(r) {
  const cols = r.lawn.cols;
  // buildBoard has already thrown the old board away, signs and all.
  r.signPlanes = [];
  let lastX = -Infinity;
  let n = 0;
  for (const ms of r.lawn.monthStarts) {
    if (ms.span < 3) continue;
    const x = ms.col + 0.6 - cols / 2;
    if (x - lastX < 3.2) continue;
    lastX = x;
    const top = n++ % 2 ? 2.3 : 1.95;   // alternate so a run does not read as a rail
    const pl = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: signTexture(ms.month, FONT), transparent: true }),
    );
    pl.position.set(x, top, r.fenceZ - 0.06);
    pl.scale.setScalar(r.signScale || 1);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, top - 0.55, 0.1), r.wood);
    st.position.set(x, (top - 0.55) / 2 + 0.3, r.fenceZ - 0.12);
    r.board.add(pl, st);
    r.signPlanes.push(pl);
  }
}
