// Outside the flat: the stairwell down from the landing, the ground-floor lobby, the yard at night
// and the "Продукты 24" kiosk across it. Authored in plan coordinates (like layout.js) and converted
// with planToWorld, so it scales and mirrors with the flat.
//   floor heights: the flat and the landing are at 0, the street is a floor below (STREET)
//   heightAt(x, z): where Oleg's feet are (stairs are smooth ramps for the camera, steps for the eye)
import * as THREE from 'three';
import { H, planToWorld as P, worldToPlan } from './layout.js';
import { mat, boxGeo, worldUV } from './apartment.js';
import * as T from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch, GLASS, cigarettes, pelmeniPack, chipsBag, signText } from './goods.js';

// Khrushchevka stairwell, Oleg on the 2nd floor. Out of his door onto the landing, then towards the
// front of the house: a flight down to the half landing, a flight back to the 1st-floor landing (right
// under his), a short flight down to the entrance door, which is in the front wall — the same side as
// the balcony. The flights zig-zag in two lanes, stacked over each other. The kiosk is right across.
export const STREET = -4.0;
const L1 = -2.8; // 1st floor landing
const SX = [8.5, 10.7], LANE = 9.6; // stairwell inner x; lane A (x < LANE) and lane B
const TOP = [3.0, 3.5], FL = [1.0, 3.0], END = [0.0, 1.0]; // plan z: by his landing, the flights, the front end
const DOOR = [9.0, 10.2]; // the entrance door (plan x) in the front wall
const FRONT = { x0: -3, x1: 16, z0: -14, z1: -0.42 }; // the yard in front of the house
const SHOP = { x0: 6.5, x1: 11, z0: -10.5, z1: -6.5, door: [8.2, 9.4] }; // across the yard, door towards the house

// plan-space box -> world mesh (y in meters, not scaled)
function pbox(group, x0, x1, y0, y1, z0, z1, m, uv) {
  const r = P.rect(x0, x1, z0, z1);
  const g = boxGeo(r.x0, r.x1, y0, y1, r.z0, r.z1);
  if (uv) worldUV(g, uv);
  const mesh = new THREE.Mesh(g, m);
  group.add(mesh);
  return mesh;
}

