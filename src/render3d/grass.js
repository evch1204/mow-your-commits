// The lawn itself: one instanced box per day, and a doodle grass card standing
// on it. The card is two crossed quads (an X, not a billboard) carrying a
// hand-drawn tuft, so the day's count picks a silhouette — sprouts, tuft, bush,
// hedge — that reads from the chase cam and from the overview alike.

import * as THREE from 'three';
import { ROWS, MAX_COLS, seasonIndexOfCol } from '../core/lawn.js';
import {
  AUTUMN_BLADE, DANDELION, PETAL,
  tileColor, stripe, bladeColor, cellTint, grassFor, shade, mix,
} from '../core/palette.js';
import {
  CARD, STUBBLE, VIGOR_LO, VIGOR_HI, LEVEL_SHADE, LEVEL_PUSH, BLOB_Y, BLOB_R, BLOB_ALPHA,
  TILE_TOP, POP_SCALE, POP_TIME,
} from './theme.js';
import { tuftCard, stubbleCard, blobTexture } from './doodle.js';

const SLOTS = MAX_COLS * ROWS;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => t * t * (3 - 2 * t);

/**
 * `grassFor(level, vigor).tuftY` is the shared grammar's 3D height, but the
 * card sizes in theme.js are absolute. Calibrating against the level's own
 * midpoint turns tuftY into a pure vigor nudge, so it keeps following core
 * however core retunes the numbers.
 */
const TY_MID = [1, 1, 1, 1, 1].map((_, l) => grassFor(l, 0.5).tuftY || 1);

/** A card on its feet: two quads crossed in an X, y running 0..1. */
function crossCard() {
  const a = new THREE.PlaneGeometry(1, 1);
  a.translate(0, 0.5, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const geo = mergeTwo(a, b);
  // flat up-facing normals, so cel shading does not shade the two quads apart
  const n = geo.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3) { n[i] = 0; n[i + 1] = 1; n[i + 2] = 0; }
  return geo;
}

/** Two small indexed geometries into one, without pulling in BufferGeometryUtils. */
function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = a.attributes[name], y = b.attributes[name];
    const out = new Float32Array(x.array.length + y.array.length);
    out.set(x.array, 0);
    out.set(y.array, x.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(out, x.itemSize));
  }
  const ai = a.index.array, bi = b.index.array;
  const off = a.attributes.position.count;
  const idx = [];
  for (const i of ai) idx.push(i);
  for (const i of bi) idx.push(i + off);
  g.setIndex(idx);
  a.dispose(); b.dispose();
  return g;
}

export function buildTiles(r) {
  const geo = new THREE.BoxGeometry(0.86, 0.14, 0.86);
  const mat = r.mats.wobbly(
    new THREE.MeshToonMaterial({ gradientMap: r.mats.grad }), { boil: 0.008 },
  );
  r.tiles = new THREE.InstancedMesh(geo, mat, SLOTS);
  r.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  r.tiles.count = 0;
  r.tiles.frustumCulled = false;
  r.scene.add(r.tiles);
  r.tileSlot = new Int16Array(SLOTS);
}

