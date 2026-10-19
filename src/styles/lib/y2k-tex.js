// "Тёплые нулевые" (src/styles/y2k.js): the procedural textures the style adds on top of the game's own.
//   noise()          a tileable 256² fBm: the ±8 % "lived-in" multiply on every surface
//   noiseNormal()    the same noise through a Sobel step: a tangent-space normal map (plaster, paper, weave)
//   parquetRough()   per-plank roughness drawn on the plank layout of textures.js parquet()
//   planAO(...)      the flat seen from above: walls and furniture footprints in black, blurred
//   blob()           a soft round contact shadow
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const dataTex = (canvas, repeat = true) => {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace; // data, not colour
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
};

// tileable value-noise fBm, 0..1, as a Float32Array of n*n
let heights = null;
function fbm(n = 256) {
  if (heights) return heights;
  const rnd = rng(1971);
  const out = new Float32Array(n * n);
  let amp = 1, total = 0;
  for (const period of [4, 8, 16, 32, 64]) {
    const grid = Array.from({ length: period * period }, rnd);
    const at = (i, j) => grid[((j + period) % period) * period + ((i + period) % period)];
    const cell = n / period;
    for (let y = 0; y < n; y++) {
      const gy = y / cell, j = Math.floor(gy), fy = gy - j, sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < n; x++) {
        const gx = x / cell, i = Math.floor(gx), fx = gx - i, sx = fx * fx * (3 - 2 * fx);
        const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
        const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
        out[y * n + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.55;
  }
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < out.length; k++) {
    out[k] /= total;
    lo = Math.min(lo, out[k]);
    hi = Math.max(hi, out[k]);
  }
  for (let k = 0; k < out.length; k++) out[k] = (out[k] - lo) / (hi - lo);
  return (heights = out);
}

let noiseT = null;
export function noise() {
  if (noiseT) return noiseT;
  const n = 256, h = fbm(n);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  for (let k = 0; k < n * n; k++) {
    const v = Math.round(h[k] * 255);
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v;
    img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (noiseT = dataTex(c));
}

// Sobel over the fBm (wrapping), plus a pinch of per-pixel grain so close up it reads as paper / weave
let normalT = null;
export function noiseNormal(strength = 5) {
  if (normalT) return normalT;
  const n = 256, h = fbm(n), rnd = rng(77);
  const grain = Float32Array.from({ length: n * n }, () => rnd() * 0.035);
  const H = (x, y) => {
    const k = ((y + n) % n) * n + ((x + n) % n);
    return h[k] + grain[k];
  };
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1);
      const dy = H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const k = (y * n + x) * 4;
      img.data[k] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[k + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[k + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return (normalT = dataTex(c));
}

// the plank layout of textures.js parquet() (512², 8 rows, planks half the width, every other row offset
// by a quarter): each plank gets its own wear, the joints are rough, a few scuffs across the busy middle
let parquetT = null;
export function parquetRough() {
  if (parquetT) return parquetT;
  const w = 512, h = 512, rows = 8, rh = h / rows, pl = w / 2;
  const rnd = rng(31);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const grey = (v) => {
    const q = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return `rgb(${q},${q},${q})`;
  };
  for (let i = 0; i < rows; i++) {
    const off = (i % 2) * (pl / 2);
    for (let x = -pl; x < w + pl; x += pl) {
      g.fillStyle = grey(0.42 + rnd() * 0.3); // lacquer .. worn
      g.fillRect(x + off, i * rh, pl, rh);
      // worn streaks along the grain
      for (let k = 0; k < 3; k++) {
        g.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.08})`;
        g.fillRect(x + off + rnd() * pl * 0.6, i * rh + rnd() * rh, pl * (0.2 + rnd() * 0.4), 2 + rnd() * 5);
      }
      g.fillStyle = grey(0.85);
      g.fillRect(x + off, i * rh, 3, rh);
    }
    g.fillStyle = grey(0.85);
    g.fillRect(0, i * rh, w, 3);
  }
  return (parquetT = dataTex(c));
}

// The flat from above, 1 = open floor, 0 = wall or under furniture, blurred into a soft falloff.
// box = { x0, x1, z0, z1 } in world metres; rects = [{x0,x1,z0,z1}]; segs = [{a:[x,z], b:[x,z], t}].
// Row 0 of the canvas is z0 (flipY off), so the shader samples it at (pos.xz - box.min) / size.
export function planAO(box, rects, segs, { pxPerM = 48, blurM = 0.26 } = {}) {
  const W = Math.round((box.x1 - box.x0) * pxPerM), H = Math.round((box.z1 - box.z0) * pxPerM);
  const px = (x) => (x - box.x0) * pxPerM, pz = (z) => (z - box.z0) * pxPerM;
  const shapes = document.createElement('canvas');
  shapes.width = W;
  shapes.height = H;
  const s = shapes.getContext('2d');
  s.fillStyle = '#fff';
  s.fillRect(0, 0, W, H);
  s.fillStyle = '#000';
  for (const q of rects) s.fillRect(px(q.x0), pz(q.z0), (q.x1 - q.x0) * pxPerM, (q.z1 - q.z0) * pxPerM);
  s.strokeStyle = '#000';
  for (const d of segs) {
    s.lineWidth = d.t * pxPerM;
    s.beginPath();
    s.moveTo(px(d.a[0]), pz(d.a[1]));
    s.lineTo(px(d.b[0]), pz(d.b[1]));
    s.stroke();
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.filter = `blur(${Math.round(blurM * pxPerM)}px)`;
  g.drawImage(shapes, 0, 0);
  g.filter = 'none';
  const t = dataTex(c, false);
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

let blobT = null;
export function blob() {
  if (blobT) return blobT;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  r.addColorStop(0, 'rgba(0,0,0,0.85)');
  r.addColorStop(0.35, 'rgba(0,0,0,0.6)');
  r.addColorStop(0.7, 'rgba(0,0,0,0.18)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (blobT = t);
}
