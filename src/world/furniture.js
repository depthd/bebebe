// Furniture meshes. Each item is built in its own local frame:
//   u — along the wall it stands against, v — from the wall (back) to the front, y — up.
// Local -> plan coords via `facing`, then plan -> world via mx(), so mirroring just works.
import * as THREE from 'three';
import { FURNITURE, ROOMS, PAINTINGS, H, mx } from './layout.js';
import frogs from '../assets/art/frogs.webp?inline';
import mushrooms from '../assets/art/mushrooms.webp?inline';
import pharaohs from '../assets/art/pharaohs.webp?inline';

const ART = { frogs, mushrooms, pharaohs };
import { boxGeo, mat } from './apartment.js';
import { model, modelSize } from './models.js';
import * as T from './textures.js';

const M = {
  wood: mat('#6b4428', { roughness: 0.6 }),
  darkWood: mat('#3b2416', { roughness: 0.45 }),
  lightWood: mat('#b08a5a', { roughness: 0.6 }),
  white: mat('#f1efe9', { roughness: 0.4 }),
  enamel: mat('#fbfbf7', { roughness: 0.2 }),
  metal: mat('#9aa0a6', { metalness: 0.7, roughness: 0.35 }),
  black: mat('#1a1a1a', { roughness: 0.5 }),
  screen: new THREE.MeshStandardMaterial({ color: '#10223a', emissive: '#3b6fb0', emissiveIntensity: 0.9, roughness: 0.2 }),
  tablecloth: mat('#f4f0e6', { roughness: 0.9 }),
  oilcloth: mat('#c9463d', { roughness: 0.5 }),
  velour: mat('#7a3b2e', { roughness: 0.95 }),
  plaid: mat('#3d5a80', { roughness: 0.95 }),
  blanketOleg: mat('#46607a', { roughness: 0.95 }),
  blanketSister: mat('#d67fa0', { roughness: 0.95 }),
  pillow: mat('#efe9dc', { roughness: 0.95 }),
  glassDoor: mat('#a7c4c9', { roughness: 0.15, metalness: 0.2 }),
  water: new THREE.MeshStandardMaterial({ color: '#9cc9d6', roughness: 0.1, transparent: true, opacity: 0.8 }),
  crystal: mat('#dfe8ee', { roughness: 0.05, metalness: 0.3 }),
  coals: new THREE.MeshStandardMaterial({ color: '#2a1208', emissive: '#ff5a10', emissiveIntensity: 1.5 }),
  rag: mat('#c7b24a', { roughness: 1 }),
};

function framer(item, group) {
  const q = item.plan;
  const facing = q.facing ?? '-z';
  const zFacing = facing === '+z' || facing === '-z';
  const U = zFacing ? q.x1 - q.x0 : q.z1 - q.z0;
  const D = zFacing ? q.z1 - q.z0 : q.x1 - q.x0;
  const toPlan = (u, v) => {
    switch (facing) {
      case '-z': return [q.x0 + u, q.z1 - v];
      case '+z': return [q.x0 + u, q.z0 + v];
      case '+x': return [q.x0 + v, q.z0 + u];
      default: return [q.x1 - v, q.z0 + u]; // '-x'
    }
  };
  const world = (u, v) => {
    const [x, z] = toPlan(u, v);
    return [mx(x), z];
  };
  const add = (geo, material) => {
    const mesh = new THREE.Mesh(geo, material);
    group.add(mesh);
    return mesh;
  };
  return {
    U, D, world, group,
    box(u0, u1, y0, y1, v0, v1, material) {
      const [ax, az] = world(u0, v0), [bx, bz] = world(u1, v1);
      return add(boxGeo(Math.min(ax, bx), Math.max(ax, bx), y0, y1, Math.min(az, bz), Math.max(az, bz)), material);
    },
    cyl(u, v, y0, y1, r0, r1, material, seg = 16) {
      const [x, z] = world(u, v);
      return add(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg).translate(x, (y0 + y1) / 2, z), material);
    },
    sph(u, v, y, r, material) {
      const [x, z] = world(u, v);
      return add(new THREE.SphereGeometry(r, 14, 10).translate(x, y, z), material);
    },
    // a 3D model (world/models.js) standing at (u, v) on height y, its front (+z as built) facing out
    // of the furniture (+v), turned by `turn` radians; h scales it to that height in meters
    model(id, u, v, y, { h, turn = 0 } = {}) {
      const m = model(id);
      const [x, z] = world(u, v), [fx, fz] = world(u, v + 1);
      m.position.set(x, y, z);
      m.rotation.y = Math.atan2(fx - x, fz - z) + turn;
      if (h) m.scale.setScalar(h / modelSize(id).y);
      group.add(m);
      return m;
    },
  };
}

