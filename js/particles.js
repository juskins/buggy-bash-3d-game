import * as THREE from 'three';

const VERTEX = `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  uniform float scale;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.15, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vTint, a);
    #include <colorspace_fragment>
  }
`;

// A small pool of soft round particles: dust, sparks, boost flames and crate bursts.
export class Particles {
  constructor(scene, max = 700) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.tint = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.gravity = new Float32Array(max);
    this.grow = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
      uniforms: { scale: { value: 800 } },
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, { life = 0.6, size = 1, color = 0xffffff, gravity = 0, grow = 0, alpha = 0.8 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const c = _c.set(color);
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.tint.set([c.r, c.g, c.b], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.size0[i] = size;
    this.gravity[i] = gravity;
    this.grow[i] = grow;
    this.alpha0[i] = alpha;
    this.alpha[i] = alpha;
    this.size[i] = size;
  }

  burst(x, y, z, count, { speed = 6, up = 3, ...opts } = {}) {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(x, y, z, Math.cos(a) * s, up * (0.3 + Math.random()), Math.sin(a) * s, {
        ...opts, life: (opts.life ?? 0.6) * (0.6 + Math.random() * 0.6),
      });
    }
  }

  update(dt, camera, viewportHeight) {
    this.material.uniforms.scale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.gravity[i] * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      const drag = Math.exp(-1.5 * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.size[i] = this.size0[i] * (1 + this.grow[i] * (1 - t));
      this.alpha[i] = this.alpha0[i] * Math.min(1, t * 1.6);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = a.tint.needsUpdate = true;
  }

}

const _c = new THREE.Color();
