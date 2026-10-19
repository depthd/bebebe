// Canvas work for the toon style (src/styles/toon.js): flat-colour posterizing (k-means), calmer
// wallpaper motifs, the sticker rim around the photo heads, the ink border on skin parts and the
// hard-edged cartoon puff. Everything here draws into new canvases; the game's own canvases are never touched.

export const INK = '#1b1410';
export const RIM = '#fffaf0';

const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
};
const sizeOf = (img) => [img.naturalWidth || img.videoWidth || img.width || 0, img.naturalHeight || img.videoHeight || img.height || 0];

// rgb [0..255] <-> hsl, for the saturation push on the cluster colours
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2rgb(h, s, l) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
export function saturate(rgb, k) {
  const [h, s, l] = rgb2hsl(...rgb);
  return hsl2rgb(h, Math.min(1, s * k), l);
}

// k colours for the opaque pixels of an RGBA buffer: k-means on a ~64x64 sample, 10 rounds,
// seeded by k-means++ (deterministic: the farthest pixel each time)
export function kmeans(data, w, h, k, iters = 10) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4096)));
  const pts = [];
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (data[i + 3] >= 128) pts.push([data[i], data[i + 1], data[i + 2]]);
    }
  if (!pts.length) return [];
  // seeds: the mean, then the point farthest from all seeds so far
  const mean = [0, 0, 0];
  for (const p of pts) for (let c = 0; c < 3; c++) mean[c] += p[c] / pts.length;
  const cents = [mean];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  while (cents.length < k) {
    let best = null, bd = -1;
    for (const p of pts) {
      let m = Infinity;
      for (const c of cents) m = Math.min(m, d2(p, c));
      if (m > bd) [bd, best] = [m, p];
    }
    if (bd < 16) break; // fewer distinct colours than k
    cents.push([...best]);
  }
  const lab = new Int32Array(pts.length);
  for (let it = 0; it < iters; it++) {
    const sum = cents.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => {
      let m = Infinity, j = 0;
      cents.forEach((c, ci) => {
        const d = d2(p, c);
        if (d < m) [m, j] = [d, ci];
      });
      lab[i] = j;
      const s = sum[j];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    sum.forEach((s, j) => s[3] && (cents[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
  }
  return cents;
}

// nearest-centroid remap, in place (alpha kept)
function remap(data, cents, out = cents) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let m = Infinity, j = 0;
    for (let c = 0; c < cents.length; c++) {
      const q = cents[c];
      const d = (data[i] - q[0]) ** 2 + (data[i + 1] - q[1]) ** 2 + (data[i + 2] - q[2]) ** 2;
      if (d < m) [m, j] = [d, c];
    }
    data[i] = out[j][0];
    data[i + 1] = out[j][1];
    data[i + 2] = out[j][2];
  }
}

// A flat-colour copy of an image or canvas: k colours, each pushed in saturation.
// calm (wallpapers): every pixel first goes 60% of the way to the background colour, so the motif
// is a quiet pattern under the ink. maxSize caps photo textures (GLB props).
export function posterize(img, { k = 5, calm = 0, sat = 1.15, maxSize = 512 } = {}) {
  const [sw, sh] = sizeOf(img);
  if (!sw || !sh) return null;
  const f = Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.round(sw * f), h = Math.round(sh * f);
  const c = canvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  if (calm > 0) {
    const [bg] = kmeans(d, w, h, 1); // the mean is close enough to the ground on a sparse motif
    const [dom] = dominant(d, w, h, bg);
    for (let i = 0; i < d.length; i += 4)
      for (let ch = 0; ch < 3; ch++) d[i + ch] += (dom[ch] - d[i + ch]) * calm;
  }
  const cents = kmeans(d, w, h, k);
  if (cents.length) remap(d, cents, cents.map((q) => saturate(q, sat)));
  g.putImageData(id, 0, 0);
  return c;
}

// the most common colour (coarse histogram), for the wallpaper ground
function dominant(d, w, h, fallback) {
  const bins = new Map();
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4096)));
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      const b = bins.get(key) ?? [0, 0, 0, 0];
      b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++;
      bins.set(key, b);
    }
  let best = null;
  for (const b of bins.values()) if (!best || b[3] > best[3]) best = b;
  return [best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : fallback];
}

