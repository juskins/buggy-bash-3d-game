import * as THREE from 'three';
import { Track } from './track.js';
import { buildWorld } from './world.js';
import { Buggy, Vehicle } from './car.js';
import { CARS, DEFAULT_CAR } from './cars.js';
import { DEFAULT_ENV, ENVIRONMENTS } from './environments.js';
import { Crates } from './crates.js';
import { Particles } from './particles.js';
import { Sound } from './audio.js';
import { clamp, formatTime, lerp, lerpAngle } from './util.js';
import { getLeaderboard, saveRun, signIn, whoami } from './startng.js';

const LAPS = 3;
const BOOST_TIME = 2.4;
const STEP = 1 / 120;
const START_BACK = 16; // samples behind the line on the grid

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- scene

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2600);

const track = new Track();
// What the player picked in the garage (remembered between visits).
const pick = { env: DEFAULT_ENV, car: DEFAULT_CAR };
try {
  const e = localStorage.getItem('bb3d_env'), c = localStorage.getItem('bb3d_car');
  if (ENVIRONMENTS[e]) pick.env = e;
  if (CARS[c]) pick.car = c;
} catch { /* storage unavailable */ }

let world = buildWorld(scene, track, ENVIRONMENTS[pick.env]);
renderer.toneMappingExposure = world.exposure;
const buggy = new Buggy(pick.car);
scene.add(buggy.root);
const vehicle = new Vehicle(CARS[pick.car].stats);
// Headlights, only bright in the dark environments.
const headlight = new THREE.SpotLight(0xfff2cf, world.headlight * 60, 90, 0.55, 0.6, 1.2);
headlight.position.set(0, 1.1, 1.6);
headlight.target.position.set(0, 0.2, 16);
buggy.root.add(headlight, headlight.target);
const crates = new Crates(scene, track);
const particles = new Particles(scene);
const sound = new Sound();

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- state

let state = 'menu'; // menu | countdown | racing | finished
let paused = false;
let time = 0;
let shake = 0;
let camHeading = 0;
let orbit = 0;
const countdown = { t: 0, step: -1 };
const progress = { last: 0, unwrapped: 0, max: 0 };
const race = { clock: 0, lapStart: 0, started: false, lapsDone: 0, laps: [] };

let lastResult = null;

// Best lap is kept per track and car.
let bestEver = null;
const bestKey = () => `bb3d_best_${pick.env}_${pick.car}`;
function loadBest() {
  bestEver = null;
  try { bestEver = parseFloat(localStorage.getItem(bestKey())) || null; } catch { /* storage unavailable */ }
}
loadBest();

function placeOnTrack(index) {
  const p = track.pts[index];
  const t = track.tan[index];
  vehicle.reset(p.x, p.z, Math.atan2(t.x, t.z));
  vehicle.hint = index;
  camHeading = vehicle.heading;
}

function resetRace() {
  const idx = track.N - START_BACK;
  placeOnTrack(idx);
  track.nearest(vehicle.x, vehicle.z, idx, 10, vehicle.near);
  progress.last = idx;
  progress.unwrapped = progress.max = -START_BACK;
  Object.assign(race, { clock: 0, lapStart: 0, started: false, lapsDone: 0, laps: [] });
  crates.reset();
  vehicle.boostT = 0;
}

// ---------------------------------------------------------------- input

const keys = new Set();
const touch = { left: false, right: false, gas: false, brake: false };
const input = { up: false, down: false, steer: 0, hand: false };

addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  sound.init();
  if (e.code === 'Escape' || e.code === 'KeyP') return togglePause();
  if (e.code === 'KeyT' && (inRace() || paused)) return startRace();
  if (paused) return;
  keys.add(e.code);
  if (e.code === 'Enter' && (state === 'menu' || state === 'finished')) {
    e.preventDefault(); // don't also press whichever button has focus
    startRace();
  }
  if (state === 'menu') {
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') chooseCar(cycle(CARS, pick.car, e.code === 'ArrowRight' ? 1 : -1));
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') chooseEnv(cycle(ENVIRONMENTS, pick.env, e.code === 'ArrowDown' ? 1 : -1));
  }
  if (e.code === 'KeyM') {
    sound.setMuted(!sound.muted);
    toast(sound.muted ? 'Sound off' : 'Sound on');
  }
  if (e.code === 'KeyR' && state === 'racing') respawn();
});
addEventListener('keyup', (e) => keys.delete(e.code));
// Buttons shouldn't keep focus, or Space/Enter would press them again mid-race.
document.addEventListener('click', (e) => e.target.closest?.('button')?.blur());
addEventListener('blur', () => { keys.clear(); if (inRace()) setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && inRace()) setPaused(true); });

