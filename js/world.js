import * as THREE from 'three';
import { TRACK_HALF } from './track.js';
import { clamp, lerp, rng, smoothstep } from './util.js';
import {
  bannerTexture, cloudTexture, curbTexture, finishLineTexture, glowTexture,
  sandTexture, trackTexture, waterTexture,
} from './textures.js';

const SEA_LEVEL = -0.55;
const FOG_COLOR = 0xd6edf2;
const col = (hex) => new THREE.Color(hex);

// Collects flat-shaded triangles with per-vertex colours.
class MeshBuilder {
  constructor() { this.pos = []; this.color = []; }
  tri(a, b, c, ca, cb = ca, cc = ca) {
    this.pos.push(...a, ...b, ...c);
    for (const k of [ca, cb, cc]) this.color.push(k.r, k.g, k.b);
  }
  quad(a, b, c, d, ca, cb = ca, cc = ca, cd = ca) {
    this.tri(a, b, c, ca, cb, cc);
    this.tri(a, c, d, ca, cc, cd);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    g.computeVertexNormals();
    return g;
  }
}

function buildPalmGeometries() {
  const trunk = new MeshBuilder();
  const leaves = new MeshBuilder();
  const H = 8, SEGS = 7, SIDES = 6, BEND = [1.6, 0.5];
  const barkA = col(0x7a5a38), barkB = col(0xa0805a);
  const rings = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const cx = BEND[0] * t * t, cz = BEND[1] * t * t;
    const r = lerp(0.46, 0.26, t) * (i % 2 ? 1.07 : 1);
    const ring = [];
    for (let k = 0; k <= SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * r, t * H, cz + Math.sin(a) * r]);
    }
    rings.push(ring);
  }
  for (let i = 0; i < SEGS; i++) {
    const c = i % 2 ? barkA : barkB;
    for (let k = 0; k < SIDES; k++) {
      trunk.quad(rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k], c);
    }
  }
  const top = [BEND[0], H, BEND[1]];
  const dark = col(0x1c6a30), light = col(0x72c24c), spineC = col(0x8ad35c);
  const FRONDS = 9, PARTS = 5, L = 4.6;
  for (let f = 0; f < FRONDS; f++) {
    const a = (f / FRONDS) * Math.PI * 2 + (f % 2 ? 0.2 : 0);
    const dx = Math.cos(a), dz = Math.sin(a);
    const rise = 1.3 + (f % 3) * 0.35;
    const droop = 3.1 + (f % 2) * 0.7;
    const row = [];
    for (let j = 0; j <= PARTS; j++) {
      const t = j / PARTS;
      const px = top[0] + dx * L * t, pz = top[2] + dz * L * t;
      const py = top[1] + 0.7 + rise * t - droop * t * t;
      const w = Math.sin(Math.PI * Math.min(1, 0.18 + 0.82 * t)) * (1 - 0.25 * t);
      row.push({
        l: [px - dz * w, py - 0.25 * w, pz + dx * w],
        s: [px, py + 0.05, pz],
        r: [px + dz * w, py - 0.25 * w, pz - dx * w],
        c: dark.clone().lerp(light, t * (0.7 + 0.15 * ((f * 7) % 3))),
      });
    }
    for (let j = 0; j < PARTS; j++) {
      const A = row[j], B = row[j + 1];
      const sa = A.c.clone().lerp(spineC, 0.3), sb = B.c.clone().lerp(spineC, 0.3);
      leaves.tri(A.l, A.s, B.s, A.c, sa, sb);
      leaves.tri(A.l, B.s, B.l, A.c, sb, B.c);
      leaves.tri(A.s, A.r, B.r, sa, A.c, B.c);
      leaves.tri(A.s, B.r, B.s, sa, B.c, sb);
    }
  }
  return { trunk: trunk.build(), leaves: leaves.build() };
}

function buildRockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + Math.sin(x * 3.1 + y * 2.3) * Math.sin(z * 2.7 + x * 1.3) * 0.2;
    p.setXYZ(i, x * n, Math.max(y * n, -0.45), z * n);
  }
  g.computeVertexNormals();
  return g;
}

