// The "doom" art style's one shared 256-colour palette: 16 ramps x 16 shades, dark to light, like
// Doom's PLAYPAL. `node scripts/assets/styles/doom_palette.mjs` writes doom_palette.json next to it;
// the engine (src/styles/doom.js) and the Blender pass (doom.py) both read that file.
// Each ramp is a few anchor colours taken from the game's own materials and canvas textures
// (wallpapers, ковёр, parquet, the guys' shirts...), interpolated in OKLab and sampled at 16 shades.
// Pinned anchors (the lamp, the moon, the broken mark, the cat's eyes, the sprite outline...) replace
// the nearest shade of their ramp, so those exact colours exist in the palette.
import { writeFileSync } from 'node:fs';

// [name, [[t, '#hex', pin?], ...]] t = 0 darkest .. 1 lightest
const RAMPS = [
  ['veneer brown', [[0, '#100c08', 1], [0.25, '#2a180e'], [0.42, '#3b2416'], [0.58, '#6b4428'], [0.78, '#a07450'], [1, '#ead2b4']]],
  ['parquet orange-brown', [[0, '#1a0d05'], [0.3, '#4a2812'], [0.5, '#7c5130'], [0.68, '#a8703e'], [0.84, '#d09a5e'], [1, '#f6d6a6']]],
  // the living-room wallpaper as the lamp lights it, from the far dim end to right under the chandelier
  ['living-room ochre', [[0, '#1c160c'], [0.3, '#54422a'], [0.5, '#8a7148'], [0.6, '#a68958'], [0.7, '#bba077'], [0.8, '#d2b98e'], [0.9, '#e6cfa6'], [1, '#fdf4de']]],
  // the kitchen's olive wallpaper and enamel under the warm lamp: yellow-olive in the mid-tones
  ['kitchen olive', [[0, '#10120a'], [0.3, '#3a3d20'], [0.5, '#6e6e3e'], [0.62, '#908d58'], [0.74, '#a8a86a'], [0.86, '#c9c98e'], [1, '#f6f6e2']]],
  ['hall orange', [[0, '#1e0d05'], [0.3, '#5a2e16'], [0.52, '#a8704a'], [0.72, '#d6955e'], [0.88, '#ffd7a0', 1], [1, '#fff4e2']]],
  ['bedroom blue-grey', [[0, '#070b16'], [0.22, '#18294c'], [0.42, '#2f5c9e'], [0.66, '#7f9bbf'], [0.8, '#9fb4c8'], [1, '#f0f5fa']]],
  // the light end is desaturated: pink cheeks and lips in the photo faces, the cake
  ['kovyor red', [[0, '#140404'], [0.25, '#5e1010'], [0.4, '#8e1c1c'], [0.54, '#b3352d'], [0.66, '#ff3b30', 1], [0.75, '#e8705e'], [0.86, '#e0a69a'], [1, '#f6e2de']]],
  ['rug navy', [[0, '#05071a'], [0.18, '#161f40'], [0.32, '#23305a'], [0.48, '#463c94'], [0.6, '#6b3fa0'], [0.78, '#a383d6'], [1, '#ece4ff']]],
  // the cream enamel (tub, stove, sink, fridge) and the white tablecloth, which the warm lamps turn tan
  ['enamel cream', [[0, '#191712'], [0.3, '#4c4538'], [0.48, '#7e7060'], [0.6, '#a08a6a'], [0.7, '#b69c81'], [0.8, '#d0bca0'], [0.9, '#e7ddc7'], [1, '#fffdf6']]],
  // photo skin: the friends' own skin tones (quantiles of the skin pixels in src/assets/faces), so the
  // digitised faces keep their colour instead of falling into the greys
  ['skin', [[0, '#1c0d08'], [0.1, '#40261a'], [0.2, '#674335'], [0.3, '#7b5848'], [0.4, '#926b5a'], [0.5, '#aa8070'], [0.6, '#c09887'], [0.7, '#cda391'], [0.8, '#d8b4a0'], [0.9, '#e8cbb8'], [1, '#f8e6dc']]],
  ['stairwell green', [[0, '#050e08'], [0.3, '#1e3626'], [0.48, '#4c7358', 1], [0.68, '#8aaa8e'], [0.84, '#cfe8c8', 1], [1, '#f2fff0']]],
  // white-green tiles: lamp-lit they go a warm sage, in the shade a cold grey-green
  ['bath-tile white-green', [[0, '#081212'], [0.3, '#344a4a'], [0.5, '#6b7474'], [0.62, '#8f9886'], [0.74, '#a9b29c'], [0.86, '#c6d2c2'], [1, '#f4fcfc']]],
  // concrete and plaster: warm greys, so a lamp-lit white ceiling stays a greige and never turns pink
  ['concrete grey', [[0, '#060606'], [0.4, '#4e4a44'], [0.55, '#6d6a66'], [0.68, '#8e8878'], [0.8, '#b0a690'], [0.9, '#cfc6b2'], [1, '#f6f4f0']]],
  ['neon green', [[0, '#03120a'], [0.28, '#0d3b2a'], [0.5, '#1d9a58'], [0.7, '#4cff7a'], [0.85, '#7dffb0'], [1, '#e2fff0']]],
  ['fire orange', [[0, '#1e0600'], [0.24, '#6a1a02'], [0.42, '#c03a08'], [0.55, '#ff5a10'], [0.66, '#f08a1c', 1], [0.8, '#ffc23e'], [1, '#fff6c0']]],
  ['night blue-black', [[0, '#000000'], [0.12, '#0b0f1c', 1], [0.26, '#161a26'], [0.46, '#2e3650'], [0.66, '#58668e'], [0.8, '#8090c0', 1], [1, '#d4dcf4']]],
];

// ---- sRGB <-> OKLab
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
function oklab([r, g, b]) {
  [r, g, b] = [r, g, b].map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => toSrgb(Math.min(1, Math.max(0, v))));
}

const ramps = RAMPS.map(([name, anchors]) => {
  const lab = anchors.map(([t, h]) => [t, oklab(hex2rgb(h))]);
  const shades = [];
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    let k = 0;
    while (k < lab.length - 2 && t > lab[k + 1][0]) k++;
    const [t0, a] = lab[k], [t1, b] = lab[k + 1];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    shades.push(rgb2hex(fromOklab(a.map((v, j) => v + (b[j] - v) * u))));
  }
  // pinned anchors replace the nearest shade (by position in the ramp)
  for (const [t, h, pin] of anchors) if (pin) shades[Math.round(t * 15)] = h;
  return { name, colors: shades };
});

const colors = ramps.flatMap((r) => r.colors);
const anchors = { lamp: '#ffd7a0', stairwellLamp: '#cfe8c8', moon: '#8090c0', broken: '#ff3b30', catEyes: '#f08a1c', outline: '#100c08', night: '#0b0f1c' };
for (const [k, h] of Object.entries(anchors)) if (!colors.includes(h)) throw new Error(`anchor ${k} ${h} is not in the palette`);
const out = process.env.OUT ? new URL(`file://${process.env.OUT}`) : new URL('./doom_palette.json', import.meta.url);
writeFileSync(out, JSON.stringify({ about: 'doom style palette: 16 ramps x 16 shades (dark to light); generated by doom_palette.mjs', anchors, ramps }, null, 1) + '\n');
console.log(`${colors.length} colours, ${new Set(colors).size} unique -> ${out.pathname}`);
