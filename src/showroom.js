// Style showroom (showroom.html, a dev tool, not in the build): one small fixed Soviet room corner drawn
// by the real engine (the game's renderer settings, lamp, post chain, wallpaper, people, cat and props),
// so art styles can be compared side by side on the same picture.
//   ?style=<id>    a style from src/styles/ (index.js has the contract)
//   ?kit=<variant> furniture from .cache/kit/<variant>/<id>.glb (default 'base'; grey boxes where one is
//                  missing); for a variant other than 'base' also styled props from .cache/kit/<variant>/props/
//   ?view=1|2|3    1 = the whole corner, 2 = armchair, TV and the guys, 3 = the kitchen side
// Keys: 1 2 3 switch views, O = free orbit camera. window.__ready turns true once everything is loaded,
// the style is applied and a few frames are drawn (scripts/showroom.mjs waits for it); window.__error on failure.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeFX } from './fx.js';
import * as T from './world/textures.js';
import { mat, worldUV, boxGeo } from './world/apartment.js';
import { loadModels, model, modelSize } from './world/models.js';
import { makePerson, makeCat, makeBottle } from './world/figures.js';
import { moodFace } from './world/faces.js';
import { SKINS } from './world/skins.js';
import { makeProp } from './world/anim.js';
import { CHARS } from './game/friends.js';

// the same picture on every load: the rigs (and anything else random) draw from a fixed sequence
let seed = 0;
const reseed = () => (seed = 20240917);
Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
reseed();

const params = new URLSearchParams(location.search);
const KIT = params.get('kit') || 'base';
const STYLE = params.get('style');

// ---------- renderer, camera, post: as in main.js
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b0f1c');
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 100);
const fx = makeFX(renderer, scene, camera);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enabled = false;

// ---------- the room: x along the back wall (0..W), z from the back wall into the room (0..D), y up.
// The corner is the back wall (z = 0) and the left wall (x = 0); the other two walls are there so no
// view ever sees past the edge. 4.5 m wide: the fridge in the corner, the стенка, the armchair, room
// for Лёха to stand, the TV and the plant along the back wall, nothing touching.
const W = 4.5, D = 3.0, H = 2.6, TH = 0.12;
const WIN = { z0: 1.0, z1: 2.0, y0: 0.9, y1: 2.3 }; // the window in the left wall
const LAMP = [W / 2, 1.45];
const room = new THREE.Group();
scene.add(room);
const add = (geo, m, parent = room) => {
  const mesh = new THREE.Mesh(geo, m);
  parent.add(mesh);
  return mesh;
};

