// The yard's edges (outside.js keeps their colliders; nothing here can be reached). Each side is a reason
// not to go on: across the yard a concrete fence with the highway on its embankment behind it (cars go by,
// a whoosh as one passes: onCarPass), on the bedroom side the driveway is dug up (striped barriers, blinking
// lamps, «Ремонт дороги», a road roller), on the stairwell side garages behind a wire fence, and the two
// gaps along the house are shut with «Проход закрыт». Lit at night by a few lamps: readable, but dark.
// Plan coordinates like outside.js: +x right on the drawing (mirrored in the world), +z away from the yard.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { planToWorld as P } from './layout.js';
import { mat, worldUV } from './apartment.js';
import * as T from './textures.js';

// a canvas texture, made once
const cache = new Map();
function tex(key, w, h, draw, repeat = false) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(key, t);
  return t;
}
const rnd = (() => {
  let s = 7;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
})();

// the concrete fence panel (ПО-2): rows of rhombuses in relief, grime from the ground up; one with a tag
const panelTex = (tag) =>
  tex(`po2:${tag ?? ''}`, 512, 232, (g, w, h) => {
    g.fillStyle = '#86837c';
    g.fillRect(0, 0, w, h);
    const cols = 12, rows = 5, cw = (w - 24) / cols, rh = (h - 24) / rows;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const x = 12 + i * cw + cw / 2, y = 12 + j * rh + rh / 2, a = cw * 0.42, b = rh * 0.42;
        const side = (dx, dy, c) => {
          g.fillStyle = c;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + dx[0] * a, y + dx[1] * b);
          g.lineTo(x + dy[0] * a, y + dy[1] * b);
          g.fill();
        };
        side([0, -1], [-1, 0], '#a19e96'); // lit from above
        side([0, -1], [1, 0], '#96938b');
        side([-1, 0], [0, 1], '#78756e');
        side([1, 0], [0, 1], '#6a6761');
      }
    g.strokeStyle = 'rgba(40,38,34,0.6)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
    const grime = g.createLinearGradient(0, h, 0, h * 0.45);
    grime.addColorStop(0, 'rgba(30,28,24,0.75)');
    grime.addColorStop(1, 'rgba(30,28,24,0)');
    g.fillStyle = grime;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `rgba(35,30,24,${0.1 + rnd() * 0.15})`;
      g.fillRect(rnd() * w, rnd() * h * 0.3, 2 + rnd() * 3, h * (0.2 + rnd() * 0.5)); // rain streaks
    }
    if (tag) {
      g.save();
      g.translate(w / 2, h * 0.55);
      g.rotate(-0.06);
      g.font = '900 64px Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 9;
      g.strokeStyle = 'rgba(20,20,22,0.85)';
      g.strokeText(tag, 0, 0);
      g.fillStyle = '#c23b2e';
      g.fillText(tag, 0, 0);
      g.restore();
    }
  });