export function buildGrass(r) {
  const cardGeo = crossCard();
  r.grass = [];
  for (let l = 1; l <= 4; l++) {
    const mat = r.mats.wobbly(new THREE.MeshToonMaterial({
      gradientMap: r.mats.grad, map: tuftCard(l),
      side: THREE.DoubleSide, alphaTest: 0.5,
    }), { sway: true, boil: 0.012 });
    const im = new THREE.InstancedMesh(cardGeo, mat, SLOTS);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    im.frustumCulled = false;
    r.scene.add(im);
    r.grass.push(im);
  }
  r.slotOf = new Int16Array(SLOTS);

  // what a cut leaves behind: the same card grammar, one nick high
  const stubMat = r.mats.wobbly(new THREE.MeshToonMaterial({
    gradientMap: r.mats.grad, map: stubbleCard(),
    side: THREE.DoubleSide, alphaTest: 0.5,
  }), { sway: true, boil: 0.01 });
  r.stubble = new THREE.InstancedMesh(cardGeo, stubMat, SLOTS);
  r.stubble.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  r.stubble.count = 0;
  r.stubble.frustumCulled = false;
  r.scene.add(r.stubble);
  r.stubbleSlot = new Int16Array(SLOTS);

  // a hedge is tall enough to want a shadow, or it looks pasted on
  const disc = new THREE.PlaneGeometry(BLOB_R * 2, BLOB_R * 2);
  disc.rotateX(-Math.PI / 2);
  r.blobs = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({
    map: blobTexture(), transparent: true, opacity: BLOB_ALPHA,
    depthWrite: false, fog: true,
  }), SLOTS);
  r.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  r.blobs.count = 0;
  r.blobs.frustumCulled = false;
  r.blobs.renderOrder = 1;
  r.scene.add(r.blobs);
  r.blobSlot = new Int16Array(SLOTS);

  // spring flowers: tiny dots in the thin grass. The same pool carries the
  // dandelion each of the year's best days puts up.
  r.flowers = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.05, 6, 4),
    new THREE.MeshBasicMaterial(),
    SLOTS,
  );
  r.flowers.count = 0;
  r.flowers.frustumCulled = false;
  r.scene.add(r.flowers);
  r.flowerSlot = new Int16Array(SLOTS);
  r.heroSlot = new Int16Array(SLOTS);
}

/** The squash a cut plays on the standing card, 1 -> nearly flat. */
function cutSquash(c) {
  if (!c.mowed) return 1;
  const e = Math.min(1, c.mowT);
  return Math.max(0.06, 1 + (0.15 - 1) * ease(e) - Math.sin(Math.PI * e) * 0.16);
}