function buildRoom() {
  const paint = mat('#d9d2c3');
  const wallpaper = mat('#ffffff', { map: T.wallpapers.living(), roughness: 0.9 });
  // wall bodies outside the room; the left one in pieces around the window (their faces are the reveals)
  const leftPieces = [[0, WIN.z0, 0, H], [WIN.z1, D, 0, H], [WIN.z0, WIN.z1, 0, WIN.y0], [WIN.z0, WIN.z1, WIN.y1, H]];
  add(boxGeo(-TH, W + TH, 0, H, -TH, 0), paint);
  add(boxGeo(-TH, W + TH, 0, H, D, D + TH), paint);
  add(boxGeo(W, W + TH, 0, H, 0, D), paint);
  for (const [z0, z1, y0, y1] of leftPieces) add(boxGeo(-TH, 0, y0, y1, z0, z1), paint);
  // wallpaper 4 mm off the walls, 0.5 m per tile like the game (worldUV scale 2)
  const lining = (geo) => add(worldUV(geo, 2), wallpaper);
  lining(new THREE.PlaneGeometry(W, H).translate(W / 2, H / 2, 0.004));
  lining(new THREE.PlaneGeometry(W, H).rotateY(Math.PI).translate(W / 2, H / 2, D - 0.004));
  lining(new THREE.PlaneGeometry(D, H).rotateY(-Math.PI / 2).translate(W - 0.004, H / 2, D / 2));
  for (const [z0, z1, y0, y1] of leftPieces) lining(new THREE.PlaneGeometry(z1 - z0, y1 - y0).rotateY(Math.PI / 2).translate(0.004, (y0 + y1) / 2, (z0 + z1) / 2));

  // parquet floor (1 texture = 1 m), ceiling, a varnished skirting board
  add(worldUV(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2).translate(W / 2, 0, D / 2)), mat('#ffffff', { map: T.parquet(), roughness: 0.6 }));
  add(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2).translate(W / 2, H, D / 2), mat('#efece6'));
  const skirt = mat('#5b3a22', { roughness: 0.5 });
  const S = 0.07, ST = 0.018;
  add(boxGeo(0, W, 0, S, 0, ST), skirt);
  add(boxGeo(0, W, 0, S, D - ST, D), skirt);
  add(boxGeo(W - ST, W, 0, S, ST, D - ST), skirt);
  add(boxGeo(0, ST, 0, S, ST, D - ST), skirt);

  // the window: a Soviet double frame (outer and inner sash, a fortochka), sill, cast-iron radiator
  const frame = mat('#e8e4da', { roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: '#9fb8d0', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1 });
  const f = 0.055;
  for (const x of [-0.095, -0.03]) {
    const bar = (z0, z1, y0, y1) => add(boxGeo(x - 0.025, x + 0.025, y0, y1, z0, z1), frame);
    const zm = (WIN.z0 + WIN.z1) / 2;
    bar(WIN.z0, WIN.z0 + f, WIN.y0, WIN.y1);
    bar(WIN.z1 - f, WIN.z1, WIN.y0, WIN.y1);
    bar(WIN.z0, WIN.z1, WIN.y1 - f, WIN.y1);
    bar(WIN.z0, WIN.z1, WIN.y0, WIN.y0 + f);
    bar(zm - f / 2, zm + f / 2, WIN.y0, WIN.y1);
    bar(WIN.z0, zm, WIN.y1 - 0.5, WIN.y1 - 0.5 + f * 0.8); // the fortochka
    add(boxGeo(x - 0.003, x + 0.003, WIN.y0 + f, WIN.y1 - f, WIN.z0 + f, WIN.z1 - f), glass);
  }
  add(boxGeo(-0.06, 0.07, WIN.y0 - 0.01, WIN.y0 + 0.03, WIN.z0 - 0.05, WIN.z1 + 0.05), mat('#f0ede6', { roughness: 0.4 }));
  buildRadiator();
  buildCurtains();

  // night outside: the panel block across the yard, some windows lit; the ground far below
  const facade = new THREE.Mesh(new THREE.PlaneGeometry(36, 18), new THREE.MeshBasicMaterial({ map: T.cityFacade() }));
  facade.rotation.y = Math.PI / 2;
  facade.position.set(-18, 3, (WIN.z0 + WIN.z1) / 2);
  scene.add(facade);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), mat('#101418'));
  ground.position.set(-20, -3, 0);
  scene.add(ground);

  // the legendary wall carpet over the armchair and the TV, a rug on the floor
  const carpet = mat('#ffffff', { map: T.wallCarpet(), roughness: 0.95 });
  add(new THREE.BoxGeometry(1.6, 1.0, 0.012).translate(2.9, 1.68, 0.012), [carpet, carpet, carpet, carpet, carpet, carpet]);
  const rug = mat('#ffffff', { map: T.floorRug(), roughness: 0.95 });
  add(new THREE.BoxGeometry(2.0, 0.008, 1.3).translate(2.45, 0.004, 1.65), rug);

  // light, as in the living room: the warm lamp (9 × lampPower 1.6), the night fill, the moon
  const lamp = new THREE.PointLight('#ffd7a0', 9 * 1.6, 0, 1.6);
  lamp.position.set(LAMP[0], H - 0.45, LAMP[1]);
  scene.add(lamp);
  const halo = T.glowSprite('#ffd7a0', 0.9);
  halo.position.set(LAMP[0], H - 0.55, LAMP[1]);
  scene.add(halo);
  scene.add(new THREE.HemisphereLight('#8a94b8', '#2a2018', 0.25));
  const moon = new THREE.DirectionalLight('#8090c0', 0.35);
  moon.position.set(-8, 10, 0.5);
  moon.target.position.set(2, 0, 1.8);
  scene.add(moon, moon.target);
}

