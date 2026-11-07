import * as THREE from 'three';
import { TRACK_HALF, WALL } from './track.js';
import { clamp } from './util.js';

// ---------------------------------------------------------------- physics

const POINT_R = 0.25;
const MASS = 1;
const FRICTION = 0.22;
const BRAKE = 42;
const BOOST_ACCEL = 34;
const REVERSE_MAX = 10;
const REVERSE_ACCEL = 14;

// Heading h faces (sin h, cos h) on the x/z plane; positive yaw turns left.
export class Vehicle {
  constructor(stats) {
    this.near = {};
    this.probe = {};
    this.setStats(stats);
    this.reset(0, 0, 0);
  }

  // Handling for the chosen car (see cars.js). Contact points sit on the chassis outline.
  setStats(stats) {
    this.stats = stats;
    const w = stats.halfW, l = stats.halfL;
    this.points = [[-w, -l], [w, -l], [-w, l], [w, l], [-w, 0], [w, 0], [0, l], [0, -l]];
  }

  reset(x, z, heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = 0;
    this.vz = 0;
    this.w = 0; // yaw rate
    this.steer = 0;
    this.boostT = 0;
    this.hint = -1;
    this.vf = 0; // forward speed
    this.accel = 0;
    this.offTrack = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  boost(seconds) {
    this.boostT = Math.max(this.boostT, seconds);
  }

  step(dt, input, track, colliders, onHit) {
    this.boostT = Math.max(0, this.boostT - dt);
    const boosting = this.boostT > 0;

    const st = this.stats;
    // Steering and yaw
    const target = clamp(input.steer, -1, 1);
    this.steer += (target - this.steer) * Math.min(1, dt * (target === 0 ? 10 : 6));
    const sf = Math.min(1, Math.abs(this.vf) / 5) * (this.vf < 0 ? -1 : 1);
    const yawTarget = (this.steer * st.yaw * sf * (input.hand ? 1.35 : 1)) / (1 + Math.abs(this.vf) / 38);
    this.w += (yawTarget - this.w) * Math.min(1, dt * 7);
    this.heading += this.w * dt;

    // Split velocity into forward and sideways parts
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const fx = s, fz = c, rx = c, rz = -s;
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;
    const vf0 = vf;
    const max = boosting ? st.boostSpeed : st.maxSpeed;

    if (input.up) {
      if (vf < -0.5) vf += BRAKE * dt;
      else vf += (st.accel + (boosting ? BOOST_ACCEL : 0)) * Math.max(0, 1 - Math.max(vf, 0) / max) * dt;
    }
    if (input.down) {
      if (vf > 0.5) vf -= BRAKE * dt;
      else vf -= REVERSE_ACCEL * Math.max(0, 1 + vf / REVERSE_MAX) * dt;
    }
    if (!input.up && !input.down) {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), (1.5 + 0.002 * vf * vf) * dt);
    }
    if (input.hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);
    if (vf > max) vf -= (vf - max) * 1.8 * dt;

    // Rough sand over the curb slows you down
    track.nearest(this.x, this.z, this.hint, 30, this.near);
    this.hint = this.near.i;
    const left = track.left(this.near.i);
    const lateral = this.near.dx * left.x + this.near.dz * left.z;
    this.offTrack = Math.abs(lateral) > TRACK_HALF ? 1 : 0;
    if (this.offTrack) vf -= vf * 0.45 * dt;

    vl *= Math.exp(-(input.hand ? st.grip * 0.18 : st.grip) * dt);
    this.vx = fx * vf + rx * vl;
    this.vz = fz * vf + rz * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.collide(track, colliders, onHit);