const inRace = () => state === 'countdown' || state === 'racing';
function setPaused(on) {
  if (on === paused || (on && !inRace())) return;
  paused = on;
  $('pause').hidden = !on;
  keys.clear();
  for (const k of Object.keys(touch)) touch[k] = false;
  if (on) sound.ctx?.suspend();
  else { sound.ctx?.resume(); last = performance.now(); }
}
const togglePause = () => setPaused(!paused);

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch');
for (const [id, name] of [['tLeft', 'left'], ['tRight', 'right'], ['tBrake', 'brake'], ['tGas', 'gas']]) {
  const el = $(id);
  const set = (on) => { touch[name] = on; el.classList.toggle('on', on); sound.init(); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => set(false));
}

function readInput() {
  if (state !== 'racing') {
    input.up = input.down = input.hand = false;
    input.steer = 0;
    if (state === 'finished') input.hand = true; // roll to a stop
    return input;
  }
  const left = keys.has('ArrowLeft') || keys.has('KeyA') || touch.left;
  const right = keys.has('ArrowRight') || keys.has('KeyD') || touch.right;
  input.up = keys.has('ArrowUp') || keys.has('KeyW') || touch.gas;
  input.down = keys.has('ArrowDown') || keys.has('KeyS') || touch.brake;
  input.hand = keys.has('Space');
  input.steer = (left ? 1 : 0) - (right ? 1 : 0);
  return input;
}

function respawn() {
  placeOnTrack(vehicle.near.i);
  toast('Back on track');
}

// ---------------------------------------------------------------- HUD

const hud = {
  root: $('hud'), lapNum: $('lapNum'), cur: $('curTime'), last: $('lastTime'), best: $('bestTime'),
  speed: $('speed'), nitro: $('nitro').firstElementChild, banner: $('banner'), toast: $('toast'), pips: $('pips'),
};
$('lapTotal').textContent = LAPS;
const pipEls = crates.items.map(() => hud.pips.appendChild(document.createElement('i')));

function banner(text) {
  hud.banner.textContent = text;
  hud.banner.classList.remove('pop');
  void hud.banner.offsetWidth;
  hud.banner.classList.add('pop');
}

let toastTimer;
function toast(text, ms = 1600) {
  hud.toast.textContent = text;
  hud.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hud.toast.classList.remove('show'), ms);
}

// Minimap: the track is pre-drawn once, then the car and crates are drawn over it. Up on the map is the way
// the car faces at the start.
const mm = $('minimap');
const mctx = mm.getContext('2d');
const mapLayer = document.createElement('canvas');
mapLayer.width = mm.width;
mapLayer.height = mm.height;
const mapScale = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const s = (mm.width - 44) / Math.max(maxX - minX, maxZ - minZ);
  return { s, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
})();
const mapX = (x) => mm.width / 2 - (x - mapScale.cx) * mapScale.s;
const mapY = (z) => mm.height / 2 - (z - mapScale.cz) * mapScale.s;
{
  const g = mapLayer.getContext('2d');
  g.lineJoin = g.lineCap = 'round';
  const path = () => {
    g.beginPath();
    track.pts.forEach((p, i) => (i ? g.lineTo(mapX(p.x), mapY(p.z)) : g.moveTo(mapX(p.x), mapY(p.z))));
    g.closePath();
  };
  path(); g.lineWidth = 22; g.strokeStyle = 'rgba(255,255,255,.25)'; g.stroke();
  path(); g.lineWidth = 14; g.strokeStyle = '#e6d3a0'; g.stroke();
  const p0 = track.pts[0];
  g.fillStyle = '#fff';
  g.fillRect(mapX(p0.x) - 9, mapY(p0.z) - 2, 18, 4);
}

