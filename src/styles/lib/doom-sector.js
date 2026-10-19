// Doom-style sector light for the doom art style: a world-space light map over the flat, the stairwell,
// the yard and the kiosk. Each texel holds the light of the room (sector) it is in: rgb = the sector's
// light colour times its level (display space, 0..1), a = the level, which also sets how fast the light
// dies off with distance in the shader. Two layers stacked in the texture: the flat's level (y above
// SPLIT_Y) and the street level, so the yard under the balcony isn't lit like the balcony.
// update() follows the room lamps (a lamp turned down darkens its sector) and paints fire / grill light
// as warm discs, re-uploading only the rows that changed.
import * as THREE from 'three';
import { ROOMS, roomAt, planToWorld } from '../../world/layout.js';

export const SIZE = 512; // texels per side of one layer
export const SPAN = 40; // metres per side
export const SPLIT_Y = -1.5; // below: the street-level layer

// [level, colour] per sector; colours are mixed towards white by TINT in the map
export const SECTORS = {
  living: [1.0, '#ffd7a0'],
  bedroom: [0.85, '#ffd7a0'],
  kitchen: [0.9, '#ffd7a0'],
  bath: [0.8, '#ffd7a0'],
  hall: [0.6, '#ffd7a0'],
  balcony: [0.45, '#ffd7a0'],
  stairwell: [0.35, '#cfe8c8'],
  yard: [0.22, '#8090c0'],
  kiosk: [0.95, '#f4f8ff'],
  room: [0.9, '#ffd7a0'], // the showroom: one lit room everywhere
};
const ZONES = { 'Продукты 24': 'kiosk', Двор: 'yard', Подъезд: 'stairwell' };

