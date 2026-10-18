import * as THREE from 'three';
import { crateTexture, glowTexture } from './textures.js';

const COUNT = 8;
const LATERAL = [0, -4.2, 3.8, -2.2, 4.4, -3.8, 2.4, 0];
const PICKUP_RADIUS = 3.4;
const IDLE = new THREE.Color(0x25d9ff);
const NEXT = new THREE.Color(0xffc933);

// Glowing floating crates: checkpoints around the lap that also give a speed boost.
export class Crates {
  constructor(scene, track) {
    this.items = [];
    const map = crateTexture();
    const glow = glowTexture();
    const boxGeo = new THREE.BoxGeometry(1.9, 1.9, 1.9);
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.05, 2.05, 2.05));
    const beamGeo = new THREE.CylinderGeometry(1.1, 1.1, 40, 16, 1, true);
    const ringGeo = new THREE.RingGeometry(2.2, 2.7, 32).rotateX(-Math.PI / 2);

    for (let k = 0; k < COUNT; k++) {
      const i = Math.floor(((k + 0.5) / COUNT) * track.N);
      const p = track.pts[i];
      const l = track.left(i);
      const off = LATERAL[k];
      const x = p.x + l.x * off, z = p.z + l.z * off;

      const group = new THREE.Group();
      group.position.set(x, 0, z);
      const material = new THREE.MeshStandardMaterial({
        map, emissiveMap: map, emissive: IDLE.clone(), emissiveIntensity: 1.4, roughness: 0.4,
      });
      const box = new THREE.Mesh(boxGeo, material);
      box.position.y = 1.9;
      const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
      box.add(edges);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: IDLE.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85,
      }));
      halo.scale.setScalar(8);
      box.add(halo);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
        color: NEXT.clone(), transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }));
      beam.position.y = 20;
      beam.visible = false;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: IDLE.clone(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      ring.position.y = 0.12;
      group.add(box, beam, ring);
      scene.add(group);
      this.items.push({ x, z, group, box, material, halo, beam, ring, collected: false, scale: 1, phase: k * 1.3 });
    }
    this.next = 0;
    this.reset();
  }

  get count() { return COUNT; }
  get collectedCount() { return this.items.filter((c) => c.collected).length; }

  reset() {
    for (const c of this.items) {
      c.collected = false;
      c.scale = 0.01; // pop back in
    }
    this.next = 0;
  }

  // Returns the index of a crate picked up this frame, or -1.
  check(x, z) {
    for (let k = 0; k < this.items.length; k++) {
      const c = this.items[k];
      if (c.collected) continue;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < PICKUP_RADIUS ** 2) {
        c.collected = true;
        this.next = this.items.findIndex((it) => !it.collected);
        return k;
      }
    }
    return -1;
  }

  position(k) {
    return this.items[k];
  }

  update(dt, time) {
    this.items.forEach((c, k) => {
      const isNext = k === this.next && !c.collected;
      const target = c.collected ? 0 : 1;
      c.scale += (target - c.scale) * Math.min(1, dt * 9);
      const s = Math.max(0.001, c.scale);
      c.box.visible = c.scale > 0.02;
      c.box.scale.setScalar(s * (isNext ? 1.12 : 1));
      c.box.position.y = 1.9 + Math.sin(time * 2 + c.phase) * 0.25;
      c.box.rotation.y = time * (isNext ? 1.6 : 0.9) + c.phase;
      c.box.rotation.x = Math.sin(time * 1.2 + c.phase) * 0.18;
      const tint = isNext ? NEXT : IDLE;
      c.material.emissive.copy(tint);
      c.material.emissiveIntensity = isNext ? 1.9 + Math.sin(time * 6) * 0.4 : 1.1;
      c.halo.material.color.copy(tint);
      c.halo.material.opacity = (isNext ? 0.95 : 0.55) * s;
      c.beam.visible = isNext;
      c.ring.visible = !c.collected;
      c.ring.material.color.copy(tint);
      c.ring.scale.setScalar(1 + 0.08 * Math.sin(time * 4 + c.phase));
    });
  }
}
