// lab.html: the guys' new physical bodies (world/robot.js) on an empty floor, with sliders, to tune how they
// stand, step, stumble and fall. window.__lab drives it from scripts (scripts/robot-lab.mjs).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TUNE } from './config.js';
import { addStatics, step as physicsStep, moveOleg, world, setSteps } from './world/ragdoll.js';
import { Robot } from './world/robot.js';
import { makePerson } from './world/figures.js';
import { CHARS } from './game/friends.js';

const params = new URLSearchParams(location.search);
if (params.get('steps')) setSteps(Number(params.get('steps')), Number(params.get('hz') ?? 180));
if (params.get('iters')) world.solver.iterations = Number(params.get('iters'));
const R = TUNE.robot;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('capture') });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1e24');
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 80);
camera.position.set(0.3, 3.2, 7.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.target.set(0, 0.8, 0);
controls.update();
scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a3226', 1.6));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.position.set(3, 7, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 20 });
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: '#8a7a66', roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(14, 28, '#5d5246', '#6f6253');
grid.position.y = 0.002;
scene.add(grid);

// obstacles: a table, a wardrobe, a low wall (the same static boxes the flat uses)
const boxes = [
  { x0: 2.2, x1: 3.0, z0: -3.6, z1: -2.4, h: 0.76, color: '#7a5636' },
  { x0: -4.4, x1: -3.8, z0: -3.8, z1: -2.4, h: 2.4, color: '#5b4632' },
  { x0: -1.5, x1: 1.0, z0: -4.1, z1: -3.95, h: 1.1, color: '#9aa3ad' },
];
for (const b of boxes) {
  addStatics([b], b.h);
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, b.h, b.z1 - b.z0), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.8 }));
  m.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}

// Oleg: the kinematic capsule from the game, steered with WASD
const oleg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.7, 16).translate(0, 0.85, 0), new THREE.MeshStandardMaterial({ color: '#3fae5a', transparent: true, opacity: 0.55 }));
oleg.position.set(0, 0, 3);
scene.add(oleg);
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));

// the guys
const ids = ['alexey', 'lyokha', 'kirill', 'temych'];
const guys = ids.map((id, i) => {
  const fig = makePerson({ ...CHARS[id], style: 'sprite', faceId: id });
  fig.root.traverse((o) => o.isMesh && (o.castShadow = true));
  scene.add(fig.root);
  const rb = new Robot(fig.figure?.rig ?? fig.rig);
  rb.home = [-3.3 + i * 2.2, 0];
  rb.yawWant = 0;
  rb.enable(...rb.home, 0);
  return { id, name: CHARS[id].name, fig, rb };
});
let drunk = 0;
let selected = -1; // -1 = everyone

// debug markers: capture point (red), support centre (green), where the swing foot goes (yellow)
const dot = (c) => new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 12), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
const dbg = guys.map(() => ['#ff4040', '#40ff70', '#ffd040'].map((c) => scene.add(dot(c)).children.at(-1)));
let showDbg = params.has('dbg');
const setDbg = (v) => dbg.flat().forEach((m) => (m.visible = v));
setDbg(showDbg);

// ---- one frame: the animation says what the upper body wants, the physics does the rest
let slow = 1, physMs = 0;
function advance(dt) {
  const sdt = dt * slow;
  // Oleg
  const sp = 3.2 * sdt, f = new THREE.Vector3();
  if (keys.has('KeyW')) f.z -= 1;
  if (keys.has('KeyS')) f.z += 1;
  if (keys.has('KeyA')) f.x -= 1;
  if (keys.has('KeyD')) f.x += 1;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd).setY(0).normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const mv = fwd.multiplyScalar(-f.z).add(right.multiplyScalar(f.x));
  if (mv.lengthSq()) mv.normalize().multiplyScalar(sp);
  oleg.position.add(mv);
  moveOleg(oleg.position.x, oleg.position.z, mv.x / Math.max(sdt, 1e-4), mv.z / Math.max(sdt, 1e-4));
  for (const g of guys) {
    g.rb.drunk = drunk;
    g.rb.restore();
    g.fig.setLoop(g.rb.state === 'down' ? 'fallen' : null);
    g.fig.update(sdt, { walking: g.rb.walking, speed: g.rb.vd.length() || 1, drunk, physical: g.rb.state !== 'getup' });
    g.rb.capture();
  }
  const t0 = performance.now();
  physicsStep(sdt, (h) => {
    for (const g of guys) g.rb.control(h);
  });
  physMs += (performance.now() - t0 - physMs) * 0.05;
  for (const [i, g] of guys.entries()) {
    g.rb.tick(sdt);
    g.rb.sync(g.fig);
    if (showDbg) {
      const [a, b, c] = dbg[i];
      a.position.copy(g.rb.debug.xi).setY(0.01);
      b.position.copy(g.rb.debug.S).setY(0.012);
      c.position.copy(g.rb.debug.to).setY(0.014);
      c.visible = g.rb.gait.swing >= 0;
    }
  }
}

function render() {
  renderer.render(scene, camera);
}

