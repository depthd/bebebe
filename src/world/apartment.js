// Builds the flat's shell from layout.js: floors, walls with openings, wallpaper linings,
// windows, interactive doors, balcony, ceiling, lamps and the night view outside.
import * as THREE from 'three';
import { H, ROOMS, WALLS, DIAG_WALLS, BALCONY, CENTER, BOUNDS, CAT_SPOTS, roomAt } from './layout.js';
import * as T from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';


export const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

// UVs from world position so textures keep real-world scale on any box/plane (geometry baked in world space).
export function worldUV(geo, scale = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) [u, v] = [p.getX(i), -p.getZ(i)];
    else if (ax >= az) [u, v] = [p.getZ(i), p.getY(i)];
    else [u, v] = [p.getX(i), p.getY(i)];
    uv.setXY(i, u * scale, v * scale);
  }
  uv.needsUpdate = true;
  return geo;
}

export function boxGeo(x0, x1, y0, y1, z0, z1) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

const alongX = (w) => w.x1 - w.x0 >= w.z1 - w.z0;

export function buildApartment() {
  const group = new THREE.Group();
  const ceiling = new THREE.Group();
  // colliders: {x0,x1,z0,z1} rects or {seg:[ax,az,bx,bz], r} segments; `enabled: false` switches one off
  const colliders = [];
  const lights = [];
  const doors = {};

  const paint = mat('#d9d2c3');
  const cap = mat('#2b2622');
  const wallMats = [paint, paint, cap, paint, paint, paint]; // top face dark for the dollhouse view
  const m = {
    frame: mat('#e8e4da', { roughness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: '#9fb8d0', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1 }),
    sill: mat('#f0ede6', { roughness: 0.4 }),
    radiator: mat('#e9e4d6', { roughness: 0.5 }),
  };

  // --- base slab (thresholds under door openings)
  const B = BOUNDS;
  // 1 cm in from the stairwell side: a face in the stairwell wall's plane flickers in a stripe along the stairs
  group.add(new THREE.Mesh(boxGeo(B.x0 + 0.01, B.x1, -0.25, 0, B.z0, B.z1), mat('#4a3f36')));

  // --- floors
  const floorMats = {
    parquet: mat('#ffffff', { map: T.parquet(), roughness: 0.6 }),
    linoleum: mat('#ffffff', { map: T.linoleum(), roughness: 0.55 }),
    floorTile: mat('#ffffff', { map: T.floorTile(), roughness: 0.4 }),
    concrete: mat('#ffffff', { map: T.concrete() }),
  };
  for (const room of ROOMS) {
    const geos = room.poly
      ? [polyFloor(room.poly)]
      : room.rects.map((q) => new THREE.PlaneGeometry(q.x1 - q.x0, q.z1 - q.z0).rotateX(-Math.PI / 2).translate((q.x0 + q.x1) / 2, 0.002, (q.z0 + q.z1) / 2));
    for (const geo of geos) group.add(new THREE.Mesh(worldUV(geo), floorMats[room.floor]));
  }

  // --- walls
  for (const w of WALLS) {
    const ax = alongX(w);
    const [s0, s1] = ax ? [w.x0, w.x1] : [w.z0, w.z1];
    const [t0, t1] = ax ? [w.z0, w.z1] : [w.x0, w.x1];
    const toRect = (a, b) => (ax ? { x0: a, x1: b, z0: t0, z1: t1 } : { x0: t0, x1: t1, z0: a, z1: b });
    const pieces = [];
    let cur = s0;
    for (const o of [...w.openings].sort((a, b) => a.at[0] - b.at[0])) {
      if (o.at[0] > cur) pieces.push([cur, o.at[0], 0, H, true]);
      if (o.bottom > 0) pieces.push([o.at[0], o.at[1], 0, o.bottom, true]);
      if (o.top < H) pieces.push([o.at[0], o.at[1], o.top, H, false]);
      cur = o.at[1];
      addOpeningDetails(group, w, o, ax, t0, t1, m, doors, colliders);
    }
    if (cur < s1) pieces.push([cur, s1, 0, H, true]);

    for (const [a, b, y0, y1, solid] of pieces) {
      const q = toRect(a, b);
      group.add(new THREE.Mesh(boxGeo(q.x0, q.x1, y0, y1, q.z0, q.z1), wallMats));
      if (solid) colliders.push(q);
    }
  }

  // --- diagonal walls (bathroom corner) with their door
  const wpMats = {};
  const wpMat = (key) =>
    (wpMats[key] ??= mat('#ffffff', { map: T.wallpapers[key](), roughness: key === 'wallTile' ? 0.3 : 0.9 }));
  for (const d of DIAG_WALLS) buildDiagWall(group, d, wallMats, wpMat, colliders, doors);

  // --- wallpaper / tile linings, per room, only where a real wall face exists
  for (const room of ROOMS) {
    if (!room.wallpaper) continue;
    const material = wpMat(room.wallpaper);
    const scale = room.wallpaper === 'wallTile' ? 1 : 2; // wallpapers are 0.5 m per tile
    const height = room.wainscot ?? H;
    for (const q of room.rects) {
      for (const edge of roomEdges(q)) {
        for (const [a, b, y0, y1] of liningPieces(edge, height)) {
          group.add(new THREE.Mesh(worldUV(liningGeo(edge, a, b, y0, y1), scale), material));
        }
      }
    }
  }

  // --- balcony: slab + railing with a soviet corrugated sheet
  {
    const b = BALCONY;
    group.add(new THREE.Mesh(boxGeo(b.x0, b.x1, -0.14, 0, b.z0, b.z1), mat('#5b5752')));
    const sheet = mat('#6f7d63', { roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    const rail = mat('#2a2a2a', { metalness: 0.5, roughness: 0.5 });
    const t = b.rail;
    const sides = [
      { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z0 + t },
      { x0: b.x0, x1: b.x0 + t, z0: b.z0, z1: b.z1 },
      { x0: b.x1 - t, x1: b.x1, z0: b.z0, z1: b.z1 },
    ];
    for (const s of sides) {
      group.add(new THREE.Mesh(boxGeo(s.x0, s.x1, 0, b.railH - 0.05, s.z0, s.z1), sheet));
      group.add(new THREE.Mesh(boxGeo(s.x0 - 0.01, s.x1 + 0.01, b.railH - 0.05, b.railH, s.z0 - 0.01, s.z1 + 0.01), rail));
      colliders.push(s);
    }
    // glazed balcony: white frames + glass from the railing up to a roof slab
    const top = H - 0.05;
    const frame = mat('#eeeae2', { roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: '#a9c3d6', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide });
    const f = 0.05;
    for (const s of sides) {
      const alongX = s.x1 - s.x0 > s.z1 - s.z0;
      const [a0, a1] = alongX ? [s.x0, s.x1] : [s.z0, s.z1];
      const [c0, c1] = alongX ? [s.z0, s.z1] : [s.x0, s.x1];
      const P = (u0, u1, y0, y1, w0, w1, m) => group.add(new THREE.Mesh(alongX ? boxGeo(u0, u1, y0, y1, w0, w1) : boxGeo(w0, w1, y0, y1, u0, u1), m));
      const n = Math.max(1, Math.round((a1 - a0) / 0.8));
      for (let i = 0; i <= n; i++) {
        const u = a0 + ((a1 - a0) * i) / n;
        P(Math.max(a0, u - f / 2), Math.min(a1, u + f / 2), b.railH, top, c0, c1, frame);
      }
      P(a0, a1, b.railH, b.railH + f, c0, c1, frame);
      P(a0, a1, top - f, top, c0, c1, frame);
      // glass pane by pane; the front pane by the cat's windowsill is the opening sash (living.js), no glass behind it
      const front = alongX && s === sides[0];
      const sashK = front ? Math.max(0, Math.min(n - 1, Math.floor((CAT_SPOTS.catRail.p[0] - a0) / ((a1 - a0) / n)))) : -1;
      for (let i = 0; i < n; i++) {
        if (i === sashK) continue;
        const u0 = a0 + ((a1 - a0) * i) / n, u1 = a0 + ((a1 - a0) * (i + 1)) / n;
        P(u0, u1, b.railH + f, top - f, (c0 + c1) / 2 - 0.005, (c0 + c1) / 2 + 0.005, glass);
      }
    }
    ceiling.add(new THREE.Mesh(boxGeo(b.x0 - 0.05, b.x1 + 0.05, top, top + 0.12, b.z0 - 0.05, b.z1), mat('#8a857c')));
  }

  // --- ceiling (faces down, so it is invisible from above anyway)
  ceiling.add(new THREE.Mesh(new THREE.PlaneGeometry(B.x1 - B.x0, B.z1 - B.z0).rotateX(Math.PI / 2).translate((B.x0 + B.x1) / 2, H, (B.z0 + B.z1) / 2), mat('#efece6')));

  // --- lamps
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#fff2d0' });
  const shadeMat = mat('#c8742f', { side: THREE.DoubleSide, emissive: '#5a2a08', emissiveIntensity: 0.6 });
  for (const room of ROOMS) {
    if (!room.lamp) continue;
    const [x, z] = room.lamp;
    const light = new THREE.PointLight(room.lampColor ?? '#ffd7a0', 9 * (room.lampPower ?? 1), 0, 1.6);
    light.position.set(x, H - 0.45, z);
    light.userData.zone = room.id === 'landing' ? 'out' : 'flat'; // the landing is the stairwell
    group.add(light);
    lights.push(light);
    const halo = T.glowSprite(room.lampColor ?? '#ffd7a0', room.chandelier ? 0.9 : 0.6);
    halo.position.set(x, H - (room.chandelier ? 0.55 : 0.43), z);
    group.add(halo);
    if (room.chandelier) continue; // built in furniture.js
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3), mat('#222'));
    cord.position.set(x, H - 0.15, z);
    ceiling.add(cord);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), bulbMat);
    bulb.position.set(x, H - 0.42, z);
    group.add(bulb);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.16, 16, 1, true), shadeMat);
    shade.position.set(x, H - 0.36, z);
    ceiling.add(shade);
  }

  // --- night outside: yard, panel building across, moonlight
  {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), mat('#101418'));
    ground.position.y = -9;
    group.add(ground);
    const facade = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshBasicMaterial({ map: T.cityFacade() }));
    facade.position.set(4, 6, -32);
    group.add(facade);
    const moon = new THREE.DirectionalLight('#8090c0', 0.35);
    moon.position.set(-6, 12, -10);
    moon.target.position.set(4, 0, 2);
    group.add(moon, moon.target);
    group.add(new THREE.HemisphereLight('#8a94b8', '#2a2018', 0.25));
    // the rest of the building under the flat, so it doesn't float in the dollhouse view
    const mass = mat('#3a3834');
    // its stairwell side stays behind the stairwell's own wall: two faces in one plane flicker in stripes
    group.add(new THREE.Mesh(boxGeo(B.x0 + 0.01, B.x1, -9, -0.25, B.z0, B.z1), mass));
    buildFacade(group, ceiling);
    // stairwell landing slab + mass (the landing is on the entrance side)
    const land = ROOMS.find((r) => r.id === 'landing').rects[0];
    group.add(new THREE.Mesh(boxGeo(land.x0 - 0.2, land.x1 + 0.2, -0.25, 0, land.z0 - 0.2, land.z1 + 0.2), mat('#4a3f36')));
    group.add(new THREE.Mesh(boxGeo(land.x0 - 0.2, land.x1 + 0.2, -9, -0.25, land.z0 - 0.2, land.z1 + 0.2), mass));
  }

  group.add(ceiling);
  return { group, ceiling, colliders, lights, doors };
}

