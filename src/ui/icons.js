// Icons. The real ones are pictures from Qwen in src/assets/icons/<name>.png (list and prompts in
// docs/ICONS.md); any file dropped there is picked up automatically. Until a file exists, a TEMPORARY
// placeholder drawn in code stands in, so the game works in the meantime.
// Used everywhere: HUD (<img src=iconURL>), phone, mini-games (canvas) and world markers (iconTexture).
import * as THREE from 'three';

const FILES = import.meta.glob('../assets/icons/*.{png,webp,jpg}', { eager: true, query: '?inline', import: 'default' });
const REAL = {};
for (const [path, src] of Object.entries(FILES)) REAL[path.match(/\/([a-z0-9_]+)\.\w+$/)[1]] = src;
export const hasRealIcon = (name) => !!REAL[name];

const INK = '#1b1612';
const W = '#fbf6ea';

// TEMPORARY placeholder glyphs (100x100 box) until the Qwen pictures are in
const G = {
  beer(g) {
    rr(g, 30, 30, 34, 50, 6); fillStroke(g, '#f2b33d');
    g.fillStyle = W; rr(g, 30, 24, 34, 14, 7); g.fill(); g.stroke();
    g.beginPath(); g.arc(68, 54, 10, -Math.PI / 2, Math.PI / 2); g.lineWidth = 7; g.strokeStyle = INK; g.stroke();
  },
  vodka(g) {
    g.beginPath(); g.moveTo(42, 16); g.lineTo(58, 16); g.lineTo(58, 32); g.quadraticCurveTo(70, 38, 70, 50); g.lineTo(70, 84); g.lineTo(30, 84); g.lineTo(30, 50); g.quadraticCurveTo(30, 38, 42, 32); g.closePath();
    fillStroke(g, W);
    g.fillStyle = '#d64535'; g.fillRect(30, 52, 40, 16); g.strokeRect(30, 52, 40, 16);
  },
  booze(g) { G.beer(g); },
  pizza(g) { G.food(g); },
  shower(g) {
    g.beginPath(); g.moveTo(30, 84); g.quadraticCurveTo(20, 50, 52, 40); g.lineWidth = 9; g.strokeStyle = INK; g.stroke();
    g.beginPath(); g.ellipse(64, 34, 20, 12, -0.5, 0, 7); fillStroke(g, '#c9ced4');
    g.fillStyle = '#7fc6ee'; for (const [x, y] of [[70, 56], [78, 64], [62, 62], [72, 74]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  },
  food(g) {
    g.beginPath(); g.moveTo(50, 18); g.lineTo(82, 78); g.quadraticCurveTo(50, 90, 18, 78); g.closePath(); fillStroke(g, '#f5c45a');
    g.beginPath(); g.moveTo(18, 78); g.quadraticCurveTo(50, 90, 82, 78); g.lineWidth = 9; g.strokeStyle = '#c27a2c'; g.stroke();
    for (const [x, y] of [[48, 44], [40, 64], [60, 66]]) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fillStyle = '#c8412f'; g.fill(); }
  },
  pelmeni(g) {
    for (const [x, y] of [[36, 56], [64, 56], [50, 38]]) {
      g.beginPath(); g.ellipse(x, y, 16, 11, 0, Math.PI, 0); g.lineTo(x + 16, y + 4); g.quadraticCurveTo(x, y + 12, x - 16, y + 4); g.closePath(); fillStroke(g, W);
    }
  },
  energy(g) {
    g.beginPath(); g.moveTo(56, 12); g.lineTo(26, 56); g.lineTo(48, 56); g.lineTo(42, 88); g.lineTo(74, 42); g.lineTo(52, 42); g.closePath(); fillStroke(g, '#ffe066');
  },
  alert(g) {
    g.fillStyle = W; g.lineWidth = 6; g.strokeStyle = INK;
    rr(g, 41, 16, 18, 48, 8); g.fill(); g.stroke();
    g.beginPath(); g.arc(50, 78, 10, 0, 7); g.fill(); g.stroke();
  },
  fun(g) {
    g.beginPath(); g.arc(50, 50, 32, 0, 7); fillStroke(g, '#ffd24a');
    g.fillStyle = INK; g.beginPath(); g.arc(39, 42, 5, 0, 7); g.arc(61, 42, 5, 0, 7); g.fill();
    g.beginPath(); g.arc(50, 52, 18, 0.15 * Math.PI, 0.85 * Math.PI); g.lineWidth = 6; g.stroke();
  },
  hut(g) {
    g.beginPath(); g.moveTo(50, 16); g.lineTo(84, 46); g.lineTo(76, 46); g.lineTo(76, 82); g.lineTo(24, 82); g.lineTo(24, 46); g.lineTo(16, 46); g.closePath(); fillStroke(g, W);
    g.fillStyle = '#b05a3a'; g.fillRect(43, 58, 14, 24); g.strokeRect(43, 58, 14, 24);
  },
  neighbours(g) {
    // an angry fist knocking
    rr(g, 26, 34, 44, 38, 12); fillStroke(g, '#f0c9a0');
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(38 + i * 11, 34); g.lineTo(38 + i * 11, 50); g.lineWidth = 4; g.stroke(); }
    g.lineWidth = 6;
    for (const [a, b, c, d] of [[76, 30, 86, 22], [80, 48, 92, 48], [76, 66, 86, 74]]) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
  },
  money(g) {
    rr(g, 14, 30, 72, 42, 6); fillStroke(g, '#8fd18b');
    g.beginPath(); g.arc(50, 51, 11, 0, 7); g.fillStyle = W; g.fill(); g.stroke();
  },
  phone(g) {
    rr(g, 32, 14, 36, 72, 8); fillStroke(g, '#2b2a33');
    g.fillStyle = '#8ec5ff'; g.fillRect(37, 22, 26, 50);
    g.beginPath(); g.arc(50, 79, 3, 0, 7); g.fillStyle = W; g.fill();
  },
  camera(g) {
    rr(g, 16, 34, 52, 36, 7); fillStroke(g, W);
    g.beginPath(); g.moveTo(68, 44); g.lineTo(86, 34); g.lineTo(86, 70); g.lineTo(68, 60); g.closePath(); fillStroke(g, W);
    g.beginPath(); g.arc(28, 44, 4, 0, 7); g.fillStyle = '#e04b3c'; g.fill();
  },
  cart(g) {
    g.beginPath(); g.moveTo(14, 26); g.lineTo(26, 26); g.lineTo(34, 64); g.lineTo(76, 64); g.lineTo(84, 36); g.lineTo(30, 36); g.lineWidth = 7; g.strokeStyle = INK; g.stroke();
    g.fillStyle = W; g.beginPath(); g.moveTo(31, 40); g.lineTo(80, 40); g.lineTo(74, 60); g.lineTo(36, 60); g.closePath(); g.fill();
    for (const x of [40, 70]) { g.beginPath(); g.arc(x, 76, 6, 0, 7); g.fillStyle = W; g.fill(); g.lineWidth = 5; g.stroke(); }
  },
  mop(g) {
    g.beginPath(); g.moveTo(66, 12); g.lineTo(46, 60); g.lineWidth = 8; g.strokeStyle = INK; g.stroke();
    g.beginPath(); g.moveTo(26, 62); g.lineTo(62, 62); g.lineTo(70, 86); g.lineTo(20, 86); g.closePath(); fillStroke(g, '#c7b24a');
  },
  tools(g) {
    g.save(); g.translate(50, 50); g.rotate(-Math.PI / 4);
    rr(g, -6, -8, 12, 46, 4); fillStroke(g, '#b8793c');
    rr(g, -20, -34, 40, 20, 5); fillStroke(g, '#c9ced4');
    g.restore();
  },
  toy(g) {
    g.beginPath(); g.ellipse(46, 56, 26, 18, 0, 0, 7); fillStroke(g, '#b9b9b9');
    g.beginPath(); g.arc(30, 40, 9, 0, 7); g.arc(50, 36, 9, 0, 7); fillStroke(g, '#e8a4a4');
    g.beginPath(); g.moveTo(72, 56); g.quadraticCurveTo(92, 50, 86, 76); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
  },
  cat(g) {
    g.beginPath(); g.moveTo(22, 30); g.lineTo(34, 44); g.lineTo(66, 44); g.lineTo(78, 30); g.lineTo(80, 60); g.quadraticCurveTo(50, 92, 20, 60); g.closePath(); fillStroke(g, '#e8943e');
    g.fillStyle = INK; g.beginPath(); g.arc(40, 58, 4, 0, 7); g.arc(60, 58, 4, 0, 7); g.fill();
  },
  talk(g) {
    rr(g, 16, 22, 68, 44, 16); fillStroke(g, W);
    g.beginPath(); g.moveTo(32, 64); g.lineTo(26, 82); g.lineTo(46, 66); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = INK; for (const x of [36, 50, 64]) { g.beginPath(); g.arc(x, 44, 4, 0, 7); g.fill(); }
  },
  music(g) {
    g.lineWidth = 7; g.strokeStyle = INK;
    g.beginPath(); g.moveTo(40, 70); g.lineTo(40, 24); g.lineTo(72, 18); g.lineTo(72, 62); g.stroke();
    g.fillStyle = W; for (const [x, y] of [[32, 72], [64, 66]]) { g.beginPath(); g.ellipse(x, y, 10, 8, -0.3, 0, 7); g.fill(); g.stroke(); }
  },
  drunk(g) {
    for (const [x, y, r] of [[40, 62, 14], [62, 44, 11], [44, 30, 8], [66, 72, 7]]) { g.beginPath(); g.arc(x, y, r, 0, 7); fillStroke(g, W); }
  },
  door(g) {
    rr(g, 30, 14, 40, 72, 3); fillStroke(g, '#7a3f24');
    g.beginPath(); g.arc(60, 52, 4, 0, 7); g.fillStyle = '#e0b94a'; g.fill();
  },
  police(g) {
    g.beginPath(); g.moveTo(50, 14); g.lineTo(80, 26); g.quadraticCurveTo(80, 68, 50, 86); g.quadraticCurveTo(20, 68, 20, 26); g.closePath(); fillStroke(g, '#4f7bd6');
    g.fillStyle = '#ffe066'; star(g, 50, 48, 14, 6);
  },
  clock(g) {
    g.beginPath(); g.arc(50, 50, 32, 0, 7); fillStroke(g, W);
    g.beginPath(); g.moveTo(50, 50); g.lineTo(50, 30); g.moveTo(50, 50); g.lineTo(64, 58); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
  },
};

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
function fillStroke(g, fill) {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke();
}
function star(g, cx, cy, r, n) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, rr2 = i % 2 ? r * 0.45 : r;
    g.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
  }
  g.closePath();
  g.fill();
  g.lineWidth = 4;
  g.stroke();
}