const legs = (f, u0, u1, v0, v1, h, s = 0.04, material = M.wood) => {
  for (const u of [u0, u1 - s]) for (const v of [v0, v1 - s]) f.box(u, u + s, 0, h, v, v + s, material);
};

const BUILD = {
  loftBed(f) {
    const { U, D } = f;
    for (const u of [0, U - 0.05]) for (const v of [0, D - 0.05]) f.box(u, u + 0.05, 0, 1.95, v, v + 0.05, M.lightWood);
    f.box(0, U, 1.45, 1.55, 0, D, M.lightWood);
    f.box(0.05, U - 0.05, 1.55, 1.7, 0.03, D - 0.03, M.pillow);
    f.box(0.4, U - 0.05, 1.7, 1.75, 0.03, D - 0.03, M.blanketSister);
    f.box(0.08, 0.4, 1.7, 1.8, 0.1, D - 0.1, M.pillow);
    f.box(0.05, U - 0.6, 1.8, 1.95, D - 0.04, D, M.lightWood); // guard rail
    for (let y = 0.3; y < 1.5; y += 0.3) f.box(U - 0.45, U - 0.05, y, y + 0.03, D - 0.02, D + 0.02, M.lightWood); // ladder
    // Oleg's desk under it
    f.box(0.1, U - 0.55, 0.72, 0.76, 0.02, 0.65, M.wood);
    f.box(0.1, 0.14, 0, 0.72, 0.02, 0.65, M.wood);
    f.box(U - 0.59, U - 0.55, 0, 0.72, 0.02, 0.65, M.wood);
    // gaming PC: flat monitor (its screen is drawn by src/game/pc.js), RGB tower, gaming chair
    f.box(0.62, 0.78, 0.76, 0.775, 0.12, 0.3, M.black); // stand base
    f.box(0.685, 0.715, 0.775, 0.93, 0.16, 0.19, M.black); // stand neck
    f.box(0.34, 1.06, 0.88, 1.32, 0.19, 0.22, M.black).userData.pcMonitor = true; // bezel, 0.72 x 0.44
    f.box(0.36, 1.04, 0.9, 1.3, 0.22, 0.222, M.screen).userData.pcScreen = true;
    f.box(0.4, 1.0, 0.76, 0.78, 0.4, 0.55, M.black); // keyboard
    f.box(1.08, 1.16, 0.76, 0.775, 0.42, 0.52, M.black); // mouse
    f.box(0.16, 0.38, 0, 0.5, 0.08, 0.55, mat('#1b1d22', { roughness: 0.4 })); // tower
    f.box(0.16, 0.38, 0.05, 0.45, 0.55, 0.552, mat('#7a2cff', { emissive: '#7a2cff', emissiveIntensity: 1.2 })); // RGB strip
    f.box(0.55, 0.95, 0.42, 0.47, 0.8, 1.2, M.black).userData.pcChair = true; // chair
    f.box(0.55, 0.95, 0.47, 0.95, 1.18, 1.22, M.black);
    f.cyl(0.75, 1.0, 0, 0.42, 0.03, 0.03, M.metal);
  },
  sisterDesk(f) {
    const { U, D } = f;
    f.box(0, U, 0.72, 0.76, 0, D, M.lightWood);
    legs(f, 0, U, 0, D, 0.72, 0.04, M.lightWood);
    f.box(0.2, 0.55, 0.76, 0.79, 0.15, 0.45, M.blanketSister); // notebook
    f.model('desk_lamp_arm_01', U - 0.16, 0.1, 0.76, { h: 0.45, turn: Math.PI - 0.5 }); // the arm reaches over the desk, not into the picture
    f.model('alarm_clock_01', U - 0.5, 0.1, 0.76, { h: 0.12, turn: 0.3 });
    f.box(0.45, 0.85, 0.42, 0.47, D + 0.1, D + 0.5, M.lightWood); // stool
    f.cyl(0.65, D + 0.3, 0, 0.42, 0.03, 0.03, M.metal);
  },
  olegBed(f) {
    const { U, D } = f;
    f.box(0, U, 0, 0.32, 0, D, M.wood);
    f.box(0.03, U - 0.03, 0.32, 0.45, 0.03, D - 0.03, M.pillow);
    f.box(0.5, U - 0.03, 0.45, 0.5, 0.02, D - 0.02, M.blanketOleg);
    f.box(0.06, 0.45, 0.45, 0.57, 0.12, D - 0.12, M.pillow);
    f.box(0, 0.05, 0, 0.8, 0, D, M.wood);
    // the legendary wall carpet above the bed
    const carpet = new THREE.MeshStandardMaterial({ map: T.wallCarpet(), roughness: 1 });
    f.box(0.05, U - 0.05, 0.6, 2.1, -0.035, -0.02, carpet);
  },
  sofa(f) {
    const { U, D } = f;
    f.box(0.02, U - 0.02, 0.08, 0.42, 0, D, M.velour);
    f.box(0.12, U - 0.12, 0.42, 0.52, 0.2, D, M.velour);
    f.box(0.02, U - 0.02, 0.42, 0.95, 0, 0.22, M.velour);
    f.box(0, 0.12, 0.42, 0.66, 0, D, M.velour);
    f.box(U - 0.12, U, 0.42, 0.66, 0, D, M.velour);
    f.box(U * 0.55, U - 0.14, 0.52, 0.55, 0.22, D - 0.05, M.plaid);
    legs(f, 0.05, U - 0.05, 0.05, D - 0.05, 0.08, 0.05, M.darkWood);
  },
  partyTable(f) {
    const { U, D } = f;
    f.box(-0.04, U + 0.04, 0.72, 0.76, -0.04, D + 0.04, M.tablecloth);
    for (const [u0, u1, v0, v1] of [[-0.04, U + 0.04, -0.05, -0.04], [-0.04, U + 0.04, D + 0.04, D + 0.05], [-0.05, -0.04, -0.04, D + 0.04], [U + 0.04, U + 0.05, -0.04, D + 0.04]])
      f.box(u0, u1, 0.5, 0.76, v0, v1, M.tablecloth);
    legs(f, 0.05, U - 0.05, 0.05, D - 0.05, 0.72);
    // birthday cake with candles
    f.cyl(U / 2, D / 2, 0.76, 0.86, 0.13, 0.13, mat('#f3d9e6'));
    f.cyl(U / 2, D / 2, 0.86, 0.88, 0.13, 0.11, mat('#b8466b'));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, u = U / 2 + Math.cos(a) * 0.07, v = D / 2 + Math.sin(a) * 0.07;
      f.cyl(u, v, 0.88, 0.95, 0.006, 0.006, mat('#7fb3e0'));
      f.sph(u, v, 0.965, 0.012, new THREE.MeshBasicMaterial({ color: '#ffcf5a' }));
    }
    f.model('russian_food_cans_01', 0.14, D - 0.12, 0.76, { turn: 2.6 }); // sprats and condensed milk
  },
  stenka(f) {
    const { U, D } = f;
    const col = Math.min(0.7, U * 0.3); // glass cabinets on both sides of the TV niche
    f.box(0, U, 0, 0.75, 0, D, M.darkWood);
    f.box(0, U, 1.5, 2.2, 0, D, M.darkWood);
    f.box(0, col, 0.75, 1.5, 0, D, M.darkWood);
    f.box(U - col, U, 0.75, 1.5, 0, D, M.darkWood);
    f.box(col, U - col, 0.75, 1.5, 0, 0.03, M.darkWood);
    // glass doors with soviet crystal
    for (const [u0, u1] of [[0.05, col - 0.05], [U - col + 0.05, U - 0.05]]) {
      f.box(u0, u1, 0.8, 1.45, D, D + 0.01, M.glassDoor);
      for (let k = 0; k < 3; k++) f.cyl(u0 + (u1 - u0) * (0.2 + k * 0.3), D - 0.15, 0.8, 0.95, 0.04, 0.05, M.crystal, 10);
    }
    for (let k = 0; k < 4; k++) f.box(0.05 + k * (U / 4), (k + 1) * (U / 4) - 0.05, 0.05, 0.7, D, D + 0.01, M.wood);
    // TV in the niche
    f.box(col + 0.05, U - col - 0.05, 0.78, 1.28, 0.05, D - 0.02, mat('#2b2b2b', { roughness: 0.5 }));
    f.box(col + 0.1, U - col - 0.1, 0.83, 1.23, D - 0.02, D - 0.01, M.screen).userData.tvScreen = true; // drawn by src/game/living.js
  },
  ficus(f) {
    f.model('potted_plant_01', f.U / 2, f.D / 2, 0, { h: 1.25, turn: 0.5 });
  },
  fridge(f) {
    const { U, D } = f;
    f.box(0, U, 0, 1.55, 0, D, M.enamel);
    f.box(0.02, U - 0.02, 1.08, 1.09, D, D + 0.005, mat('#c9c6bd'));
    f.box(U - 0.1, U - 0.06, 0.7, 1.0, D, D + 0.04, M.metal);
    f.box(U / 2 - 0.08, U / 2 + 0.08, 1.35, 1.39, D, D + 0.005, M.metal); // "ЗИЛ" badge
  },
  counter(f) {
    const { U, D } = f;
    f.box(0, U, 0, 0.85, 0, D - 0.02, mat('#e7ddc7', { roughness: 0.6 }));
    f.box(-0.01, U + 0.01, 0.85, 0.89, 0, D, M.wood);
    const n = Math.max(2, Math.round(U / 0.45));
    for (let i = 0; i < n; i++) {
      const u0 = (i * U) / n + 0.02, u1 = ((i + 1) * U) / n - 0.02;
      for (const [y0, y1] of [[0.62, 0.8], [0.34, 0.58], [0.06, 0.3]]) {
        f.box(u0, u1, y0, y1, D - 0.02, D, mat('#d8ccb2', { roughness: 0.6 }));
        f.box((u0 + u1) / 2 - 0.05, (u0 + u1) / 2 + 0.05, (y0 + y1) / 2 - 0.01, (y0 + y1) / 2 + 0.01, D, D + 0.02, M.metal);
      }
    }
    // wall cabinets above
    f.box(0, U, 1.5, 2.1, 0, 0.32, mat('#e7ddc7', { roughness: 0.6 }));
    f.model('pot_enamel_01', U * 0.62, 0.2, 0.89, { h: 0.16, turn: 0.3 });
    f.model('jug_01', U * 0.86, 0.17, 0.89, { h: 0.2, turn: -0.5 });
    f.model('russian_food_cans_01', U * 0.8, 0.42, 0.89, { turn: 0.2 });
  },
  microwave(f) {
    const { U, D } = f;
    f.box(0, U, 0.89, 1.16, 0, D, mat('#dcdad4', { roughness: 0.4 }));
    f.box(0.03, U - 0.12, 0.92, 1.13, D, D + 0.005, M.black);
    f.box(U - 0.1, U - 0.03, 1.08, 1.12, D, D + 0.005, new THREE.MeshBasicMaterial({ color: '#4cff7a' }));
  },
  sink(f) {
    const { U, D } = f;
    f.box(0, U, 0, 0.85, 0, D - 0.02, mat('#e7ddc7', { roughness: 0.6 }));
    f.box(-0.01, U + 0.01, 0.85, 0.89, 0, D, M.metal);
    f.box(U / 2 - 0.22, U / 2 + 0.22, 0.87, 0.895, 0.12, D - 0.08, M.black);
    f.cyl(U / 2, 0.06, 0.89, 1.15, 0.015, 0.015, M.metal);
    f.box(U / 2 - 0.01, U / 2 + 0.01, 1.13, 1.15, 0.06, 0.22, M.metal);
  },
  stove(f) {
    const { U, D } = f;
    f.box(0, U, 0, 0.85, 0, D, M.enamel);
    f.box(0, U, 0.85, 0.87, 0, D, M.black);
    for (const [du, dv] of [[0.16, 0.14], [U - 0.16, 0.14], [0.16, D - 0.16], [U - 0.16, D - 0.16]]) f.cyl(du, dv, 0.87, 0.885, 0.08, 0.08, mat('#333'));
    f.box(0.06, U - 0.06, 0.2, 0.65, D, D + 0.01, mat('#2a2a2a', { roughness: 0.2 }));
    f.model('vintage_electric_kettle', 0.17, 0.15, 0.885, { h: 0.24, turn: 0.7 }); // the pelmeni pot takes the middle
  },
  kitchenTable(f) {
    const { U, D } = f;
    f.box(0, U, 0.72, 0.75, 0, D, M.oilcloth);
    legs(f, 0.03, U - 0.03, 0.03, D - 0.03, 0.72);
    f.box(U + 0.1, U + 0.42, 0.42, 0.46, 0.15, 0.47, M.wood);
    f.cyl(U + 0.26, 0.31, 0, 0.42, 0.03, 0.03, M.metal);
    f.box(0.2, 0.52, 0.42, 0.46, D + 0.12, D + 0.44, M.wood);
    f.cyl(0.36, D + 0.28, 0, 0.42, 0.03, 0.03, M.metal);
  },
  tub(f) {
    const { U, D } = f;
    f.box(0.02, U - 0.02, 0, 0.58, 0, D, M.enamel);
    f.box(0.09, U - 0.09, 0.2, 0.585, 0.07, D - 0.07, M.water);
    // shower: mixer above the rim, a vertical rail with a holder, the hand shower hanging on it, a hose
    const u = U - 0.18;
    f.box(u - 0.09, u + 0.09, 0.72, 0.8, -0.005, 0.05, M.metal).userData.mixer = true;
    f.cyl(u - 0.06, 0.07, 0.74, 0.78, 0.02, 0.02, M.metal); // knobs
    f.cyl(u + 0.06, 0.07, 0.74, 0.78, 0.02, 0.02, M.metal);
    f.cyl(u, 0.025, 0.95, 1.95, 0.011, 0.011, M.metal); // rail
    f.box(u - 0.025, u + 0.025, 1.68, 1.72, 0.01, 0.06, M.metal); // holder
    const head = [
      f.cyl(u, 0.055, 1.52, 1.72, 0.017, 0.021, M.metal), // handle
      f.cyl(u, 0.055, 1.72, 1.75, 0.045, 0.04, M.metal), // head
    ];
    for (const m of head) m.userData.showerHead = true; // Oleg can take it (interact.js)
    // hose on the wall: from the mixer down in a loop and up to the handle
    const P = (uu, vv, y) => {
      const [x, z] = f.world(uu, vv);
      return new THREE.Vector3(x, y, z);
    };
    const curve = new THREE.CatmullRomCurve3([P(u, 0.04, 0.72), P(u, 0.09, 0.6), P(u, 0.1, 0.62), P(u, 0.08, 1.0), P(u, 0.055, 1.52)]);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.011, 6, false), mat('#8b9298', { metalness: 0.6, roughness: 0.35 }));
    hose.userData.staticHose = true;
    f.group.add(hose);
  },
  bathSink(f) {
    const { U, D } = f;
    f.cyl(U / 2, 0.2, 0, 0.8, 0.08, 0.06, M.enamel);
    f.box(0.02, U - 0.02, 0.8, 0.9, 0, D - 0.05, M.enamel);
    f.cyl(U / 2, 0.05, 0.9, 1.0, 0.012, 0.012, M.metal);
    f.box(0.05, U - 0.05, 1.2, 1.75, -0.02, -0.01, mat('#c9dde6', { roughness: 0.05, metalness: 0.6 })).userData.mirror = true; // replaced by a real mirror (mirror.js)
    f.box(U - 0.02, U + 0.03, 0.55, 0.85, 0.1, 0.35, M.rag); // the rag hangs here
  },
  toilet(f) {
    const { U } = f;
    f.box(0.1, U - 0.1, 0.4, 0.8, 0, 0.18, M.enamel);
    f.cyl(U / 2, 0.36, 0, 0.4, 0.17, 0.2, M.enamel);
    f.cyl(U / 2, 0.37, 0.4, 0.42, 0.19, 0.19, mat('#d8d3c8'));
    f.cyl(-0.1, 0.1, 0.7, 0.8, 0.05, 0.05, M.white); // paper
  },
  wardrobe(f) {
    const { U, D } = f;
    f.box(0, U, 0, 2.2, 0, D, M.wood);
    f.box(0.02, U / 2 - 0.01, 0.05, 2.15, D, D + 0.01, mat('#c9dde6', { roughness: 0.05, metalness: 0.6 }));
    f.box(U / 2 + 0.01, U - 0.02, 0.05, 2.15, D, D + 0.01, M.darkWood);
    f.box(U / 2 + 0.05, U / 2 + 0.08, 1.0, 1.2, D + 0.01, D + 0.03, M.metal);
    f.model('cardboard_box_01', U * 0.28, D * 0.5, 2.2, { h: 0.3, turn: 0.15 }); // boxes on top, as on every soviet wardrobe
    f.model('cardboard_box_01', U * 0.68, D * 0.45, 2.2, { h: 0.24, turn: -0.25 });
  },
  grill(f) {
    const { U, D } = f;
    for (const [u, v] of [[0.03, 0.03], [U - 0.03, 0.03], [0.03, D - 0.03], [U - 0.03, D - 0.03]]) f.cyl(u, v, 0, 0.55, 0.012, 0.012, M.black, 6);
    f.box(0, U, 0.55, 0.75, 0, D, mat('#2d2d2d', { metalness: 0.6, roughness: 0.6 }));
    const coals = f.box(0.03, U - 0.03, 0.7, 0.72, 0.03, D - 0.03, M.coals);
    coals.userData.coals = true;
    for (let k = 0; k < 4; k++) f.box(0.05 + k * 0.1, 0.07 + k * 0.1, 0.76, 0.78, -0.05, D + 0.05, M.metal);
  },
};