// The rest of the khrushchevka, seen from the yard: a window under and over each of Oleg's,
// some lit, and the neighbours' balconies stacked on his. Floors 3-5 and the roof hang on
// the ceiling group, so the dollhouse view (ceiling hidden) still looks into the flat.
function buildFacade(group, ceiling) {
  const north = WALLS.find((w) => w.id === 'north');
  const FZ = north.z0 - 0.108; // the street facade's face (outside.js puts a 0.08 plan-m skin there)
  const Y = -2.8; // their floor
  const frame = mat('#d9d4c6');
  // everything is merged per (group, material) at the end: hundreds of little boxes, a dozen draw calls
  const buckets = new Map();
  const put = (parent, geo, m) => {
    const key = parent === group ? 0 : 1;
    if (!buckets.has(m)) buckets.set(m, [[], []]);
    buckets.get(m)[key].push(geo);
  };
  const dark = new THREE.MeshBasicMaterial({ color: '#0b0f16' });
  const lit = (seed) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, seed % 2 ? '#e9b56a' : '#d9c79a');
    grad.addColorStop(1, seed % 2 ? '#a8652c' : '#8f7a52');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = seed % 2 ? 'rgba(120,40,30,0.75)' : 'rgba(60,70,90,0.7)'; // curtains
    g.fillRect(0, 0, 14 + (seed % 3) * 4, 64);
    g.fillRect(50 - (seed % 2) * 6, 0, 20, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t });
  };
  let n = 0;
  const windows = (parent, Y) => {
    for (const o of north.openings) {
      const [a, b] = o.at;
      const y0 = Y + (o.kind === 'balcony' ? 0 : o.bottom), y1 = Y + o.top;
      const f = 0.06;
      put(parent, boxGeo(a, b, y0, y1, FZ - 0.005, FZ), [1, 3, 6, 8, 13].includes(n) ? lit(n) : dark);
      for (const [x0, x1, yy0, yy1] of [[a, a + f, y0, y1], [b - f, b, y0, y1], [a, b, y1 - f, y1], [a, b, y0, y0 + f], [(a + b) / 2 - f / 2, (a + b) / 2 + f / 2, y0, y1]]) {
        put(parent, boxGeo(x0, x1, yy0, yy1, FZ - 0.04, FZ), frame);
      }
      if (o.kind !== 'balcony') put(parent, boxGeo(a - 0.05, b + 0.05, y0 - 0.05, y0, FZ - 0.12, FZ), sill);
      n++;
    }
  };
  const sill = mat('#7d7a74');
  // a neighbours' balcony: slab, rail panels, glazing up to the next slab
  const { x0, x1, z0 } = BALCONY;
  const panel = mat('#5f6b5c', { roughness: 0.9 });
  const slab = mat('#7a7670');
  const glass = new THREE.MeshStandardMaterial({ color: '#1a2230', roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.55 });
  const balcony = (parent, Y, top) => {
    put(parent, boxGeo(x0, x1, Y - 0.15, Y, z0, FZ), slab);
    put(parent, boxGeo(x0, x1, Y, Y + 1, z0, z0 + 0.04), panel);
    put(parent, boxGeo(x0, x0 + 0.04, Y, Y + 1, z0, FZ), panel);
    put(parent, boxGeo(x1 - 0.04, x1, Y, Y + 1, z0, FZ), panel);
    put(parent, boxGeo(x0 + 0.04, x1 - 0.04, Y + 1, top, z0 + 0.01, z0 + 0.02), glass);
    const k = Math.round((x1 - x0) / 0.9);
    for (let i = 0; i <= k; i++) {
      const x = x0 + ((x1 - x0) * i) / k;
      put(parent, boxGeo(Math.max(x0, x - 0.03), Math.min(x1, x + 0.03), Y + 1, top, z0, z0 + 0.05), frame);
    }
    put(parent, boxGeo(x0, x1, Y + 1, Y + 1.06, z0 - 0.02, z0 + 0.06), frame);
    put(parent, boxGeo(x0, x1, top - 0.06, top, z0, FZ), frame);
  };
  windows(group, Y);
  balcony(group, Y, -0.3);
  // floors 3-5 over the flat and the stairwell, then a flat roof with a parapet
  const FLOOR = 2.8, top = FLOOR * 4 + 0.3, sx0 = -3.9;
  const wall = new THREE.MeshStandardMaterial({ map: T.concrete(), color: '#8f8a80', roughness: 1 });
  const upper = boxGeo(sx0, BOUNDS.x1, H + 0.02, top, FZ, BOUNDS.z1);
  worldUV(upper, 1);
  put(ceiling, upper, wall);
  put(ceiling, boxGeo(sx0 - 0.05, BOUNDS.x1 + 0.05, top, top + 0.5, FZ - 0.05, BOUNDS.z1), mat('#55524c'));
  for (let f = 1; f <= 3; f++) {
    windows(ceiling, f * FLOOR);
    balcony(ceiling, f * FLOOR, f * FLOOR + FLOOR - 0.3);
  }
  // stairwell windows between the floors
  for (let f = 0; f <= 3; f++) {
    const y = f * FLOOR + 1.4, a = -2.8, b = -1.6;
    if (y < H) continue;
    put(ceiling, boxGeo(a, b, y, y + 1, FZ - 0.005, FZ), f % 2 ? lit(2) : dark);
    put(ceiling, boxGeo((a + b) / 2 - 0.03, (a + b) / 2 + 0.03, y, y + 1, FZ - 0.04, FZ), frame);
  }
  for (const [m, [low, high]] of buckets) {
    if (low.length) group.add(new THREE.Mesh(mergeGeometries(low.map((g) => g.index ? g.toNonIndexed() : g)), m));
    if (high.length) ceiling.add(new THREE.Mesh(mergeGeometries(high.map((g) => g.index ? g.toNonIndexed() : g)), m));
  }
}