export function buildOutside() {
  const group = new THREE.Group();
  const ceiling = new THREE.Group();
  const colliders = [];
  const wall = (x0, x1, z0, z1, extra = {}) => colliders.push({ ...P.rect(x0, x1, z0, z1), ...extra });

  const paintLow = mat('#3f6b5a', { roughness: 0.9 }); // the classic green stairwell paint
  const paintHigh = mat('#c9c6b8', { roughness: 0.95 });
  const concrete = new THREE.MeshStandardMaterial({ map: T.concrete(), roughness: 1 });
  const stepMat = mat('#8a8378', { roughness: 0.95 });
  const railMat = mat('#2a2a2a', { metalness: 0.4, roughness: 0.6 });

  // ---- stairwell walls (from the street level up to the ceiling)
  const sw = (x0, x1, z0, z1, extra = {}) => {
    pbox(group, x0, x1, STREET, -1.1, z0, z1, paintLow);
    pbox(group, x0, x1, -1.1, H, z0, z1, paintHigh);
    wall(x0, x1, z0, z1, extra);
  };
  sw(10.7, 10.9, 0, TOP[1]); // the outer side wall, behind the front wall (overlapping boxes flicker)
  // against the flat: above its floor the flat's own wall is there already (two walls in one place flicker)
  pbox(group, 8.3, 8.5, STREET, -1.1, END[0], TOP[1], paintLow);
  pbox(group, 8.3, 8.5, -1.1, 0, END[0], TOP[1], paintHigh);
  wall(8.3, 8.5, END[0], TOP[1]);
  // the front wall with the entrance door at the bottom
  const facade = new THREE.MeshStandardMaterial({ map: T.concrete(), color: '#8f8a80', roughness: 1 });
  for (const [x0, x1] of [[8.5, DOOR[0]], [DOOR[1], 10.9]]) { // from the flat's corner on
    pbox(group, x0, x1, STREET, H + 0.4, -0.42, 0, facade, 1);
    wall(x0, x1, -0.42, 0);
  }
  pbox(group, DOOR[0], DOOR[1], STREET + 2.1, H + 0.4, -0.42, 0, facade, 1);
  wall(DOOR[0], DOOR[1], -0.42, 0, { floor: [-3.4, 9] }); // a door only down at the street
  pbox(group, DOOR[0] - 0.75, DOOR[0], STREET, STREET + 2.05, -0.55, -0.45, mat('#5a3a24')); // the door leaf, open out
  pbox(group, DOOR[0] - 0.3, DOOR[1] + 0.3, STREET + 2.3, STREET + 2.4, -1.1, -0.42, mat('#5b5752')); // canopy
  ceiling.add(pbox(new THREE.Group(), 8.5, 10.9, H, H + 0.15, 0, TOP[1], mat('#bdb9ad'))); // behind the front wall, not in its face

  // ---- stairs: steps you see, a ramp the camera follows (heightAt)
  // steps and slabs go 3 cm into the side walls: an end face lying exactly on a wall face flickers in stripes
  const IN = 0.03;
  const lane = (a) => (a ? [SX[0] - IN, LANE - 0.05] : [LANE + 0.05, SX[1] + IN]);
  // from z0 (height y0) to z1 (height y1)
  const flight = (laneA, z0, z1, y0, y1, n) => {
    const [x0, x1] = lane(laneA);
    for (let k = 0; k < n; k++) {
      const a = z0 + ((z1 - z0) * k) / n, b = z0 + ((z1 - z0) * (k + 1)) / n;
      const top = y0 + ((y1 - y0) * (k + 1)) / n;
      pbox(group, x0, x1, top - 0.3, top, Math.min(a, b), Math.max(a, b), stepMat);
    }
  };
  const slab = (z0, z1, y) => pbox(group, SX[0] - IN, SX[1] + IN, y - 0.25, y, z0, z1, concrete, 1);
  slab(TOP[0], TOP[1], 0); // his landing
  flight(true, FL[1], FL[0], 0, -1.4, 10); // towards the front, down to the half landing
  slab(END[0] - IN, END[1], -1.4); // into the front wall, same reason
  flight(false, FL[0], FL[1], -1.4, L1, 10); // back to the 1st floor
  slab(TOP[0], TOP[1], L1);
  flight(true, FL[1], FL[0], L1, STREET, 8); // the short one down to the door
  pbox(group, SX[0] - IN, SX[1] + IN, STREET - 0.2, STREET, END[0] - IN, END[1], new THREE.MeshStandardMaterial({ map: T.floorTile(), roughness: 0.8 }), 1);
  // balusters and a hand rail along each flight (the collider stops you hopping between flights)
  wall(LANE - 0.05, LANE + 0.05, FL[0], FL[1]);
  for (const [y0, y1] of [[-1.4, 0], [-1.4, L1], [STREET, L1]]) { // height at FL[0] .. at FL[1]
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const z = FL[0] + ((FL[1] - FL[0]) * k) / n, y = y0 + ((y1 - y0) * k) / n;
      pbox(group, LANE - 0.015, LANE + 0.015, y, y + 0.9, z - 0.015, z + 0.015, railMat);
    }
    const a = P.pt(LANE, FL[0]), b2 = P.pt(LANE, FL[1]);
    const len = Math.hypot(b2[0] - a[0], b2[1] - a[1], y1 - y0);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, len), mat('#5a3a24'));
    rail.position.set((a[0] + b2[0]) / 2, (y0 + y1) / 2 + 0.92, (a[1] + b2[1]) / 2);
    rail.lookAt(b2[0], y1 + 0.92, b2[1]);
    group.add(rail);
  }
  // drops you can't walk off: his landing over the 2nd flight; the 1st-floor landing back up into his doorway
  wall(LANE, SX[1], FL[1] - 0.03, FL[1] + 0.03, { floor: [-0.7, 9] });
  wall(SX[0], SX[1], 3.45, 3.56, { floor: [-9, -0.7] });
  // under the 2nd flight at the bottom: no headroom
  wall(LANE, SX[1], FL[0], TOP[1], { floor: [-9, -3.4] });
  // the neighbours' door on the 1st floor
  pbox(group, 10.66, 10.7, L1, L1 + 2.0, TOP[0] - 0.4, TOP[0] + 0.4, mat('#6a4a2e'));
  // the building under the stairwell, so it doesn't float in the dollhouse view
  pbox(group, 8.3, 10.9, -9, STREET - 0.2, -0.42, TOP[1], mat('#3a3834'));
  for (const [z, y] of [[0.5, -0.4], [3.2, L1 + 1.6]]) {
    const l = new THREE.PointLight('#d8f0c8', 4, 9, 1.5);
    l.userData.zone = 'out';
    const [lx0, lz0] = P.pt(9.6, z);
    l.position.set(lx0, y, lz0);
    group.add(l);
  }

  // ---- the yard in front of the house
  pbox(group, FRONT.x0, FRONT.x1, STREET - 0.3, STREET, FRONT.z0, FRONT.z1, mat('#2b2c2e', { roughness: 1 }));
  pbox(group, FRONT.x0, FRONT.x1, STREET, STREET + 0.06, -1.9, FRONT.z1, mat('#55534f', { roughness: 1 })); // sidewalk
  pbox(group, -0.4, 8.5, STREET, -0.25, -0.5, -0.42, facade, 1); // the house below the flat's windows, up to the stairwell
  wall(-0.4, 8.3, -0.5, -0.42, { floor: [-9, -2] }); // street level only (the balcony door is right above)
  const fence = mat('#3b4a3a', { metalness: 0.3 });
  for (const [x0, x1, z0, z1, streetOnly] of [
    [FRONT.x0, FRONT.x1, FRONT.z0 - 0.1, FRONT.z0],
    [FRONT.x0 - 0.1, FRONT.x0, FRONT.z0, FRONT.z1],
    [FRONT.x1, FRONT.x1 + 0.1, FRONT.z0, FRONT.z1],
    [FRONT.x0, -0.4, FRONT.z1 - 0.08, FRONT.z1 + 0.05, true],
    [10.9, FRONT.x1, FRONT.z1 - 0.08, FRONT.z1 + 0.05, true],
  ]) {
    pbox(group, x0, x1, STREET, STREET + 1.1, z0, z1, fence);
    wall(x0, x1, z0, z1, streetOnly ? { floor: [-9, -2] } : {});
  }
  for (const [x, z] of [[2, -3.2], [12.5, -3.2]]) {
    pbox(group, x - 0.06, x + 0.06, STREET, STREET + 4.2, z - 0.06, z + 0.06, railMat);
    pbox(group, x - 0.25, x + 0.25, STREET + 4.1, STREET + 4.25, z - 0.15, z + 0.15, new THREE.MeshBasicMaterial({ color: '#ffd59a' }));
    const l = new THREE.PointLight('#ffb866', 18, 10, 1.4); // short range: no shadows, so it must not reach into the flat
    l.userData.zone = 'out';
    const [wx, wz] = P.pt(x, z);
    l.position.set(wx, STREET + 4, wz);
    group.add(l);
    const halo = T.glowSprite('#ffc27a', 1.6);
    halo.position.set(wx, STREET + 4.05, wz);
    group.add(halo);
  }
  const car = mat('#7a2d22', { roughness: 0.5, metalness: 0.2 });
  pbox(group, 1.2, 2.5, STREET + 0.25, STREET + 0.95, -10, -6.4, car);
  pbox(group, 1.3, 2.4, STREET + 0.95, STREET + 1.45, -9.1, -7.4, car);
  pbox(group, 1.25, 2.45, STREET + 1.0, STREET + 1.4, -9.05, -7.45, new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.1 }));
  for (const [x, z] of [[1.2, -9.4], [2.5, -9.4], [1.2, -7.0], [2.5, -7.0]]) pbox(group, x - 0.08, x + 0.08, STREET, STREET + 0.45, z - 0.3, z + 0.3, mat('#111'));
  wall(1.2, 2.5, -10, -6.4);
  pbox(group, 3.5, 5.2, STREET + 0.4, STREET + 0.48, -4.2, -3.8, mat('#6b4a2c')); // bench
  pbox(group, 13.5, 14.3, STREET, STREET + 1.1, -3, -1.6, mat('#3d5a3a')); // trash bins
  wall(13.5, 14.3, -3, -1.6);

  // ---- the kiosk "Продукты 24" (door towards the house)
  const S = SHOP, cx = (S.x0 + S.x1) / 2;
  const kiosk = mat('#d9d4c7', { roughness: 0.9 });
  const kw = (x0, x1, z0, z1) => {
    pbox(group, x0, x1, STREET, STREET + 2.6, z0, z1, kiosk);
    wall(x0, x1, z0, z1);
  };
  kw(S.x0, S.door[0], S.z1 - 0.15, S.z1);
  kw(S.door[1], S.x1, S.z1 - 0.15, S.z1);
  pbox(group, S.door[0], S.door[1], STREET + 2.1, STREET + 2.6, S.z1 - 0.15, S.z1, kiosk);
  kw(S.x0, S.x1, S.z0, S.z0 + 0.15);
  kw(S.x0, S.x0 + 0.15, S.z0, S.z1);
  kw(S.x1 - 0.15, S.x1, S.z0, S.z1);
  pbox(group, S.x0, S.x1, STREET + 2.6, STREET + 2.75, S.z0, S.z1, mat('#d4d2cc', { emissive: '#5c5c58' })); // lit by the tubes right under it
  const tube = new THREE.MeshBasicMaterial({ color: '#f4fbff', toneMapped: false }); // the fluorescent tubes of every 24/7 shop
  for (const tx of [S.x0 + 1.4, S.x1 - 1.4]) pbox(group, tx - 0.04, tx + 0.04, STREET + 2.54, STREET + 2.6, S.z0 + 0.9, S.z1 - 0.9, tube);
  pbox(group, S.x0 + 0.15, S.x1 - 0.15, STREET, STREET + 0.01, S.z0 + 0.15, S.z1 - 0.15, new THREE.MeshStandardMaterial({ map: T.floorTile(), roughness: 0.8 }), 1);
  const sign = document.createElement('canvas');
  sign.width = 512;
  sign.height = 96;
  const sg = sign.getContext('2d');
  sg.fillStyle = '#0d3b2a';
  sg.fillRect(0, 0, 512, 96);
  sg.fillStyle = '#7dffb0';
  sg.font = '900 60px Arial';
  sg.textAlign = 'center';
  sg.textBaseline = 'middle';
  sg.fillText('ПРОДУКТЫ 24', 256, 50);
  const signTex = new THREE.CanvasTexture(sign);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false, side: THREE.DoubleSide });
  const [sx, sz] = P.pt((S.door[0] + S.door[1]) / 2, S.z1 + 0.02);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(P.len(2.6), 0.5), signMat);
  front.position.set(sx, STREET + 2.35, sz);
  front.lookAt(sx, STREET + 2.35, sz + 5);
  group.add(front);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(P.len(3.4), 0.8), signMat);
  const [rx, rz] = P.pt(cx, S.z1 - 0.3);
  roof.position.set(rx, STREET + 3.25, rz);
  roof.lookAt(rx, STREET + 3.9, rz + 5); // tipped up towards the windows
  group.add(roof);
  const shopLight = new THREE.PointLight('#f4f8ff', 6, 10, 1.2);
  shopLight.userData.zone = 'out';
  const [lx, lz] = P.pt(cx, (S.z0 + S.z1) / 2);
  shopLight.position.set(lx, STREET + 2.3, lz);
  group.add(shopLight);
  // counter across the back, the cashier behind it
  pbox(group, S.x0 + 0.6, S.x1 - 0.6, STREET, STREET + 1.0, S.z0 + 1.0, S.z0 + 1.4, mat('#7a5a3a'));
  pbox(group, S.x0 + 0.55, S.x1 - 0.55, STREET + 1.0, STREET + 1.05, S.z0 + 0.95, S.z0 + 1.45, mat('#c9b48a'));
  wall(S.x0 + 0.6, S.x1 - 0.6, S.z0 + 1.0, S.z0 + 1.4);
  const shelves = [];
  const MATS = {
    clear: GLASS.clear(), brown: GLASS.brown(), green: GLASS.green(), amber: GLASS.amber(), cap: GLASS.cap(),
    paper: mat('#ece6d6', { roughness: 0.9 }), gold: mat('#c9a23a', { roughness: 0.6 }), red: mat('#a8202a', { roughness: 0.7 }), blue: mat('#2a4a8a', { roughness: 0.7 }),
    pelmeni: new THREE.MeshStandardMaterial({ map: pelmeniPack(), roughness: 0.6 }),
    chips: new THREE.MeshStandardMaterial({ map: chipsBag(), roughness: 0.45 }),
  };
  const addBatch = (parent, batch) => {
    for (const [key, geos] of batch.parts) parent.add(new THREE.Mesh(mergeGeometries(geos), MATS[key]));
  };
  const rack = mat('#5a524a', { roughness: 0.8 });
  // open shelving against a side wall: back panel, ends, four boards, the goods standing on them
  const shelf = (id, x0, x1, z0, z1, label) => {
    const unit = new THREE.Group();
    const wallSide = x0 < cx ? 'lo' : 'hi'; // which plan-x end is against the shop wall
    const [bx0, bx1] = wallSide === 'lo' ? [x0, x0 + 0.03] : [x1 - 0.03, x1];
    pbox(unit, bx0, bx1, STREET, STREET + 1.9, z0, z1, rack);
    pbox(unit, x0, x1, STREET, STREET + 1.9, z0, z0 + 0.03, rack);
    pbox(unit, x0, x1, STREET, STREET + 1.9, z1 - 0.03, z1, rack);
    const boards = [0.06, 0.48, 0.9, 1.32];
    for (const y of boards) pbox(unit, x0, x1, STREET + y - 0.03, STREET + y, z0, z1, rack);
    pbox(unit, x0, x1, STREET + 1.87, STREET + 1.9, z0, z1, rack);
    wall(x0, x1, z0, z1);
    const goods = new THREE.Group();
    const batch = new Batch();
    const a = P.pt((x0 + x1) / 2, z0 + 0.06), b = P.pt((x0 + x1) / 2, z1 - 0.06);
    const depth = P.len(x1 - x0);
    boards.forEach((by, row) => {
      const y = STREET + by;
      if (id === 'beer' || id === 'vodka') {
        const kind = id === 'beer' ? 'beer' : row === 3 ? 'cognac' : 'vodka';
        const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / (kind === 'cognac' ? 0.11 : 0.085));
        for (let k = 0; k <= n; k++) {
          for (const d of [-0.22, 0.12]) { // two deep
            const t = k / n, x = a[0] + (b[0] - a[0]) * t + d * depth * (wallSide === 'lo' ? -1 : 1) * 0.5, z = a[1] + (b[1] - a[1]) * t;
            if (kind === 'beer') batch.bottle('beer', (k + row) % 3 ? 'brown' : 'green', (k + row) % 3 ? 'gold' : 'red', x, y, z);
            else batch.bottle(kind, kind === 'cognac' ? 'amber' : 'clear', kind === 'cognac' ? 'gold' : 'paper', x, y, z);
          }
        }
      } else {
        const bag = id === 'chips';
        const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.19);
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          const h = bag ? 0.26 : 0.22;
          // the wide printed side faces the aisle (along the shelf = world z)
          const g = new THREE.BoxGeometry(bag ? 0.07 : 0.05, h, 0.16).translate(x, y + h / 2, z);
          batch.put(bag ? 'chips' : 'pelmeni', g);
        }
      }
    });
    addBatch(goods, batch);
    unit.add(goods);
    group.add(unit);
    shelves.push({ id, label, mesh: unit, goods });
  };
  const zm = S.z0 + 2.65; // shelves along the side walls, by the door half
  shelf('beer', S.x0 + 0.15, S.x0 + 0.55, zm - 0.85, zm, 'Пиво');
  shelf('vodka', S.x0 + 0.15, S.x0 + 0.55, zm, zm + 0.85, 'Водка');
  shelf('pelmeni', S.x1 - 0.55, S.x1 - 0.15, zm - 0.85, zm, 'Пельмени');
  shelf('chips', S.x1 - 0.55, S.x1 - 0.15, zm, zm + 0.85, 'Сухарики');
  // behind the cashier: bottles on the two lower boards, the cigarette wall above, an "18+" sign on top
  pbox(group, S.x0 + 0.3, S.x1 - 0.3, STREET, STREET + 2.2, S.z0 + 0.15, S.z0 + 0.55, mat('#3a332d'));
  const back = new Batch();
  const fz = S.z0 + 0.62; // bottle row line, on the boards
  for (let row = 0; row < 2; row++) {
    pbox(group, S.x0 + 0.3, S.x1 - 0.3, STREET + 0.4 + row * 0.38, STREET + 0.43 + row * 0.38, S.z0 + 0.15, S.z0 + 0.7, mat('#4a4038'));
    const y = STREET + 0.43 + row * 0.38;
    for (let x = S.x0 + 0.42; x < S.x1 - 0.38; x += row ? 0.09 : 0.075) {
      const [wx, wz] = P.pt(x, fz);
      const i = Math.round(x * 100);
      if (row === 0) back.bottle('beer', i % 3 ? 'brown' : 'green', i % 4 ? 'gold' : 'blue', wx, y, wz);
      else if (i % 5 === 0) back.bottle('cognac', 'amber', 'gold', wx, y, wz);
      else back.bottle('vodka', 'clear', i % 3 ? 'paper' : 'red', wx, y, wz);
    }
  }
  addBatch(group, back);
  // cigarettes: three printed rows on the upper part of the unit, each on its own little board
  const cw = P.len(S.x1 - 0.6 - (S.x0 + 0.6));
  for (let row = 0; row < 3; row++) {
    const y = STREET + 1.22 + row * 0.32;
    pbox(group, S.x0 + 0.3, S.x1 - 0.3, y - 0.03, y, S.z0 + 0.15, S.z0 + 0.62, mat('#4a4038'));
    const t = cigarettes(row);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.x = cw / 1.28; // a pack is ~5.5 cm wide: 22 px of the 512 px strip
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(cw, 0.28), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    const [px, pz] = P.pt(cx, S.z0 + 0.56);
    plane.position.set(px, y + 0.14, pz);
    group.add(plane);
  }
  const sign18 = new THREE.Mesh(new THREE.PlaneGeometry(P.len(2.2), 0.22), new THREE.MeshBasicMaterial({ map: signText('ТАБАК · АЛКОГОЛЬ · 18+'), toneMapped: false }));
  const [s18x, s18z] = P.pt(cx, S.z0 + 0.56);
  sign18.position.set(s18x, STREET + 2.3, s18z);
  group.add(sign18);
  const shopDoor = { ...P.rect(S.door[0], S.door[1], S.z1 - 0.2, S.z1 + 0.05), enabled: false };
  colliders.push(shopDoor);
  const cashier = P.pt(cx, S.z0 + 0.75);

  // where Oleg's feet are. In the stairwell several floors are stacked over the same spot: take the one
  // closest to where his feet already are (you can only get to a level by walking onto it)
  function heightAt(x, z, cur = 0) {
    const [px, pz] = worldToPlan(x, z);
    const onBalcony = px > 2.3 && px < 5.6 && pz > -1.3 && pz < -0.42; // the balcony is the flat's floor
    if (pz < FRONT.z1 && !onBalcony) return STREET;
    if (px < SX[0] - 0.2 || px > SX[1] + 0.25 || pz >= TOP[1] || pz < -0.42) return 0;
    const t = (FL[1] - pz) / (FL[1] - FL[0]); // 0 by his landing .. 1 at the front end
    let cands;
    if (pz >= TOP[0]) cands = [0, L1];
    else if (pz < END[1]) cands = [-1.4, STREET];
    else if (px < LANE) cands = [-1.4 * t, L1 + (STREET - L1) * t];
    else cands = [L1 + 1.4 * t];
    return cands.reduce((b, h) => (Math.abs(h - cur) < Math.abs(b - cur) ? h : b));
  }

  function zoneName(x, z) {
    const [px, pz] = worldToPlan(x, z);
    if (px > S.x0 && px < S.x1 && pz > S.z0 && pz < S.z1) return 'Продукты 24';
    if (pz < -1.3 || (pz < FRONT.z1 && !(px > 2.3 && px < 5.6))) return 'Двор';
    if (px >= SX[0] - 0.2 && px <= SX[1] + 0.25 && pz >= -0.42 && pz < TOP[1]) return 'Подъезд';
    return null;
  }

  return { group, ceiling, colliders, heightAt, zoneName, shelves, shopDoor, cashier, inShop: (x, z) => zoneName(x, z) === 'Продукты 24' };
}