// ---- UI
const fmt = (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));
function slider(parent, label, get, set, min, max, stepv) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<label>${label}</label><output></output><input type="range" min="${min}" max="${max}" step="${stepv}">`;
  const inp = row.querySelector('input'), out = row.querySelector('output');
  inp.value = get();
  out.textContent = fmt(get());
  inp.addEventListener('input', () => {
    set(Number(inp.value));
    out.textContent = fmt(get());
  });
  document.getElementById(parent).appendChild(row);
}
const tune = (k) => [() => R[k], (v) => (R[k] = v)];
let pushStrength = 1.6;
slider('sliders', 'Пьяный, %', () => drunk * 100, (v) => (drunk = v / 100), 0, 100, 1);
slider('sliders', 'Сила мышц', ...tune('strength'), 0.2, 2, 0.05);
slider('sliders', 'Скорость ходьбы, м/с', ...tune('walkSpeed'), 0.3, 2.2, 0.05);
slider('sliders', 'Время шага, с', ...tune('stepTime'), 0.2, 0.7, 0.01);
slider('sliders', 'Сила толчка, м/с', () => pushStrength, (v) => (pushStrength = v), 0.3, 5, 0.1);
slider('sliders2', 'Быстрота суставов', ...tune('speed'), 3, 30, 0.5);
slider('sliders2', 'Куда ставить ногу (поправка)', ...tune('placeGain'), 0, 0.4, 0.01);
slider('sliders2', 'Высота шага, м', ...tune('stepHeight'), 0.02, 0.2, 0.005);
slider('sliders2', 'Ширина шага, м', ...tune('stepWidth'), 0.04, 0.2, 0.005);
slider('sliders2', 'Присед, м', ...tune('crouch'), 0, 0.12, 0.005);
slider('sliders2', 'Пьяный: слабость', ...tune('weak'), 0, 0.9, 0.01);
slider('sliders2', 'Пьяный: опоздание, с', ...tune('late'), 0, 0.6, 0.01);
slider('sliders2', 'Пьяный: промах ноги, м', ...tune('sloppy'), 0, 0.3, 0.01);
slider('sliders2', 'Пьяный: качает, рад', ...tune('wander'), 0, 0.5, 0.01);
slider('sliders2', 'Упал при наклоне, рад', ...tune('fallAt'), 0.4, 1.4, 0.02);
slider('sliders2', 'Встаёт не с первого раза', ...tune('retry'), 0, 1, 0.05);
slider('sliders2', 'Помощь: выпрямляет, Н·м', ...tune('assist'), 0, 300, 5);
slider('sliders2', 'Помощь: ловит себя, Н·м', ...tune('reflex'), 0, 600, 10);

const pick = () => (selected < 0 ? guys : [guys[selected]]);
function push(g, s = pushStrength) {
  g.rb.push(Math.random() * Math.PI * 2, s);
}
const btn = (id, fn) => document.getElementById(id).addEventListener('click', fn);
btn('push', () => pick().forEach((g) => push(g)));
btn('shoveHard', () => pick().forEach((g) => push(g, pushStrength * 2)));
let wander = false;
btn('walk', () => {
  wander = true;
  document.getElementById('walk').classList.add('on');
});
btn('stop', () => {
  wander = false;
  document.getElementById('walk').classList.remove('on');
  for (const g of guys) g.rb.goal = null;
});
function reset() {
  for (const g of guys) {
    g.rb.disable();
    g.rb.state = 'up';
    g.rb.goal = null;
    g.rb.enable(...g.rb.home, 0);
    g.rb.stats = { steps: 0, falls: 0, feetN: 0, airT: 0, t: 0 };
  }
}
btn('reset', reset);
btn('slow', (e) => {
  slow = slow === 1 ? 0.25 : 1;
  e.target.classList.toggle('on', slow !== 1);
});
btn('dbg', (e) => {
  showDbg = !showDbg;
  setDbg(showDbg);
  e.target.classList.toggle('on', showDbg);
});

// click: a guy selects him, the floor sends the selected one(s) there
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hitGuy = ray.intersectObjects(guys.map((g) => g.fig.root), true)[0];
  if (hitGuy) {
    const i = guys.findIndex((g) => g.fig.root.getObjectById(hitGuy.object.id));
    selected = selected === i ? -1 : i;
    return;
  }
  const p = ray.intersectObject(floor)[0]?.point;
  if (!p) return;
  wander = false;
  document.getElementById('walk').classList.remove('on');
  pick().forEach((g, k) => (g.rb.goal = [p.x + (selected < 0 ? (k - 1.5) * 0.7 : 0), p.z]));
});

const stats = document.getElementById('stats');
function statText() {
  const rows = guys.map((g, i) => {
    const s = g.rb.stats, load = (s.feetN / (68 * 9.8)) * 100;
    const st = { up: g.rb.walking ? 'идёт' : 'стоит', down: 'лежит', getup: 'встаёт' }[g.rb.state];
    return `${i === selected ? '▶' : ' '}${g.name.padEnd(8)}${st.padEnd(7)}шагов ${String(s.steps).padStart(3)}  падал ${s.falls}  ноги ${load.toFixed(0).padStart(3)}%`;
  });
  rows.push(`физика ${physMs.toFixed(2)} мс/кадр${slow !== 1 ? '  (замедлено)' : ''}`);
  return rows.join('\n');
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---- the loop (scripts switch it off and call advance/render themselves)
const lab = (window.__lab = { guys, oleg, advance, render, reset, manual: params.has('manual'), camera, controls, world, R, push: (i, dir, s) => guys[i].rb.push(dir, s), setDrunk: (v) => (drunk = v) });
let last = performance.now(), wanderT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (lab.manual) return;
  if (wander && (wanderT -= dt) <= 0) {
    wanderT = 2.5;
    for (const g of guys) if (!g.rb.goal || Math.hypot(g.rb.goal[0] - g.rb.c.x, g.rb.goal[1] - g.rb.c.z) < 0.3 || Math.random() < 0.2) g.rb.goal = [(Math.random() - 0.5) * 7, (Math.random() - 0.5) * 5];
  }
  advance(dt);
  controls.update();
  render();
  stats.textContent = statText();
}
requestAnimationFrame(frame);
lab.statText = statText;