// a cast-iron МС-140 under the window: sections of two rounded columns with a slit between them, and
// the riser pipe going through the floor and the ceiling, the radiator hung on it by two stubs
function buildRadiator() {
  const parts = [];
  const n = 8, pitch = 0.093, y0 = 0.14, h = 0.56, x0 = 0.045, x1 = 0.165;
  const z0 = (WIN.z0 + WIN.z1) / 2 - (n * pitch) / 2;
  for (let i = 0; i < n; i++) {
    const zc = z0 + (i + 0.5) * pitch;
    for (const xc of [x0 + 0.024, x1 - 0.024]) parts.push(new RoundedBoxGeometry(0.048, h, 0.082, 3, 0.02).translate(xc, y0 + h / 2, zc));
    parts.push(new THREE.BoxGeometry(x1 - x0 - 0.06, h - 0.08, 0.03).translate((x0 + x1) / 2, y0 + h / 2, zc));
  }
  const pipe = (len, r = 0.016) => new THREE.CylinderGeometry(r, r, len, 12);
  const zr = z0 + n * pitch + 0.055; // the riser, at the stove end
  parts.push(pipe(H).translate(0.07, H / 2, zr));
  for (const y of [y0 + 0.06, y0 + h - 0.06]) parts.push(pipe(0.1, 0.013).rotateX(Math.PI / 2).translate(0.07, y, zr - 0.05));
  add(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), mat('#e9e4d6', { roughness: 0.45 }));
}

// a canvas texture: draw(g, w, h) on a w x h canvas, tiled
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// a hanging cloth along z (from za to zb), from y0 up to y1, at x, gathered into folds
function cloth(za, zb, y0, y1, x, fold, depth, m) {
  const geo = new THREE.PlaneGeometry(zb - za, y1 - y0, Math.ceil(((zb - za) / fold) * 8), 1).rotateY(Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) + (za + zb) / 2;
    p.setXYZ(i, x + depth * Math.sin((z * 2 * Math.PI) / fold), p.getY(i) + (y0 + y1) / 2, z);
  }
  geo.computeVertexNormals();
  return add(geo, m);
}

// the window dressed as in every Soviet flat: a rod, golden-brown jacquard drapes pulled to the sides,
// and the тюль, a sheer white lace over the whole window
function buildCurtains() {
  const rodY = 2.44;
  add(new THREE.CylinderGeometry(0.012, 0.012, WIN.z1 - WIN.z0 + 0.8, 10).rotateX(Math.PI / 2).translate(0.12, rodY, (WIN.z0 + WIN.z1) / 2), mat('#8a6a3c', { roughness: 0.4, metalness: 0.5 }));
  for (const z of [WIN.z0 - 0.4, WIN.z1 + 0.4]) add(new THREE.BoxGeometry(0.12, 0.03, 0.03).translate(0.06, rodY + 0.02, z + (z < WIN.z0 ? 0.02 : -0.02)), mat('#6b5030', { roughness: 0.5 }));
  // tone-on-tone damask: pointed ovals with a leaf inside, offset every other row
  const jacquard = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#7a5528';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = x % 8 ? 'rgba(0,0,0,0.05)' : 'rgba(255,230,180,0.04)';
      g.fillRect(x, 0, 2, h);
    }
    const motif = (cx, cy) => {
      g.fillStyle = 'rgba(255,214,150,0.16)';
      g.beginPath();
      g.moveTo(cx, cy - h * 0.2);
      g.quadraticCurveTo(cx + w * 0.3, cy, cx, cy + h * 0.2);
      g.quadraticCurveTo(cx - w * 0.3, cy, cx, cy - h * 0.2);
      g.fill();
      g.fillStyle = 'rgba(60,30,5,0.18)';
      g.beginPath();
      g.moveTo(cx, cy - h * 0.09);
      g.quadraticCurveTo(cx + w * 0.11, cy, cx, cy + h * 0.09);
      g.quadraticCurveTo(cx - w * 0.11, cy, cx, cy - h * 0.09);
      g.fill();
    };
    for (const [cx, cy] of [[w / 2, h / 4], [0, (3 * h) / 4], [w, (3 * h) / 4]]) motif(cx, cy);
  });
  jacquard.repeat.set(1, 1);
  const drape = mat('#ffffff', { map: jacquard, roughness: 0.9, side: THREE.DoubleSide });
  for (const [za, zb] of [[WIN.z0 - 0.36, WIN.z0 + 0.04], [WIN.z1 + 0.0, WIN.z1 + 0.32]]) {
    const geo = cloth(za, zb, 0.05, rodY - 0.02, 0.135, 0.11, 0.022, drape).geometry;
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (zb - za)) / 0.22, (uv.getY(i) * (rodY - 0.07)) / 0.45);
  }
  const lace = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgba(255,255,255,0.30)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 3;
    for (const [cx, cy] of [[w / 2, h / 2], [0, 0], [w, 0], [0, h], [w, h]]) {
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26, 20, 9, a, 0, Math.PI * 2);
        g.stroke();
      }
      g.beginPath();
      g.arc(cx, cy, 8, 0, Math.PI * 2);
      g.stroke();
    }
  });
  const tulle = new THREE.MeshStandardMaterial({ map: lace, transparent: true, roughness: 1, side: THREE.DoubleSide, depthWrite: false });
  const top = rodY - 0.02, bottom = WIN.y0 + 0.06;
  const geo = cloth(WIN.z0 - 0.08, WIN.z1 + 0.08, bottom, top, 0.1, 0.09, 0.01, tulle).geometry;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (WIN.z1 - WIN.z0 + 0.16)) / 0.3, (uv.getY(i) * (top - bottom)) / 0.3);
}

