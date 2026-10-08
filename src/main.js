import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildApartment } from './world/apartment.js';
import { buildFurniture } from './world/furniture.js';
import { buildOutside } from './world/outside.js';
import * as ragdoll from './world/ragdoll.js';
import { roomAt, START, DOORCAM, SPOTS, CENTER } from './world/layout.js';
import { Game } from './game/game.js';
import { Player } from './player.js';
import { makeFX } from './fx.js';
import { createHUD } from './ui/hud.js';
import { createViewmodel } from './world/viewmodel.js';
import { createMirror } from './world/mirror.js';
import { moodFace } from './world/faces.js';
import { iconURL } from './ui/icons.js';
import * as audio from './audio.js';
import { TUNE, BIRTHDAY } from './config.js';
import { createLightPool } from './world/lightpool.js';
import { createPerf } from './perf.js';
import { loadModels } from './world/models.js';
import { createFilters } from './filters.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // retina at 2x costs 4x the pixels for little gain
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('app').appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b0f1c');

const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 200);
const orbitCam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
const doorCam = new THREE.PerspectiveCamera(80, 4 / 3, 0.05, 50);
doorCam.position.set(...DOORCAM.pos);
doorCam.lookAt(...DOORCAM.look);

await loadModels(); // the .glb models, before anything that places them
const apt = buildApartment();
const furn = buildFurniture();
scene.add(apt.group, furn.group);

const game = new Game({ scene, apt, furn, sfx: audio.sfx, voices: audio.voices });
const outside = buildOutside(); // stairwell down, the yard, "Продукты 24"
scene.add(outside.group);
apt.ceiling.add(outside.ceiling);
const player = new Player(camera, [...apt.colliders, ...furn.colliders, ...outside.colliders]);
player.floorAt = outside.heightAt;
ragdoll.addStatics(apt.colliders, 2.6); // walls for the ragdolls
ragdoll.addStatics(furn.colliders, 0.8); // furniture, each as tall as it's drawn (they bump into it, fall over it)
scene.add(camera); // the first-person hands hang off the camera
const hands = createViewmodel(camera);
let mirror = null; // created at boot, once the head style is known
let phoneBob = 0;
const fx = makeFX(renderer, scene, camera);
// "Oleg's eyes": full-screen looks, V cycles (Shift+V back), remembered in the browser
const filters = createFilters(fx.composer, $('filter-ov'));
filters.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
let filterNameT = null;
function nextFilter(step = 1) {
  const f = filters.next(step);
  $('btn-filter').textContent = `Глаза Олега: ${f.name}`;
  const n = $('filter-name');
  n.textContent = `${f.name} · V — следующий`;
  n.classList.add('on');
  clearTimeout(filterNameT);
  filterNameT = setTimeout(() => n.classList.remove('on'), 1600);
}
game.attachOutside(outside);
const hud = createHUD({ onBuy: (cart) => game.buyCart(cart) });
// close-up hands-on scenes (pelmeni): the mouse is free, the camera flies in, the world slows down
// close-ups where the camera flies to something and the mouse works on it: the pelmeni pot, the PC
const focuser = () => (game.cooking.focus ? game.cooking : game.pc.focus ? game.pc : null);
const focusActive = () => !!focuser();
const mini = { get active() { return focusActive(); } };
const mouseNdc = new THREE.Vector2();
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouseNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
});
// warm up the mood faces so mini-games and heads show them right away
for (const who of ['alexey', 'lyokha', 'kirill', 'temych']) for (const st of ['default', 'happy', 'angry', 'sad', 'doing']) moodFace(who, st);
window.__game = game; // handy in the console
window.__player = player;
window.__spots = SPOTS;
window.__three = THREE; // debugging: raycasts from the console
const lightPool = createLightPool(scene, 6, (p) => { const r = p.y > -0.3 && roomAt(p.x, p.z); return r && r.id !== 'landing' ? 'flat' : 'out'; });
window.__renderer = renderer; window.__scene = scene;
window.__tune = TUNE; // balance numbers, live
window.__ragdoll = ragdoll; // physics debugging
window.__TUNE = TUNE; // tuning from the console / scripts
if (params.get('physics') === 'off') game.noPhysics = true; // debug: the old kinematic bodies

const orbit = new OrbitControls(orbitCam, canvas);
orbit.target.set(CENTER.x, 0, CENTER.z);
orbit.enableDamping = true;
orbit.enabled = false;