    const s2 = Math.sin(this.heading), c2 = Math.cos(this.heading);
    this.vf = this.vx * s2 + this.vz * c2;
    this.accel += ((this.vf - vf0) / dt - this.accel) * Math.min(1, dt * 6);
  }

  collide(track, colliders, onHit) {
    for (let iter = 0; iter < 3; iter++) {
      const s = Math.sin(this.heading), c = Math.cos(this.heading);
      for (const [lx, lz] of this.points) {
        const px = this.x + lx * c + lz * s;
        const pz = this.z - lx * s + lz * c;

        const near = track.nearest(px, pz, this.hint, 30, this.probe);
        if (near.dist + POINT_R > WALL) {
          const d = near.dist || 1;
          this.resolve(near.dx / d, near.dz / d, px, pz, near.dist + POINT_R - WALL, onHit);
        }
        for (const o of colliders) {
          const ox = o.x - this.x, oz = o.z - this.z;
          if (ox * ox + oz * oz > 36) continue;
          const dx = o.x - px, dz = o.z - pz;
          const d = Math.hypot(dx, dz);
          if (d < o.r + POINT_R) this.resolve(dx / (d || 1), dz / (d || 1), px, pz, o.r + POINT_R - d, onHit);
        }
      }
    }
  }

  // Impulse resolution at contact point p. (nx, nz) points from the car into the obstacle.
  resolve(nx, nz, px, pz, penetration, onHit) {
    this.x -= nx * penetration * 0.8;
    this.z -= nz * penetration * 0.8;
    const rx = px - this.x, rz = pz - this.z;
    const vpx = this.vx + this.w * rz;
    const vpz = this.vz - this.w * rx;
    const vn = vpx * nx + vpz * nz;
    if (vn <= 0) return;

    const rn = rz * nx - rx * nz;
    const j = (-(1 + this.stats.restitution) * vn) / (1 / MASS + (rn * rn) / this.stats.inertia);
    this.vx += (j * nx) / MASS;
    this.vz += (j * nz) / MASS;
    this.w += (j * rn) / this.stats.inertia;

    // Friction along the surface
    const tx = -nz, tz = nx;
    const vtx = this.vx + this.w * rz, vtz = this.vz - this.w * rx;
    const vt = vtx * tx + vtz * tz;
    const rt = rz * tx - rx * tz;
    const jt = clamp(-vt / (1 / MASS + (rt * rt) / this.stats.inertia), FRICTION * j, -FRICTION * j);
    this.vx += (jt * tx) / MASS;
    this.vz += (jt * tz) / MASS;
    this.w += (jt * rt) / this.stats.inertia;

    onHit?.(-j, px, pz, nx, nz);
  }
}

// ---------------------------------------------------------------- model

const DEFAULT_STYLE = {
  body: 'male', primaryColor: '#3b82f6', secondaryColor: '#2b2f4a', skinColor: '#8d5524',
  hairColor: '#17120f', hair: 'short', hat: 'none', accessory: 'none',
};

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

