// The riding mower: small wheels at the front, big ones at the back, a cutting
// deck that spins and a driver who bounces. `rig` is the THREE group this
// builds; `lawn.mower` is the sim object that says where it stands.
//
// Every part keeps its own inverted-hull outline even under the sketch pass:
// the screen-space ink draws the silhouette, and these draw the panel lines.

import * as THREE from 'three';
import { faceTexture } from './doodle.js';

export function buildMower(r) {
  const mats = r.mats;
  const g = new THREE.Group();
  // Yaw first, then pitch and roll in the mower's own frame. With the default
  // XYZ order the acceleration pitch was applied about the *world* x axis,
  // which rolled the mower onto its side whenever it drove along the year.
  g.rotation.order = 'YXZ';
  const orange = mats.toon(0xd85a30);
  const darkOrange = mats.toon(0xb84a22);
  const grey = mats.toon(0x45454a);
  const rubber = mats.toon(0x2c2c2a);
  const creamMat = mats.plain(0xfbf4dd);
  const inkPlain = mats.plain(0x2c2c2a);

  // hood, front (+z), with a rounded upper deck
  const hood = mats.inked(new THREE.BoxGeometry(0.62, 0.28, 0.66), orange, 1.06);
  hood.position.set(0, 0.5, 0.42); g.add(hood);
  const hoodTop = mats.inked(new THREE.BoxGeometry(0.5, 0.12, 0.54), orange, 1.07);
  hoodTop.position.set(0, 0.68, 0.4); g.add(hoodTop);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.04), inkPlain);
  grille.position.set(0, 0.46, 0.76); g.add(grille);
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), creamMat);
    lamp.position.set(s * 0.17, 0.62, 0.72); g.add(lamp);
  }

  // cutting deck: wider than the body, with a discharge chute on the right
  r.deck = mats.inked(new THREE.CylinderGeometry(0.56, 0.56, 0.11, 18), grey, 1.05);
  r.deck.position.set(0, 0.18, 0.16); g.add(r.deck);
  const chute = mats.inked(new THREE.BoxGeometry(0.2, 0.13, 0.3), grey, 1.08);
  chute.position.set(0.58, 0.2, 0.1);
  chute.rotation.y = -0.5; g.add(chute);

  // wheels: small at the front, big at the back. That is the signature.
  const fw = new THREE.CylinderGeometry(0.14, 0.14, 0.1, 12); fw.rotateZ(Math.PI / 2);
  r.frontWheels = [];
  for (const s of [-1, 1]) {
    const w = mats.inked(fw, rubber, 1.1);
    w.position.set(s * 0.36, 0.14, 0.62); g.add(w); r.frontWheels.push(w);
  }
  const rw = new THREE.CylinderGeometry(0.3, 0.3, 0.19, 10); rw.rotateZ(Math.PI / 2);
  const tread = new THREE.TorusGeometry(0.28, 0.055, 4, 10); tread.rotateY(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.11, 0.11, 0.21, 10); hub.rotateZ(Math.PI / 2);
  r.rearWheels = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.add(mats.inked(rw, rubber, 1.06));
    w.add(new THREE.Mesh(tread, inkPlain));
    w.add(new THREE.Mesh(hub, creamMat));
    w.position.set(s * 0.44, 0.3, -0.5); g.add(w); r.rearWheels.push(w);
  }

  // fender plate, seat, steering wheel
  const fender = mats.inked(new THREE.BoxGeometry(0.92, 0.08, 0.52), darkOrange, 1.05);
  fender.position.set(0, 0.44, -0.44); g.add(fender);
  const seat = mats.inked(new THREE.BoxGeometry(0.38, 0.09, 0.36), grey, 1.07);
  seat.position.set(0, 0.53, -0.44); g.add(seat);
  const back = mats.inked(new THREE.BoxGeometry(0.38, 0.34, 0.09), grey, 1.07);
  back.position.set(0, 0.72, -0.63); g.add(back);
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.07), inkPlain);
  column.position.set(0, 0.74, 0.1); column.rotation.x = -0.42; g.add(column);
  const wheelGeo = new THREE.TorusGeometry(0.13, 0.026, 5, 12);
  const steer = new THREE.Mesh(wheelGeo, inkPlain);
  steer.position.set(0, 0.94, 0.02); steer.rotation.x = -1.15; g.add(steer);
  r.steer = steer;

  // driver
  const driver = new THREE.Group();
  const torso = mats.inked(new THREE.BoxGeometry(0.3, 0.34, 0.24), mats.toon(0x5c8f3a), 1.06);
  torso.position.set(0, 0.86, -0.36); driver.add(torso);
  const armGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.42, 6);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, mats.plain(0x5c8f3a));
    arm.position.set(s * 0.15, 0.92, -0.17);
    arm.rotation.set(-1.05, 0, s * 0.16);
    driver.add(arm);
  }
  const head = mats.inked(new THREE.SphereGeometry(0.15, 10, 8), mats.toon(0xf5c4b3), 1.09);
  head.position.set(0, 1.14, -0.33); driver.add(head);
  const cap = mats.inked(new THREE.CylinderGeometry(0.155, 0.155, 0.08, 10), orange, 1.08);
  cap.position.set(0, 1.24, -0.33); driver.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.15), mats.plain(0xd85a30));
  brim.position.set(0, 1.21, -0.21); driver.add(brim);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ map: faceTexture(), transparent: true, depthWrite: false }),
  );
  face.position.set(0, 1.13, -0.19);
  driver.add(face);
  g.add(driver);
  r.driver = driver;

  // exhaust pipe, back left
  const pipe = mats.inked(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 8), grey, 1.1);
  pipe.position.set(-0.3, 0.62, -0.12); g.add(pipe);

  r.rig = g;
  r.tilt = 0;
  r.lean = 0;
  r.scene.add(g);
}

/** Lawn heading (cos a, sin a) in (x, z) -> three rotation.y = pi/2 - a. */
export function poseMower(r) {
  const m = r.lawn.mower;
  const rig = r.rig;
  const idle = Math.sin(r.time * 60) * 0.004;
  rig.position.set(r.wx(m.x), idle + Math.abs(m.vel) * 0.06, r.wz(m.z));
  rig.rotation.y = Math.PI / 2 - m.angle;
  // a few degrees of nose-up under throttle and a hint of body roll in turns
  r.tilt += (m.acc * 6 - r.tilt) * 0.15;
  r.lean += ((m.turn || 0) * Math.min(1, Math.abs(m.vel) * 6) * 0.05 - r.lean) * 0.12;
  rig.rotation.x = -r.tilt;
  rig.rotation.z = r.lean;
  rig.updateMatrixWorld();
  for (const w of r.frontWheels) w.rotation.x += m.vel * 8;
  for (const w of r.rearWheels) w.rotation.x += m.vel * 3.7;   // bigger wheel, slower roll
  r.deck.rotation.y += Math.abs(m.vel) * 2 + 0.04;
  r.steer.rotation.z = -(m.turn || 0) * 0.5;
  r.driver.position.y = Math.sin(r.time * 9) * 0.008;
}
