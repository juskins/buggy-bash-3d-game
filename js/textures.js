import * as THREE from 'three';
import { rng } from './util.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Packed, darker beach sand with two faint tyre lanes. u runs across the track, v along it.
export function trackTexture() {
  const [c, g] = makeCanvas(256, 256);
  const r = rng(7);
  g.fillStyle = '#c8a266';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const v = 150 + r() * 90;
    g.fillStyle = `rgba(${v},${v * 0.82},${v * 0.55},${0.12 + r() * 0.25})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  for (const x of [88, 168]) {
    const grad = g.createLinearGradient(x - 14, 0, x + 14, 0);
    grad.addColorStop(0, 'rgba(120,88,50,0)');
    grad.addColorStop(0.5, 'rgba(120,88,50,0.28)');
    grad.addColorStop(1, 'rgba(120,88,50,0)');
    g.fillStyle = grad;
    g.fillRect(x - 14, 0, 28, 256);
  }
  return toTexture(c);
}

export function curbTexture() {
  const [c, g] = makeCanvas(64, 128);
  g.fillStyle = '#f4efe4';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#e0412f';
  g.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

// Fine sand grain for the island.
export function sandTexture() {
  const [c, g] = makeCanvas(256, 256);
  const r = rng(21);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 205 + r() * 50;
    g.fillStyle = `rgba(${v},${v},${v * 0.92},${0.25 + r() * 0.4})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  const t = toTexture(c);
  t.repeat.set(90, 90);
  return t;
}

// Soft wave highlights, scrolled over the sea.
export function waterTexture() {
  const [c, g] = makeCanvas(512, 512);
  const r = rng(99);
  g.fillStyle = '#cfe4e4';
  g.fillRect(0, 0, 512, 512);
  g.lineCap = 'round';
  for (let i = 0; i < 140; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const len = 30 + r() * 70;
    g.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.5})`;
    g.lineWidth = 1 + r() * 2.5;
    for (const ox of [-512, 0, 512]) {
      g.beginPath();
      g.moveTo(x + ox, y);
      g.quadraticCurveTo(x + ox + len / 2, y - 6 - r() * 6, x + ox + len, y);
      g.stroke();
    }
  }
  const t = toTexture(c);
  t.repeat.set(70, 70);
  return t;
}

export function glowTexture() {
  const [c, g] = makeCanvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c, { repeat: false });
}

export function cloudTexture() {
  const [c, g] = makeCanvas(256, 128);
  const r = rng(5);
  for (let i = 0; i < 16; i++) {
    const x = 50 + r() * 156;
    const y = 50 + r() * 28;
    const rad = 22 + r() * 24;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
  }
  return toTexture(c, { repeat: false });
}

export function crateTexture() {
  const [c, g] = makeCanvas(128, 128);
  g.fillStyle = '#10222e';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 112, 112);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(8, 8); g.lineTo(120, 120);
  g.moveTo(120, 8); g.lineTo(8, 120);
  g.globalAlpha = 0.35;
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = '#10222e';
  g.beginPath();
  g.arc(64, 64, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 60px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', 64, 68);
  return toTexture(c, { repeat: false });
}

export function bannerTexture() {
  const [c, g] = makeCanvas(1024, 160);
  g.fillStyle = '#19232b';
  g.fillRect(0, 0, 1024, 160);
  const size = 20;
  for (let x = 0; x < 1024 / size; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#ffffff' : '#111111';
      g.fillRect(x * size, y * size, size, size);
      g.fillRect(x * size, 160 - (y + 1) * size, size, size);
    }
  }
  g.fillStyle = '#d8fd71';
  g.font = 'italic 900 78px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('BUGGY BASH 3D', 512, 82);
  return toTexture(c, { repeat: false });
}

export function finishLineTexture() {
  const [c, g] = makeCanvas(128, 32);
  const s = 16;
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#ffffff' : '#1a1a1a';
      g.fillRect(x * s, y * s, s, s);
    }
  }
  return toTexture(c, { repeat: false });
}