// ---------- loading
const loader = new GLTFLoader();
const loadGlb = async (url) => (await loader.loadAsync(url)).scene;
async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'); // not the SPA fallback page
  } catch {
    return false;
  }
}

// the base kit: [w, d, h] as the kit builds it (origin at the bottom centre, front toward +z),
// where its bottom centre stands in the room and the way its front faces (yaw: front = (sin, cos))
// Back wall from the corner: the fridge (on the left wall, its side to the стенка), the стенка, the
// armchair, the TV turned a little toward the room, the plant. Left wall: fridge, window, stove.
const KIT_ITEMS = {
  fridge: { size: [0.6, 0.68, 1.5], at: [0.35, 0.33], yaw: Math.PI / 2 },
  stenka: { size: [1.0, 0.49, 2.1], at: [1.28, 0.27], yaw: 0 },
  armchair: { size: [0.73, 0.85, 0.85], at: [2.2, 0.45], yaw: 0.12 },
  tv: { size: [0.7, 0.55, 0.95], at: [3.63, 0.33], yaw: -0.2 },
  stove: { size: [0.5, 0.68, 0.85], at: [0.35, 2.6], yaw: Math.PI / 2 },
  stool: { size: [0.33, 0.33, 0.45], at: [0.66, 1.5], yaw: Math.PI / 2 + 0.35 },
};

// grey stand-ins of the right size while the kit isn't built (an armchair you can sit in, a TV with a screen side)
function placeholder(id, [w, d, h]) {
  const g = new THREE.Group();
  const grey = mat('#8d8d8d'), dark = mat('#5e5e5e');
  const box = (x0, x1, y0, y1, z0, z1, m = grey) => g.add(new THREE.Mesh(boxGeo(x0, x1, y0, y1, z0, z1), m));
  const a = 0.12;
  if (id === 'armchair') {
    box(-w / 2, w / 2, 0, 0.12, -d / 2, d / 2, dark);
    box(-w / 2 + a, w / 2 - a, 0.12, 0.42, -d / 2 + 0.2, d / 2);
    box(-w / 2, w / 2, 0.12, h, -d / 2, -d / 2 + 0.2);
    for (const s of [-1, 1]) box(s < 0 ? -w / 2 : w / 2 - a, s < 0 ? -w / 2 + a : w / 2, 0.12, 0.62, -d / 2, d / 2);
  } else if (id === 'tv') {
    box(-w / 2 + 0.1, w / 2 - 0.1, 0, 0.45, -d / 2 + 0.05, d / 2 - 0.05, dark);
    box(-w / 2, w / 2, 0.45, h, -d / 2, d / 2);
    box(-w / 2 + 0.06, w / 2 - 0.18, 0.51, h - 0.06, d / 2, d / 2 + 0.006, dark);
  } else {
    box(-w / 2, w / 2, 0, h, -d / 2, d / 2);
    box(-w / 2 + 0.03, w / 2 - 0.03, 0.04, h - 0.04, d / 2, d / 2 + 0.004, mat('#7a7a7a')); // the front
  }
  g.userData.placeholder = true;
  return g;
}

