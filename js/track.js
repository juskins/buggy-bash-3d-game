import * as THREE from 'three';

export const TRACK_HALF = 9; // drivable surface half-width
export const WALL = 10.3; // car contact points bounce off the sand berm at this offset
const SCALE = 1.4;

// A clockwise loop around the island (x, z).
const CONTROL = [
  [0, -75], [50, -70], [85, -35], [80, 15], [45, 35], [20, 60],
  [-25, 75], [-72, 58], [-92, 14], [-78, -24], [-92, -56], [-66, -84], [-32, -80],
];

export class Track {
  constructor() {
    const curve = new THREE.CatmullRomCurve3(
      CONTROL.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE)),
      true,
      'centripetal',
    );
    const N = (this.N = 1200);
    this.pts = curve.getSpacedPoints(N).slice(0, N);
    this.tan = this.pts.map((_, i) => {
      const a = this.pts[(i - 1 + N) % N];
      const b = this.pts[(i + 1) % N];
      return new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    });
    this.length = 0;
    for (let i = 0; i < N; i++) this.length += this.pts[i].distanceTo(this.pts[(i + 1) % N]);
  }

  // Unit vector pointing to the left of the direction of travel at sample i.
  left(i) {
    const t = this.tan[((i % this.N) + this.N) % this.N];
    return { x: t.z, z: -t.x };
  }

  // Closest point on the centre line. With a hint, only samples within `win` of it are searched.
  nearest(x, z, hint = -1, win = 40, out = {}) {
    const N = this.N;
    const pts = this.pts;
    let best = Infinity;
    const count = hint < 0 ? N : win * 2 + 1;
    const start = hint < 0 ? 0 : hint - win;
    for (let k = 0; k < count; k++) {
      const i = (((start + k) % N) + N) % N;
      const a = pts[i];
      const b = pts[(i + 1) % N];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) {
        best = d2;
        out.i = i;
        out.t = t;
        out.px = px;
        out.pz = pz;
      }
    }
    out.dx = x - out.px;
    out.dz = z - out.pz;
    out.dist = Math.sqrt(best);
    return out;
  }
}