function polyFloor(poly) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.002, 0);
}

// Room rect edges with the inward normal
function roomEdges(q) {
  return [
    { axis: 'x', c: q.z0, from: q.x0, to: q.x1, n: +1, face: (w) => Math.abs(w.z1 - q.z0) < 0.02 }, // north
    { axis: 'x', c: q.z1, from: q.x0, to: q.x1, n: -1, face: (w) => Math.abs(w.z0 - q.z1) < 0.02 }, // south
    { axis: 'z', c: q.x0, from: q.z0, to: q.z1, n: +1, face: (w) => Math.abs(w.x1 - q.x0) < 0.02 }, // west
    { axis: 'z', c: q.x1, from: q.z0, to: q.z1, n: -1, face: (w) => Math.abs(w.x0 - q.x1) < 0.02 }, // east
  ];
}

// Pieces [a, b, y0, y1] of lining along an edge: only where walls exist, minus openings.
function liningPieces(edge, height) {
  const out = [];
  for (const w of WALLS) {
    if ((edge.axis === 'x') !== alongX(w) || !edge.face(w)) continue;
    const [s0, s1] = edge.axis === 'x' ? [w.x0, w.x1] : [w.z0, w.z1];
    const a0 = Math.max(s0, edge.from), b0 = Math.min(s1, edge.to);
    if (b0 - a0 < 0.01) continue;
    let cur = a0;
    const ops = w.openings.filter((o) => o.at[1] > a0 && o.at[0] < b0).sort((a, b) => a.at[0] - b.at[0]);
    for (const o of ops) {
      const oa = Math.max(o.at[0], a0), ob = Math.min(o.at[1], b0);
      if (oa > cur) out.push([cur, oa, 0, height]);
      if (o.bottom > 0) out.push([oa, ob, 0, Math.min(o.bottom, height)]);
      if (o.top < height) out.push([oa, ob, o.top, height]);
      cur = ob;
    }
    if (cur < b0) out.push([cur, b0, 0, height]);
  }
  return out;
}