function drawMinimap() {
  mctx.clearRect(0, 0, mm.width, mm.height);
  mctx.drawImage(mapLayer, 0, 0);
  crates.items.forEach((c, k) => {
    if (c.collected) return;
    mctx.fillStyle = k === crates.next ? '#ffc933' : '#25d9ff';
    mctx.beginPath();
    mctx.arc(mapX(c.x), mapY(c.z), 6, 0, Math.PI * 2);
    mctx.fill();
  });
  mctx.save();
  mctx.translate(mapX(vehicle.x), mapY(vehicle.z));
  mctx.rotate(-vehicle.heading);
  mctx.fillStyle = '#ff6a1f';
  mctx.strokeStyle = '#fff';
  mctx.lineWidth = 3;
  mctx.beginPath();
  mctx.moveTo(0, -12); mctx.lineTo(8, 9); mctx.lineTo(0, 5); mctx.lineTo(-8, 9); mctx.closePath();
  mctx.fill();
  mctx.stroke();
  mctx.restore();
}

function updateHud() {
  const lapTime = state === 'finished' ? race.laps[race.laps.length - 1] : race.started ? race.clock - race.lapStart : 0;
  hud.lapNum.textContent = Math.min(race.lapsDone + 1, LAPS);
  hud.cur.textContent = formatTime(lapTime);
  hud.last.textContent = formatTime(race.laps[race.laps.length - 1]);
  const raceBest = race.laps.length ? Math.min(...race.laps) : null;
  hud.best.textContent = formatTime(raceBest ?? bestEver);
  hud.speed.firstChild.nodeValue = Math.round(Math.abs(vehicle.vf) * 3.6);
  hud.nitro.style.width = `${clamp(vehicle.boostT / BOOST_TIME, 0, 1) * 100}%`;
  pipEls.forEach((el, k) => {
    el.className = crates.items[k].collected ? 'got' : k === crates.next ? 'next' : '';
  });
}

// ---------------------------------------------------------------- start.ng player + leaderboard

const card = { root: $('card'), face: $('playerFace'), name: $('playerName'), account: $('playerAccount'), signIn: $('signInBtn') };
card.signIn.addEventListener('click', signIn);
let me = null;
let styleKey = '';

async function refreshPlayer() {
  const reply = await whoami();
  const player = reply?.user ?? reply?.guest ?? null;
  me = reply?.user ?? null;
  card.root.hidden = false;
  card.name.textContent = player?.name ?? 'Guest';
  card.account.textContent = me?.account ? `@${me.account}` : 'Not signed in';
  card.signIn.hidden = !!me;
  if (player?.face) card.face.src = player.face;
  card.face.hidden = !player?.face;
  const key = JSON.stringify(player?.style ?? null);
  if (key !== styleKey) {
    styleKey = key;
    buggy.setDriver(player?.style);
  }
}
addEventListener('focus', refreshPlayer);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPlayer(); });

async function renderBoard(el) {
  const heading = document.createElement('h3');
  heading.textContent = 'TOP RACERS';
  const note = (text) => {
    const p = document.createElement('p');
    p.textContent = text;
    el.replaceChildren(heading, p);
  };
  note('Loading…');
  const entries = await getLeaderboard(8);
  if (!entries) return note('Leaderboards work when you play on start.ng.');
  if (!entries.length) return note('No times yet. Set the first one!');
  const ol = document.createElement('ol');
  const row = (cls, cells) => {
    const li = document.createElement('li');
    li.className = cls;
    for (const c of cells) li.appendChild(document.createElement('span')).textContent = c;
    ol.appendChild(li);
  };
  row('head', ['#', 'RACER', 'BEST LAP', 'RACE']);
  for (const e of entries) {
    row(me && e.player_id === me.id ? 'me' : '', [
      e.rank, e.name, formatTime(e.stats?.best_lap).replace(/\.\d+$/, ''), formatTime(e.stats?.race_time).replace(/\.\d+$/, ''),
    ]);
  }
  el.replaceChildren(heading, ol);
}

// ---------------------------------------------------------------- garage

const garage = { env: $('envChips'), car: $('carChips') };