// ---------- modes ----------
let mode = 'menu'; // menu | play | orbit | end
let started = false;
let phoneOpen = false;
let locked = false;
let dragging = false;

const isTouchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
if (isTouchOnly) {
  $('btn-play').disabled = true;
  document.querySelectorAll('#night-pick button').forEach((b) => (b.disabled = true));
  $('mobile-note').hidden = false;
}

function show(id, v) {
  $(id).hidden = !v;
}

// the benchmark looks at the party from the title-screen corner
function benchView() {
  player.place(MENU_SHOT.x, MENU_SHOT.z, MENU_SHOT.yaw);
  player.pitch = MENU_SHOT.pitch;
}

// the title screen shows the party until the first night starts
let attract = !params.has('play') && !params.has('x') && !params.has('bench');
const MENU_SHOT = { x: 6.9, z: 7.0, yaw: 35 * (Math.PI / 180), pitch: -0.2 };

function startNight(n) {
  game.startNight(n);
  setPhotoMode(false);
  player.place(START.x, START.z, START.yaw);
  hud.reset();
  started = true;
}

function lock() {
  try {
    canvas.requestPointerLock()?.catch?.(() => {});
  } catch {
    /* pointer lock is optional: drag to look instead */
  }
}

function play() {
  audio.init();
  if (attract) {
    attract = false;
    startNight(game.night); // the party behind the title was only for show
  }
  if (!started || game.over) startNight(game.over?.win ? game.night + 1 : game.night);
  mode = 'play';
  show('menu', false);
  show('end', false);
  show('orbit-bar', false);
  show('hud', true);
  orbit.enabled = false;
  apt.ceiling.visible = true;
  lock();
}

function pause() {
  mode = 'menu';
  setPhone(false, false);
  $('btn-play').textContent = started && !game.over ? 'Продолжить' : `Начать ночь ${game.night}`;
  show('menu', true);
  show('hud', false);
}

function toOrbit() {
  mode = 'orbit';
  show('menu', false);
  show('hud', false);
  show('orbit-bar', true);
  orbit.enabled = true;
  apt.ceiling.visible = false;
  if (params.get('view') === 'top') {
    orbitCam.position.set(CENTER.x, 17, CENTER.z);
  } else orbitCam.position.set(CENTER.x, 12, CENTER.z + 11);
  orbitCam.lookAt(orbit.target);
}

function setPhone(open, relock = true) {
  phoneOpen = open;
  show('phone', open);
  if (open) document.exitPointerLock?.();
  else if (relock && mode === 'play') lock();
}

