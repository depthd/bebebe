// Photos on the walls. What Oleg snaps with C (game.takePhoto) is kept in an album that outlives the night (and
// the page: small JPEGs in localStorage), and from the next night on it hangs in the flat as polaroids: pinned to the
// living-room wall, under magnets on the fridge, taped up by the front door and next to the PC. In the story they
// are the evidence: every one of them says 30.09.
import * as THREE from 'three';
import { planToWorld, mfacing, FURNITURE, mx } from './layout.js';

const KEY = 'oleg.album';
const MAX = 15; // photos kept (the oldest go first), one wall spot each
const THUMB = 256; // px, the stored JPEG's width
const TEX = [256, 224]; // the polaroid: the 16:10 picture and a white strip under it for the caption
const PW = 0.2, PH = (PW * TEX[1]) / TEX[0]; // on the wall, metres
const deg = Math.PI / 180;

// Where they hang, in the order they fill up: the first night's three end up all over the flat, and a photo keeps
// its place night after night. A wall spot is on a wall face of the drawing (`z` or `x` in plan coordinates, `at`
// along it, facing as drawn); an item spot is in that furniture's own frame (u along it, v from its back, y up,
// see furniture.js), so it stays put wherever fitFurniture moved the piece. Nothing covers a painting, a door,
// the wall carpet or the PC screen.
const PLACES = [
  { wall: { z: 5.5, facing: '-z' }, at: 3.95, y: 1.62, tilt: -4, hold: 'pin' }, // living room, the empty wall behind the start
  { item: 'fridge', u: 0.18, v: 'front', y: 0.9, tilt: 3, hold: 'magnet' },
  { wall: { z: 4.25, facing: '+z' }, at: 7.8, y: 1.52, tilt: 5, hold: 'tape' }, // hall, next to the front door
  { wall: { z: 5.5, facing: '-z' }, at: 3.72, y: 1.4, tilt: 6, hold: 'pin' },
  { item: 'loftBed', u: 1.31, v: -0.015, y: 1.1, tilt: -5, hold: 'tape' }, // the wall by Oleg's monitor
  { item: 'fridge', u: 0.33, v: 'front', y: 0.62, tilt: -6, hold: 'magnet' },
  { wall: { z: 5.5, facing: '-z' }, at: 4.17, y: 1.42, tilt: -2, hold: 'pin' },
  { wall: { z: 4.25, facing: '+z' }, at: 7.55, y: 1.33, tilt: -4, hold: 'tape' },
  { wall: { x: 2.3, facing: '-x' }, at: 3.0, y: 1.5, tilt: 4, hold: 'pin' }, // bedroom, between the pharaohs and the door
  { wall: { z: 5.5, facing: '-z' }, at: 3.5, y: 1.6, tilt: 3, hold: 'pin' },
  { item: 'fridge', u: 0.2, v: 'front', y: 1.22, tilt: 7, hold: 'magnet' }, // the freezer door, under the badge
  { item: 'loftBed', u: 0.2, v: -0.015, y: 1.06, tilt: 4, hold: 'tape' },
  { wall: { z: 4.25, facing: '+z' }, at: 7.3, y: 1.56, tilt: 3, hold: 'tape' },
  { wall: { z: 5.5, facing: '-z' }, at: 4.39, y: 1.63, tilt: -6, hold: 'pin' },
  { wall: { x: 2.3, facing: '-x' }, at: 3.3, y: 1.34, tilt: -5, hold: 'pin' },
];

const NORMAL = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };

// a spot -> a point on the surface (world) and the way out of it
function resolve(s) {
  if (s.wall) {
    const { x, z, facing } = s.wall;
    const [wx, wz] = planToWorld.pt(x ?? s.at, z ?? s.at);
    return { pos: new THREE.Vector3(wx, s.y, wz), normal: new THREE.Vector3(...NORMAL[mfacing(facing)]) };
  }
  // furniture.js framer(): local (u, v) -> plan -> world
  const it = FURNITURE.find((f) => f.id === s.item), q = it.plan, facing = q.facing ?? '-z';
  const zFacing = facing === '+z' || facing === '-z';
  const v = s.v === 'front' ? (zFacing ? q.z1 - q.z0 : q.x1 - q.x0) : s.v;
  const [px, pz] = { '-z': [q.x0 + s.u, q.z1 - v], '+z': [q.x0 + s.u, q.z0 + v], '+x': [q.x0 + v, q.z0 + s.u], '-x': [q.x1 - v, q.z0 + s.u] }[facing];
  return { pos: new THREE.Vector3(mx(px), s.y, pz), normal: new THREE.Vector3(...NORMAL[mfacing(facing)]) };
}
const SPOTS = PLACES.map((s) => ({ ...s, ...resolve(s), tilt: s.tilt * deg }));

// ---------- the album (in the browser: a reload keeps it; private windows and full storage just forget) ----------

function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(a) ? a.filter((p) => typeof p?.img === 'string' && p.img.startsWith('data:image/')).slice(-MAX) : [];
  } catch {
    return [];
  }
}
function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* no room or no storage: the album lives until the page does */
  }
}

// the frame as a smaller JPEG for keeping
function shrink(src, done) {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.min(THUMB, im.width);
    c.height = Math.round((c.width * im.height) / im.width);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    try {
      done(c.toDataURL('image/jpeg', 0.72));
    } catch {
      done(src);
    }
  };
  im.onerror = () => done(src);
  im.src = src;
}