function chip(parent, id, data, onPick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.id = id;
  b.textContent = `${data.icon} ${data.name}`;
  b.addEventListener('click', () => { sound.init(); onPick(id); });
  parent.appendChild(b);
}

function updateGarage() {
  for (const [kind, list] of [['env', ENVIRONMENTS], ['car', CARS]]) {
    for (const b of garage[kind].children) b.classList.toggle('on', b.dataset.id === pick[kind]);
    $(kind + 'Blurb').textContent = list[pick[kind]].blurb;
  }
  const r = CARS[pick.car].ratings;
  $('carStats').replaceChildren(...[['Speed', r.speed], ['Accel', r.accel], ['Handling', r.handling]].map(([label, n]) => {
    const row = document.createElement('div');
    row.className = 'stat';
    const name = document.createElement('span');
    name.textContent = label;
    const bar = document.createElement('i');
    bar.appendChild(document.createElement('b')).style.width = `${n * 20}%`;
    row.append(name, bar);
    return row;
  }));
}

function chooseEnv(id) {
  if (!ENVIRONMENTS[id] || id === world.envId) return;
  pick.env = id;
  world.dispose();
  world = buildWorld(scene, track, ENVIRONMENTS[id]);
  world.envId = id;
  renderer.toneMappingExposure = world.exposure;
  headlight.intensity = world.headlight * 60;
  try { localStorage.setItem('bb3d_env', id); } catch { /* storage unavailable */ }
  loadBest();
  updateGarage();
}

function chooseCar(id) {
  if (!CARS[id] || id === pick.car) return;
  pick.car = id;
  buggy.build(id);
  vehicle.setStats(CARS[id].stats);
  try { localStorage.setItem('bb3d_car', id); } catch { /* storage unavailable */ }
  loadBest();
  updateGarage();
}

const cycle = (list, current, dir) => {
  const ids = Object.keys(list);
  return ids[(ids.indexOf(current) + dir + ids.length) % ids.length];
};

world.envId = pick.env;
for (const [id, data] of Object.entries(ENVIRONMENTS)) chip(garage.env, id, data, chooseEnv);
for (const [id, data] of Object.entries(CARS)) chip(garage.car, id, data, chooseCar);
updateGarage();

function goMenu() {
  paused = false;
  $('pause').hidden = true;
  $('results').hidden = true;
  hud.root.hidden = true;
  $('menu').hidden = false;
  state = 'menu';
  resetRace();
  sound.ctx?.resume();
  last = performance.now();
  renderBoard($('menuBoard'));
}

// ---------------------------------------------------------------- race flow

function startRace() {
  sound.init();
  paused = false;
  $('pause').hidden = true;
  $('menu').hidden = true;
  $('results').hidden = true;
  hud.root.hidden = false;
  resetRace();
  state = 'countdown';
  countdown.t = 0;
  countdown.step = -1;
}

function onLineCrossed(k) {
  if (k === 0) {
    race.started = true;
    race.lapStart = race.clock;
    banner('LAP 1');
    return;
  }
  const lapTime = race.clock - race.lapStart;
  race.laps.push(lapTime);
  race.lapsDone = k;
  race.lapStart = race.clock;
  if (k >= LAPS) return finishRace();
  banner(k === LAPS - 1 ? 'FINAL LAP' : `LAP ${k + 1}`);
  toast(`Lap ${k}: ${formatTime(lapTime)}`, 2400);
  crates.reset();
  sound.lap();
}

async function finishRace() {
  state = 'finished';
  sound.finish();
  banner('FINISH!');
  const total = race.laps.reduce((a, b) => a + b, 0);
  const best = Math.min(...race.laps);
  lastResult = { total, best };
  const pb = bestEver == null || best < bestEver;
  if (pb) {
    bestEver = best;
    try { localStorage.setItem(bestKey(), String(best)); } catch { /* storage unavailable */ }
  }
  $('finalTime').textContent = formatTime(total);
  $('pbBadge').hidden = !pb;
  const list = $('lapList');
  list.replaceChildren();
  race.laps.forEach((t, i) => {
    const a = document.createElement('span');
    const b = document.createElement('span');
    a.textContent = `Lap ${i + 1}`;
    b.textContent = formatTime(t);
    if (t === best) a.className = b.className = 'best';
    list.append(a, b);
  });
  $('saveNote').textContent = 'Saving your time…';
  $('resultsBoard').replaceChildren();
  setTimeout(() => {
    if (state !== 'finished') return;
    $('results').hidden = false;
  }, 1600);

  const saved = await saveRun({ best_lap: Math.max(1, Math.round(best)), race_time: Math.max(1, Math.round(total)) });
  const note = $('saveNote');
  if (!saved) note.textContent = 'Play on start.ng to save your time to the leaderboard.';
  else if (!saved.ok) note.textContent = saved.error ?? 'Sign in to save your time.';
  else note.textContent = saved.result.improved ? `New personal best on the leaderboard: #${saved.result.rank}` : `Your best run stays on the board: #${saved.result.rank}`;
  renderBoard($('resultsBoard'));
}