async function kitItem(id) {
  const url = `/.cache/kit/${KIT}/${id}.glb`;
  if (await exists(url)) {
    try {
      return await loadGlb(url);
    } catch (e) {
      console.warn(`showroom: ${url} did not load (${e.message}), grey box instead`);
    }
  } else console.warn(`showroom: no ${url}, grey box instead`);
  return placeholder(id, KIT_ITEMS[id].size);
}

// Poly Haven props (world/models.js) at the game's sizes; a kit variant may bring styled copies
const PROP_H = { vintage_electric_kettle: 0.24, potted_plant_01: 1.2, cardboard_box_01: 0.3 };
const PROP_SCALE = { Chandelier_02: 0.8 };
async function prop(id) {
  const height = PROP_H[id] ?? modelSize(id).y * (PROP_SCALE[id] ?? 1);
  const url = `/.cache/kit/${KIT}/props/${id}.glb`;
  let m = null;
  if (KIT !== 'base' && (await exists(url))) {
    try {
      m = await loadGlb(url);
      console.info(`showroom: ${id} from ${url}`);
    } catch (e) {
      console.warn(`showroom: ${url} did not load (${e.message}), the original instead`);
    }
  }
  m ??= model(id);
  m.scale.setScalar(height / new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).y);
  return m;
}

// ---------- placing things
const ray = new THREE.Raycaster();
ray.camera = camera;
const V = new THREE.Vector3();

// stand obj at (x, z) facing yaw, then nudge it off the walls if its real footprint reaches them
function put(obj, [x, z], yaw = 0, y = 0) {
  obj.position.set(x, y, z);
  obj.rotation.y = yaw;
  room.add(obj);
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj, true), gap = 0.025; // precise: the kit has tilted parts (legs)
  obj.position.x += Math.max(0, gap - b.min.x) - Math.max(0, b.max.x - (W - gap));
  obj.position.z += Math.max(0, gap - b.min.z) - Math.max(0, b.max.z - (D - gap));
  obj.updateMatrixWorld(true);
  return obj;
}

// world height of obj's top surface over its local point (lx, lz)
function topAt(obj, lx, lz, fallback) {
  obj.updateMatrixWorld(true);
  const from = obj.localToWorld(V.set(lx, 0, lz));
  from.y = H - 0.01;
  ray.set(from, new THREE.Vector3(0, -1, 0));
  return ray.intersectObject(obj, true)[0]?.point.y ?? fallback;
}

// local z of the first surface met going back (-z) from in front at local height ly (an armchair's back, its seat edge)
function backAt(obj, ly) {
  obj.updateMatrixWorld(true);
  const from = obj.localToWorld(new THREE.Vector3(0, ly, 1));
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(obj.matrixWorld);
  ray.set(from, dir);
  const hit = ray.intersectObject(obj, true)[0];
  return hit ? obj.worldToLocal(hit.point.clone()).z : null;
}