// a carriageway: asphalt, solid edges, a dashed line between its two lanes (u along the road: 1 = 12 m)
const roadTex = () =>
  tex('road', 256, 128, (g, w, h) => {
    g.fillStyle = '#26282a';
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${rnd() * 0.07})`;
      g.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    g.fillStyle = '#c9c7bd';
    g.fillRect(0, 6, w, 4);
    g.fillRect(0, h - 10, w, 4);
    for (let x = 0; x < w; x += 64) g.fillRect(x, h / 2 - 2, 40, 4);
  }, true);

// red-white striped boards of the road barriers
const stripes = () =>
  tex('stripes', 128, 32, (g, w, h) => {
    g.fillStyle = '#eeeae0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c4261f';
    for (let x = -h; x < w + h; x += 32) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 16, h);
      g.lineTo(x + 16 + h, 0);
      g.lineTo(x + h, 0);
      g.fill();
    }
  }, true);

// corrugated sheet fence (профнастил): 1 = 1 m
const sheet = () =>
  tex('sheet', 64, 64, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const k = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 5);
      g.fillStyle = `rgb(${50 + k * 30},${66 + k * 34},${78 + k * 36})`;
      g.fillRect(x, 0, 1, h);
    }
    g.fillStyle = 'rgba(120,70,30,0.25)';
    for (let k = 0; k < 6; k++) g.fillRect(rnd() * w, h * 0.6, 2, h * 0.4);
  }, true);

// chain-link wire (рабица), cut out by alphaTest: 1 = 0.5 m
const wire = () =>
  tex('wire', 64, 64, (g, w) => {
    g.strokeStyle = '#9aa0a0';
    g.lineWidth = 3;
    for (const [a, b] of [[[0, 0], [w, w]], [[w, 0], [0, w]], [[-w / 2, w / 2], [w / 2, w * 1.5]], [[w / 2, -w / 2], [w * 1.5, w / 2]], [[w / 2, w * 1.5], [w * 1.5, w / 2]], [[-w / 2, w / 2], [w / 2, -w / 2]]]) {
      g.beginPath();
      g.moveTo(...a);
      g.lineTo(...b);
      g.stroke();
    }
  }, true);

// a sign: text lines on a plate, with a border
const plate = (key, lines, { bg, fg, border = fg, w = 512, h = 160 }) =>
  tex(`plate:${key}`, w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = border;
    g.lineWidth = 14;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = Math.min(h / (lines.length + 0.6), 74);
    g.font = `900 ${size}px Arial`;
    lines.forEach((t, i) => g.fillText(t, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.08));
  });

// the "road works" triangle: yellow (a temporary sign), red rim, a man with a shovel by a heap
const worksSign = () =>
  tex('works', 256, 224, (g, w, h) => {
    const tri = (inset, c) => {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(w / 2, 8 + inset * 1.7);
      g.lineTo(w - 8 - inset * 1.5, h - 8 - inset * 0.85);
      g.lineTo(8 + inset * 1.5, h - 8 - inset * 0.85);
      g.fill();
    };
    tri(0, '#f4f1ea');
    tri(9, '#c8231c');
    tri(30, '#f2c21c');
    g.fillStyle = '#141414';
    g.beginPath();
    g.arc(118, 96, 11, 0, Math.PI * 2); // head
    g.fill();
    g.lineWidth = 12;
    g.lineCap = 'round';
    g.strokeStyle = '#141414';
    for (const [a, b] of [[[114, 110], [104, 150]], [[104, 150], [92, 182]], [[104, 150], [124, 182]], [[112, 118], [140, 138]], [[140, 138], [166, 172]]]) {
      g.beginPath();
      g.moveTo(...a);
      g.lineTo(...b);
      g.stroke();
    }
    g.beginPath(); // the heap
    g.moveTo(150, 186);
    g.quadraticCurveTo(172, 150, 196, 186);
    g.fill();
  });

// four garage gates side by side: paint, the two leaves, rust, a painted number
const GATES = [['#4c6a4a', '14'], ['#5d4632', '15'], ['#46586e', '16'], ['#6b6e66', '17']];
const gatesTex = () =>
  tex('gates', 1024, 256, (g, w, h) => {
    GATES.forEach(([c, n], i) => {
      const x0 = i * 256;
      g.fillStyle = c;
      g.fillRect(x0, 0, 256, h);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x0 + 126, 0, 5, h); // the gap between the leaves
      g.fillRect(x0, 0, 256, 6);
      for (let k = 0; k < 10; k++) {
        g.fillStyle = `rgba(${110 + rnd() * 40},${55 + rnd() * 20},20,${0.2 + rnd() * 0.35})`;
        g.fillRect(x0 + rnd() * 250, h * (0.15 + rnd() * 0.5), 3 + rnd() * 6, h * (0.2 + rnd() * 0.5));
      }
      g.fillStyle = 'rgba(25,20,15,0.4)';
      g.fillRect(x0, h - 40, 256, 40);
      g.fillStyle = 'rgba(235,232,220,0.85)';
      g.font = '900 54px Arial';
      g.textAlign = 'center';
      g.fillText(n, x0 + 64, 92);
      g.fillStyle = '#2b2b2b';
      g.fillRect(x0 + 134, 120, 10, 22); // the padlock
    });
    g.save();
    g.translate(2 * 256 + 180, 150);
    g.rotate(-0.12);
    g.fillStyle = '#d6d0c0';
    g.font = '900 30px Arial';
    g.textAlign = 'center';
    g.fillText('НЕ СТАВИТЬ', 0, 0);
    g.restore();
  });

// world-space geometry from a plan box (y in meters)
function geo(x0, x1, y0, y1, z0, z1, uv) {
  const r = P.rect(x0, x1, z0, z1);
  const g = new THREE.BoxGeometry(r.x1 - r.x0, y1 - y0, r.z1 - r.z0).translate((r.x0 + r.x1) / 2, (y0 + y1) / 2, (r.z0 + r.z1) / 2);
  return uv ? worldUV(g, uv) : g;
}
// a flat sign standing at plan (x, z), y = its middle, facing plan direction `face` ('-z' = the yard side of a house-line fence)
function signAt(group, map, x, z, y, w, h, face) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, roughness: 0.6, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.12 }));
  const [wx, wz] = P.pt(x, z);
  const [tx, tz] = P.pt(x + (face === '+x' ? 1 : face === '-x' ? -1 : 0), z + (face === '+z' ? 1 : face === '-z' ? -1 : 0));
  m.position.set(wx, y, wz);
  m.lookAt(tx, y, tz);
  group.add(m);
  return m;
}
const lamp = (group, x, z, y, color, intensity, distance) => {
  const l = new THREE.PointLight(color, intensity, distance, 1.5);
  l.userData.zone = 'out';
  const [wx, wz] = P.pt(x, z);
  l.position.set(wx, y, wz);
  group.add(l);
  return l;
};
const glow = (group, x, z, y, color, size, opacity = 0.55) => {
  const s = T.glowSprite(color, size);
  s.material.opacity = opacity;
  const [wx, wz] = P.pt(x, z);
  s.position.set(wx, y, wz);
  group.add(s);
  return s;
};
// many glows of one colour as one draw call: pts = world [x, y, z]
const glows = (group, pts, color, size, opacity) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ map: T.glow(), color, size, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  group.add(p);
  return p;
};

export function buildYardEdges(group, { STREET, FRONT }) {
  const Y = STREET;
  const parts = new Map(); // material -> geometries, merged into one mesh each at the end
  const put = (m, g) => (parts.has(m) ? parts.get(m).push(g) : parts.set(m, [g]));
  const dark = mat('#1c1d1c', { roughness: 1 });
  const grey = mat('#77746d', { roughness: 1 });
  const steel = mat('#8d9294', { metalness: 0.5, roughness: 0.5 });
  const bulb = new THREE.MeshBasicMaterial({ color: '#fff0d6', toneMapped: false });

  // ground beyond the yard (the yard's own floor is 5 cm higher), so the edges don't stand over the void
  put(dark, geo(-34, 46, Y - 0.35, Y - 0.05, -15.6, 9));

  // ---------------- across the yard: the concrete fence and the highway behind it ----------------
  const RY = Y + 2.4; // the road on its embankment
  const FZ = FRONT.z0; // the fence (its collider: FZ - 0.1 .. FZ)
  const panels = [mat('#ffffff', { map: panelTex(), emissive: '#6a5236', emissiveMap: panelTex(), emissiveIntensity: 0.8 }), mat('#ffffff', { map: panelTex('ЦОЙ ЖИВ'), emissive: '#6a5236', emissiveMap: panelTex('ЦОЙ ЖИВ'), emissiveIntensity: 0.8 })]; // the highway's lamps light it from behind and above
  const PW = (FRONT.x1 - FRONT.x0) / 5;
  for (let i = 0; i < 5; i++) {
    const x0 = FRONT.x0 + i * PW;
    put(panels[i === 3 ? 1 : 0], geo(x0 + 0.04, x0 + PW - 0.04, Y, Y + 2.3, FZ - 0.1, FZ));
    put(grey, geo(x0 - 0.1, x0 + 0.1, Y, Y + 2.45, FZ - 0.14, FZ + 0.03)); // the posts
  }
  put(grey, geo(FRONT.x1 - 0.1, FRONT.x1 + 0.1, Y, Y + 2.45, FZ - 0.14, FZ + 0.03));
  // the embankment: a grass slope up from behind the fence, the road on top, a mass under it all
  {
    const [ax, az] = P.pt(-40, FZ - 0.15), [bx] = P.pt(60, FZ - 0.15), [, cz] = P.pt(0, -15.6);
    const slope = new THREE.BufferGeometry();
    slope.setAttribute('position', new THREE.Float32BufferAttribute([ax, Y, az, bx, Y, az, bx, RY, cz, ax, Y, az, bx, RY, cz, ax, RY, cz], 3));
    slope.computeVertexNormals();
    group.add(new THREE.Mesh(slope, mat('#1f2a1c', { roughness: 1, side: THREE.DoubleSide })));
  }
  put(mat('#2a2826', { roughness: 1 }), geo(-40, 60, -9, RY - 0.05, -15.6, -23.4));
  const road = mat('#ffffff', { map: roadTex(), roughness: 0.9 });
  for (const [z0, z1] of [[-15.6, -18.85], [-19.25, -22.5]]) {
    const r = P.rect(-40, 60, z1, z0);
    const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2).translate((r.x0 + r.x1) / 2, RY, (r.z0 + r.z1) / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * ((r.x1 - r.x0) / 12));
    group.add(new THREE.Mesh(g, road));
  }
  put(grey, geo(-40, 60, RY, RY + 0.8, -18.85, -19.25)); // the concrete divider
  for (const z of [-15.45, -22.65]) {
    put(steel, geo(-40, 60, RY + 0.45, RY + 0.75, z - 0.03, z + 0.03)); // guardrail
    for (let x = -40; x <= 60; x += 3) put(steel, geo(x - 0.04, x + 0.04, RY, RY + 0.7, z + 0.03, z + 0.09));
  }
  // sodium lamps over the divider: the pole, two arms, orange heads, their pools of light on the road (no real light
  // but one, over the middle of the yard)
  const head = new THREE.MeshBasicMaterial({ color: '#ffb35c', toneMapped: false });
  const pool = new THREE.MeshBasicMaterial({ map: T.glow(), color: '#ff9d3a', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  const pools = [], halos = [];
  for (let x = -22; x <= 40; x += 13) {
    put(steel, geo(x - 0.08, x + 0.08, RY + 0.8, RY + 8, -19.13, -18.97));
    put(steel, geo(x - 0.05, x + 0.05, RY + 7.85, RY + 7.95, -17.6, -20.5));
    for (const z of [-17.5, -20.6]) {
      put(head, geo(x - 0.35, x + 0.35, RY + 7.7, RY + 7.85, z - 0.16, z + 0.16));
      const [wx, wz] = P.pt(x, z);
      halos.push([wx, RY + 7.6, wz]);
      pools.push(new THREE.PlaneGeometry(9, 7).rotateX(-Math.PI / 2).translate(wx, RY + 0.02, wz));
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(pools), pool));
  glows(group, halos, '#ffae55', 2.6, 0.6);
  lamp(group, 5.5, -14.6, Y + 9, '#ff9e48', 14, 18); // the highway's light spills over the fence onto the far end of the yard

  // ---------------- the cars ----------------
  // body + cabin + wheels in one instanced mesh (vertex colours keep the wheels and the glass dark), the lamps
  // and their glow and the beams on the road as four more: five draw calls for the whole traffic
  const shade = (g, k) => g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(k), 3));
  const carGeo = mergeGeometries([
    shade(new THREE.BoxGeometry(4.3, 0.62, 1.78).translate(0, 0.6, 0), 1),
    shade(new THREE.BoxGeometry(2.3, 0.5, 1.6).translate(-0.25, 1.15, 0), 0.4),
    ...[[-1.35, 0.9], [-1.35, -0.9], [1.35, 0.9], [1.35, -0.9]].map(([x, z]) => shade(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 10).rotateX(Math.PI / 2).translate(x, 0.33, z), 0.12)),
  ]);
  const CARS = 5;
  const bodies = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }), CARS);
  const lampGeo = mergeGeometries([0.62, -0.62].map((z) => new THREE.BoxGeometry(0.06, 0.12, 0.34).translate(2.16, 0.68, z)));
  const heads = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: '#fff4d6', toneMapped: false }), CARS);
  const tailGeo = mergeGeometries([0.62, -0.62].map((z) => new THREE.BoxGeometry(0.06, 0.12, 0.34).translate(-2.16, 0.7, z)));
  const tails = new THREE.InstancedMesh(tailGeo, new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false }), CARS);
  const flare = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: T.glow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), CARS * 2);
  const beamTex = tex('beam', 64, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, 0, 0, w / 2, 0, h);
    r.addColorStop(0, 'rgba(255,255,255,0.9)');
    r.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
  const beams = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: beamTex, color: '#fff0c8', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }), CARS); // bright end at -x
  const PAINT = ['#1b1d22', '#5a1a16', '#c9c8c2', '#24344f', '#3d3f3a', '#6b6a62'];
  const [, laneZ0] = P.pt(0, -16.4), [, laneZ1] = P.pt(0, -18.1), [, laneZ2] = P.pt(0, -20.0), [, laneZ3] = P.pt(0, -21.7);
  // right-hand traffic: the near carriageway runs to the left as seen from the yard (world -x), the far one back
  const lanes = [[laneZ0, -1], [laneZ1, -1], [laneZ2, 1], [laneZ3, 1]];
  const [spanA] = P.pt(-34, 0), [spanB] = P.pt(52, 0);
  const X0 = Math.min(spanA, spanB), X1 = Math.max(spanA, spanB);
  const cars = Array.from({ length: CARS }, (_, i) => {
    const [z, dir] = lanes[[0, 2, 1, 3, 0][i]];
    const c = { z, dir, v: 13 + rnd() * 6, x: X0 + rnd() * (X1 - X0), wait: 0, side: 0 };
    bodies.setColorAt(i, new THREE.Color(PAINT[i % PAINT.length]));
    return c;
  });
  for (let i = 0; i < CARS; i++) {
    flare.setColorAt(i * 2, new THREE.Color('#fff2cc'));
    flare.setColorAt(i * 2 + 1, new THREE.Color('#ff3020'));
  }
  for (const m of [bodies, heads, tails, flare, beams]) {
    m.frustumCulled = false; // they move: the box of where they are is the whole road
    group.add(m);
  }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const placeCars = () => {
    cars.forEach((c, i) => {
      Q.setFromAxisAngle(UP, c.dir > 0 ? 0 : Math.PI);
      V.set(c.x, RY, c.z);
      M.compose(V, Q, S.set(1, 1, 1));
      bodies.setMatrixAt(i, M);
      heads.setMatrixAt(i, M);
      tails.setMatrixAt(i, M);
      V.set(c.x + c.dir * 7, RY + 0.03, c.z);
      M.compose(V, Q, S.set(10, 1, 2.6));
      beams.setMatrixAt(i, M);
      Q.identity();
      V.set(c.x + c.dir * 2.25, RY + 0.68, c.z + 1);
      M.compose(V, Q, S.set(1.9, 1.1, 1));
      flare.setMatrixAt(i * 2, M);
      V.set(c.x - c.dir * 2.2, RY + 0.68, c.z + 1);
      M.compose(V, Q, S.set(0.9, 0.6, 1));
      flare.setMatrixAt(i * 2 + 1, M);
    });
    for (const m of [bodies, heads, tails, flare, beams]) m.instanceMatrix.needsUpdate = true;
  };
  placeCars();
  bodies.userData.cars = cars; // debugging: put a car where you look

  // ---------------- the bedroom side: the driveway dug up ----------------
  const X = FRONT.x0; // its collider: X - 0.1 .. X
  const sheetMat = mat('#ffffff', { map: sheet(), roughness: 0.7, metalness: 0.3, emissive: '#ffffff', emissiveMap: sheet(), emissiveIntensity: 0.14 });
  const sheetFence = (x0, x1, z0, z1) => put(sheetMat, geo(x0, x1, Y, Y + 2.0, z0, z1, 1));
  sheetFence(X - 0.1, X - 0.04, FRONT.z0 - 0.1, -10.3);
  sheetFence(X - 0.1, X - 0.04, -5.2, FRONT.z1);
  sheetFence(X, -0.4, FRONT.z1 - 0.07, FRONT.z1 + 0.02); // the gap by the bedroom end of the house
  for (const z of [FRONT.z0, -12.2, -10.3, -5.2, -3, FRONT.z1]) put(steel, geo(X - 0.12, X + 0.02, Y, Y + 2.05, z - 0.05, z + 0.05));
  signAt(group, plate('closed1', ['ПРОХОД', 'ЗАКРЫТ'], { bg: '#f3f1ea', fg: '#b3221b', h: 256 }), -1.7, FRONT.z1 - 0.09, Y + 1.35, 0.9, 0.45, '-z');
  // the barriers across the driveway: striped boards on A-legs, a lamp on every leg
  const stripeMat = mat('#ffffff', { map: stripes(), roughness: 0.6, emissive: '#ffffff', emissiveMap: stripes(), emissiveIntensity: 0.08 });
  const legs = [];
  for (let z = -10.3; z < -5.2 - 0.1; z += 1.275) {
    const za = z + 0.05, zb = Math.min(-5.25, z + 1.225);
    for (const [y0, y1] of [[0.62, 0.92], [0.22, 0.38]]) {
      const b = geo(X - 0.08, X - 0.04, Y + y0, Y + y1, za, zb);
      const uv = b.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 2);
      put(stripeMat, b);
    }
    for (const lz of [za + 0.08, zb - 0.08]) {
      put(dark, geo(X - 0.24, X + 0.02, Y, Y + 0.94, lz - 0.03, lz + 0.03));
      legs.push(lz);
    }
  }
  // blinking lamps: two sets, they take turns
  const blink = [0, 1].map(() => ({ m: new THREE.MeshBasicMaterial({ color: '#ffb020', toneMapped: false }), geos: [], pts: [] }));
  legs.forEach((lz, i) => {
    const b = blink[i % 2];
    const [wx, wz] = P.pt(X - 0.06, lz);
    b.geos.push(new THREE.SphereGeometry(0.075, 10, 6).translate(wx, Y + 1.02, wz));
    b.pts.push([wx, Y + 1.02, wz]);
  });
  // signs on a post by the barrier: the triangle and the plate under it
  put(steel, geo(X - 0.3, X - 0.24, Y, Y + 2.5, -10.6, -10.54));
  signAt(group, worksSign(), X - 0.22, -10.57, Y + 2.15, 0.8, 0.7, '+x');
  signAt(group, plate('works', ['РЕМОНТ', 'ДОРОГИ'], { bg: '#f2c21c', fg: '#141414', h: 220 }), X - 0.22, -10.57, Y + 1.5, 0.84, 0.36, '+x');
  // beyond: the dug-up road (a trench, heaps), a road roller, a work lamp on a tripod
  put(mat('#0c0b0a', { roughness: 1 }), geo(-9.4, -3.7, Y - 0.04, Y - 0.03, -9.6, -6.4));
  const dirt = mat('#3a2e22', { roughness: 1 });
  for (const [x, z, r, h] of [[-4.6, -10.4, 0.9, 0.7], [-6.2, -10.6, 1.1, 0.9], [-8.4, -5.6, 1.0, 0.8], [-10.6, -9.8, 1.3, 1.1]]) {
    const [wx, wz] = P.pt(x, z);
    put(dirt, new THREE.ConeGeometry(r, h, 7).translate(wx, Y + h / 2 - 0.05, wz));
  }
  {
    const [rx, rz] = P.pt(-6.4, -4.4);
    const at = new THREE.Matrix4().makeRotationY(0.35).setPosition(rx, Y, rz);
    const yellow = mat('#d99a1a', { roughness: 0.6 });
    const add = (g, m) => put(m, g.applyMatrix4(at));
    add(new THREE.CylinderGeometry(0.62, 0.62, 1.7, 18).rotateX(Math.PI / 2).translate(1.35, 0.62, 0), steel); // the drum
    add(new THREE.BoxGeometry(0.5, 0.5, 1.82).translate(1.35, 1.3, 0), yellow); // its yoke
    add(new THREE.BoxGeometry(2.1, 0.95, 1.45).translate(-0.55, 0.95, 0), yellow);
    add(new THREE.BoxGeometry(1.05, 1.0, 1.3).translate(-0.45, 1.92, 0), mat('#2a3236', { roughness: 0.2 })); // the cab's glass
    add(new THREE.BoxGeometry(1.25, 0.08, 1.5).translate(-0.45, 2.46, 0), yellow);
    for (const z of [0.68, -0.68]) add(new THREE.CylinderGeometry(0.52, 0.52, 0.35, 14).rotateX(Math.PI / 2).translate(-1.05, 0.52, z), dark);
    blink[0].geos.push(new THREE.SphereGeometry(0.09, 10, 6).translate(-0.45, 2.57, 0).applyMatrix4(at)); // the beacon
    const v = new THREE.Vector3(-0.45, 2.6, 0).applyMatrix4(at);
    blink[0].pts.push([v.x, v.y, v.z]);
  }
  put(dark, geo(-4.9, -4.84, Y, Y + 2.1, -8.0, -7.94));
  put(bulb, geo(-4.98, -4.8, Y + 2.05, Y + 2.3, -8.12, -7.82));
  glow(group, -4.89, -7.97, Y + 2.18, '#fff0d0', 1.6, 0.55);
  lamp(group, -4.6, -7.4, Y + 2.3, '#ffe2b8', 7, 10);
  for (const b of blink) {
    group.add(new THREE.Mesh(mergeGeometries(b.geos), b.m));
    b.glow = glows(group, b.pts, '#ffa21c', 0.9, 0.75);
  }

  // ---------------- the stairwell side: garages behind a wire fence ----------------
  const XG = FRONT.x1; // its collider: XG .. XG + 0.1
  const wireMat = new THREE.MeshStandardMaterial({ map: wire(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  const wireFence = (x0, x1, z0, z1) => {
    put(wireMat, worldUV(geo(x0, x1, Y + 0.05, Y + 2.0, z0, z1), 5));
  };
  wireFence(XG + 0.05, XG + 0.052, FRONT.z0, FRONT.z1);
  wireFence(10.9, XG, FRONT.z1 - 0.031, FRONT.z1 - 0.029); // the gap along the stairwell's side
  for (let z = FRONT.z0; z <= FRONT.z1 + 0.01; z += (FRONT.z1 - FRONT.z0) / 6) put(steel, geo(XG + 0.02, XG + 0.08, Y, Y + 2.05, z - 0.03, z + 0.03));
  for (let x = 10.9; x <= XG + 0.01; x += (XG - 10.9) / 3) put(steel, geo(x - 0.03, x + 0.03, Y, Y + 2.05, FRONT.z1 - 0.06, FRONT.z1));
  put(steel, geo(10.9, XG + 0.08, Y + 1.98, Y + 2.03, FRONT.z1 - 0.06, FRONT.z1));
  put(steel, geo(XG + 0.02, XG + 0.08, Y + 1.98, Y + 2.03, FRONT.z0, FRONT.z1));
  signAt(group, plate('closed2', ['ПРОХОД', 'ЗАКРЫТ'], { bg: '#f3f1ea', fg: '#b3221b', h: 256 }), 13.4, FRONT.z1 - 0.08, Y + 1.3, 0.9, 0.45, '-z');
  put(mat('#2d2b28', { roughness: 1 }), geo(XG + 0.1, 24.5, Y - 0.04, Y - 0.02, FRONT.z0, FRONT.z1)); // the lane, gravel
  const brick = mat('#5b4a40', { roughness: 1 });
  const slab = mat('#3b3633', { roughness: 0.9 });
  const GW = 3; // a garage, along the row
  const gates = [];
  GATES.forEach((_, i) => {
    const z0 = -13.6 + i * GW, z1 = z0 + GW;
    put(brick, geo(19.2, 24.5, Y, Y + 2.6, z0, z0 + 0.12));
    put(brick, geo(19.2, 24.5, Y + 2.2, Y + 2.6, z0, z1)); // over the gate
    put(slab, geo(19.0, 24.7, Y + 2.6, Y + 2.72, z0 - 0.1, z1 + 0.1)); // the roof slab
    put(brick, geo(23.9, 24.5, Y, Y + 2.6, z0, z1));
    // the gate, a plane facing the yard, its cell of the atlas
    const r = P.rect(19.22, 19.24, z0 + 0.15, z1 - 0.03);
    const toYard = r.x0 < P.pt(XG, 0)[0] ? 1 : -1; // the yard is that way along world x
    const g = new THREE.PlaneGeometry(r.z1 - r.z0, 2.2).rotateY((toYard * Math.PI) / 2).translate((r.x0 + r.x1) / 2, Y + 1.1, (r.z0 + r.z1) / 2);
    const uv = g.attributes.uv;
    const cell = toYard > 0 ? GATES.length - 1 - i : i; // the numbers go up left to right, seen from the yard
    for (let k = 0; k < uv.count; k++) uv.setX(k, (cell + uv.getX(k)) / GATES.length);
    gates.push(g);
  });
  put(brick, geo(19.2, 24.5, Y, Y + 2.6, -13.6 + GATES.length * GW - 0.12, -13.6 + GATES.length * GW));
  group.add(new THREE.Mesh(mergeGeometries(gates), mat('#ffffff', { map: gatesTex(), roughness: 0.7, metalness: 0.2, emissive: '#ffffff', emissiveMap: gatesTex(), emissiveIntensity: 0.12 })));
  // a bulb over the far gate (the courier comes out of the dark further along: game.js, stairsRoute)
  put(bulb, geo(19.05, 19.15, Y + 2.38, Y + 2.48, -12.15, -12.05));
  glow(group, 19.0, -12.1, Y + 2.43, '#ffcf8a', 1.4, 0.6);
  lamp(group, 18.6, -12.1, Y + 2.4, '#ffc27a', 5, 8);

  for (const [m, gs] of parts) group.add(new THREE.Mesh(mergeGeometries(gs), m));

  let t = 0, last = 0;
  return {
    onCarPass: null, // (pos [x, z, y], speed) -> a car just went by Oleg (main.js plays the whoosh)
    // ear: [x, z] where Oleg is, or null (nothing to hear: the title, a story scene)
    update(dt, ear) {
      t += dt;
      for (const c of cars) {
        if (c.wait > 0) {
          c.wait -= dt;
          continue;
        }
        c.x += c.dir * c.v * dt;
        if (c.dir > 0 ? c.x > X1 : c.x < X0) { // off the end: back to the start after a pause, a new speed
          c.x = c.dir > 0 ? X0 : X1;
          c.v = 13 + rnd() * 6;
          c.wait = rnd() * 5;
          c.side = 0;
        }
        const side = ear ? Math.sign(c.x - ear[0]) : 0;
        if (ear && c.side && side !== c.side && t - last > 0.4) {
          last = t;
          this.onCarPass?.([c.x, c.z, RY + 0.6], c.v);
        }
        c.side = side;
      }
      placeCars();
      // the barrier lamps take turns, a short flash each (the roller's beacon with the first set)
      const ph = (t * 1.4) % 1;
      blink.forEach((b, i) => {
        const on = Math.abs(ph - i * 0.5) < 0.2 || Math.abs(ph - i * 0.5 - 1) < 0.2;
        b.m.color.set(on ? '#ffb020' : '#3a2606');
        b.glow.visible = on;
      });
    },
  };
}