function bar(a, b, material, radius = 0.045) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), material);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  return m;
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function buildDriver(style) {
  const st = { ...DEFAULT_STYLE, ...style };
  const skin = mat(st.skinColor), hairM = mat(st.hairColor), top = mat(st.primaryColor), bottom = mat(st.secondaryColor);
  const g = new THREE.Group();

  g.add(box(0.55, 0.6, 0.32, top, 0, 0.4, 0));
  for (const x of [-1, 1]) {
    g.add(box(0.2, 0.2, 0.6, bottom, x * 0.15, 0.12, 0.3));
    const arm = box(0.12, 0.12, 0.5, top, x * 0.34, 0.55, 0.22);
    arm.rotation.x = 0.55;
    g.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), skin);
    hand.position.set(x * 0.3, 0.45, 0.48);
    g.add(hand);
  }

  const head = new THREE.Group();
  head.position.y = 0.9;
  g.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 10), skin));
  const eyeM = mat(0x1a1a1a);
  for (const x of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), eyeM);
    eye.position.set(x * 0.08, 0.03, 0.21);
    head.add(eye);
  }

  const cap = (r, material, y = 0.02) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), material);
    m.position.y = y;
    return m;
  };
  const strand = (x, y, z, len, r, tilt = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.7, len, 6), hairM);
    m.position.set(x, y, z);
    m.rotation.x = tilt;
    return m;
  };
  switch (st.hair) {
    case 'afro': {
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), hairM);
      a.position.set(0, 0.07, -0.04);
      head.add(a);
      break;
    }
    case 'braids':
      head.add(cap(0.255, hairM));
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (0.75 + (i / 6) * 1.5);
        head.add(strand(Math.sin(a) * 0.23, -0.2, Math.cos(a) * 0.23 - 0.02, 0.45, 0.03));
      }
      break;
    case 'bun': {
      head.add(cap(0.255, hairM));
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), hairM);
      b.position.y = 0.3;
      head.add(b);
      break;
    }
    case 'ponytail':
      head.add(cap(0.255, hairM));
      head.add(strand(0, -0.02, -0.33, 0.45, 0.05, -0.6));
      break;
    case 'dreads':
      head.add(cap(0.26, hairM));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        head.add(strand(Math.sin(a) * 0.23, -0.15, Math.cos(a) * 0.23, 0.42, 0.04));
      }
      break;
    case 'bald':
      break;
    default:
      head.add(cap(0.255, hairM));
  }

  const gold = mat(0xf2c230, { metalness: 0.6, roughness: 0.3 });
  switch (st.hat) {
    case 'cap': {
      head.add(cap(0.27, top, 0.04));
      head.add(box(0.3, 0.02, 0.2, top, 0, 0.06, 0.3));
      break;
    }
    case 'beanie': {
      head.add(cap(0.28, bottom, 0.04));
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), top);
      pom.position.y = 0.33;
      head.add(pom);
      break;
    }
    case 'tophat': {
      const dark = mat(0x16161a);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 14), dark);
      brim.position.y = 0.17;
      const crownM = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.34, 14), dark);
      crownM.position.y = 0.35;
      head.add(brim, crownM);
      break;
    }
    case 'crown': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.2, 0.2, 5, 1, true), new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
      c.position.y = 0.25;
      head.add(c);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), gold);
        tip.position.set(Math.sin(a) * 0.27, 0.37, Math.cos(a) * 0.27);
        head.add(tip);
      }
      break;
    }
    default:
  }

  switch (st.accessory) {
    case 'glasses': {
      const lens = mat(0x101820, { roughness: 0.2, metalness: 0.4 });
      for (const x of [-1, 1]) head.add(box(0.15, 0.1, 0.04, lens, x * 0.09, 0.04, 0.225));
      head.add(box(0.06, 0.02, 0.03, lens, 0, 0.05, 0.225));
      break;
    }
    case 'earrings':
      for (const x of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), gold);
        e.position.set(x * 0.24, -0.08, 0);
        head.add(e);
      }
      break;
    case 'beard': {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), hairM);
      b.scale.set(1, 0.7, 0.8);
      b.position.set(0, -0.13, 0.08);
      head.add(b);
      break;
    }
    case 'scarf': {
      const sc = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 8, 14), bottom);
      sc.rotation.x = Math.PI / 2;
      sc.position.y = -0.24;
      head.add(sc);
      break;
    }
    case 'backpack':
      g.add(box(0.4, 0.5, 0.18, bottom, 0, 0.42, -0.26));
      break;
    default:
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, head };
}

const lampMat = (color, emissive, k = 1.6) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: k });

// Each builder fills `b` with the car body and returns what Buggy needs to finish it:
// wheels [x, radius, width, z, steered], where the driver sits, an optional flag mount and how much it rolls/bounces.

