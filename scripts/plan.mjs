// Draws a 2D plan straight from src/world/layout.js, so the schematic always matches the game.
// Usage: npm run plan  ->  docs/plan.svg
import { writeFileSync, mkdirSync } from 'node:fs';
import { ROOMS, WALLS, DIAG_WALLS, BALCONY, FURNITURE, START, MIRROR, SCALE, mx } from '../src/world/layout.js';

const S = 110 / SCALE; // px per meter (the plan is stretched by SCALE, keep the picture the same size)
const minX = -3.0 * SCALE, minZ = -1.6 * SCALE, maxX = 9.1 * SCALE, maxZ = 6.8 * SCALE;
const X = (x) => ((x - minX) * S).toFixed(1);
const Z = (z) => ((z - minZ) * S + 60).toFixed(1);
const width = (maxX - minX) * S, height = (maxZ - minZ) * S + 60;

const out = [];
const add = (s) => out.push(s);
const rect = (q, attrs) => add(`<rect x="${X(q.x0)}" y="${Z(q.z0)}" width="${((q.x1 - q.x0) * S).toFixed(1)}" height="${((q.z1 - q.z0) * S).toFixed(1)}" ${attrs}/>`);
const poly = (pts, attrs) => add(`<polygon points="${pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" ${attrs}/>`);
const text = (x, z, s, attrs = '') => {
  const lines = s.split('\n');
  const spans = lines.map((l, i) => `<tspan x="${X(x)}" dy="${i ? '1.1em' : `${-(lines.length - 1) * 0.55}em`}">${l}</tspan>`).join('');
  add(`<text x="${X(x)}" y="${Z(z)}" ${attrs}>${spans}</text>`);
};
// short labels where the footprint is too small for the full name
const shortLabel = { fridge: 'Холо-\nдильник', microwave: 'Микро-\nволновка', counter: 'Тумба\nс ящиками', stenka: 'Стенка + телик', kitchenTable: 'Стол', bathSink: 'Раков.' };
// room label positions in plan coords (mirrored like everything else)
const roomLabelAt = { bedroom: [1.65, 3.0], living: [4.0, 4.3], kitchen: [6.85, 1.02], bath: [5.98, 2.62], hall: [6.05, 4.5], balcony: [3.95, -0.75], landing: [9.6, 5.6] };

const roomFill = { bedroom: '#dfe7f0', living: '#efe4cf', kitchen: '#e4ecd2', bath: '#d6ecee', hall: '#ecd9c8', balcony: '#e2e0dc' };

function area(room) {
  if (room.poly) {
    let a = 0;
    for (let i = 0, j = room.poly.length - 1; i < room.poly.length; j = i++) a += (room.poly[j][0] + room.poly[i][0]) * (room.poly[j][1] - room.poly[i][1]);
    return Math.abs(a / 2);
  }
  return room.rects.reduce((s, q) => s + (q.x1 - q.x0) * (q.z1 - q.z0), 0);
}