game.onEnd = (res) => {
  if (attract) return startNight(game.night);
  if (perf.benching) return benchView(startNight(game.night)); // the benchmark outlives a lost night
  mode = 'end';
  setPhone(false, false);
  document.exitPointerLock?.();
  audio.setMusic(false);
  show('hud', false);
  const st = game.state;
  const last = res.win && res.night >= TUNE.nights;
  $('end-night').textContent = `Ночь ${res.night} из ${TUNE.nights}`;
  $('end-title').textContent = last ? BIRTHDAY.title : res.win ? 'Пережил ночь!' : 'Провал';
  $('end-reason').textContent = last ? BIRTHDAY.lines.join(' ') : res.reason;
  const tile = (v, label) => `<div><b>${v}</b><span>${label}</span></div>`;
  $('end-stats').innerHTML = [
    tile(st.stats.helped, 'раз помог пацанам'),
    tile(`${Math.round(st.hut)}%`, 'осталось от хаты'),
    tile(`${st.stats.spent} ₽`, 'на доставку'),
    tile(`${st.stats.bribes} ₽`, 'на взятки соседям'),
    tile(`${st.money} ₽`, 'осталось денег'),
  ].join('');
  $('end-photos').innerHTML = st.photos
    .map((p, i) => `<figure style="--r:${(i % 2 ? 1 : -1) * (2 + i)}deg"><img src="${p.img}" alt=""><figcaption>${p.caption}</figcaption></figure>`)
    .join('');
  $('btn-next').textContent = last ? 'Сначала' : res.win ? `Ночь ${res.night + 1}` : 'Ещё раз';
  if (last) game.night = 0;
  // the birthday screen gets confetti
  $('end').querySelectorAll('.confetti').forEach((c) => c.remove());
  if (last) {
    const colors = ['#f2b33d', '#ff5a4f', '#7fd48a', '#5fb7a5', '#9b86e0', '#f1e8d6'];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${-Math.random() * 6}s;animation-duration:${4 + Math.random() * 4}s;--x:${(Math.random() - 0.5) * 160}px;--r:${Math.random() * 720}deg`;
      $('end').appendChild(c);
    }
  }
  show('end', true);
};

$('btn-play').addEventListener('click', play);
// any night straight from the menu, from its start
for (const b of document.querySelectorAll('#night-pick [data-night]')) {
  b.addEventListener('click', () => {
    startNight(Number(b.dataset.night));
    play();
  });
}
$('btn-orbit').addEventListener('click', toOrbit);
$('btn-filter').addEventListener('click', () => nextFilter());
$('btn-filter').textContent = `Глаза Олега: ${filters.current.name}`;

$('btn-back').addEventListener('click', pause);
$('btn-next').addEventListener('click', () => {
  const win = game.over?.win;
  game.over = null;
  startNight(win ? game.night + 1 : game.night);
  play();
});
$('btn-menu').addEventListener('click', () => {
  game.over = null;
  started = false;
  pause();
});
$('phone-close').addEventListener('click', () => setPhone(false));

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && mode === 'play' && !phoneOpen && !mini.active) pause();
});
document.addEventListener('mousemove', (e) => {
  if (mode !== 'play' || phoneOpen) return;
  use.mx += e.movementX;
  use.my += e.movementY;
  use.fx = (use.fx ?? 0) + e.movementX;
  use.fy = (use.fy ?? 0) + e.movementY;
  // while scrubbing or shaking someone the mouse moves the hand, not the view
  if (use.down && use.busy) return;
  if ((locked || dragging) && !game.talkLocked && !mini.active) player.look(e.movementX, e.movementY);
});
// ---------- photo mode: C (or "Снять" in the phone) ----------
let photoMode = false;
let snapRequested = false;
function setPhotoMode(on) {
  photoMode = on;
  show('viewfinder', on);
  if (on) {
    setPhone(false);
    $('vf-count').textContent = `${game.state.photos.length}/${TUNE.photo.perNight}`;
  }
}
$('tab-photo').addEventListener('click', () => setPhotoMode(true));
$('ico-photo').src = iconURL('camera');
const losRay = new THREE.Raycaster();
function snap() {
  // what's in frame: friends/cat doing something photogenic, close to the centre, not behind a wall
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const P = TUNE.photo;
  const subjects = [];
  for (const f of [...game.friends, game.cat]) {
    const moment = f.photoMoment?.();
    if (!moment) continue;
    const pt = new THREE.Vector3(f.pos[0], f.figure.pose === 'lie' ? 0.6 : f === game.cat ? 0.3 : 1.4, f.pos[1]);
    const to = pt.clone().sub(origin);
    const dist = to.length();
    const ang = Math.acos(Math.min(1, to.normalize().dot(dir)));
    if (dist > P.range || ang > P.cone) continue;
    losRay.set(origin, to);
    losRay.far = dist - 0.3;
    if (losRay.intersectObject(apt.group, true).length) continue;
    subjects.push({ f, moment, ang });
  }
  subjects.sort((a, b) => a.ang - b.ang);
  // thumbnail from the frame just rendered
  const t = document.createElement('canvas');
  t.width = 320;
  t.height = 200;
  const cw = canvas.width, ch = canvas.height, w = Math.min(cw, ch * 1.6);
  t.getContext('2d').drawImage(canvas, (cw - w) / 2, (ch - w / 1.6) / 2, w, w / 1.6, 0, 0, 320, 200);
  const photo = game.takePhoto(subjects, t.toDataURL('image/jpeg', 0.8));
  $('vf-count').textContent = `${game.state.photos.length}/${TUNE.photo.perNight}`;
  if (!photo) return;
  $('flash').classList.add('on');
  requestAnimationFrame(() => $('flash').classList.remove('on'));
  $('polaroid-img').src = photo.img;
  $('polaroid-cap').textContent = photo.caption;
  show('polaroid', true);
  clearTimeout(snap.t);
  snap.t = setTimeout(() => show('polaroid', false), 3000);
}

// left button while playing: hands-on actions (spray, scrub, pat, shake)
const use = { down: false, pressed: false, mx: 0, my: 0 };
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || mode !== 'play' || phoneOpen || (!locked && !focusActive())) return;
  if (photoMode) return void (snapRequested = true);
  use.down = true;
  use.pressed = true;
});
document.addEventListener('mouseup', (e) => e.button === 0 && (use.down = false));
canvas.addEventListener('mousedown', () => {
  if (mode !== 'play' || locked || phoneOpen || focusActive() || perf.benching) return;
  // back from a close-up (pot, PC) the browser may refuse to re-lock the mouse on its own: a click does it
  dragging = true;
  lock();
});
addEventListener('mouseup', () => (dragging = false));
addEventListener('wheel', (e) => mode === 'play' && game.inv.select(game.inv.sel + Math.sign(e.deltaY)));

let currentActions = [];
addEventListener('keydown', (e) => {
  if (e.code === 'Backquote' && !e.repeat) return perf.toggle(); // Ё: the performance meter
  if (perf.benching) return; // hands off while the benchmark runs
  if (e.code === 'KeyV' && !e.repeat && (mode === 'play' || mode === 'menu' || mode === 'end')) return nextFilter(e.shiftKey ? -1 : 1);
  if (mode !== 'play') return;
  player.keys.add(e.code);
  if (e.repeat) return;
  const k = e.code;
  if (focusActive()) {
    if (k === 'Escape') focuser().cancel();
    return;
  }
  if (k === 'KeyC' && !phoneOpen) return setPhotoMode(!photoMode);
  if (photoMode && k === 'Escape') return setPhotoMode(false);
  if (k === 'KeyF') return setPhone(!phoneOpen);
  if (k === 'Escape') return phoneOpen ? setPhone(false) : pause();
  if (phoneOpen || game.oleg.blackout > 0 || game.talkLocked) return;
  if (k.startsWith('Digit')) {
    const n = Number(k.slice(5));
    if (n >= 1 && n <= 4) game.inv.select(n - 1);
  }
  if (k === 'KeyQ' && game.inv.selectedItem() && ['beer', 'vodka', 'food'].includes(game.inv.selectedItem())) hands.play('drink');
  if (k === 'KeyQ') game.useSelf();
  if (k === 'KeyG') game.inv.drop();
  const key = { KeyE: 'E', KeyR: 'R', KeyT: 'T' }[k];
  const act = key && currentActions.find((a) => a.key === key);
  if (act) {
    // plain actions pay here; mini-game actions pay when the game opens (game.minigame)
    if (act.cost && !act.mini && !game.spend(act.cost)) return;
    act.run();
    hands.play('use');
    audio.sfx.click();
  } else if (k === 'KeyT') game.olegDance(); // nothing to do with T here: dance
});
addEventListener('keyup', (e) => player.keys.delete(e.code));
addEventListener('blur', () => player.keys.clear());

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  fx.setSize(innerWidth, innerHeight);
  filters.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
  for (const c of [camera, orbitCam]) {
    c.aspect = innerWidth / innerHeight;
    c.updateProjectionMatrix();
  }
});

// ---------- looking at things ----------
const ray = new THREE.Raycaster();
ray.far = 2.4;
ray.camera = camera;
const center = new THREE.Vector2(0, 0);
const pickRoots = [apt.group, furn.group, outside.group, game.dynamic]; // the stairwell, yard and shop too: their walls block, the shelves are targets
function visibleChain(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
let wasFocused = false;
const focusRay = new THREE.Raycaster();
function findTarget() {
  ray.setFromCamera(center, camera);
  for (const hit of ray.intersectObjects(pickRoots, true)) {
    if (!visibleChain(hit.object)) continue;
    if (hit.object.isSprite && !hit.object.parent?.userData.target) continue; // labels don't block

    for (let o = hit.object; o; o = o.parent) if (o.userData.target) return o.userData.target;
    return null; // a wall or something without a target is in the way
  }
  return null;
}

// ---------- loop ----------
const camCanvas = $('cam-canvas');
const camCtx = camCanvas.getContext('2d');
let last = performance.now();
let time = 0;
let drunkFx = 0;
let blackFx = 0;
let hudT = 0;

function frame(now) {
  perf.begin(now);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // never backwards (first frame)
  last = now;
  time += dt;

  if (mode === 'play') {
    game.update(game.cooking.focus ? dt * TUNE.minigame.timeScale : dt); // at the PC the party doesn't wait
    // listening to a story: Oleg turns to the guy and can't walk away until the lock ends
    const listening = game.talkLocked;
    if (listening) {
      const [fx, fz] = game.talk.friend.pos;
      const want = Math.atan2(-(fx - player.x), -(fz - player.z));
      let dy = want - player.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      player.yaw += dy * Math.min(1, dt * 6);
      player.pitch += (-0.12 - player.pitch) * Math.min(1, dt * 4);
    }
    if (focusActive()) {
      // fly to the close-up and hand the mouse over to the objects
      if (locked) document.exitPointerLock?.();
      const f = focuser().focus;
      camera.position.lerp(f.cam.pos, Math.min(1, dt * 6));
      const q = camera.quaternion.clone();
      camera.lookAt(f.cam.look);
      const want = camera.quaternion.clone();
      camera.quaternion.copy(q).slerp(want, Math.min(1, dt * 6));
      wasFocused = true;
    } else {
      if (wasFocused) {
        wasFocused = false;
        use.down = false;
        lock();
        setTimeout(() => !locked && mode === 'play' && !focusActive() && game.toastOnce('relock', 'Кликни мышью, чтобы снова крутить головой', 'info', 4), 400);
      }
      // the phone is in his hand: he can keep walking with it (WASD), the mouse is on the screen
      const px = player.x, pz = player.z;
      player.update(dt, { drunk: game.oleg.drunk, canMove: !(game.oleg.blackout > 0) && !listening, fall: game.olegFallK, dance: game.oleg.dance > 0 ? game.oleg.dance : 0 });
      game.olegSpeed = Math.hypot(player.x - px, player.z - pz) / Math.max(dt, 1e-4);
    }
    focusRay.setFromCamera(focusActive() ? mouseNdc : center, camera);
    game.cooking.update(dt, { ray: focusRay.ray, down: use.down, dx: use.fx, dy: use.fy });
    game.pc.update(dt, { ray: game.pc.focus ? focusRay.ray : null, pressed: game.pc.focus && use.pressed });
    use.fx = use.fy = 0;
    if (focusActive()) hud.setUse({ label: focuser().hint(), progress: focuser().progress(), top: true });
    document.body.classList.toggle('focus', focusActive()); // close-up: no hotbar in the way
    const k = player.keys;
    hands.update(dt, {
      item: game.inv.selectedItem(),
      moving: !listening && !mini.active && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((c) => k.has(c)),
      speed: k.has('ShiftLeft') || k.has('ShiftRight') ? 1.5 : 1,
      drunk: game.oleg.drunk,
      visible: !phoneOpen && !mini.active && !photoMode && !(game.oleg.blackout > 0) && !game.oleg.fall,
      yaw: player.yaw,
      pitch: player.pitch,
    });
    // the phone sways in his hand as he walks
    if (phoneOpen) {
      const walking = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((c) => k.has(c));
      phoneBob += dt * (walking ? 8 : 1.5);
      const bx = walking ? Math.cos(phoneBob) * 5 : 0, by = walking ? Math.abs(Math.sin(phoneBob)) * 8 : Math.sin(phoneBob) * 2;
      $('phone').style.transform = `translate(${bx}px, ${by}px) rotate(${-3 + (walking ? Math.cos(phoneBob) * 1.2 : 0)}deg)`;
    }
    mirror?.update(dt, { x: player.x, z: player.z, yaw: player.yaw, moving: ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((c) => k.has(c)), drunk: game.oleg.drunk, item: game.inv.selectedItem() });
    game.olegPos = [player.x, player.z];
    game.olegYaw = player.yaw;
    const target = phoneOpen || mini.active ? null : findTarget();
    // hands-on: aim + left button
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const handHud = game.hands.update(dt, { down: use.down, pressed: use.pressed, mx: use.mx, my: use.my, target, origin, dir, hand: hands.tip() });
    const held = game.inv.selectedItem();
    use.busy = (held === 'mop' && target?.puddle) || (!held && target?.friend?.problem?.id === 'sleep') || !!game.hands.grab;
    hands.setActivity({ spray: held === 'shower' && use.down, scrub: use.down && held === 'mop' && target?.puddle ? 1 : 0, shake: use.down && !held && (game.hands.grab || target?.friend?.problem?.id === 'sleep') ? 1 : 0, mx: use.mx, my: use.my });
    if (game.handAnim) {
      hands.play(game.handAnim);
      game.handAnim = null;
    }
    use.pressed = false;
    use.mx = use.my = 0;
    if (!focusActive()) hud.setUse(handHud);
    currentActions = target?.actions?.() ?? [];
    hudT -= dt;
    if (hudT <= 0 || target !== hud.lastTarget) {
      hudT = 0.1;
      hud.lastTarget = target;
      hud.update(game, { roomName: roomAt(player.x, player.z)?.name ?? outside.zoneName(player.x, player.z), target, actions: currentActions });
    }
    audio.setMusic(game.state.music && !game.hushed); // the music goes quiet while someone knocks
    audio.voices.update([player.x, player.z]);
  } else {
    hands.root.visible = false;
    audio.setMusic(false);
    audio.voices.stopAll();
    if (mode === 'orbit') orbit.update();
    else if (mode === 'menu' && attract) {
      // title screen: the party goes on by itself (no sound before the first click), seen from the corner
      game.olegPos = [99, 99]; // no name tags
      game.update(dt);
      player.place(MENU_SHOT.x, MENU_SHOT.z, MENU_SHOT.yaw + Math.sin(time * 0.12) * 0.07);
      player.pitch = MENU_SHOT.pitch;
      player.update(0);
    } else if (mode === 'menu' || mode === 'end') player.update(0);
  }

  drunkFx += ((mode === 'play' ? game.oleg.drunk / 100 : 0) - drunkFx) * Math.min(1, dt * 2);
  blackFx += ((mode === 'play' && game.oleg.blackout > 0 ? 1 : 0) - blackFx) * Math.min(1, dt * 3);
  fx.set(time, drunkFx, blackFx);
  filters.update(time, game.clock);

  lightPool.update(dt, mode === 'play' && hud.camRect() ? [camera, doorCam] : [mode === 'orbit' ? orbitCam : camera]);
  perf.renderStart();
  if (!perf.cfg.render) { /* benchmark: logic only */ }
  else if (mode === 'orbit') renderer.render(scene, orbitCam);
  else if (perf.cfg.post) fx.render();
  else renderer.render(scene, camera); // benchmark: no post-processing
  if (snapRequested) {
    snapRequested = false;
    if (mode === 'play') snap();
  }

  const r = perf.cfg.render && mode === 'play' && hud.camRect();
  if (r) {
    doorCam.aspect = r.width / r.height;
    doorCam.updateProjectionMatrix();
    const y = innerHeight - r.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.render(scene, doorCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    // the phone body covers that part of the canvas, so copy the picture into the phone's own canvas
    const pr = renderer.getPixelRatio();
    const w = Math.round(r.width * pr), h = Math.round(r.height * pr);
    if (camCanvas.width !== w || camCanvas.height !== h) [camCanvas.width, camCanvas.height] = [w, h];
    camCtx.drawImage(canvas, r.left * pr, r.top * pr, w, h, 0, 0, w, h);
  }
  perf.end(now);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
// heads are flat Doom-style cut-outs that turn to the camera (the cube-head style is kept for ?heads=box)
game.style = params.get('heads') === 'box' ? 'box' : 'sprite';
mirror = createMirror({
  furn, scene, hands, style: game.style,
  seen: (cam) => {
    const room = roomAt(cam.position.x, cam.position.z)?.id;
    return room === 'bath' || (room === 'hall' && apt.doors.bath.open);
  },
});
// FPS meter (?perf, Ё) and the one-minute benchmark (?bench)
const perf = createPerf({ renderer, scene, fx, filters, game, world: ragdoll.world, params });
startNight(Number(params.get('night')) || 1);
started = false; // the menu offers "start", not "continue"
player.update(0);
if (params.has('x')) player.place(Number(params.get('x')), Number(params.get('z')), (Number(params.get('yaw')) || 0) * (Math.PI / 180));
if (params.has('pitch')) player.pitch = (Number(params.get('pitch')) * Math.PI) / 180;
if (params.has('eye')) {
  // debug: look from any height (e.g. ?eye=6&pitch=-89 for a close top-down view); ceiling hidden above it
  player.eye = Number(params.get('eye'));
  apt.ceiling.visible = player.eye < 2.5;
}
if (params.get('view') === 'orbit' || params.get('view') === 'top') toOrbit();
if (params.has('play') || params.has('bench')) {
  // screenshot/testing mode: run without pointer lock
  mode = 'play';
  started = true;
  show('menu', false);
  show('hud', true);
  const skip = Number(params.get('t')) || 0;
  for (let s = 0; s < skip; s += 0.05) game.update(0.05);
  if (params.has('phone')) setPhone(true, false);
  if (params.has('bench')) {
    benchView();
    perf.startBench();
  }
} else if (attract) {
  game.olegPos = [99, 99];
  for (let s = 0; s < 10; s += 0.05) game.update(0.05); // the guys have settled in by the time the title shows
}
requestAnimationFrame(frame);