// disc colours per icon (the "category" colour)
const BG = {
  beer: '#3d7bd9', vodka: '#3d7bd9', booze: '#3d7bd9', food: '#e0822d', pizza: '#e0822d', shower: '#3aa0c8', pelmeni: '#e0822d', energy: '#2d9c6f',
  alert: '#e0412f', fun: '#d9508a', hut: '#2f9e8f', neighbours: '#8a5ad6', money: '#2d9c6f', phone: '#52505c',
  camera: '#52505c', cart: '#e0822d', mop: '#3aa0c8', tools: '#6c7a89', toy: '#d9508a', cat: '#b8742f',
  talk: '#3d7bd9', music: '#8a5ad6', drunk: '#8a5ad6', door: '#9c5a35', police: '#2b3f66', clock: '#52505c',
};

const cache = new Map();
const listeners = new Map(); // canvas -> [fn] to call when the real picture has loaded
// canvas with the icon; bare = glyph only, no disc (placeholder only)
export function icon(name, size = 96, { bare = false, bg } = {}) {
  const key = `${name}|${size}|${bare}|${bg ?? ''}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  cache.set(key, c);
  if (REAL[name]) {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      g.clearRect(0, 0, size, size);
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      (listeners.get(c) ?? []).forEach((fn) => fn());
    };
    img.src = REAL[name];
    return c;
  }
  g.scale(size / 100, size / 100);
  if (!bare) {
    g.beginPath();
    g.arc(50, 50, 46, 0, Math.PI * 2);
    g.fillStyle = bg ?? BG[name] ?? '#52505c';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = INK;
    g.stroke();
    g.translate(50, 50);
    g.scale(0.72, 0.72);
    g.translate(-50, -50);
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  (G[name] ?? G.alert)(g);
  return c;
}

const urls = new Map();
export function iconURL(name, opts) {
  if (REAL[name]) return REAL[name];
  const key = `${name}|${JSON.stringify(opts ?? {})}`;
  if (!urls.has(key)) urls.set(key, icon(name, 96, opts).toDataURL());
  return urls.get(key);
}
export const iconImg = (name, cls = 'ico', opts) => `<img class="${cls}" src="${iconURL(name, opts)}" alt="" draggable="false">`;

const textures = new Map();
export function iconTexture(name, opts) {
  const key = `${name}|${JSON.stringify(opts ?? {})}`;
  if (!textures.has(key)) {
    const c = icon(name, 128, opts);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (REAL[name]) listeners.set(c, [...(listeners.get(c) ?? []), () => (t.needsUpdate = true)]);
    textures.set(key, t);
  }
  return textures.get(key);
}