function buildBuggy(b, m) {
  const paint = mat(0xff6a1f, { roughness: 0.4, metalness: 0.15 });
  const cage = mat(0xf4f0e6, { roughness: 0.4, metalness: 0.3 });
  b.add(box(1.5, 0.42, 3.0, paint, 0, 0.64, 0));
  const hood = box(1.3, 0.26, 1.1, paint, 0, 0.84, 1.15);
  hood.rotation.x = 0.14;
  b.add(hood);
  b.add(box(1.4, 0.3, 0.9, paint, 0, 0.86, -1.2));
  b.add(box(1.3, 0.1, 3.3, m.dark, 0, 0.42, 0));
  b.add(box(0.7, 0.14, 0.6, m.dark, 0, 0.82, -0.2));
  b.add(box(0.7, 0.62, 0.12, m.dark, 0, 1.12, -0.55));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 14), m.dark);
  wheel.position.set(0, 1.28, 0.4);
  wheel.rotation.x = 1.0;
  b.add(wheel);
  b.add(bar([0, 1.05, 0.3], [0, 1.28, 0.4], m.dark, 0.03));
  for (const x of [-1, 1]) {
    const px = x * 0.72;
    b.add(bar([px, 0.85, 0.55], [px, 2.15, 0.2], cage));
    b.add(bar([px, 0.85, -0.75], [px, 2.15, -0.75], cage));
    b.add(bar([px, 2.15, 0.2], [px, 2.15, -0.75], cage));
    b.add(bar([px, 2.15, -0.75], [x * 0.7, 0.9, -1.55], cage));
    b.add(bar([x * 0.8, 0.55, 1.72], [x * 0.8, 0.9, 1.55], m.chrome, 0.05));
    b.add(bar([x * 0.8, 0.55, -1.72], [x * 0.8, 0.8, -1.55], m.chrome, 0.05));
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), m.chrome);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x * 0.25, 0.85, -1.95);
    b.add(pipe);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), lampMat(0xfff6c8, 0xffe58a));
    lamp.position.set(x * 0.5, 0.88, 1.62);
    b.add(lamp);
  }
  b.add(bar([-0.72, 2.15, 0.2], [0.72, 2.15, 0.2], cage));
  b.add(bar([-0.72, 2.15, -0.75], [0.72, 2.15, -0.75], cage));
  b.add(bar([-0.8, 0.55, 1.72], [0.8, 0.55, 1.72], m.chrome, 0.05));
  b.add(bar([-0.8, 0.55, -1.72], [0.8, 0.55, -1.72], m.chrome, 0.05));
  b.add(box(0.9, 0.5, 0.8, m.dark, 0, 1.12, -1.3));
  const board = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat(0xff7ab0, { roughness: 0.3 }));
  board.scale.set(0.3, 0.05, 1.45);
  board.position.set(0.25, 2.25, -0.3);
  board.rotation.y = 0.04;
  b.add(board);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat(0xffffff, { roughness: 0.3 }));
  stripe.scale.set(0.08, 0.055, 1.46);
  stripe.position.copy(board.position);
  stripe.rotation.y = 0.04;
  b.add(stripe);
  b.add(bar([-0.6, 0.9, -1.5], [-0.6, 3.1, -1.5], m.chrome, 0.015));
  return {
    wheels: [[-1.05, 0.5, 0.45, 1.2, true], [1.05, 0.5, 0.45, 1.2, true], [-1.1, 0.62, 0.62, -1.15, false], [1.1, 0.62, 0.62, -1.15, false]],
    driver: { y: 0.9, z: -0.2, s: 1 }, flag: [-0.6, 2.9, -1.5], roll: 1, bounce: 1,
  };
}

