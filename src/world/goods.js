// What a 24/7 kiosk sells, made to read at a glance instead of coloured blocks:
// bottles with real profiles (vodka, beer, cognac) and paper labels, a cigarette wall with
// price tags, packs of pelmeni and bags of сухарики with printed fronts.
// Everything is built as plain geometry in world space and merged per material by the caller.
import * as THREE from 'three';
import { mat } from './apartment.js';

// ---------- bottles ----------
// Blocky, like everything else in the game (box bodies, box heads): a square body, a square neck,
// a cap and a label band. [body w, body h, neck w, neck h, label y0, label y1] in metres.
const SHAPES = {
  vodka: [0.065, 0.2, 0.026, 0.09, 0.06, 0.15],
  beer: [0.06, 0.15, 0.026, 0.09, 0.04, 0.11],
  cognac: [0.085, 0.15, 0.026, 0.08, 0.04, 0.12],
};
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

export const GLASS = {
  clear: () => mat('#c6dbe2', { roughness: 0.25, metalness: 0.1 }),
  brown: () => mat('#5a2c0e', { roughness: 0.3 }),
  green: () => mat('#2a5f2e', { roughness: 0.3 }),
  amber: () => mat('#8a4512', { roughness: 0.3 }),
  cap: () => mat('#2a2a2e', { roughness: 0.6 }),
};

// one bottle as its own Group, standing on its bottom (table, hands); same shape as the shelf ones
const LOOK = { vodka: ['clear', 'paper'], beer: ['brown', 'gold'], cognac: ['amber', 'gold'] };
const mats = {};
const labelMat = { paper: () => mat('#ece6d6', { roughness: 0.9 }), gold: () => mat('#c9a23a', { roughness: 0.6 }), red: () => mat('#a8202a', { roughness: 0.7 }) };
export function blockyBottle(kind = 'beer') {
  const b = new Batch();
  const [glass, label] = LOOK[kind] ?? LOOK.beer;
  b.bottle(kind in SHAPES ? kind : 'beer', glass, label, 0, 0, 0);
  const g = new THREE.Group();
  for (const [key, geos] of b.parts) {
    const m = (mats[key] ??= GLASS[key]?.() ?? labelMat[key]());
    for (const geo of geos) g.add(new THREE.Mesh(geo, m));
  }
  return g;
}

// a bucket of geometries per material name; the caller merges and adds them
export class Batch {
  constructor() {
    this.parts = new Map();
  }
  put(key, geo) {
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
  }
  bottle(kind, glass, label, x, y, z) {
    const [bw, bh, nw, nh, l0, l1] = SHAPES[kind];
    this.put(glass, box(bw, bh, bw, x, y, z));
    this.put(glass, box(nw, nh, nw, x, y + bh, z));
    this.put('cap', box(nw + 0.006, 0.018, nw + 0.006, x, y + bh + nh, z));
    this.put(label, box(bw + 0.004, l1 - l0, bw + 0.004, x, y + l0, z));
  }
}

// ---------- printed things (canvas textures) ----------
const tex = {};
function canvasTex(key, w, h, draw) {
  if (tex[key]) return tex[key];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (tex[key] = t);
}

// one shelf row of cigarette packs with yellow price tags under them
export const cigarettes = (seed = 0) =>
  canvasTex(`cig${seed}`, 512, 96, (g, w, h) => {
    g.fillStyle = '#2b2622';
    g.fillRect(0, 0, w, h);
    const brands = ['#b3102a', '#1d3f8f', '#c9a227', '#161616', '#8a8f96', '#0f6b3a', '#5e1d52', '#d8d2c4'];
    const pw = 22, gap = 6;
    for (let i = 0, x = 4; x + pw < w; i++, x += pw + gap) {
      const c = brands[(i * 3 + seed * 5 + (i % 4 === 0 ? 1 : 0)) % brands.length];
      for (const y of [6, 36]) { // two packs stacked
        g.fillStyle = '#efebe1';
        g.fillRect(x, y, pw, 28);
        g.fillStyle = c;
        g.fillRect(x, y, pw, 11);
        g.fillRect(x + 7, y + 15, 8, 8);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + pw - 3, y, 3, 28);
      }
      if (i % 2 === 0) {
        g.fillStyle = '#f2d23a';
        g.fillRect(x, 70, pw * 2 + gap - 2, 18);
        g.fillStyle = '#1b1408';
        g.font = 'bold 14px Arial';
        g.fillText(String(180 + ((i * 37 + seed * 11) % 140)), x + 6, 84);
      }
    }
  });

export const pelmeniPack = () =>
  canvasTex('pelmeni', 64, 96, (g, w, h) => {
    g.fillStyle = '#eef3fb';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2350a8';
    g.fillRect(0, 0, w, 30);
    g.fillRect(0, h - 10, w, 10);
    g.fillStyle = '#fff';
    g.font = 'bold 11px Arial';
    g.fillText('ПЕЛЬМЕНИ', 4, 20);
    g.fillStyle = '#e8d9b0'; // the pelmeni in the window
    for (const [x, y] of [[18, 52], [38, 50], [28, 66], [46, 68], [14, 72]]) {
      g.beginPath();
      g.ellipse(x, y, 8, 6, 0, 0, Math.PI * 2);
      g.fill();
    }
  });

export const chipsBag = () =>
  canvasTex('chips', 64, 96, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#f0a020');
    gr.addColorStop(1, '#c4561a');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b3102a';
    g.fillRect(0, 22, w, 20);
    g.fillStyle = '#fff';
    g.font = 'bold 10px Arial';
    g.fillText('СУХАРИКИ', 4, 36);
    g.fillStyle = '#e8c47a';
    for (const [x, y] of [[16, 62], [34, 70], [48, 58], [24, 80]]) g.fillRect(x, y, 9, 7);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, 0, w, 5);
    g.fillRect(0, h - 5, w, 5);
  });

// a small printed sign: dark plate, light letters
export const signText = (text, { bg = '#1b1c20', fg = '#f2d23a', w = 512, h = 64 } = {}) =>
  canvasTex(`sign:${text}`, w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `bold ${Math.round(h * 0.55)}px Arial`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