// A reflection probe. The game has no environment map, so chrome, gilt and glass from the kit (metallic,
// no textures) would show nothing but the lamp's highlight and render black. One snapshot of the room
// from its middle (furniture, lamp and window in it, the guys not yet), filtered by roughness (PMREM),
// becomes the envMap of the metal, glass and screen materials of the kit and the props. A style can
// drop it (material.envMap = null) or swap it; window.__showroom.probe is the texture.
let probe = null;
function reflect(objects) {
  const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cube = new THREE.CubeCamera(0.05, 50, target);
  cube.position.set(W / 2, 1.25, 1.4);
  scene.add(cube);
  cube.update(renderer, scene);
  scene.remove(cube);
  const pmrem = new THREE.PMREMGenerator(renderer);
  probe = pmrem.fromCubemap(target.texture).texture;
  pmrem.dispose();
  target.dispose();
  for (const obj of objects)
    obj.traverse((o) => {
      for (const m of o.isMesh ? [o.material].flat() : []) {
        if (!m.isMeshStandardMaterial || !(m.metalness > 0.4 || m.transparent || /screen|chrome|glass|crystal/i.test(m.name))) continue;
        m.envMap = probe;
        m.needsUpdate = true;
      }
    });
}

// run a figure's animation for a while so it settles into its pose (then it stays frozen)
function settle(fig, seconds, state = {}) {
  for (let t = 0; t < seconds; t += 1 / 30) fig.update(1 / 30, state);
}

const faceReady = (who) =>
  Promise.race([new Promise((r) => moodFace(who, 'default').then(() => r())), new Promise((r) => setTimeout(r, 15000))]);

async function build() {
  buildRoom();
  await loadModels();
  const [items, props] = await Promise.all([
    Promise.all(Object.keys(KIT_ITEMS).map(async (id) => [id, await kitItem(id)])).then(Object.fromEntries),
    Promise.all(['vintage_electric_kettle', 'Chandelier_02', 'potted_plant_01', 'russian_food_cans_01', 'cardboard_box_01'].map(async (id) => [id, await prop(id)])).then(Object.fromEntries),
  ]);
  for (const [id, it] of Object.entries(KIT_ITEMS)) put(items[id], it.at, it.yaw);
  const { stenka, armchair, stove, stool } = items;

  // props on the furniture, at whatever height the kit variant's tops are
  const on = (m, base, lx, lz, turn = 0) => {
    const p = base.localToWorld(new THREE.Vector3(lx, 0, lz));
    m.position.set(p.x, topAt(base, lx, lz, 0), p.z);
    m.rotation.y = base.rotation.y + turn;
    room.add(m);
  };
  on(props.vintage_electric_kettle, stove, 0.1, -0.1, 0.6);
  on(props.cardboard_box_01, stenka, 0.12, 0.02, 0.15);
  on(props.russian_food_cans_01, stool, -0.07, 0.07, 0.4);
  on(makeBottle('vodka'), stool, 0.08, -0.08);
  put(props.potted_plant_01, [4.2, 0.42], 0.5);
  // the chandelier, lit from the inside like in furniture.js: shades glow in their own colour, bulbs shine
  const ch = props.Chandelier_02;
  ch.position.set(LAMP[0], H, LAMP[1]);
  ch.traverse((o) => {
    for (const m of o.isMesh ? [o.material].flat() : []) {
      if (!m.emissive) continue;
      if (/bulb/i.test(m.name)) {
        m.emissive.set('#fff2d0');
        m.emissiveIntensity = 2;
      } else {
        m.emissiveMap = m.map;
        m.emissive.set('#ffd9a0');
        m.emissiveIntensity = 0.6;
      }
      m.needsUpdate = true;
    }
  });
  room.add(ch);
  reflect([...Object.values(items), ...Object.values(props)]);

  // the guys, made the way friends.js makes them (no name tags), posed and then frozen. Reseeded first:
  // what was built before them (a kit variant has other objects, and every object takes a random id)
  // must not change their pose
  reseed();
  const person = (id) => makePerson({ ...CHARS[id], style: 'sprite', faceId: id, label: false });
  const lyokha = person('lyokha');
  lyokha.root.position.set(2.92, 0, 0.62);
  lyokha.root.rotation.y = 0.35;
  room.add(lyokha.root);
  lyokha.setPose('stand');
  settle(lyokha, 2);
  lyokha.play('talk', { dur: 3 });
  settle(lyokha, 1.1);
  // a beer in the right hand, forearm level: a prop laid along +z stands upright in the hand then
  const arm = lyokha.rig.arms[0];
  arm.shoulder.quaternion.setFromEuler(new THREE.Euler(-0.3, 0, -0.12));
  arm.elbow.rotation.x = -1.25;
  const beer = makeProp('beer');
  beer.position.y = -0.05;
  arm.hand.add(beer);

  // Kirill in the armchair: the seat and the back are found on the model, so any kit variant fits
  const kirill = person('kirill');
  const seat = topAt(armchair, 0, 0.1, 0.42);
  const ly = seat - armchair.position.y;
  const backs = [0.15, 0.4].map((dy) => backAt(armchair, ly + dy)).filter((z) => z !== null && z < 0.2);
  const front = backAt(armchair, ly - 0.06) ?? 0.4; // the seat's front edge: the shins hang in front of it
  const pelvisZ = Math.max((backs.length ? Math.max(...backs) : -0.2) + 0.17, front - 0.4);
  armchair.localToWorld(V.set(0, 0, pelvisZ));
  kirill.root.position.set(V.x, 0, V.z);
  kirill.root.rotation.y = armchair.rotation.y;
  room.add(kirill.root);
  kirill.setPose('sit', seat - 0.46);
  settle(kirill, 2);
  kirill.rig.spine.rotation.x -= 0.14; // slouching back into the armchair
  kirill.rig.neck.rotation.x += 0.1;
  // forearms on the armrests
  for (const [i, arm] of kirill.rig.arms.entries()) {
    const s = i ? 1 : -1; // anim.js SIDES: arms[0] is the right arm
    arm.shoulder.quaternion.setFromEuler(new THREE.Euler(-0.25, 0, s * 0.28));
    arm.elbow.rotation.x = -1.2;
  }

  // the cat on the warm TV, of course
  const cat = makeCat({ label: false });
  cat.animate(0, false, {});
  on(cat.root, items.tv, 0.04, 0.08, -0.25);

  // wait for the face pictures and the skin sheet
  await Promise.all([
    ...['lyokha', 'kirill', 'cat'].map(faceReady),
    ...Object.values(SKINS).map((s) => {
      const img = new Image();
      img.src = s.src;
      return img.decode().catch(() => {});
    }),
  ]);
  window.__showroom = { THREE, scene, camera, renderer, fx, items, props, probe, lyokha, kirill, cat, seat: { y: seat, backs, front, pelvisZ } };
}