// ---------- the polaroids ----------

// shared by every photo: the plane, the soft shadow under it, what holds it up
let parts = null;
function shared() {
  if (parts) return parts;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(0,0,0,1)';
  g.shadowBlur = 7;
  g.fillStyle = '#000';
  g.fillRect(9, 9, 46, 46);
  const shadowTex = new THREE.CanvasTexture(c);
  const m = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, ...o });
  parts = {
    plane: new THREE.PlaneGeometry(PW, PH),
    shadowGeo: new THREE.PlaneGeometry(PW * 1.22, PH * 1.26),
    shadow: new THREE.MeshBasicMaterial({ map: shadowTex, color: '#000', transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    pin: new THREE.SphereGeometry(0.0075, 12, 8).scale(1, 1, 0.75),
    magnet: new THREE.CylinderGeometry(0.012, 0.012, 0.007, 18).rotateX(Math.PI / 2),
    tape: new THREE.PlaneGeometry(0.058, 0.019),
    tapeMat: m('#f3ecd2', { transparent: true, opacity: 0.62, roughness: 0.35, depthWrite: false }),
    colors: ['#d8382c', '#2f6fd0', '#f0c419', '#3fa357'].map((c) => m(c, { roughness: 0.3, metalness: 0.1 })),
  };
  return parts;
}

// the paper: the picture, the caption in ballpoint, the date in the corner
function draw(g, p, img) {
  const [w, h] = TEX, pad = 13, pw = w - 2 * pad, ph = Math.round(pw / 1.6);
  g.fillStyle = '#f3efe4';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1d1c22';
  g.fillRect(pad, pad, pw, ph);
  if (img) {
    // the stored frame is 16:10 too; anything else is cropped to fit
    const s = Math.max(pw / img.width, ph / img.height), sw = pw / s, sh = ph / s;
    g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, pad, pad, pw, ph);
  }
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.strokeRect(pad + 0.5, pad + 0.5, pw - 1, ph - 1);
  g.fillStyle = '#27347c';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  let size = 23;
  do g.font = `italic ${size}px "PT Sans", sans-serif`;
  while (g.measureText(p.caption).width > pw - 6 && --size > 11);
  g.fillText(p.caption, pad + 2, pad + ph + 23);
  g.font = 'italic 17px "PT Sans", sans-serif';
  g.textAlign = 'right';
  g.fillText(p.date ?? '', w - pad, h - 15);
}

function polaroid(p, spot, i) {
  const P = shared();
  const root = new THREE.Group();
  root.position.copy(spot.pos).addScaledVector(spot.normal, 0.004);
  root.lookAt(root.position.clone().add(spot.normal));
  root.rotateZ(spot.tilt);
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = TEX;
  const g = canvas.getContext('2d');
  draw(g, p, null);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const im = new Image();
  im.onload = () => {
    draw(g, p, im);
    tex.needsUpdate = true;
  };
  im.src = p.img;
  const pic = new THREE.Mesh(P.plane, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  pic.position.z = 0.0015;
  pic.userData.target = { name: 'Фото', info: () => [p.caption, p.date].filter(Boolean).join(' · ') };
  const shadow = new THREE.Mesh(P.shadowGeo, P.shadow);
  shadow.position.set(0.004, -0.006, -0.0025);
  root.add(shadow, pic);
  // what holds it: a pin or a magnet near the top edge, or a strip of tape over it
  const top = PH / 2;
  if (spot.hold === 'tape') {
    const t = new THREE.Mesh(P.tape, P.tapeMat);
    t.position.set(((i % 3) - 1) * 0.012, top - 0.002, 0.0028);
    t.rotation.z = ((i % 2) * 2 - 1) * 0.12;
    root.add(t);
  } else {
    const k = new THREE.Mesh(spot.hold === 'magnet' ? P.magnet : P.pin, P.colors[i % P.colors.length]);
    k.position.set(0, top - 0.014, spot.hold === 'magnet' ? 0.005 : 0.006);
    root.add(k);
  }
  root.userData.dispose = () => {
    tex.dispose();
    pic.material.dispose();
  };
  return root;
}

// the album and the photos on the walls; `album` is what hung up when this night began (the earlier nights' photos,
// oldest first: { img, caption, night, date }), tonight's go up next night
export function createPhotoWall() {
  const group = new THREE.Group();
  group.name = 'photowall';
  const kept = load();
  let album = [];
  return {
    group,
    get album() {
      return album;
    },
    // a photo just taken: kept (and stored, smaller), on a wall from the next night on
    add(p) {
      const entry = { img: p.img, caption: p.caption, night: p.night, date: p.date };
      kept.push(entry);
      if (kept.length > MAX) kept.splice(0, kept.length - MAX);
      shrink(p.img, (small) => {
        entry.img = small;
        save(kept);
      });
    },
    // a night begins: everything kept so far goes up
    hang() {
      for (const o of [...group.children]) {
        o.userData.dispose?.();
        group.remove(o);
      }
      album = kept.slice(-SPOTS.length);
      album.forEach((p, i) => group.add(polaroid(p, SPOTS[i], i)));
    },
  };
}