function buildSprinter(b, m) {
  const paint = mat(0xd9262e, { roughness: 0.28, metalness: 0.45 });
  const white = mat(0xffffff, { roughness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.4, roughness: 0.1 });
  b.add(box(1.7, 0.45, 3.6, paint, 0, 0.55, 0));
  const nose = box(1.5, 0.28, 1.3, paint, 0, 0.7, 1.35);
  nose.rotation.x = 0.1;
  b.add(nose);
  b.add(box(1.6, 0.34, 1.1, paint, 0, 0.82, -1.3));
  b.add(box(1.5, 0.08, 3.4, m.dark, 0, 0.3, 0));
  b.add(box(1.2, 0.06, 1.2, m.dark, 0, 0.8, 0));
  b.add(box(0.7, 0.55, 0.1, m.dark, 0, 1.05, -0.65));
  const ws = box(1.3, 0.5, 0.05, glass, 0, 1.1, 0.62);
  ws.rotation.x = -0.55;
  b.add(ws);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14), m.dark);
  wheel.position.set(0, 1.0, 0.3);
  wheel.rotation.x = 1.0;
  b.add(wheel);
  b.add(box(0.28, 0.02, 1.3, white, 0, 0.86, 1.35));
  b.add(box(0.28, 0.02, 1.1, white, 0, 1.0, -1.3));
  for (const x of [-1, 1]) {
    b.add(bar([x * 0.6, 1.0, -1.6], [x * 0.6, 1.4, -1.78], m.dark, 0.04));
    b.add(box(0.05, 0.3, 0.5, paint, x * 0.92, 1.38, -1.8));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), lampMat(0xfff6c8, 0xffe58a));
    lamp.position.set(x * 0.55, 0.72, 1.98);
    b.add(lamp);
    b.add(box(0.3, 0.1, 0.05, lampMat(0xff3030, 0xff2020, 1.2), x * 0.5, 0.92, -1.86));
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.35, 8), m.chrome);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x * 0.4, 0.5, -1.85);
    b.add(pipe);
    b.add(box(0.08, 0.16, 0.6, m.dark, x * 0.86, 0.6, 0.2));
  }
  b.add(box(1.8, 0.06, 0.5, m.dark, 0, 1.42, -1.8));
  return {
    wheels: [[-1.0, 0.42, 0.32, 1.25, true], [1.0, 0.42, 0.32, 1.25, true], [-1.03, 0.45, 0.38, -1.2, false], [1.03, 0.45, 0.38, -1.2, false]],
    driver: { y: 0.62, z: -0.15, s: 0.88 }, flag: null, roll: 1, bounce: 0.7,
  };
}

function buildTruck(b, m) {
  const paint = mat(0x2fa64a, { roughness: 0.35, metalness: 0.3 });
  const cage = mat(0xf4f0e6, { roughness: 0.4, metalness: 0.3 });
  b.add(box(1.8, 0.3, 3.5, m.dark, 0, 1.15, 0));
  b.add(box(1.9, 0.6, 1.3, paint, 0, 1.75, 1.15));
  b.add(box(1.9, 0.5, 1.2, paint, 0, 1.65, -1.3));
  b.add(box(1.8, 0.12, 1.4, m.dark, 0, 1.4, -0.1));
  b.add(box(0.7, 0.15, 0.6, m.dark, 0, 1.55, -0.15));
  b.add(box(0.7, 0.6, 0.12, m.dark, 0, 1.85, -0.5));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 14), m.dark);
  wheel.position.set(0, 2.05, 0.3);
  wheel.rotation.x = 1.0;
  b.add(wheel);
  for (const x of [-1, 1]) {
    const px = x * 0.85;
    b.add(bar([px, 1.45, 0.5], [px, 3.2, 0.15], cage, 0.06));
    b.add(bar([px, 1.45, -0.8], [px, 3.2, -0.8], cage, 0.06));
    b.add(bar([px, 3.2, 0.15], [px, 3.2, -0.8], cage, 0.06));
    for (const z of [0.2, -0.45]) b.add(box(0.2, 0.2, 0.2, lampMat(0xfff2b0, 0xffd24a, 1.8), x * 0.45, 3.45, z));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), lampMat(0xfff6c8, 0xffe58a));
    lamp.position.set(x * 0.65, 1.8, 1.82);
    b.add(lamp);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 8), m.chrome);
    stack.position.set(x * 0.98, 2.35, -0.95);
    b.add(stack);
  }
  b.add(bar([-0.85, 3.2, 0.15], [0.85, 3.2, 0.15], cage, 0.06));
  b.add(bar([-0.85, 3.2, -0.8], [0.85, 3.2, -0.8], cage, 0.06));
  b.add(box(1.8, 0.2, 0.2, m.dark, 0, 3.35, 0.2));
  b.add(box(2.1, 0.28, 0.25, m.chrome, 0, 1.3, 1.9));
  b.add(box(2.1, 0.28, 0.25, m.chrome, 0, 1.3, -1.9));
  b.add(bar([-1.35, 0.95, 1.2], [1.35, 0.95, 1.2], m.dark, 0.1));
  b.add(bar([-1.35, 0.95, -1.15], [1.35, 0.95, -1.15], m.dark, 0.1));
  return {
    wheels: [[-1.35, 0.95, 0.8, 1.2, true], [1.35, 0.95, 0.8, 1.2, true], [-1.35, 0.95, 0.8, -1.15, false], [1.35, 0.95, 0.8, -1.15, false]],
    driver: { y: 1.52, z: -0.15, s: 1 }, flag: null, roll: 1.6, bounce: 2,
  };
}