// ---------- views
const VIEWS = {
  1: { pos: [4.25, 1.6, 2.9], at: [2.51, 0.95, 0.83], fov: 75 }, // the whole corner
  2: { pos: [2.9, 1.45, 2.6], at: [2.9, 0.95, 0.4], fov: 65 }, // armchair, TV, the guys
  3: { pos: [1.85, 1.6, 2.92], at: [0.2, 0.85, 1.5], fov: 70 }, // the kitchen side
};
function setView(n) {
  const v = VIEWS[n] ?? VIEWS[1];
  camera.position.set(...v.pos);
  camera.fov = v.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(...v.at);
  orbit.target.set(...v.at);
}
setView(Number(params.get('view')) || 1);

addEventListener('keydown', (e) => {
  const n = { Digit1: 1, Digit2: 2, Digit3: 3 }[e.code];
  if (n) {
    orbit.enabled = false;
    setView(n);
    params.set('view', n);
    history.replaceState(null, '', `?${params}`);
  }
  if (e.code === 'KeyO') orbit.enabled = !orbit.enabled;
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  fx.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- go
let look = null;
let readyIn = Infinity;
let time = 0, last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;
  if (orbit.enabled) orbit.update();
  look?.update(dt, time);
  fx.set(time, 0, 0);
  fx.render();
  if (--readyIn === 0) window.__ready = true;
}
try {
  await build();
  if (STYLE) {
    look = await (await import('./styles/index.js')).applyStyle(STYLE, { scene, renderer, camera, composer: fx.composer });
    if (!look) throw new Error(`no style "${STYLE}"`);
  }
  readyIn = 10;
  frame();
} catch (e) {
  console.error(e);
  window.__error = String(e?.stack ?? e);
  frame();
}
