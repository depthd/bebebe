// The doom style's 256 colours (scripts/assets/styles/doom_palette.json, shared with the Blender pass):
// nearest-colour lookups in CIELAB through a precomputed 32^3 table, image quantisation (optionally with
// a 4x4 ordered dither for the digitised-photo sprites), and the 3D LUT for the palette post pass.
import * as THREE from 'three';
import DATA from '../../../scripts/assets/styles/doom_palette.json';

export const PALETTE = DATA.ramps.flatMap((r) => r.colors).map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
export const ANCHORS = DATA.anchors;

// sRGB bytes -> CIELAB (D65)
const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function lab(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const PAL_LAB = PALETTE.map((c) => lab(...c));

// wL < 1 weighs lightness less than hue and chroma: a shaded colour then stays in its own ramp
function nearest(r, g, b, wL = 1) {
  const [L, A, B] = lab(r, g, b);
  let best = 0, bd = Infinity;
  for (let i = 0; i < PAL_LAB.length; i++) {
    const p = PAL_LAB[i];
    const d = wL * (p[0] - L) ** 2 + (p[1] - A) ** 2 + (p[2] - B) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// 32 levels per channel: grid value i = i * 255 / 31
export const N = 32;
export const LUT = new Uint8Array(N * N * N); // palette index per grid cell, index = r + g*N + b*N*N
for (let b = 0; b < N; b++)
  for (let g = 0; g < N; g++)
    for (let r = 0; r < N; r++) LUT[r + g * N + b * N * N] = nearest((r * 255) / 31, (g * 255) / 31, (b * 255) / 31);

const q = (v) => Math.min(31, Math.max(0, Math.round((v * 31) / 255)));
export const snapIndex = (r, g, b) => LUT[q(r) + q(g) * N + q(b) * N * N];
export const snap = (r, g, b) => PALETTE[snapIndex(r, g, b)];
export function snapHex(color) {
  // a THREE.Color in linear working space -> the nearest palette colour (same space)
  const c = color.clone().convertLinearToSRGB();
  const [r, g, b] = snap(c.r * 255, c.g * 255, c.b * 255);
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

// 4x4 Bayer matrix, -0.5..0.5
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

// quantise ImageData in place. dither: amplitude in 0..1 of full range (1/16 = ±16 levels);
// alphaCut: alpha below it becomes 0, above it 255 (cut-outs), or null to keep alpha as is
export function quantise(img, { dither = 0, alphaCut = null } = {}) {
  const d = img.data, w = img.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (alphaCut != null) d[i + 3] = d[i + 3] < alphaCut * 255 ? 0 : 255;
    if (d[i + 3] === 0) continue;
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (dither) {
      const o = BAYER[(p % w & 3) + ((((p / w) | 0) & 3) << 2)] * dither * 2 * 255;
      r += o; g += o; b += o;
    }
    const c = PALETTE[snapIndex(r, g, b)];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
  }
  return img;
}

// the post pass's 3D LUT: every display colour to its palette colour (RGBA8, sampled nearest).
// wL: lightness weight (see nearest)
export function lut3D(wL = 1) {
  const data = new Uint8Array(N * N * N * 4);
  for (let i = 0; i < LUT.length; i++) {
    const r = i % N, g = ((i / N) | 0) % N, b = (i / (N * N)) | 0;
    const c = PALETTE[wL === 1 ? LUT[i] : nearest((r * 255) / 31, (g * 255) / 31, (b * 255) / 31, wL)];
    data.set([c[0], c[1], c[2], 255], i * 4);
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