function liningGeo(edge, a, b, y0, y1) {
  const off = 0.004 * edge.n;
  const geo = new THREE.PlaneGeometry(b - a, y1 - y0);
  const mid = (a + b) / 2, ym = (y0 + y1) / 2;
  if (edge.axis === 'x') {
    if (edge.n < 0) geo.rotateY(Math.PI);
    geo.translate(mid, ym, edge.c + off);
  } else {
    geo.rotateY(edge.n > 0 ? Math.PI / 2 : -Math.PI / 2);
    geo.translate(edge.c + off, ym, mid);
  }
  return geo;
}

function buildDiagWall(group, d, wallMats, wpMat, colliders, doors) {
  const [ax, az] = d.a, [bx, bz] = d.b;
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len, uz = (bz - az) / len;
  const ang = Math.atan2(uz, ux);
  const place = (geo) => geo.rotateY(-ang).translate(ax, 0, az);
  const [d0, d1] = d.door.at;
  const t = d.t;

  const pieces = [[0, d0, 0, H], [d1, len, 0, H], [d0, d1, d.door.top, H]].filter(([s0, s1]) => s1 - s0 > 0.05);
  for (const [s0, s1, y0, y1] of pieces) group.add(new THREE.Mesh(place(boxGeo(s0, s1, y0, y1, -t / 2, t / 2)), wallMats));
  for (const [s0, s1] of [[0, d0], [d1, len]].filter(([s0, s1]) => s1 - s0 > 0.05)) {
    colliders.push({ seg: [ax + ux * s0, az + uz * s0, ax + ux * s1, az + uz * s1], r: t / 2 });
  }

  // linings on both sides: local +z side normal in world = (-uz, ux)
  for (const side of [1, -1]) {
    const nx = -uz * side, nz = ux * side;
    const room = roomAt((ax + bx) / 2 + nx * 0.3, (az + bz) / 2 + nz * 0.3);
    if (!room?.wallpaper) continue;
    const height = room.wainscot ?? H;
    const scale = room.wallpaper === 'wallTile' ? 1 : 2;
    const segs = [[0, d0, 0, height], [d1, len, 0, height]].filter(([s0, s1]) => s1 - s0 > 0.05);
    if (height > d.door.top) segs.push([d0, d1, d.door.top, height]);
    for (const [s0, s1, y0, y1] of segs) {
      // turn the back-side strip around BEFORE moving it along the wall, otherwise it lands mirrored
      // on the other side of the corner (it used to stick out into the passage and the living room)
      const geo = new THREE.PlaneGeometry(s1 - s0, y1 - y0);
      if (side < 0) geo.rotateY(Math.PI);
      geo.translate((s0 + s1) / 2, (y0 + y1) / 2, side * (t / 2 + 0.004));
      worldUV(geo, scale);
      group.add(new THREE.Mesh(place(geo), wpMat(room.wallpaper)));
    }
  }

  // the bathroom door
  const hinge = [ax + ux * (d0 + 0.02), az + uz * (d0 + 0.02)];
  const bathSide = [-uz, ux].map((v) => v * (roomAt((ax + bx) / 2 - uz * 0.3, (az + bz) / 2 + ux * 0.3)?.id === 'bath' ? 1 : -1));
  doors.bath = makeDoor(group, colliders, {
    id: 'bath',
    label: 'Дверь в санузел',
    hinge,
    dir: [ux, uz],
    width: d1 - d0 - 0.04,
    height: d.door.top - 0.02,
    openTo: [hinge[0] + bathSide[0] + ux * 0.3, hinge[1] + bathSide[1] + uz * 0.3],
    style: 'interior',
    open: true,
  });
}