function buildKart(b, m) {
  const paint = mat(0xffc933, { roughness: 0.35 });
  b.add(box(1.0, 0.14, 2.1, paint, 0, 0.28, 0));
  b.add(box(0.6, 0.2, 0.8, paint, 0, 0.42, 0.95));
  for (const x of [-1, 1]) {
    b.add(box(0.28, 0.28, 1.1, paint, x * 0.55, 0.42, 0));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lampMat(0xfff6c8, 0xffe58a));
    lamp.position.set(x * 0.22, 0.5, 1.37);
    b.add(lamp);
  }
  b.add(bar([-0.55, 0.3, 1.32], [0.55, 0.3, 1.32], m.chrome, 0.05));
  b.add(box(0.55, 0.1, 0.5, m.dark, 0, 0.4, -0.4));
  b.add(box(0.55, 0.45, 0.1, m.dark, 0, 0.7, -0.66));
  b.add(box(0.5, 0.35, 0.4, m.dark, 0, 0.5, -1.0));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 6, 12), m.dark);
  wheel.position.set(0, 0.8, 0.4);
  wheel.rotation.x = 1.1;
  b.add(wheel);
  b.add(bar([0, 0.45, 0.7], [0, 0.78, 0.4], m.dark, 0.025));
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), m.chrome);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(0.18, 0.4, -1.3);
  b.add(pipe);
  b.add(bar([-0.4, 0.5, -1.05], [-0.4, 2.0, -1.05], m.chrome, 0.012));
  return {
    wheels: [[-0.78, 0.32, 0.28, 0.85, true], [0.78, 0.32, 0.28, 0.85, true], [-0.82, 0.36, 0.4, -0.85, false], [0.82, 0.36, 0.4, -0.85, false]],
    driver: { y: 0.4, z: -0.1, s: 0.82 }, flag: [-0.4, 1.95, -1.05], roll: 0.6, bounce: 0.7,
  };
}

const BUILDERS = { buggy: buildBuggy, sprinter: buildSprinter, truck: buildTruck, kart: buildKart };

export class Buggy {
  constructor(type = 'buggy') {
    this.root = new THREE.Group();
    this.pitch = 0;
    this.bounce = 0;
    this.style = DEFAULT_STYLE;
    this.driver = null;
    this.build(type);
  }