// a Soviet five-horn chandelier (Poly Haven, CC0), hung from the ceiling over the party
function chandelier(group, [x, z]) {
  const c = model('Chandelier_02');
  c.scale.setScalar(0.8);
  c.position.set(x, H, z);
  // lit from the inside: the fabric shades glow in their own colour (brass, darker, barely), the bulbs shine
  c.traverse((o) => {
    for (const m of o.isMesh ? [o.material].flat() : []) {
      if (m.name.endsWith('_bulb')) {
        m.emissive.set('#fff2d0');
        m.emissiveIntensity = 2;
      } else {
        m.emissiveMap = m.map;
        m.emissive.set('#ffd9a0');
        m.emissiveIntensity = 0.6;
      }
    }
  });
  group.add(c);
}

function painting(group, p) {
  const h = p.w * (928 / 1664);
  const n = p.facing === '+x' ? 1 : -1;
  const frame = new THREE.Mesh(boxGeo(0, 0.03, -h / 2 - 0.05, h / 2 + 0.05, -p.w / 2 - 0.05, p.w / 2 + 0.05), M.darkWood);
  frame.position.set(p.x + (n > 0 ? 0.005 : -0.035), p.y, p.z);
  group.add(frame);
  const tex = new THREE.TextureLoader().load(ART[p.img]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(p.w, h).rotateY(n > 0 ? Math.PI / 2 : -Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  pic.position.set(p.x + n * 0.037, p.y, p.z);
  pic.userData.target = { name: 'Картина', info: () => 'С днюхой, Олег' };
  group.add(pic);
}

export function buildFurniture() {
  const group = new THREE.Group();
  const items = {};
  const colliders = [];
  for (const item of FURNITURE) {
    const g = new THREE.Group();
    g.name = item.id;
    const f = framer(item, g);
    BUILD[item.id]?.(f);
    group.add(g);
    items[item.id] = { ...item, group: g };
    if (!item.onTop) colliders.push({ x0: item.x0 + 0.05, x1: item.x1 - 0.05, z0: item.z0 + 0.05, z1: item.z1 - 0.05 });
  }
  for (const p of PAINTINGS) painting(group, p);
  const living = ROOMS.find((r) => r.chandelier);
  if (living) chandelier(group, living.lamp);

  // floor rug in the living room
  // real-size rug centred under the party table
  const t = FURNITURE.find((f) => f.id === 'partyTable');
  const [cx, cz] = [(t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2];
  group.add(new THREE.Mesh(boxGeo(cx - 0.75, cx + 0.75, 0.003, 0.012, cz - 1.4, cz + 1.4), new THREE.MeshStandardMaterial({ map: T.floorRug(), roughness: 1 })));
  return { group, items, colliders };
}
