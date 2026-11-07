import * as THREE from 'three';
import { TRACK_HALF } from './track.js';
import { clamp, lerp, rng, smoothstep } from './util.js';
import {
  bannerTexture, cloudTexture, curbTexture, discTexture, finishLineTexture, glowTexture,
  sandTexture, trackTexture, waterTexture, windowTextures,
} from './textures.js';

const SEA_LEVEL = -0.55;
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

// A tapered, capped tube between two points.
function tube(mb, p0, p1, r0, r1, c0, c1, sides = 6) {
  const a = new THREE.Vector3(...p1).sub(new THREE.Vector3(...p0)).normalize();
  const ref = Math.abs(a.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(a, ref).normalize();
  const v = new THREE.Vector3().crossVectors(a, u);
  const ring = (p, r) => Array.from({ length: sides + 1 }, (_, k) => {
    const t = (k / sides) * Math.PI * 2;
    const cs = Math.cos(t) * r, sn = Math.sin(t) * r;
    return [p[0] + u.x * cs + v.x * sn, p[1] + u.y * cs + v.y * sn, p[2] + u.z * cs + v.z * sn];
  });
  const R0 = ring(p0, r0), R1 = ring(p1, r1);
  const tip = [p1[0] + a.x * r1 * 0.7, p1[1] + a.y * r1 * 0.7, p1[2] + a.z * r1 * 0.7];
  for (let k = 0; k < sides; k++) {
    mb.quad(R0[k], R0[k + 1], R1[k + 1], R1[k], c0, c0, c1, c1);
    mb.tri(R1[k], R1[k + 1], tip, c1);
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

function buildCactusGeometry() {
  const mb = new MeshBuilder();
  const lo = col(0x2f7a3e), hi = col(0x5ba85e);
  tube(mb, [0, 0, 0], [0, 4.8, 0], 0.5, 0.42, lo, hi, 7);
  tube(mb, [0.35, 2.2, 0], [1.3, 2.2, 0], 0.27, 0.27, lo, lo, 6);
  tube(mb, [1.3, 2.2, 0], [1.38, 3.7, 0], 0.27, 0.23, lo, hi, 6);
  tube(mb, [-0.35, 1.5, 0], [-1.1, 1.5, 0], 0.25, 0.25, lo, lo, 6);
  tube(mb, [-1.1, 1.5, 0], [-1.16, 2.7, 0], 0.25, 0.21, lo, hi, 6);
  return mb.build();
}

function buildMesaGeometry() {
  const g = new THREE.CylinderGeometry(0.8, 1, 1, 9, 6, false).toNonIndexed();
  const p = g.attributes.position;
  const colors = [];
  const bands = [col(0xb5653a), col(0xc47a4a), col(0x9a5230), col(0xd08a58), col(0xa65a34)];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + Math.sin(x * 5.3 + y * 3.1) * Math.sin(z * 4.7 - y * 2.2) * 0.12;
    const edge = Math.abs(y) < 0.499 ? n : 1;
    p.setXYZ(i, x * edge, y, z * edge);
    const band = bands[Math.min(bands.length - 1, Math.floor((y + 0.5) * bands.length))];
    colors.push(band.r, band.g, band.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
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

// Builds the whole scene for one environment (see environments.js). Call dispose() before building another.
export function buildWorld(scene, track, env) {
  const root = new THREE.Group();
  scene.add(root);
  const horizon = col(env.sky.horizon);
  scene.background = horizon;
  scene.fog = new THREE.Fog(horizon, env.fog[0], env.fog[1]);

  // ---- Lights
  root.add(new THREE.HemisphereLight(env.hemi.sky, env.hemi.ground, env.hemi.intensity));
  const sun = new THREE.DirectionalLight(env.sun.color, env.sun.intensity);
  const SUN_OFFSET = new THREE.Vector3(...env.sun.offset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -60;
  sc.right = sc.top = 60;
  sc.near = 1;
  sc.far = 360;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  root.add(sun, sun.target);

  // ---- Terrain height field
  const T = env.terrain;
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
    const shore = T.shore ? -smoothstep(0.82, 1.25, d) * 3.4 : 0;
    const bump = 0.5 + 0.5 * Math.sin(x * 0.045 + 1) * Math.sin(z * 0.05) + 0.25 * Math.sin(x * 0.11 + z * 0.09);
    const dunes = T.dune * clamp(bump, 0, 1.2) * smoothstep(20, 36, td) * (1 - smoothstep(0.66, 0.82, d));
    return shore + dunes;
  };

  const SIZE = 640, SEG = 230;
  const ground = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position;
  const gc = new Float32Array(gp.count * 3);
  const G = env.ground;
  const dry = col(G.dry), wet = col(G.wet), edge = col(G.edge);
  const foam = col(G.foam ?? G.dry), seabed = col(G.seabed ?? G.dry);
  const tmp = new THREE.Color();
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const h = heightAt(x, z);
    gp.setY(i, h);
    const grain = 0.94 + 0.08 * Math.sin(x * 0.7) * Math.sin(z * 0.9);
    tmp.copy(dry).multiplyScalar(grain);
    if (T.shore) {
      tmp.lerp(wet, smoothstep(-0.05, -0.5, h));
      tmp.lerp(foam, smoothstep(0.17, 0, Math.abs(h - SEA_LEVEL)) * 0.85);
      tmp.lerp(seabed, smoothstep(-0.7, -1.8, h));
    } else {
      // No shoreline: blend into the flat ground that continues to the horizon.
      tmp.lerp(edge, smoothstep(0.78, 0.97, Math.hypot(x, z) / islandR(Math.atan2(z, x))));
    }
    gc.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  ground.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(
    ground,
    new THREE.MeshStandardMaterial({ vertexColors: true, map: sandTexture(), roughness: 1 }),
  );
  groundMesh.receiveShadow = true;
  root.add(groundMesh);

  // ---- Sea, or flat ground out to the horizon
  let waterMap = null;
  if (env.water) {
    waterMap = waterTexture();
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshPhongMaterial({
        color: env.water.color, map: waterMap, transparent: true, opacity: env.water.opacity,
        specular: 0xffffff, shininess: 90,
      }),
    );
    sea.position.y = SEA_LEVEL;
    root.add(sea);
  } else {
    const far = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: G.edge, roughness: 1 }),
    );
    far.position.y = -0.12;
    root.add(far);
  }

  // ---- Track surface, curbs and berms
  const white = col(0xffffff);
  const [bermMid, bermLight, bermDark] = env.berm.colors.map(col);
  const mats = {
    road: new THREE.MeshStandardMaterial({
      map: trackTexture(env.road), vertexColors: true, roughness: env.road.center ? 0.85 : 1, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    curb: new THREE.MeshStandardMaterial({
      map: curbTexture(), vertexColors: true, roughness: 0.9, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }),
    berm: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
  };
  root.add(strip(track, [[-TRACK_HALF, 0.04, white], [TRACK_HALF, 0.04, white]], mats.road, 14));
  root.add(strip(track, [[TRACK_HALF, 0.06, white], [TRACK_HALF + 1.1, 0.06, white]], mats.curb, 8));
  root.add(strip(track, [[-TRACK_HALF - 1.1, 0.06, white], [-TRACK_HALF, 0.06, white]], mats.curb, 8));
  const bermProfile = env.berm.style === 'wall'
    ? [[10.1, 0, bermMid], [10.15, 1.1, bermMid], [11.2, 1.15, bermLight], [11.25, 0, bermDark]]
    : [[10.1, 0, bermMid], [11, 0.55, bermLight], [12.2, 0.85, bermLight], [13.4, 0.6, bermMid], [14.6, 0, bermDark]];
  const bermHeight = (off) => {
    const a = Math.abs(off);
    for (let i = 0; i < bermProfile.length - 1; i++) {
      const [o0, h0] = bermProfile[i], [o1, h1] = bermProfile[i + 1];
      if (a >= o0 && a <= o1) return lerp(h0, h1, (a - o0) / (o1 - o0));
    }
    return 0;
  };
  root.add(strip(track, bermProfile, mats.berm, 12));
  root.add(strip(track, bermProfile.map(([o, h, c]) => [-o, h, c]).reverse(), mats.berm, 12));

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
  root.add(gate);

  // ---- Scenery
  const rand = rng(1234);
  const colliders = [];
  const N = track.N;
  const tallSpots = []; // palms or cacti
  const rockSpots = [];
  const cactus = env.decor === 'cacti';
  const roadside = env.decor !== 'city';

  if (roadside) {
    for (let i = 0; i < N; i += 13) {
      if (i < 34 || i > N - 34) continue; // keep the start gate clear
      for (const side of [-1, 1]) {
        const roll = rand();
        const l = track.left(i);
        const p = track.pts[i];
        if (roll < 0.42) {
          const off = side * (12.4 + rand() * 1.4);
          const x = p.x + l.x * off, z = p.z + l.z * off;
          tallSpots.push({ x, z, y: bermHeight(off) - 0.1, s: (cactus ? 0.8 : 0.85) + rand() * 0.45 });
          colliders.push({ x, z, r: cactus ? 0.6 : 0.5 });
        } else if (roll < 0.8) {
          const off = side * (11.3 + rand() * 0.6);
          const x = p.x + l.x * off, z = p.z + l.z * off;
          const s = 0.9 + rand() * 0.9;
          rockSpots.push({ x, z, y: bermHeight(off) + s * 0.15, s, sy: 0.7 + rand() * 0.5 });
          colliders.push({ x, z, r: s * 0.9 });
        }
      }
    }
    // Back rows and the rest of the land.
    const maxTall = cactus ? 330 : 620;
    for (let i = 0; i < N; i += cactus ? 11 : 7) {
      for (const side of [-1, 1]) {
        if (rand() > 0.5) continue;
        const l = track.left(i);
        const p = track.pts[i];
        const off = side * (16 + rand() * 26);
        const x = p.x + l.x * off, z = p.z + l.z * off;
        tallSpots.push({ x, z, y: heightAt(x, z) - 0.1, s: 0.9 + rand() * 0.6 });
      }
    }
    for (let n = 0; n < 900 && tallSpots.length < maxTall; n++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 215;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const d = Math.hypot(x, z) / islandR(Math.atan2(z, x));
      const td = trackDist(x, z);
      if (d > 0.8 || td < 24) continue;
      tallSpots.push({ x, z, y: heightAt(x, z, td) - 0.1, s: 0.8 + rand() * 0.7 });
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
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const shade = (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  };

  if (tallSpots.length) {
    const tallMeshes = cactus
      ? [new THREE.InstancedMesh(buildCactusGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), tallSpots.length)]
      : (() => {
        const g = buildPalmGeometries();
        return [
          new THREE.InstancedMesh(g.trunk, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }), tallSpots.length),
          new THREE.InstancedMesh(g.leaves, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), tallSpots.length),
        ];
      })();
    tallSpots.forEach((p, i) => {
      e.set((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12);
      q.setFromEuler(e);
      m4.compose(v3.set(p.x, p.y, p.z), q, s3.set(p.s, p.s * (0.9 + rand() * 0.3), p.s));
      for (const m of tallMeshes) m.setMatrixAt(i, m4);
    });
    tallMeshes.forEach(shade);
  }

  if (rockSpots.length) {
    const rocks = new THREE.InstancedMesh(buildRockGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide }), rockSpots.length);
    const palette = env.rocks.map(col);
    rockSpots.forEach((r, i) => {
      e.set(0, rand() * Math.PI * 2, 0);
      q.setFromEuler(e);
      m4.compose(v3.set(r.x, r.y, r.z), q, s3.set(r.s, r.s * r.sy, r.s * (0.8 + rand() * 0.4)));
      rocks.setMatrixAt(i, m4);
      rocks.setColorAt(i, palette[Math.floor(rand() * palette.length)]);
    });
    shade(rocks);
  }

  // Desert mesas on the horizon
  if (cactus) {
    const spots = [];
    for (let n = 0; n < 400 && spots.length < 16; n++) {
      const a = rand() * Math.PI * 2;
      const r = 120 + rand() * 190;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (trackDist(x, z) < 70) continue;
      spots.push({ x, z, w: 16 + rand() * 24, h: 18 + rand() * 30 });
    }
    const mesas = new THREE.InstancedMesh(buildMesaGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), spots.length);
    spots.forEach((s, i) => {
      e.set(0, rand() * Math.PI * 2, 0);
      q.setFromEuler(e);
      m4.compose(v3.set(s.x, s.h / 2 - 2, s.z), q, s3.set(s.w, s.h, s.w * (0.7 + rand() * 0.5)));
      mesas.setMatrixAt(i, m4);
    });
    shade(mesas);
  }

  // Beach umbrellas
  if (env.decor === 'palms' && !env.stars) {
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
      root.add(g);
    }
  }

  // ---- City blocks
  if (env.decor === 'city') {
    const { map, glow } = windowTextures();
    const material = new THREE.MeshStandardMaterial({
      map, emissiveMap: glow, emissive: 0xffffff, emissiveIntensity: env.windowGlow ?? 0, vertexColors: true, roughness: 0.7, metalness: 0.1,
    });
    const tints = [0xb9bcc6, 0x9aa3b4, 0xc9b79c, 0x8d93a0, 0xa7b0b8, 0xc4c4cc].map(col);
    const placed = [];
    for (let n = 0; n < 1400 && placed.length < 150; n++) {
      const x = (rand() - 0.5) * 600, z = (rand() - 0.5) * 600;
      const td = trackDist(x, z);
      if (td < 28) continue;
      const w = 12 + rand() * 16, d = 12 + rand() * 16;
      const rad = Math.max(w, d) * 0.62;
      if (placed.some((b) => Math.hypot(b.x - x, b.z - z) < (b.rad + rad) * 0.95)) continue;
      // Lower blocks beside the road so the view stays open; towers further out.
      const h = td < 60 ? 14 + rand() * 26 : 24 + Math.pow(rand(), 1.6) * 90;
      placed.push({ x, z, w, d, h, rad });
    }
    for (const b of placed) {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d);
      const uv = g.attributes.uv;
      const faceW = [b.d, b.d, 0, 0, b.w, b.w]; // +x -x (+y -y roofs) +z -z
      const ou = rand(), ov = rand();
      for (let f = 0; f < 6; f++) {
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k;
          if (f === 2 || f === 3) uv.setXY(i, 0.02, 0.02); // roof: blank wall corner
          else uv.setXY(i, ou + (uv.getX(i) * faceW[f]) / 32, ov + (uv.getY(i) * b.h) / 32);
        }
      }
      const tint = tints[Math.floor(rand() * tints.length)];
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: 24 }).flatMap(() => [tint.r, tint.g, tint.b]), 3));
      const m = new THREE.Mesh(g, material);
      m.position.set(b.x, b.h / 2 - 0.2, b.z);
      m.rotation.y = rand() < 0.5 ? 0 : Math.PI / 2;
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
    }
  }

  // ---- Lamps (street lights in the city, torches on the moonlit island)
  const glowTex = glowTexture();
  if (env.lamps) {
    const L = env.lamps;
    const spots = [];
    for (let i = 40; i < N - 20; i += Math.round(L.spacing / 0.65)) {
      for (const side of [-1, 1]) {
        const l = track.left(i), p = track.pts[i];
        const off = side * L.offset;
        spots.push({ x: p.x + l.x * off, z: p.z + l.z * off, side, l, p, y: L.torch ? bermHeight(off) : 0 });
      }
    }
    const count = spots.length;
    const poleMat = new THREE.MeshStandardMaterial({ color: L.torch ? 0x6b4a2b : 0x45484f, roughness: 0.7 });
    const bulbMat = new THREE.MeshBasicMaterial({ color: L.color, fog: false });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.16, L.height, 6).translate(0, L.height / 2, 0), poleMat, count);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(L.torch ? 0.28 : 0.36, 8, 6), bulbMat, count);
    const arms = L.arm ? new THREE.InstancedMesh(new THREE.BoxGeometry(L.arm, 0.12, 0.12).translate(L.arm / 2, 0, 0), poleMat, count) : null;
    const pools = L.pool ? new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTex, color: L.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
      count,
    ) : null;
    spots.forEach((s, i) => {
      const dir = { x: -s.side * s.l.x, z: -s.side * s.l.z }; // toward the track
      q.setFromEuler(e.set(0, Math.atan2(-dir.z, dir.x), 0));
      m4.compose(v3.set(s.x, s.y, s.z), q, s3.set(1, 1, 1));
      poles.setMatrixAt(i, m4);
      const bx = s.x + dir.x * L.arm, bz = s.z + dir.z * L.arm, by = s.y + L.height;
      m4.compose(v3.set(bx, by + (L.torch ? 0.2 : 0), bz), q, s3.set(1, L.torch ? 1.5 : 1, 1));
      bulbs.setMatrixAt(i, m4);
      if (arms) { m4.compose(v3.set(s.x, by - 0.1, s.z), q, s3.set(1, 1, 1)); arms.setMatrixAt(i, m4); }
      if (pools) {
        m4.compose(v3.set(s.p.x + s.l.x * s.side * 3, 0.12, s.p.z + s.l.z * s.side * 3), q.identity(), s3.set(22, 1, 22));
        pools.setMatrixAt(i, m4);
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: L.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
      halo.position.set(bx, by + (L.torch ? 0.2 : 0), bz);
      halo.scale.setScalar(L.torch ? 5 : 9);
      root.add(halo);
    });
    for (const m of [poles, bulbs, arms, pools]) {
      if (!m) continue;
      m.frustumCulled = false;
      root.add(m);
    }
    poles.castShadow = true;
  }

  // ---- Sky
  const skyGeo = new THREE.SphereGeometry(1500, 24, 16);
  const skyColors = [];
  const mid = col(env.sky.mid), topC = col(env.sky.top);
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
  root.add(sky);

  const sunDir = SUN_OFFSET.clone().normalize();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: env.sun.glow, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunSprite.scale.setScalar(env.sun.glowSize);
  sunSprite.renderOrder = -1;
  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(), color: env.sun.core, fog: false, depthWrite: false }));
  sunCore.scale.setScalar(env.sun.coreSize);
  sunCore.renderOrder = -1;
  root.add(sunSprite, sunCore);

  let stars = null;
  if (env.stars) {
    const pts = [];
    for (let i = 0; i < 1400; i++) {
      const a = rand() * Math.PI * 2, y = 0.05 + rand() * 0.95, r = Math.sqrt(1 - y * y);
      pts.push(Math.cos(a) * r * 1400, y * 1400, Math.sin(a) * r * 1400);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.9 }));
    stars.renderOrder = -2;
    stars.frustumCulled = false;
    root.add(stars);
  }

  const clouds = [];
  if (env.clouds) {
    const cloudMap = cloudTexture();
    for (let n = 0; n < env.clouds.count; n++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudMap, color: env.clouds.color, fog: false, depthWrite: false, transparent: true, opacity: env.clouds.opacity }));
      const a = rand() * Math.PI * 2, r = 350 + rand() * 650;
      s.position.set(Math.cos(a) * r, 140 + rand() * 120, Math.sin(a) * r);
      s.scale.set(240 + rand() * 160, 110 + rand() * 60, 1);
      s.renderOrder = -1;
      root.add(s);
      clouds.push(s);
    }
  }

  return {
    colliders,
    dust: env.dust,
    headlight: env.headlight,
    exposure: env.exposure,
    // Called every frame with the point the world should be centred on.
    update(dt, focus, camera) {
      sun.position.copy(focus).add(SUN_OFFSET);
      sun.target.position.copy(focus);
      sky.position.copy(camera.position);
      sunSprite.position.copy(camera.position).addScaledVector(sunDir, 1200);
      sunCore.position.copy(sunSprite.position);
      stars?.position.copy(camera.position);
      if (waterMap) {
        waterMap.offset.x += dt * 0.004;
        waterMap.offset.y += dt * 0.0025;
      }
      for (const c of clouds) {
        c.position.x += dt * 3;
        if (c.position.x > 1000) c.position.x = -1000;
      }
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material ?? [])) {
          for (const k of ['map', 'emissiveMap']) m[k]?.dispose();
          m.dispose();
        }
      });
    },
  };
}