function updateRace(dt) {
  if (state === 'countdown') {
    countdown.t += dt;
    const step = Math.floor(countdown.t / 0.9);
    if (step !== countdown.step) {
      countdown.step = step;
      if (step < 3) { banner(String(3 - step)); sound.beep(false); }
      else { banner('GO!'); sound.beep(true); state = 'racing'; }
    }
    return;
  }
  if (state !== 'racing' && state !== 'finished') return;
  if (state === 'racing') race.clock += dt;

  // Lap progress from the nearest point on the centre line
  const n = track.N;
  const prog = vehicle.near.i + vehicle.near.t;
  let d = prog - progress.last;
  if (d < -n / 2) d += n;
  else if (d > n / 2) d -= n;
  progress.last = prog;
  progress.unwrapped += d;
  if (state === 'racing' && progress.unwrapped > progress.max) {
    const prev = progress.max;
    progress.max = progress.unwrapped;
    const kNow = Math.floor(progress.max / n);
    if (kNow > Math.floor(prev / n)) onLineCrossed(kNow);
  }

  // Crates
  if (state === 'racing') {
    const k = crates.check(vehicle.x, vehicle.z);
    if (k >= 0) {
      const c = crates.position(k);
      vehicle.boost(BOOST_TIME);
      vehicle.vx += Math.sin(vehicle.heading) * 3;
      vehicle.vz += Math.cos(vehicle.heading) * 3;
      particles.burst(c.x, 2, c.z, 40, { speed: 9, up: 8, gravity: 6, size: 0.6, color: 0x7ff0ff, life: 0.9, alpha: 1 });
      particles.burst(c.x, 2, c.z, 20, { speed: 6, up: 6, gravity: 6, size: 0.5, color: 0xffd24a, life: 0.8, alpha: 1 });
      sound.pickup();
      const got = crates.collectedCount;
      toast(got === crates.count ? 'ALL CRATES! BOOST!' : `CRATE ${got}/${crates.count}  BOOST!`);
    }
  }
}

// ---------------------------------------------------------------- effects

function onHit(strength, px, pz) {
  if (strength < 0.4) return;
  shake = Math.min(1, shake + strength * 0.05);
  buggy.kick(strength);
  const n = Math.min(14, Math.round(strength * 1.5));
  particles.burst(px, 0.8, pz, n, { speed: 6, up: 3, gravity: 12, size: 0.3, color: 0xffd24a, life: 0.5, alpha: 1 });
  particles.burst(px, 0.6, pz, Math.ceil(n / 2), { speed: 3, up: 1.5, size: 1.8, grow: 1.5, color: world.dust, life: 0.8, alpha: 0.5 });
  if (strength > 1.5) sound.bump(strength);
}