// Window frames and glass, radiators, balcony and entrance doors
function addOpeningDetails(group, w, o, ax, t0, t1, m, doors, colliders) {
  const [a, b] = o.at;
  const mid = (t0 + t1) / 2;
  const inside = (ax ? CENTER.z : CENTER.x) > mid ? 1 : -1;
  const innerFace = inside > 0 ? t1 : t0;
  const box = (s0, s1, y0, y1, u0, u1, material) => {
    const g = ax ? boxGeo(s0, s1, y0, y1, Math.min(u0, u1), Math.max(u0, u1)) : boxGeo(Math.min(u0, u1), Math.max(u0, u1), y0, y1, s0, s1);
    const mesh = new THREE.Mesh(g, material);
    group.add(mesh);
    return mesh;
  };
  const f = 0.06; // frame bar
  const fu0 = mid - 0.04, fu1 = mid + 0.04;
  // world point from (along, across)
  const P = (s, u) => (ax ? [s, u] : [u, s]);

  if (o.kind === 'window') {
    box(a, a + f, o.bottom, o.top, fu0, fu1, m.frame);
    box(b - f, b, o.bottom, o.top, fu0, fu1, m.frame);
    box(a, b, o.top - f, o.top, fu0, fu1, m.frame);
    box(a, b, o.bottom, o.bottom + f, fu0, fu1, m.frame);
    box((a + b) / 2 - f / 2, (a + b) / 2 + f / 2, o.bottom, o.top, fu0, fu1, m.frame);
    box(a, b, o.top - 0.55, o.top - 0.55 + f / 2, fu0, fu1, m.frame); // fortochka line
    box(a + f, b - f, o.bottom + f, o.top - f, mid - 0.01, mid + 0.01, m.glass);
    box(a - 0.05, b + 0.05, o.bottom - 0.01, o.bottom + 0.03, mid, innerFace + 0.07 * inside, m.sill); // above the wall top, no z-fighting
    box(a + 0.2, b - 0.2, 0.15, 0.7, innerFace + 0.03 * inside, innerFace + 0.12 * inside, m.radiator);
  }
  if (o.kind === 'balcony') {
    box(a, a + f, 0, o.top, fu0, fu1, m.frame);
    box(b - f, b, 0, o.top, fu0, fu1, m.frame);
    box(a, b, o.top - f, o.top, fu0, fu1, m.frame);
    const u = innerFace - 0.05 * inside;
    doors.balcony = makeDoor(group, colliders, {
      id: 'balcony',
      label: 'Балконная дверь',
      hinge: P(a + f, u),
      dir: ax ? [1, 0] : [0, 1],
      width: b - a - 2 * f,
      height: o.top - f,
      openTo: P((a + b) / 2, innerFace + inside),
      style: 'balcony',
      open: true,
    });
  }
  if (o.kind === 'entrance') {
    const u = innerFace - 0.05 * inside;
    doors.entrance = makeDoor(group, colliders, {
      id: 'entrance',
      label: 'Входная дверь',
      hinge: P(a + 0.02, u),
      dir: ax ? [1, 0] : [0, 1],
      width: b - a - 0.04,
      height: o.top - 0.02,
      openTo: P((a + b) / 2, innerFace + inside),
      style: 'entrance',
      open: false,
    });
  }
}