// A ribbon along the track. Each section is [lateral offset (left +, ascending), height, colour].
function strip(track, sections, material, vRepeat = 12) {
  const N = track.N;
  const S = sections.length;
  const repeat = track.length / Math.max(1, Math.round(track.length / vRepeat));
  const pos = [], colr = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i <= N; i++) {
    const p = track.pts[i % N];
    const l = track.left(i);
    if (i > 0) dist += p.distanceTo(track.pts[(i - 1) % N]);
    for (let s = 0; s < S; s++) {
      const [off, y, c] = sections[s];
      pos.push(p.x + l.x * off, y, p.z + l.z * off);
      colr.push(c.r, c.g, c.b);
      uv.push(s / (S - 1), dist / repeat);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let s = 0; s < S - 1; s++) {
      const a = i * S + s, b = a + 1, c = a + S, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

export function buildWorld(scene, track) {
  scene.background = col(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 220, 1100);

  // ---- Lights
  scene.add(new THREE.HemisphereLight(0xcfeaff, 0xf2dcaa, 1.35));
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.1);
  const SUN_OFFSET = new THREE.Vector3(70, 100, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -60;
  sc.right = sc.top = 60;
  sc.near = 1;
  sc.far = 320;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  // ---- Island height field
  const islandR = (a) => 232 + 10 * Math.sin(3 * a + 1) + 7 * Math.sin(5 * a + 2) + 4 * Math.sin(9 * a);
  const coarse = track.pts.filter((_, i) => i % 8 === 0);
  const trackDist = (x, z) => {
    let best = Infinity;
    for (const p of coarse) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const heightAt = (x, z, td = trackDist(x, z)) => {
    const d = Math.hypot(x, z) / islandR(Math.atan2(z, x));
    const shore = -smoothstep(0.82, 1.25, d) * 3.4;
    const bump = 0.5 + 0.5 * Math.sin(x * 0.045 + 1) * Math.sin(z * 0.05) + 0.25 * Math.sin(x * 0.11 + z * 0.09);
    const dunes = 1.1 * clamp(bump, 0, 1.2) * smoothstep(20, 36, td) * (1 - smoothstep(0.66, 0.82, d));
    return shore + dunes;
  };

  const SIZE = 640, SEG = 230;
  const ground = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position;
  const gc = new Float32Array(gp.count * 3);
  const dry = col(0xf0dca8), wet = col(0xb89d6c), foam = col(0xf6fbf8), seabed = col(0x8fbfb2);
  const tmp = new THREE.Color();
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const h = heightAt(x, z);
    gp.setY(i, h);
    const grain = 0.94 + 0.08 * Math.sin(x * 0.7) * Math.sin(z * 0.9);
    tmp.copy(dry).multiplyScalar(grain);
    tmp.lerp(wet, smoothstep(-0.05, -0.5, h));
    tmp.lerp(foam, smoothstep(0.17, 0, Math.abs(h - SEA_LEVEL)) * 0.85);
    tmp.lerp(seabed, smoothstep(-0.7, -1.8, h));
    gc.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  ground.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(
    ground,
    new THREE.MeshStandardMaterial({ vertexColors: true, map: sandTexture(), roughness: 1 }),
  );
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ---- Sea
  const waterMap = waterTexture();
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new THREE.MeshPhongMaterial({
      color: 0x2fd2cf, map: waterMap, transparent: true, opacity: 0.84,
      specular: 0xffffff, shininess: 90,
    }),
  );
  sea.position.y = SEA_LEVEL;
  scene.add(sea);

  // ---- Track surface, curbs and berms
  const white = col(0xffffff);
  const sandLight = col(0xeed7a2), sandMid = col(0xe0c78e), sandDark = col(0xc9ae78);
  const mats = {
    road: new THREE.MeshStandardMaterial({
      map: trackTexture(), vertexColors: true, roughness: 1, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    curb: new THREE.MeshStandardMaterial({
      map: curbTexture(), vertexColors: true, roughness: 0.9, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
    berm: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
  };
  scene.add(strip(track, [[-TRACK_HALF, 0.04, white], [TRACK_HALF, 0.04, white]], mats.road, 14));
  scene.add(strip(track, [[TRACK_HALF, 0.06, white], [TRACK_HALF + 1.1, 0.06, white]], mats.curb, 8));
  scene.add(strip(track, [[-TRACK_HALF - 1.1, 0.06, white], [-TRACK_HALF, 0.06, white]], mats.curb, 8));
  const bermProfile = [[10.1, 0, sandMid], [11, 0.55, sandLight], [12.2, 0.85, sandLight], [13.4, 0.6, sandMid], [14.6, 0, sandDark]];
  const bermHeight = (off) => {
    const a = Math.abs(off);
    for (let i = 0; i < bermProfile.length - 1; i++) {
      const [o0, h0] = bermProfile[i], [o1, h1] = bermProfile[i + 1];
      if (a >= o0 && a <= o1) return lerp(h0, h1, (a - o0) / (o1 - o0));
    }
    return 0;
  };
  scene.add(strip(track, bermProfile, mats.berm, 12));
  scene.add(strip(track, bermProfile.map(([o, h, c]) => [-o, h, c]).reverse(), mats.berm, 12));

  // ---- Start / finish gate
  const gate = new THREE.Group();
  const t0 = track.tan[0];
  gate.position.set(track.pts[0].x, 0, track.pts[0].z);
  gate.rotation.y = Math.atan2(t0.x, t0.z);
  const finish = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_HALF * 2, 2.2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: finishLineTexture(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  );
  finish.position.y = 0.07;
  finish.receiveShadow = true;
  gate.add(finish);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf6efe0, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 7.4, 10), postMat);
    post.position.set(side * 11.6, 3.7, 0);
    post.castShadow = true;
    gate.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe0412f }));
    cap.position.set(side * 11.6, 7.5, 0);
    gate.add(cap);
  }
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(23.2, 3.6),
    new THREE.MeshBasicMaterial({ map: bannerTexture() }),
  );
  banner.position.set(0, 6, 0);
  banner.rotation.y = Math.PI; // text faces the cars coming up to the line
  gate.add(banner);
  scene.add(gate);

  // ---- Palms and rocks
  const rand = rng(1234);
  const colliders = [];
  const palmGeo = buildPalmGeometries();
  const rockGeo = buildRockGeometry();
  const palmSpots = [];
  const rockSpots = [];
  const N = track.N;

  for (let i = 0; i < N; i += 13) {
    if (i < 34 || i > N - 34) continue; // keep the start gate clear
    for (const side of [-1, 1]) {
      const roll = rand();
      const l = track.left(i);
      const p = track.pts[i];
      if (roll < 0.42) {
        const off = side * (12.4 + rand() * 1.4);
        const x = p.x + l.x * off, z = p.z + l.z * off;
        palmSpots.push({ x, z, y: bermHeight(off) - 0.1, s: 0.85 + rand() * 0.45 });
        colliders.push({ x, z, r: 0.5 });
      } else if (roll < 0.8) {
        const off = side * (11.3 + rand() * 0.6);
        const x = p.x + l.x * off, z = p.z + l.z * off;
        const s = 0.9 + rand() * 0.9;
        rockSpots.push({ x, z, y: bermHeight(off) + s * 0.15, s, sy: 0.7 + rand() * 0.5 });
        colliders.push({ x, z, r: s * 0.9 });
      }
    }
  }
  // Lush back rows and the rest of the island.
  for (let i = 0; i < N; i += 7) {
    for (const side of [-1, 1]) {
      if (rand() > 0.5) continue;
      const l = track.left(i);
      const p = track.pts[i];
      const off = side * (16 + rand() * 26);
      const x = p.x + l.x * off, z = p.z + l.z * off;
      palmSpots.push({ x, z, y: heightAt(x, z) - 0.1, s: 0.9 + rand() * 0.6 });
    }
  }
  for (let n = 0; n < 900 && palmSpots.length < 620; n++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 215;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const d = Math.hypot(x, z) / islandR(Math.atan2(z, x));
    const td = trackDist(x, z);
    if (d > 0.8 || td < 24) continue;
    palmSpots.push({ x, z, y: heightAt(x, z, td) - 0.1, s: 0.8 + rand() * 0.7 });
  }
  for (let n = 0; n < 300 && rockSpots.length < 220; n++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 235;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const td = trackDist(x, z);
    if (td < 24) continue;
    const s = 0.8 + rand() * 1.6;
    rockSpots.push({ x, z, y: Math.max(heightAt(x, z, td), SEA_LEVEL - 0.3) + s * 0.1, s, sy: 0.6 + rand() * 0.5 });
  }

  const palmTrunks = new THREE.InstancedMesh(palmGeo.trunk, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }), palmSpots.length);
  const palmLeaves = new THREE.InstancedMesh(palmGeo.leaves, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), palmSpots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  palmSpots.forEach((p, i) => {
    e.set((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12);
    q.setFromEuler(e);
    m4.compose(v3.set(p.x, p.y, p.z), q, s3.set(p.s, p.s * (0.9 + rand() * 0.3), p.s));
    palmTrunks.setMatrixAt(i, m4);
    palmLeaves.setMatrixAt(i, m4);
  });
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide }), rockSpots.length);
  const rockPalette = [0x8a8378, 0x6f6a62, 0xa29a8a, 0x5d5a55].map(col);
  rockSpots.forEach((r, i) => {
    e.set(0, rand() * Math.PI * 2, 0);
    q.setFromEuler(e);
    m4.compose(v3.set(r.x, r.y, r.z), q, s3.set(r.s, r.s * r.sy, r.s * (0.8 + rand() * 0.4)));
    rocks.setMatrixAt(i, m4);
    rocks.setColorAt(i, rockPalette[Math.floor(rand() * rockPalette.length)]);
  });
  for (const m of [palmTrunks, palmLeaves, rocks]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
  }

  // ---- Beach umbrellas
  const umbrellaColors = [0xe0412f, 0x1fb5b0, 0xffc93c, 0xff7ab0];
  for (let n = 0; n < 16; n++) {
    const i = Math.floor(rand() * N);
    const side = rand() < 0.5 ? -1 : 1;
    const l = track.left(i), p = track.pts[i];
    const off = side * (19 + rand() * 8);
    const x = p.x + l.x * off, z = p.z + l.z * off;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6), new THREE.MeshStandardMaterial({ color: 0xf4efe4 }));
    pole.position.y = 1.35;
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(1.7, 0.8, 10),
      new THREE.MeshStandardMaterial({ color: umbrellaColors[n % 4], flatShading: true, side: THREE.DoubleSide }),
    );
    canopy.position.y = 2.75;
    canopy.castShadow = true;
    g.add(pole, canopy);
    g.position.set(x, heightAt(x, z), z);
    g.rotation.set((rand() - 0.5) * 0.25, rand() * 6, (rand() - 0.5) * 0.25);
    scene.add(g);
  }

  // ---- Sky
  const skyGeo = new THREE.SphereGeometry(1500, 24, 16);
  const skyColors = [];
  const horizon = col(FOG_COLOR), mid = col(0x8fd2f0), topC = col(0x2f82d8);
  const sp = skyGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const t = sp.getY(i) / 1500;
    const c = horizon.clone();
    if (t > 0) c.lerp(mid, smoothstep(0, 0.22, t)).lerp(topC, smoothstep(0.2, 0.9, t));
    skyColors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -2;
  scene.add(sky);
  const glow = glowTexture();
  const sunDir = SUN_OFFSET.clone().normalize();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff1c4, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunSprite.scale.setScalar(420);
  sunSprite.renderOrder = -1;
  scene.add(sunSprite);
  const cloudMap = cloudTexture();
  const clouds = [];
  for (let n = 0; n < 14; n++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudMap, fog: false, depthWrite: false, transparent: true, opacity: 0.9 }));
    const a = rand() * Math.PI * 2, r = 350 + rand() * 650;
    s.position.set(Math.cos(a) * r, 140 + rand() * 120, Math.sin(a) * r);
    s.scale.set(240 + rand() * 160, 110 + rand() * 60, 1);
    s.renderOrder = -1;
    scene.add(s);
    clouds.push(s);
  }

  return {
    colliders,
    // Called every frame with the point the world should be centred on.
    update(dt, focus, camera) {
      sun.position.copy(focus).add(SUN_OFFSET);
      sun.target.position.copy(focus);
      sky.position.copy(camera.position);
      sunSprite.position.copy(camera.position).addScaledVector(sunDir, 1200);
      waterMap.offset.x += dt * 0.004;
      waterMap.offset.y += dt * 0.0025;
      for (const c of clouds) {
        c.position.x += dt * 3;
        if (c.position.x > 1000) c.position.x = -1000;
      }
    },
  };
}