add(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif">`);
add(`<rect width="100%" height="100%" fill="#faf8f3"/>`);
add(`<text x="20" y="34" font-size="22" font-weight="bold" fill="#222">Хата Олега — схема из игры${MIRROR ? ' (зеркально к плану БТИ)' : ''}</text>`);

// rooms
for (const room of ROOMS) {
  const fill = roomFill[room.id] ?? '#eee';
  if (room.poly) poly(room.poly, `fill="${fill}"`);
  else for (const q of room.rects) rect(q, `fill="${fill}"`);
}

// furniture (under walls so it never hides them)
for (const f of FURNITURE) {
  rect(f, `fill="${f.onTop ? '#7aa7e0' : '#fff'}" fill-opacity="${f.onTop ? 0.9 : 0.85}" stroke="#555" stroke-width="1.2" ${f.onTop ? 'stroke-dasharray="3 2"' : ''}`);
}

// walls
const WALL = 'fill="#3a3632"';
for (const w of WALLS) {
  const ax = w.x1 - w.x0 >= w.z1 - w.z0;
  const [s0, s1] = ax ? [w.x0, w.x1] : [w.z0, w.z1];
  const piece = (a, b) => rect(ax ? { x0: a, x1: b, z0: w.z0, z1: w.z1 } : { x0: w.x0, x1: w.x1, z0: a, z1: b }, WALL);
  let cur = s0;
  for (const o of [...w.openings].sort((a, b) => a.at[0] - b.at[0])) {
    if (o.at[0] > cur) piece(cur, o.at[0]);
    const q = ax ? { x0: o.at[0], x1: o.at[1], z0: w.z0, z1: w.z1 } : { x0: w.x0, x1: w.x1, z0: o.at[0], z1: o.at[1] };
    if (o.kind === 'window') rect(q, 'fill="#bfe0f5" stroke="#3a3632" stroke-width="1"');
    if (o.kind === 'balcony') rect(q, 'fill="#bfe0f5" stroke="#3a3632" stroke-width="1" stroke-dasharray="4 3"');
    if (o.kind === 'entrance') rect(q, 'fill="#8a4a2a"');
    cur = o.at[1];
  }
  if (cur < s1) piece(cur, s1);
}
for (const d of DIAG_WALLS) {
  const [ax, az] = d.a, [bx, bz] = d.b;
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz * d.t / 2, nz = ux * d.t / 2;
  const seg = (s0, s1) => poly([[ax + ux * s0 + nx, az + uz * s0 + nz], [ax + ux * s1 + nx, az + uz * s1 + nz], [ax + ux * s1 - nx, az + uz * s1 - nz], [ax + ux * s0 - nx, az + uz * s0 - nz]], WALL);
  seg(0, d.door.at[0]);
  seg(d.door.at[1], len);
}

// balcony rail
rect(BALCONY, 'fill="none" stroke="#6f7d63" stroke-width="4"');

// labels
for (const f of FURNITURE) {
  let cx = (f.x0 + f.x1) / 2;
  const cz = (f.z0 + f.z1) / 2;
  if (f.id === 'counter') {
    const m = FURNITURE.find((g) => g.id === 'microwave');
    cx += (m.x0 + m.x1) / 2 > cx ? -0.25 : 0.25;
  }
  const vertical = f.z1 - f.z0 > (f.x1 - f.x0) * 1.6 && f.x1 - f.x0 < 0.7;
  const tr = vertical ? `transform="rotate(-90 ${X(cx)} ${Z(cz)})"` : '';
  text(cx, cz + 0.04, shortLabel[f.id] ?? f.label, `font-size="11" text-anchor="middle" fill="${f.onTop ? '#0b3d7a' : '#333'}" ${tr}`);
}
for (const room of ROOMS) {
  const [px, pz] = roomLabelAt[room.id];
  const cx = mx(px * SCALE), cz = pz * SCALE;
  text(cx, cz, room.name, 'font-size="16" font-weight="bold" text-anchor="middle" fill="#1d1b19"');
  text(cx, cz + 0.24, `≈${area(room).toFixed(1)} м²`, 'font-size="12" text-anchor="middle" fill="#555"');
}

// Oleg start + entrance marker
const ex = WALLS.find((w) => w.id === 'east');
const entX = (ex.x0 + ex.x1) / 2 + (ex.x0 < 1 ? -0.7 : 0.7);
text(entX, 5.0 * SCALE, 'ВХОД', `font-size="13" font-weight="bold" text-anchor="middle" fill="#8a4a2a"`);
const fx = -Math.sin(START.yaw) * 0.45, fz = -Math.cos(START.yaw) * 0.45;
add(`<circle cx="${X(START.x)}" cy="${Z(START.z)}" r="9" fill="#d9822b"/>`);
add(`<line x1="${X(START.x)}" y1="${Z(START.z)}" x2="${X(START.x + fx)}" y2="${Z(START.z + fz)}" stroke="#d9822b" stroke-width="3"/>`);
text(START.x, START.z + 0.32, 'Олег', 'font-size="11" text-anchor="middle" fill="#a0561a"');

// scale bar
const sy = 6.25 * SCALE;
add(`<line x1="${X(0)}" y1="${Z(sy)}" x2="${X(1)}" y2="${Z(sy)}" stroke="#333" stroke-width="2"/>`);
text(0.5, sy - 0.07, '1 м', 'font-size="11" text-anchor="middle" fill="#333"');
text(1.4, sy + 0.05, `масштаб ×${SCALE} к реальному · окна — голубые · балконная дверь — пунктир · синее с пунктиром — стоит сверху`, 'font-size="11" fill="#555"');
add('</svg>');

mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/plan.svg', import.meta.url), out.join('\n'));
console.log('docs/plan.svg written');