export function createSector({ apt, outside, game, tint = 0.6 } = {}) {
  const flat = !!(apt && outside);
  // the square covers the yard, the kiosk, the stairwell and the flat
  const a = planToWorld.pt(-3, -14), b = planToWorld.pt(16, 6.5);
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
  const x0 = cx - SPAN / 2, z0 = cz - SPAN / 2, cell = SPAN / SIZE;
  const W = SIZE, Hh = SIZE * 2; // two layers
  const ids = Object.keys(SECTORS);
  const col = Object.fromEntries(
    ids.map((id) => {
      const [level, hex] = SECTORS[id];
      const c = new THREE.Color(hex); // working (linear) -> back to display for the mix
      const s = c.clone().convertLinearToSRGB();
      return [id, [level, [s.r, s.g, s.b].map((v) => 1 - tint + tint * v)]];
    }),
  );

  // ---- which sector every texel is in (Uint8 index into ids, 255 = unknown, filled below)
  const sec = new Uint8Array(W * Hh).fill(255);
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  const fillDefault = flat ? idx.yard : idx.room;
  if (flat) {
    for (let j = 0; j < SIZE; j++) {
      const z = z0 + (j + 0.5) * cell;
      for (let i = 0; i < SIZE; i++) {
        const x = x0 + (i + 0.5) * cell;
        const room = roomAt(x, z);
        const zone = ZONES[outside.zoneName(x, z)];
        // upper layer: the flat's rooms first, then the outside zones; inside walls stays unknown
        const up = room ? (room.id === 'landing' ? 'stairwell' : room.id) : zone;
        if (up) sec[(SIZE + j) * W + i] = idx[up];
        // street level: the outside zones; anything else down there is the open yard
        const lo = zone ?? (room?.id === 'landing' ? 'stairwell' : 'yard');
        sec[j * W + i] = idx[lo];
      }
    }
    // texels inside walls take their brightest neighbour's sector (a few passes), the rest is yard
    let open = [];
    for (let k = SIZE * W; k < Hh * W; k++) if (sec[k] === 255) open.push(k);
    const lv = ids.map((id) => SECTORS[id][0]);
    for (let pass = 0; pass < 10 && open.length; pass++) {
      const set = [];
      for (const k of open) {
        let best = 255;
        for (const n of [k - 1, k + 1, k - W, k + W]) {
          const s2 = n >= SIZE * W && n < Hh * W ? sec[n] : 255;
          if (s2 !== 255 && (best === 255 || lv[s2] > lv[best])) best = s2;
        }
        if (best !== 255) set.push(k, best);
      }
      for (let q = 0; q < set.length; q += 2) sec[set[q]] = set[q + 1];
      open = open.filter((k) => sec[k] === 255);
    }
  }
  for (let k = 0; k < sec.length; k++) if (sec[k] === 255) sec[k] = fillDefault;

  // ---- lamps: each room lamp scales its sector
  const lampOf = {}; // sector id -> [light, initial intensity]
  if (flat) {
    let li = 0;
    for (const room of ROOMS) {
      if (!room.lamp) continue;
      const l = apt.lights[li++];
      if (l) lampOf[room.id === 'landing' ? 'stairwell' : room.id] = [l, l.intensity];
    }
  }
  const lampK = Object.fromEntries(ids.map((id) => [id, 1]));

  // ---- static light pools baked into the street layer: the yard's lamp posts
  const pools = [];
  if (flat) {
    outside.group.traverse((o) => {
      if (!o.isPointLight || o.position.y > -1 || o.color.getHexString() !== 'ffb866') return;
      pools.push({ x: o.position.x, z: o.position.z, r: 4.5, c: [1.0, 0.78, 0.5], k: 0.5 });
    });
  }

  // base: float light per texel (r, g, b, level), without dynamic lights
  const base = new Float32Array(W * Hh * 4);
  const perSector = new Float32Array(ids.length * 4);
  const writeBase = () => {
    ids.forEach((id, i) => {
      const [level, c] = col[id];
      const lv = level * (lampOf[id] ? 0.2 + 0.8 * lampK[id] : 1);
      perSector.set([c[0] * lv, c[1] * lv, c[2] * lv, lv], i * 4);
    });
    for (let k = 0; k < W * Hh; k++) {
      const o = sec[k] * 4;
      base[k * 4] = perSector[o];
      base[k * 4 + 1] = perSector[o + 1];
      base[k * 4 + 2] = perSector[o + 2];
      base[k * 4 + 3] = perSector[o + 3];
    }
  };
  writeBase();
  const disc = (arr, p, layer, scale = 1) => {
    // add a light pool into a float array (base), returns the texel rect touched
    const ci = Math.floor((p.x - x0) / cell), cj = Math.floor((p.z - z0) / cell), rr = Math.ceil(p.r / cell);
    const i0 = Math.max(0, ci - rr), i1 = Math.min(W - 1, ci + rr), j0 = Math.max(0, cj - rr), j1 = Math.min(SIZE - 1, cj + rr);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - ci, j - cj) * cell;
        if (d >= p.r) continue;
        const f = p.k * scale * (1 - d / p.r) ** 1.5;
        const k = ((layer ? SIZE : 0) + j) * W + i;
        for (let c = 0; c < 3; c++) arr[k * 4 + c] = Math.min(1, arr[k * 4 + c] + p.c[c] * f);
        arr[k * 4 + 3] = Math.min(1, Math.max(arr[k * 4 + 3], arr[k * 4 + 3] + f * 0.8));
      }
    return [i0, i1, (layer ? SIZE : 0) + j0, (layer ? SIZE : 0) + j1];
  };
  for (const p of pools) disc(base, p, 0);

  const data = new Uint8Array(W * Hh * 4);
  const toBytes = (k, src) => {
    for (let c = 0; c < 4; c++) data[k * 4 + c] = Math.round(Math.min(1, src[k * 4 + c]) * 255);
  };
  for (let k = 0; k < W * Hh; k++) toBytes(k, base);
  const texture = new THREE.DataTexture(data, W, Hh, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  // the shader's uniforms: the map and its placement (x0, z0, 1/span, split y)
  const uniforms = {
    uDoomSector: { value: texture },
    uDoomRect: { value: new THREE.Vector4(x0, z0, 1 / SPAN, SPLIT_Y) },
  };

  // dynamic lights (fire, grill): non-pooled point lights under game.dynamic with intensity > 0
  const dynLights = () => {
    const out = [];
    game?.dynamic?.traverse((o) => {
      if (o.isPointLight && !o.userData.pooled && o.intensity > 0) out.push(o);
    });
    return out;
  };
  let lastRect = null;
  const wp = new THREE.Vector3();
  const work = new Float32Array(base.length); // scratch: base + discs in the touched rect
  const union = (a, b) => (!a ? b : !b ? a : { i0: Math.min(a.i0, b.i0), i1: Math.max(a.i1, b.i1), j0: Math.min(a.j0, b.j0), j1: Math.max(a.j1, b.j1) });

  function upload(rect) {
    for (let j = rect.j0; j <= rect.j1; j++) texture.addUpdateRange((j * W + rect.i0) * 4, (rect.i1 - rect.i0 + 1) * 4);
    texture.needsUpdate = true;
  }

  return {
    texture,
    uniforms,
    ids,
    // light at a world point, in display space: [r, g, b, level] (0..1)
    sample(x, y, z, out = [0, 0, 0, 0]) {
      const i = Math.min(W - 1, Math.max(0, Math.floor((x - x0) / cell)));
      const j = Math.min(SIZE - 1, Math.max(0, Math.floor((z - z0) / cell))) + (y < SPLIT_Y ? 0 : SIZE);
      const k = (j * W + i) * 4;
      for (let c = 0; c < 4; c++) out[c] = data[k + c] / 255;
      return out;
    },
    update() {
      // room lamps: rebuild a sector when its lamp changed
      let changed = false;
      for (const [id, [l, i0]] of Object.entries(lampOf)) {
        const k = i0 > 0 ? Math.max(0, Math.min(1.5, l.intensity / i0)) : 1;
        if (Math.abs(k - lampK[id]) > 0.01) {
          lampK[id] = k;
          changed = true;
        }
      }
      if (changed) {
        writeBase();
        for (const p of pools) disc(base, p, 0);
        for (let k = 0; k < W * Hh; k++) toBytes(k, base);
        texture.needsUpdate = true;
        lastRect = null;
        return;
      }
      // fire and grill: warm discs over the base, only where they are (and were)
      const lights = dynLights();
      let rect = null;
      const discs = lights.map((l) => {
        l.getWorldPosition(wp);
        const c = l.color.clone().convertLinearToSRGB();
        const p = { x: wp.x, z: wp.z, r: Math.max(1.5, (l.distance || 4) * 0.9), c: [c.r, c.g, c.b], k: Math.min(0.9, l.intensity / 7) };
        const layer = wp.y < SPLIT_Y ? 0 : 1;
        const ci = Math.floor((p.x - x0) / cell), cj = Math.floor((p.z - z0) / cell) + (layer ? SIZE : 0), rr = Math.ceil(p.r / cell);
        rect = union(rect, { i0: Math.max(0, ci - rr), i1: Math.min(W - 1, ci + rr), j0: Math.max(0, cj - rr), j1: Math.min(Hh - 1, cj + rr) });
        return [p, layer];
      });
      const dirty = union(rect, lastRect);
      if (!dirty) return;
      for (let j = dirty.j0; j <= dirty.j1; j++) {
        const s = (j * W + dirty.i0) * 4, e = (j * W + dirty.i1 + 1) * 4;
        work.set(base.subarray(s, e), s);
      }
      for (const [p, layer] of discs) disc(work, p, layer);
      for (let j = dirty.j0; j <= dirty.j1; j++) for (let i = dirty.i0; i <= dirty.i1; i++) toBytes(j * W + i, work);
      upload(dirty);
      lastRect = rect;
    },
  };
}