export function setCell(r, i) {
  const c = r.lawn.cells[i];
  if (c.void) return;
  const d = r.dummy;
  const season = seasonIndexOfCol(r.lawn, c.col);
  const col = r.tmpColor;
  const x = r.wx(c.col + 0.5);
  const z = r.wz(c.row + 0.5);
  const cut = r.cutAt.has(i) ? r.time - r.cutAt.get(i) : 99;

  // tile. A fresh reveal pops: 1.12 -> 1 over POP_TIME.
  const ts = r.tileSlot[i];
  if (ts >= 0) {
    const pop = cut < POP_TIME ? 1 + (POP_SCALE - 1) * (1 - cut / POP_TIME) : 1;
    d.position.set(x, 0.07, z);
    d.rotation.set(0, 0, 0);
    d.scale.set(pop, 1, pop);
    d.updateMatrix();
    r.tiles.setMatrixAt(ts, d.matrix);
    let tc = tileColor(c.level, season, c.mowed && c.mowT > 0.35, c.vigor || 0);
    if (c.mowed && c.level > 0 && c.col % 2 === 0 && c.mowT > 0.35) tc = stripe(tc);
    col.set(tc);
    // a fresh cut flashes for a moment, so you see what you just took
    const age = cut / 1.2;
    if (age < 1) col.lerp(r.tmpColorB.set('#FFFFFF'), 0.3 * (1 - age));
    r.tiles.setColorAt(ts, col);
  }

  if (c.level > 0) {
    const l = c.level;
    const card = CARD[l];
    const v = c.vigor || 0;
    const vig = VIGOR_LO + (VIGOR_HI - VIGOR_LO) * v;
    const ty = clamp(grassFor(l, v).tuftY / TY_MID[l], 0.9, 1.1);
    const done = c.mowed && c.mowT >= 1;
    const sq = cutSquash(c);
    const spread = 1 + Math.sin(Math.PI * Math.min(1, c.mowT)) * (c.mowed ? 0.22 : 0);

    // the standing card
    const mesh = r.grass[l - 1];
    const slot = r.slotOf[i];
    d.position.set(x, TILE_TOP, z);
    d.rotation.set(0, c.rot, 0);
    if (done) d.scale.setScalar(0.0001);
    else d.scale.set(card.w * vig * spread, card.h * vig * ty * sq, card.w * vig * spread);
    d.updateMatrix();
    mesh.setMatrixAt(slot, d.matrix);
    // winter keeps its own frosted ramp; the rest of the year the level's
    // green is pushed toward its own end of the scale before it is shaded
    const push = LEVEL_PUSH[l];
    const raw = bladeColor(l, season);
    const base = shade(season === 0 ? raw : mix(raw, push[0], push[1]), LEVEL_SHADE[l]);
    col.set(cellTint(base, c.col, c.row));
    col.lerp(r.tmpColorB.set(shade(base, 0.72)), 0.3 * v);
    if (season === 3 && (c.col * 7 + c.row * 13) % 5 === 0) {
      col.lerp(r.tmpColorB.set(AUTUMN_BLADE), 0.32);
    }
    mesh.setColorAt(slot, col);

    // the stubble that replaces it
    const ss = r.stubbleSlot[i];
    if (ss >= 0) {
      const show = c.mowed ? Math.min(1, Math.max(0, (c.mowT - 0.45) / 0.55)) : 0;
      d.position.set(x, TILE_TOP, z);
      d.rotation.set(0, c.rot + 0.7, 0);
      if (show <= 0) d.scale.setScalar(0.0001);
      else d.scale.set(STUBBLE.w * vig, STUBBLE.h * vig * show, STUBBLE.w * vig);
      d.updateMatrix();
      r.stubble.setMatrixAt(ss, d.matrix);
      r.stubble.setColorAt(ss, col.set(shade(tileColor(l, season, true), 0.78)));
    }

    // a hedge stands off its tile on a blob of shade
    const bs = r.blobSlot[i];
    if (bs >= 0) {
      d.position.set(x + 0.06, BLOB_Y, z + 0.06);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(done ? 0.0001 : vig * sq);
      d.updateMatrix();
      r.blobs.setMatrixAt(bs, d.matrix);
    }
  }

  // spring flowers sit in the thin grass
  const fs = r.flowerSlot[i];
  if (fs >= 0) {
    const show = !c.mowed && season === 1;
    d.position.set(
      x + (c.rot % 1 - 0.5) * 0.4,
      show ? 0.34 : -9,
      z + ((c.rot * 3) % 1 - 0.5) * 0.4,
    );
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(show ? 1 : 0.0001);
    d.updateMatrix();
    r.flowers.setMatrixAt(fs, d.matrix);
    r.flowers.setColorAt(fs, col.set((c.col + c.row) % 2 ? PETAL[0] : PETAL[1]));
  }

  // the best days of the year put up a dandelion, until you cut it
  const hs = r.heroSlot[i];
  if (hs >= 0) {
    const show = !c.mowed;
    d.position.set(
      x + (c.rot % 1 - 0.5) * 0.3,
      show ? TILE_TOP + CARD[4].h * 1.05 : -9,
      z + ((c.rot * 3) % 1 - 0.5) * 0.3,
    );
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(show ? 1.8 : 0.0001);
    d.updateMatrix();
    r.flowers.setMatrixAt(hs, d.matrix);
    r.flowers.setColorAt(hs, col.set(DANDELION));
  }
}

/** Call after createLawn / resetLawn / setLawn to push all cells to the GPU. */
export function applyLawn(r) {
  const cells = r.lawn.cells;
  const counts = [0, 0, 0, 0];
  let tiles = 0;
  let stubble = 0;
  let blobs = 0;
  let flowers = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const grown = !c.void && c.level > 0;
    r.tileSlot[i] = c.void ? -1 : tiles++;
    r.slotOf[i] = grown ? counts[c.level - 1]++ : -1;
    r.stubbleSlot[i] = grown ? stubble++ : -1;
    r.blobSlot[i] = grown && c.level === 4 ? blobs++ : -1;
    const springy = grown && c.level <= 2 && seasonIndexOfCol(r.lawn, c.col) === 1;
    r.flowerSlot[i] = springy ? flowers++ : -1;
    const hero = !c.void && c.heroic && seasonIndexOfCol(r.lawn, c.col) !== 0;
    r.heroSlot[i] = hero ? flowers++ : -1;
  }
  r.tiles.count = tiles;
  r.stubble.count = stubble;
  r.blobs.count = blobs;
  r.flowers.count = flowers;
  for (let l = 0; l < 4; l++) r.grass[l].count = counts[l];
  r.cutAt.clear();
  for (let i = 0; i < cells.length; i++) setCell(r, i);
  r.anim.clear();
  flagDirty(r);
}

export function flagDirty(r) {
  for (const m of [r.tiles, r.flowers, r.stubble, r.blobs, ...r.grass]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
