// Faces of the guys. A photo (cropped to the face, normalized x, y, w, h) or a drawn placeholder.
// To add someone's face: drop a photo into src/assets/faces/ and add it here.
import kirill from '../assets/faces/kirill.png?inline';
import kirillDrink from '../assets/faces/kirill-drink.png?inline';
import lyokhaSheet from '../assets/skins/lyokha.png?inline';

const PHOTOS = {
  kirill: { src: kirill, crop: [0.16, 0.0, 0.74, 0.8], w: 449, h: 600 },
  // shown instead of the head while he drinks (bottle and hand included)
  kirillDrink: { src: kirillDrink, crop: [0, 70 / 600, 420 / 450, 370 / 600], w: 450, h: 600 },
  // cartoon head from his skin sheet until there's a photo; white sheet background keyed out
  lyokha: { src: lyokhaSheet, crop: [73 / 600, 40 / 334, 46 / 600, 52 / 334], w: 600, h: 334, keyWhite: true },
};

const cache = {};

function loadPhoto(id) {
  const p = PHOTOS[id];
  if (!p) return null;
  if (!cache[id]) {
    cache[id] = { img: new Image(), ready: false, waiters: [] };
    cache[id].img.onload = () => {
      cache[id].ready = true;
      cache[id].waiters.forEach((fn) => fn());
    };
    cache[id].img.src = p.src;
  }
  return cache[id];
}

// width / height of the face picture (photo crop), for sizing billboard heads
export function faceAspect(id) {
  const p = PHOTOS[id];
  if (!p) return 0.8;
  const [, , cw, ch] = p.crop;
  return (cw * (p.w ?? 1)) / (ch * (p.h ?? 1));
}

// Draws the face into ctx at (x, y, w, h). Calls onReady again when a photo finishes loading.
// cutout: keep the photo's transparent background (billboard heads) instead of filling it.
export function drawFace(ctx, id, { skin, hair }, x, y, w, h, onReady, { cutout = false } = {}) {
  const photo = loadPhoto(id);
  const draw = () => {
    if (photo?.ready) {
      const [cx, cy, cw, ch] = PHOTOS[id].crop;
      const { naturalWidth: iw, naturalHeight: ih } = photo.img;
      ctx.clearRect(x, y, w, h);
      ctx.drawImage(photo.img, cx * iw, cy * ih, cw * iw, ch * ih, x, y, w, h);
      if (cutout) {
        if (PHOTOS[id].keyWhite) {
          const px = ctx.getImageData(x, y, w, h);
          const d = px.data;
          for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) d[i + 3] = 0;
          ctx.putImageData(px, x, y);
        }
        return;
      }
      // cut-out photo: fill the see-through / whitish background with the hair colour
      const [hr, hg, hb] = [1, 3, 5].map((i) => parseInt(hair.slice(i, i + 2), 16));
      const px = ctx.getImageData(x, y, w, h);
      for (let i = 0; i < px.data.length; i += 4) {
        const d = px.data;
        const a = d[i + 3] / 255;
        const whitish = d[i] > 215 && d[i + 1] > 215 && d[i + 2] > 215;
        const t = whitish ? 1 : 1 - a; // blend semi-transparent edges into the hair colour
        d[i] = d[i] * (1 - t) + hr * t;
        d[i + 1] = d[i + 1] * (1 - t) + hg * t;
        d[i + 2] = d[i + 2] * (1 - t) + hb * t;
        d[i + 3] = 255;
      }
      ctx.putImageData(px, x, y);
      return;
    }
    // placeholder: skin, hair fringe, eyes, brows, mouth
    const u = w / 16, v = h / 16;
    ctx.fillStyle = skin;
    if (cutout) {
      // oval head on a transparent background
      ctx.clearRect(x, y, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w * 0.46, h * 0.48, 0, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = hair;
    ctx.fillRect(x, y, w, v * 4);
    ctx.fillRect(x, y, u * 2, v * 7);
    ctx.fillRect(x + w - u * 2, y, u * 2, v * 7);
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(x + u * 4, y + v * 6, u * 2, v * 2);
    ctx.fillRect(x + u * 10, y + v * 6, u * 2, v * 2);
    ctx.fillRect(x + u * 3, y + v * 5, u * 4, v * 0.8);
    ctx.fillRect(x + u * 9, y + v * 5, u * 4, v * 0.8);
    ctx.fillStyle = '#b86a5a';
    ctx.fillRect(x + u * 5, y + v * 11.5, u * 6, v * 1.2);
    if (cutout) ctx.restore();
  };
  draw();
  if (photo && !photo.ready) photo.waiters.push(() => (draw(), onReady?.()));
}

// ---------- mood faces: src/assets/faces/<who>_<state>.(png|jpg|webp) ----------
// States: default, happy, angry, sad, doing (+ anything else, e.g. cry, looked up by name).
// Generated heads on a white background: the background is removed by flood fill from the
// edges (so the whites of the eyes stay), then the picture is cropped to the head.
const FILES = import.meta.glob('../assets/faces/*_*.{png,jpg,jpeg,webp}', { eager: true, query: '?inline', import: 'default' });
const STATES = {};
for (const [path, src] of Object.entries(FILES)) {
  const m = path.match(/\/([a-z]+)_([a-z]+)\.\w+$/);
  if (m) (STATES[m[1]] ??= {})[m[2]] = src;
}

export const hasMoodFaces = (who) => !!STATES[who];
// best available picture for this state: the state itself, else default, else null (use the old photo)
export const moodState = (who, state) => (STATES[who]?.[state] ? state : STATES[who]?.default ? 'default' : null);

const cuts = {};
// { canvas, aspect, ready, then(fn) }: the cut-out head, processed once and shared
export function moodFace(who, state) {
  const key = `${who}_${state}`;
  if (cuts[key]) return cuts[key];
  const entry = { canvas: null, aspect: 0.65, ready: false, waiters: [], then(fn) { this.ready ? fn(this) : this.waiters.push(fn); } };
  cuts[key] = entry;
  const src = STATES[who]?.[state];
  if (!src) return entry;
  const img = new Image();
  img.onload = () => {
    const c = cutOut(img);
    entry.canvas = c;
    entry.aspect = c.width / c.height;
    entry.ready = true;
    entry.waiters.forEach((fn) => fn(entry));
  };
  img.src = src;
  return entry;
}

function cutOut(img) {
  const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h);
  const d = px.data;
  const isBg = (i) => {
    if (d[i + 3] < 30) return true;
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    return r > 218 && gg > 218 && b > 218 && Math.max(r, gg, b) - Math.min(r, gg, b) < 28;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const k = y * w + x;
    if (!seen[k] && isBg(k * 4)) {
      seen[k] = 1;
      stack.push(k);
    }
  };
  for (let x = 0; x < w; x++) push(x, 0), push(x, h - 1);
  for (let y = 0; y < h; y++) push(0, y), push(w - 1, y);
  while (stack.length) {
    const k = stack.pop();
    const x = k % w, y = (k / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let k = 0; k < w * h; k++) {
    if (seen[k]) {
      d[k * 4 + 3] = 0;
      continue;
    }
    // soften the edge: a pixel touching the background gets half alpha
    const x = k % w, y = (k / w) | 0;
    if ((x > 0 && seen[k - 1]) || (x < w - 1 && seen[k + 1]) || (y > 0 && seen[k - w]) || (y < h - 1 && seen[k + w])) d[k * 4 + 3] = Math.min(d[k * 4 + 3], 140);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  g.putImageData(px, 0, 0);
  if (x1 <= x0 || y1 <= y0) return c;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