// Hinged door. `dir` = closed leaf direction from the hinge. Opens toward `openTo`.
function makeDoor(group, colliders, o) {
  const t = 0.05;
  const pivot = new THREE.Group();
  pivot.position.set(o.hinge[0], 0, o.hinge[1]);
  const leaf = new THREE.Group();
  pivot.add(leaf);
  const add = (geo, material) => {
    const mesh = new THREE.Mesh(geo, material);
    leaf.add(mesh);
    return mesh;
  };
  const knobMat = mat('#c9a44a', { metalness: 0.8, roughness: 0.3 });
  if (o.style === 'entrance') {
    add(boxGeo(0, o.width, 0.01, o.height, -t / 2, t / 2), mat('#5a2d1c', { roughness: 0.65 })); // dermantin
    const btn = mat('#b08a3a', { metalness: 0.7, roughness: 0.4 });
    for (let y = 0.3; y < o.height - 0.1; y += 0.3)
      for (let s = 0.12; s < o.width - 0.05; s += 0.22)
        for (const side of [-1, 1]) add(new THREE.SphereGeometry(0.012, 6, 4).translate(s, y, side * (t / 2 + 0.004)), btn);
  } else if (o.style === 'balcony') {
    const frame = mat('#f2efe8', { roughness: 0.5 });
    add(boxGeo(0, o.width, 0.01, 0.9, -t / 2, t / 2), frame);
    add(boxGeo(0, 0.06, 0.9, o.height, -t / 2, t / 2), frame);
    add(boxGeo(o.width - 0.06, o.width, 0.9, o.height, -t / 2, t / 2), frame);
    add(boxGeo(0, o.width, o.height - 0.06, o.height, -t / 2, t / 2), frame);
    add(boxGeo(0.06, o.width - 0.06, 0.9, o.height - 0.06, -0.01, 0.01), new THREE.MeshStandardMaterial({ color: '#9fb8d0', transparent: true, opacity: 0.2, roughness: 0.05 }));
  } else {
    add(boxGeo(0, o.width, 0.01, o.height, -t / 2, t / 2), mat('#e6dccb', { roughness: 0.6 }));
  }
  for (const side of [-1, 1]) add(new THREE.SphereGeometry(0.03, 12, 8).translate(o.width - 0.08, 1.0, side * (t / 2 + 0.03)), knobMat);

  const closedAngle = Math.atan2(-o.dir[1], o.dir[0]);
  const openAngle = [1, -1]
    .map((s) => closedAngle + (s * Math.PI) / 2)
    .map((a) => ({ a, d: Math.hypot(o.hinge[0] + Math.cos(a) * 0.5 - o.openTo[0], o.hinge[1] - Math.sin(a) * 0.5 - o.openTo[1]) }))
    .sort((p, q) => p.d - q.d)[0].a;

  const collider = {
    seg: [o.hinge[0], o.hinge[1], o.hinge[0] + o.dir[0] * o.width, o.hinge[1] + o.dir[1] * o.width],
    r: 0.06,
    enabled: !o.open,
  };
  colliders.push(collider);
  group.add(pivot);

  const door = {
    id: o.id,
    label: o.label,
    pivot,
    leaf,
    open: o.open,
    angle: o.open ? openAngle : closedAngle,
    // where to stand to be "at" the door
    center: [o.hinge[0] + (o.dir[0] * o.width) / 2, o.hinge[1] + (o.dir[1] * o.width) / 2],
    listeners: [],
    setOpen(v) {
      if (this.open === v) return;
      this.open = v;
      collider.enabled = !v;
      for (const fn of this.listeners) fn(v);
    },
    toggle() {
      this.setOpen(!this.open);
    },
    update(dt) {
      const target = this.open ? openAngle : closedAngle;
      this.angle += Math.sign(target - this.angle) * Math.min(Math.abs(target - this.angle), dt * 5);
      pivot.rotation.y = this.angle;
    },
  };
  pivot.rotation.y = door.angle;
  return door;
}