  // (Re)builds the model for one of the cars in cars.js.
  build(type) {
    if (this.body) {
      this.root.remove(this.body);
      for (const w of this.wheels) this.root.remove(w.pivot);
      for (const o of [this.body, ...this.wheels.map((w) => w.pivot)]) {
        o.traverse((n) => {
          n.geometry?.dispose();
          for (const mm of [].concat(n.material ?? [])) mm.dispose();
        });
      }
    }
    this.type = type;
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.wheels = [];
    const shared = {
      dark: mat(0x23272b, { roughness: 0.8 }),
      chrome: mat(0xcfd6dc, { metalness: 0.85, roughness: 0.25 }),
    };
    const spec = BUILDERS[type](this.body, shared);
    this.spec = spec;

    const tire = mat(0x1b1b1b, { roughness: 1 });
    const hub = mat(0xd9dde0, { metalness: 0.7, roughness: 0.3 });
    for (const [x, r, w, z, steered] of spec.wheels) {
      const pivot = new THREE.Group();
      pivot.position.set(x, r, z);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, r > 0.8 ? 18 : 14), tire);
      t.rotation.z = Math.PI / 2;
      const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.03, 10), hub);
      h.rotation.z = Math.PI / 2;
      spin.add(t, h);
      const lugs = r > 0.8 ? 3 : 1;
      for (let i = 0; i < lugs; i++) {
        const lug = box(0.1, r * 1.9, w * 0.5, shared.dark);
        lug.rotation.x = (i * Math.PI) / lugs;
        spin.add(lug);
      }
      pivot.add(spin);
      this.root.add(pivot);
      this.wheels.push({ pivot, spin, r, steered });
    }

    this.flag = null;
    if (spec.flag) {
      this.flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x1fe0d0, emissive: 0x0b8f86, side: THREE.DoubleSide }),
      );
      this.flag.geometry.translate(0.35, 0, 0);
      this.flag.position.set(...spec.flag);
      this.body.add(this.flag);
    }

    this.body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.wheels.forEach((w) => w.pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; }));
    this.driver = null;
    this.setDriver(this.style);
  }

  setDriver(style) {
    this.style = style ?? DEFAULT_STYLE;
    if (this.driver) {
      this.body.remove(this.driver.group);
      this.driver.group.traverse((o) => {
        if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
      });
    }
    this.driver = buildDriver(this.style);
    const d = this.spec.driver;
    this.driver.group.position.set(0, d.y, d.z);
    this.driver.group.scale.setScalar(d.s);
    this.body.add(this.driver.group);
  }

  kick(strength) {
    this.bounce = Math.min(0.25, this.bounce + strength * 0.012);
  }

  // Sync the model with the physics state.
  update(v, dt, time) {
    const { roll: rollK, bounce: bounceK } = this.spec;
    this.root.position.set(v.x, 0, v.z);
    this.root.rotation.y = v.heading;

    const roll = clamp(v.w * v.vf * 0.014 * rollK, -0.16 * rollK, 0.16 * rollK);
    const pitchTarget = clamp(v.accel * 0.006, -0.08, 0.12) * -1 + (v.accel < -20 ? 0.05 : 0);
    this.pitch += (pitchTarget - this.pitch) * Math.min(1, dt * 8);
    this.bounce *= Math.exp(-dt * 7);
    const chatter = Math.min(1, Math.abs(v.vf) / 20) * 0.012 * bounceK * Math.sin(time * 38);
    this.body.rotation.set(this.pitch, 0, roll);
    this.body.position.y = this.bounce * bounceK * Math.abs(Math.sin(time * 18)) + chatter + (v.offTrack ? 0.015 * Math.sin(time * 55) : 0);

    for (const w of this.wheels) {
      w.spin.rotation.x += (v.vf * dt) / w.r;
      if (w.steered) w.pivot.rotation.y = v.steer * 0.5;
    }
    this.driver.head.rotation.y = v.steer * 0.45;
    if (this.flag) this.flag.rotation.y = 0.5 + Math.sin(time * 14) * 0.25 - Math.min(1, Math.abs(v.vf) / 40) * 0.5;
  }
}