// skin part (64x128 piece of the sheet): 6 flat colours and a 2 px ink border, which draws the box edges
export function skinPart(src) {
  const c = posterize(src, { k: 6, sat: 1.1 });
  if (!c) return null;
  const g = c.getContext('2d');
  g.strokeStyle = INK;
  g.lineWidth = 4; // centred on the edge: 2 px inside
  g.strokeRect(0, 0, c.width, c.height);
  return c;
}

// distance (in px, chamfer 1/sqrt2) from every pixel to the nearest opaque one, on a padded grid
function distanceField(alpha, w, h, cut) {
  const INF = 1e9;
  const D = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) D[i] = alpha[i] >= cut ? 0 : INF;
  const S = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = D[i];
      if (!v) continue;
      if (x > 0) v = Math.min(v, D[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, D[i - w] + 1);
        if (x > 0) v = Math.min(v, D[i - w - 1] + S);
        if (x < w - 1) v = Math.min(v, D[i - w + 1] + S);
      }
      D[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = D[i];
      if (!v) continue;
      if (x < w - 1) v = Math.min(v, D[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, D[i + w] + 1);
        if (x < w - 1) v = Math.min(v, D[i + w + 1] + S);
        if (x > 0) v = Math.min(v, D[i + w - 1] + S);
      }
      D[i] = v;
    }
  return D;
}

// The sticker: the cut-out photo on a white rim (white px) with an ink outline (ink px) round it.
// Returns { canvas, pad }: the canvas is the source grown by pad on every side.
// poster: an optional cel feel for the photo (3x3 blur, 6 levels per channel).
export function sticker(src, { white = 6, ink = 3, poster = false } = {}) {
  const [w, h] = sizeOf(src);
  if (!w || !h) return null;
  const pad = Math.ceil(white + ink + 2);
  const W = w + 2 * pad, H = h + 2 * pad;
  const c = canvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, pad, pad);
  const id = g.getImageData(0, 0, W, H);
  const d = id.data;
  const alpha = new Uint8Array(W * H);
  let any = false;
  for (let i = 0; i < W * H; i++) {
    alpha[i] = d[i * 4 + 3];
    if (alpha[i] >= 128) any = true;
  }
  if (!any) return null; // not drawn yet
  const D = distanceField(alpha, W, H, 128);
  const ir = [0x1b, 0x14, 0x10], wr = [0xff, 0xfa, 0xf0];
  const R = white + ink;
  const rim = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const dist = D[i];
    const aInk = Math.max(0, Math.min(1, R + 0.5 - dist));
    if (!aInk) continue;
    const aW = Math.max(0, Math.min(1, white + 0.5 - dist));
    const j = i * 4;
    for (let ch = 0; ch < 3; ch++) rim[j + ch] = ir[ch] + (wr[ch] - ir[ch]) * aW;
    rim[j + 3] = 255 * aInk;
  }
  let photo = src;
  if (poster) photo = posterPhoto(src, w, h);
  g.putImageData(new ImageData(rim, W, H), 0, 0);
  g.drawImage(photo, pad, pad);
  return { canvas: c, pad };
}

// a cel feel that keeps the likeness: soften by a 3x3 box, then 6 levels per channel
function posterPhoto(src, w, h) {
  const c = canvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.filter = 'blur(0.8px)';
  g.drawImage(src, 0, 0);
  g.filter = 'none';
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  const lv = 5; // 6 levels
  for (let i = 0; i < d.length; i += 4) for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.round((d[i + ch] / 255) * lv) * (255 / lv);
  // the alpha of the blurred copy is soft: take the original's
  const o = canvas(w, h).getContext('2d', { willReadFrequently: true });
  o.drawImage(src, 0, 0);
  const a = o.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) d[i] = a[i];
  g.putImageData(id, 0, 0);
  return c;
}

// a hard-edged cartoon puff (vape, smoke): three round lobes, white, with a 2 px ink rim
export function puffCanvas() {
  const S = 64;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const lobes = [[26, 36, 15], [40, 34, 14], [33, 24, 14], [33, 40, 12]];
  g.fillStyle = INK;
  for (const [x, y, r] of lobes) {
    g.beginPath();
    g.arc(x, y, r + 2.2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  for (const [x, y, r] of lobes) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // one flat shade on the lower side, cel style
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(150,160,200,0.35)';
  g.beginPath();
  g.ellipse(34, 50, 26, 10, 0, 0, Math.PI * 2);
  g.fill();
  return c;
}