let dustCarry = 0;
function emitTrail(dt) {
  const s = Math.sin(vehicle.heading), c = Math.cos(vehicle.heading);
  const speed = vehicle.speed;
  const side = vehicle.vx * c - vehicle.vz * s;
  if (speed > 5) {
    dustCarry += dt * (speed * 1.1 + Math.abs(side) * 4 + (vehicle.offTrack ? 30 : 0));
    while (dustCarry > 1) {
      dustCarry -= 1;
      const lx = (Math.random() < 0.5 ? -1 : 1) * vehicle.stats.halfW * 1.1;
      const lz = -vehicle.stats.halfL * 0.65;
      particles.emit(
        vehicle.x + lx * c + lz * s, 0.3, vehicle.z - lx * s + lz * c,
        -vehicle.vx * 0.1 + (Math.random() - 0.5), 0.8 + Math.random() * 1.2, -vehicle.vz * 0.1 + (Math.random() - 0.5),
        { life: 0.7, size: 1.5, grow: 2, color: world.dust, alpha: 0.4 },
      );
    }
  }
  if (vehicle.boostT > 0) {
    for (const lx of [-vehicle.stats.halfW * 0.26, vehicle.stats.halfW * 0.26]) {
      const lz = -(vehicle.stats.halfL + 0.55);
      const hot = Math.random() < 0.5;
      particles.emit(
        vehicle.x + lx * c + lz * s, 0.95, vehicle.z - lx * s + lz * c,
        -s * 9 + vehicle.vx * 0.3, 0.3, -c * 9 + vehicle.vz * 0.3,
        { life: 0.25, size: hot ? 0.9 : 0.6, grow: -0.8, color: hot ? 0xff7a1f : 0xffd24a, alpha: 0.95 },
      );
    }
  }
}

// ---------------------------------------------------------------- camera

function updateCamera(dt) {
  if (state === 'menu') {
    orbit += dt * 0.28;
    const a = orbit + vehicle.heading + 2.2;
    camera.position.set(vehicle.x + Math.sin(a) * 11, 3.4, vehicle.z + Math.cos(a) * 11);
    camera.lookAt(vehicle.x, 1.5, vehicle.z);
    camera.fov = 50;
  } else {
    camHeading = lerpAngle(camHeading, vehicle.heading, 1 - Math.exp(-dt * 4));
    const speed = vehicle.speed;
    const dist = 9 + speed * 0.05;
    const height = 4 + speed * 0.02;
    const k = 1 - Math.exp(-dt * 14);
    camera.position.x = lerp(camera.position.x, vehicle.x - Math.sin(camHeading) * dist, k);
    camera.position.y = lerp(camera.position.y, height, k);
    camera.position.z = lerp(camera.position.z, vehicle.z - Math.cos(camHeading) * dist, k);
    camera.lookAt(vehicle.x + Math.sin(camHeading) * 6, 1.7, vehicle.z + Math.cos(camHeading) * 6);
    const targetFov = 62 + speed * 0.38 + (vehicle.boostT > 0 ? 9 : 0);
    camera.fov = lerp(camera.fov, targetFov, 1 - Math.exp(-dt * 5));
  }
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * shake * 0.5;
    camera.position.z += (Math.random() - 0.5) * shake * 0.6;
    shake *= Math.exp(-dt * 7);
  }
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- loop

let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }
  time += dt;

  const inp = readInput();
  acc += dt;
  while (acc >= STEP) {
    vehicle.step(STEP, inp, track, world.colliders, onHit);
    acc -= STEP;
  }
  updateRace(dt);
  emitTrail(dt);

  buggy.update(vehicle, dt, time);
  crates.update(dt, time);
  updateCamera(dt);
  world.update(dt, buggy.root.position, camera);
  particles.update(dt, camera, renderer.domElement.height);
  if (state === 'racing' || state === 'countdown') sound.engine(vehicle.speed, state === 'racing' && inp.up ? 1 : 0, vehicle.boostT > 0);
  else sound.silenceEngine();

  if (!hud.root.hidden) {
    updateHud();
    drawMinimap();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- go

$('startBtn').addEventListener('click', startRace);
$('againBtn').addEventListener('click', startRace);
$('shareBtn').addEventListener('click', () => {
  if (!lastResult) return;
  const text = `I raced the ${CARS[pick.car].name} round ${ENVIRONMENTS[pick.env].name} in Buggy Bash 3D: ${formatTime(lastResult.total)} (best lap ${formatTime(lastResult.best)}). Can you beat me?`;
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent('https://start.ng/games/buggy-bash-3d')}`;
  window.open(url, '_blank', 'noopener');
});
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', startRace);
$('menuBtn').addEventListener('click', goMenu);
$('garageBtn').addEventListener('click', goMenu);
resetRace();
refreshPlayer();
renderBoard($('menuBoard'));
requestAnimationFrame(frame);
