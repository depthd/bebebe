// Canvas pictures for the "paper" style (src/styles/paper.js): the paper grain, the plan AO under the
// furniture, cotton-wool puffs, the cut-out moon, the sticker border round the photo heads and the
// posterized skin prints. Everything is drawn here once, nothing is shipped.
import * as THREE from 'three';

export const PAPER = {
  white: '#f3ecdc',
  kraft: '#c8a476',
  card: '#b08a5a',
  ink: '#2b1d14',
  tape: '#e8d9b0',
  sticker: '#fbf7ee',
  stickerRim: '#cfc6b4',
  sky: '#1a2240',
  fog: '#141c33',
  lift: '#18140f',
};

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// separable box blur with wrap-around, so the tile stays seamless
function blurWrap(src, n, r) {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[y * n + ((x + d + n) % n)];
      tmp[y * n + x] = s * k;
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += tmp[((y + d + n) % n) * n + x];
      out[y * n + x] = s * k;
    }
  return out;
}

// 256² tileable paper: blurred white noise plus short darker fibres, luminance 0.9..1.0 (data, not colour)
export function grainTexture() {
  const n = 256, R = rng(1977);
  let v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = R();
  v = blurWrap(blurWrap(v, n, 1), n, 2);
  let lo = 1, hi = 0;
  for (const a of v) (lo = Math.min(lo, a)), (hi = Math.max(hi, a));
  for (let i = 0; i < v.length; i++) v[i] = 0.93 + 0.07 * ((v[i] - lo) / (hi - lo));
  // fibres: 1-px lines, a few px long, wrapping round the tile
  for (let f = 0; f < 200; f++) {
    let x = R() * n, y = R() * n;
    const a = R() * Math.PI * 2, len = 4 + R() * 12, tone = 0.89 + R() * 0.05;
    for (let t = 0; t < len; t++) {
      x += Math.cos(a) + (R() - 0.5) * 0.4;
      y += Math.sin(a) + (R() - 0.5) * 0.4;
      const i = ((Math.round(y) % n) + n) % n * n + ((Math.round(x) % n) + n) % n;
      v[i] = Math.min(v[i], tone);
    }
  }
  const c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let i = 0; i < v.length; i++) {
    const b = Math.round(Math.min(1, v[i]) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

// Plan AO: a top view of the flat (world x/z over `bounds`) with every footprint and solid wall in black,
// blurred, so floors darken next to furniture and walls, and walls darken at their foot.
// rects: [{x0, x1, z0, z1, k}] (k = how dark, 0..1), segs: [{a: [x, z], b: [x, z], w, k}]
export function planAOTexture(bounds, rects, segs, { size = 512, blur = 14 } = {}) {
  const c = canvas(size, size), g = c.getContext('2d');
  const sx = size / (bounds.x1 - bounds.x0), sz = size / (bounds.z1 - bounds.z0);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  for (const q of rects) {
    g.fillStyle = `rgba(0,0,0,${q.k ?? 1})`;
    g.fillRect((q.x0 - bounds.x0) * sx, (q.z0 - bounds.z0) * sz, (q.x1 - q.x0) * sx, (q.z1 - q.z0) * sz);
  }
  for (const s of segs) {
    g.strokeStyle = `rgba(0,0,0,${s.k ?? 1})`;
    g.lineWidth = s.w * sx;
    g.beginPath();
    g.moveTo((s.a[0] - bounds.x0) * sx, (s.a[1] - bounds.z0) * sz);
    g.lineTo((s.b[0] - bounds.x0) * sx, (s.b[1] - bounds.z0) * sz);
    g.stroke();
  }
  // blur through a second canvas with a white margin, so the edges stay white
  const out = canvas(size, size), o = out.getContext('2d');
  o.fillStyle = '#fff';
  o.fillRect(0, 0, size, size);
  o.filter = `blur(${blur}px)`;
  o.drawImage(c, 0, 0);
  o.filter = 'none';
  const t = new THREE.CanvasTexture(out);
  t.flipY = false; // canvas row = world z
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// cotton wool for smoke and vape: a dozen overlapping soft circles, a fibrous edge
export function drawCotton(c) {
  const n = c.width, g = c.getContext('2d'), R = rng(42);
  g.clearRect(0, 0, n, n);
  const m = n / 2;
  for (let i = 0; i < 12; i++) {
    const a = R() * Math.PI * 2, d = R() * n * 0.17, r = n * (0.13 + R() * 0.12);
    const x = m + Math.cos(a) * d, y = m + Math.sin(a) * d;
    const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // fibres pulled out of the edge
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = Math.max(1, n / 96);
  for (let i = 0; i < 70; i++) {
    const a = R() * Math.PI * 2, r0 = n * (0.22 + R() * 0.1), r1 = r0 + n * (0.05 + R() * 0.1);
    const bend = (R() - 0.5) * 0.5;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0);
    g.quadraticCurveTo(m + Math.cos(a + bend) * (r0 + r1) / 2, m + Math.sin(a + bend) * (r0 + r1) / 2, m + Math.cos(a + bend * 1.5) * r1, m + Math.sin(a + bend * 1.5) * r1);
    g.stroke();
  }
}

// a cut-out paper moon: pale yellow card, grey craters, a white cut edge and a marker outline
export function moonTexture() {
  const n = 256, c = canvas(n, n), g = c.getContext('2d'), R = rng(7);
  const m = n / 2, r = n * 0.4;
  const wobble = (rr) => {
    g.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2, k = rr * (1 + (i % 48 ? (R() - 0.5) * 0.02 : 0));
      i ? g.lineTo(m + Math.cos(a) * k, m + Math.sin(a) * k) : g.moveTo(m + Math.cos(a) * k, m + Math.sin(a) * k);
    }
    g.closePath();
  };
  g.fillStyle = PAPER.white;
  wobble(r + 7);
  g.fill();
  g.fillStyle = '#efe0a6';
  wobble(r);
  g.fill();
  g.fillStyle = 'rgba(160,140,90,0.35)';
  for (const [x, y, s] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [-0.05, 0.4, 0.12], [0.35, -0.35, 0.09], [-0.45, 0.2, 0.08]]) {
    g.beginPath();
    g.arc(m + x * r, m + y * r, s * r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = PAPER.ink;
  g.lineWidth = 3;
  wobble(r + 8);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The photo heads become stickers: a white paper border round the cut-out, its outermost pixel darker,
// a soft drop shadow down-right under it. The canvas grows by `pad` on each side; the caller rescales
// the sprite so the face keeps its size. Returns { canvas, pad }.
export function stickerCanvas(src, seed = 1) {
  const w = src.width, h = src.height;
  if (!w || !h) return null;
  const b = Math.max(4, Math.round(0.035 * Math.max(w, h))); // border width
  const shadowOff = Math.max(2, Math.round(b * 0.4));
  const pad = Math.ceil(b * 1.1 + shadowOff + 1);
  const W = w + 2 * pad, H = h + 2 * pad;
  const R = rng(seed);
  // the silhouette grown by r: the picture stamped round circles of radius r, r*2/3 and r/3 (thin hair
  // strands leave no gaps), each stamp a little off, so the edge looks cut by hand with scissors
  const rings = [[1, 20], [0.66, 14], [0.33, 8]].map(([k, n]) => Array.from({ length: n }, (_, i) => [(i / n) * Math.PI * 2, k * (0.9 + R() * 0.2)]));
  const grown = (r, color) => {
    const c = canvas(W, H), g = c.getContext('2d');
    for (const ring of rings) for (const [a, k] of ring) g.drawImage(src, pad + Math.cos(a) * r * k, pad + Math.sin(a) * r * k);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
    return c;
  };
  const out = canvas(W, H), g = out.getContext('2d');
  const rim = grown(b, PAPER.stickerRim);
  g.globalAlpha = 0.3;
  g.filter = `blur(${Math.max(1, b * 0.2)}px) brightness(0)`;
  g.drawImage(rim, shadowOff, shadowOff);
  g.filter = 'none';
  g.globalAlpha = 1;
  g.drawImage(rim, 0, 0);
  g.drawImage(grown(b - Math.max(1, b * 0.15), PAPER.sticker), 0, 0);
  g.drawImage(src, pad, pad);
  return { canvas: out, pad };
}

// a skin part print, posterized to 8 levels per channel (printed with a cheap inkjet)
export function posterize(src, dst) {
  const w = src.width, h = src.height;
  if (dst.width !== w || dst.height !== h) [dst.width, dst.height] = [w, h];
  const g = dst.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, w, h);
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) d[i + k] = Math.round(Math.round((d[i + k] / 255) * 7) * (255 / 7));
  }
  g.putImageData(img, 0, 0);
}
