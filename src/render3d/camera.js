// Two cameras with one body: the chase cam behind the mower and the overview
// that frames the whole year, blended by `camBlend`, each with its own
// look-around offset. Plus the pointer/wheel/pinch orbit that drives them.
//
// The overview is the poster of the year, so it is framed from the lawn out,
// not from a fixed distance: `fitOverview` solves for the distance at which
// `lawn.cols` weeks just fill the frame, whatever the canvas aspect, and the
// pitch is steep enough (38 degrees onto the tiles, against the old 21) that
// the grid reads as a contribution graph instead of a strip seen edge-on.

import { ROWS } from '../core/lawn.js';
import { OVER_LOOK_Y, OVER_LOOK_Z, OVER_FOV, CHASE_FOV } from './theme.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function bindOrbit(r) {
  const c = r.canvas;
  const pointers = new Map();
  let pinch = 0;
  const cam = () => (r.camMode ? r.over : r.chase);

  c.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinch = pinchDistance(pointers);
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
      const d = pinchDistance(pointers);
      if (pinch) zoom(r, (pinch - d) * 0.02);
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
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(r, e.deltaY * 0.004);
  }, { passive: false });
  c.addEventListener('dblclick', () => resetOrbit(r));
}

function pinchDistance(pointers) {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The distance at which the whole year just fits across the frame. The slab
 * corner nearest the camera is the first thing to leave it, so solve for the
 * distance where that corner lands on the edge and back off a hair.
 */
export function fitOverview(r) {
  const tanV = Math.tan(OVER_FOV * Math.PI / 360);
  const tanH = tanV * (r.camera.aspect || 1.8);
  const x = r.lawn.cols / 2 + 1;             // outer corner of the dirt slab
  const zn = ROWS / 2 + 0.75;
  const p = r.OVER_PITCH;
  const depth = (od) => {
    const H = od * Math.sin(p), D = od * Math.cos(p);
    const n = Math.hypot(OVER_LOOK_Y - H, OVER_LOOK_Z - D);
    return (-H * (OVER_LOOK_Y - H) + (zn - D) * (OVER_LOOK_Z - D)) / n;
  };
  let lo = 8, hi = 120;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (depth(mid) * tanH >= x) hi = mid; else lo = mid;
  }
  const was = r.overFit;
  r.overFit = clamp(hi, 12, 110);
  // keep whatever the visitor zoomed to, in proportion; otherwise sit on the fit
  if (r.overZoomed && was) {
    r.over.dist = clamp(r.over.dist * (r.overFit / was), r.overFit * 0.5, r.overFit * 2);
  } else r.over.dist = r.overFit;
}

export function zoom(r, d) {
  if (r.camMode) {
    r.over.dist = clamp(r.over.dist * (1 + d), r.overFit * 0.5, r.overFit * 2);
    r.overZoomed = true;
  } else r.chase.dist = clamp(r.chase.dist * (1 + d), 4, 14);
}

export function resetOrbit(r) {
  r.chase.yaw = r.chase.pitch = 0;
  r.over.yaw = r.over.pitch = 0;
  r.chase.dist = 9.6;
  r.overZoomed = false;
  r.over.dist = r.overFit;
}

/** Chase <-> overview, each with its own look-around offset. */
export function updateCamera(r, dt) {
  const m = r.lawn.mower;
  if (m.acc > 0) r.gasHeld += dt; else r.gasHeld = 0;
  if (r.gasHeld > 0.5 && !r.camMode) {
    // driving pulls the framing back behind the mower
    const k = Math.min(1, dt / 1.5 * 2.2);
    r.chase.yaw += (0 - r.chase.yaw) * k;
    r.chase.pitch += (0 - r.chase.pitch) * k;
  }

  r.camBlend += (r.camMode - r.camBlend) * (r.snapped ? Math.min(1, dt * 3.4) : 1);
  const b = r.camBlend;

  const cYaw = m.angle + r.chase.yaw;
  const cPitch = clamp(r.CHASE_PITCH + r.chase.pitch, 0.14, 1.31);
  const cd = r.chase.dist;
  const chaseX = r.wx(m.x) - Math.cos(cYaw) * cd * Math.cos(cPitch);
  const chaseY = cd * Math.sin(cPitch);
  const chaseZ = r.wz(m.z) - Math.sin(cYaw) * cd * Math.cos(cPitch);

  const oPitch = clamp(r.OVER_PITCH + r.over.pitch, 0.2, 1.31);
  const od = r.over.dist;
  const overX = Math.sin(r.over.yaw) * od * Math.cos(oPitch);
  const overY = od * Math.sin(oPitch);
  const overZ = Math.cos(r.over.yaw) * od * Math.cos(oPitch);

  const tx = chaseX + (overX - chaseX) * b;
  const ty = chaseY + (overY - chaseY) * b;
  const tz = chaseZ + (overZ - chaseZ) * b;

  const cam = r.camera;
  // snap on the very first frame, otherwise a single-frame render (or a
  // headless screenshot) would show the camera still flying in
  const s = r.snapped && !r.reframed ? Math.min(1, dt * 4.5) : 1;
  r.reframed = false;

  // the overview swaps to a longer lens as it blends in, so the far end of the
  // year is drawn at nearly the size of the near end and reads as a grid
  const fov = CHASE_FOV + (OVER_FOV - CHASE_FOV) * b;
  if (Math.abs(cam.fov - fov) > 0.02) { cam.fov = fov; cam.updateProjectionMatrix(); }
  // and the month signs grow with it, so the year stays labelled from up there
  const ss = 1 + 0.3 * b;
  if (Math.abs(ss - r.signScale) > 0.004) {
    r.signScale = ss;
    for (const p of r.signPlanes) p.scale.setScalar(ss);
  }
  cam.position.x += (tx - cam.position.x) * s;
  cam.position.y += (ty - cam.position.y) * s;
  cam.position.z += (tz - cam.position.z) * s;

  // look ahead of the mower when you are behind it; swing the aim onto the
  // mower itself as you orbit around, so it never slides out of frame
  r.sky.position.copy(cam.position);
  const ahead = 3.0 * Math.max(0, Math.cos(r.chase.yaw));
  const lx = r.wx(m.x) + Math.cos(m.angle) * ahead;
  const lz = r.wz(m.z) + Math.sin(m.angle) * ahead;
  r.lookAt.x += (lx + (0 - lx) * b - r.lookAt.x) * s;
  r.lookAt.y += (1.95 + (OVER_LOOK_Y - 1.95) * b - r.lookAt.y) * s;
  r.lookAt.z += (lz + (OVER_LOOK_Z - lz) * b - r.lookAt.z) * s;
  cam.lookAt(r.lookAt);
}
