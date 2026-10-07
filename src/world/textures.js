// Procedural canvas textures — no image assets to ship.
// Floor/wall textures are authored as 1 texture = 1 meter (see worldUV in apartment.js).
import * as THREE from 'three';

const cache = new Map();

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function make(key, w, h, draw, repeat = true) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  cache.set(key, t);
  return t;
}

// Staggered oak planks
export const parquet = () =>
  make('parquet', 512, 512, (g, w, h) => {
    const rnd = rng(7);
    const rows = 8, rh = h / rows, pl = w / 2;
    const tones = Array.from({ length: rows * 2 }, () => [24 + rnd() * 8, 42 + rnd() * 12, 27 + rnd() * 12]);
    for (let i = 0; i < rows; i++) {
      const off = (i % 2) * (pl / 2);
      for (let x = -pl; x < w + pl; x += pl) {
        const j = ((Math.round((x + off) / pl) % 2) + 2) % 2;
        const [hh, s, l] = tones[i * 2 + j];
        g.fillStyle = `hsl(${hh},${s}%,${l}%)`;
        g.fillRect(x + off, i * rh, pl, rh);
        g.strokeStyle = 'rgba(40,20,5,0.18)';
        for (let k = 0; k < 6; k++) {
          const y = i * rh + rnd() * rh;
          g.beginPath();
          g.moveTo(x + off, y);
          g.lineTo(x + off + pl, y + (rnd() - 0.5) * 5);
          g.stroke();
        }
        g.fillStyle = 'rgba(20,10,0,0.55)';
        g.fillRect(x + off, i * rh, 2, rh);
      }
      g.fillStyle = 'rgba(20,10,0,0.5)';
      g.fillRect(0, i * rh, w, 2);
    }
  });

// Soviet linoleum: beige squares with brown diamonds
export const linoleum = () =>
  make('linoleum', 512, 512, (g, w) => {
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 ? '#b89868' : '#a88458';
        g.fillRect(i * s, j * s, s, s);
        g.strokeStyle = '#6b4a2a';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(i * s + s / 2, j * s + 12);
        g.lineTo(i * s + s - 12, j * s + s / 2);
        g.lineTo(i * s + s / 2, j * s + s - 12);
        g.lineTo(i * s + 12, j * s + s / 2);
        g.closePath();
        g.stroke();
        g.strokeStyle = 'rgba(60,40,20,0.35)';
        g.lineWidth = 2;
        g.strokeRect(i * s, j * s, s, s);
      }
  });

function tiles(key, count, base, jitter, grout) {
  return make(key, 480, 480, (g, w) => {
    const rnd = rng(key.length * 31);
    const s = w / count;
    g.fillStyle = grout;
    g.fillRect(0, 0, w, w);
    for (let i = 0; i < count; i++)
      for (let j = 0; j < count; j++) {
        const [hh, ss, l] = base;
        g.fillStyle = `hsl(${hh},${ss}%,${l + (rnd() - 0.5) * jitter}%)`;
        g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      }
  });
}
export const wallTile = () => tiles('wallTile', 6, [185, 30, 82], 5, '#8d9a9a');
export const floorTile = () => tiles('floorTile', 10, [14, 45, 38], 8, '#3a2a22');

export const concrete = () =>
  make('concrete', 256, 256, (g, w) => {
    const rnd = rng(3);
    g.fillStyle = '#6d6a66';
    g.fillRect(0, 0, w, w);
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${rnd() * 0.08})`;
      g.fillRect(rnd() * w, rnd() * w, 2, 2);
    }
  });

// Wallpapers: 1 texture = 0.5 m (scaled in apartment.js)
function wallpaper(key, bg, fg, draw) {
  return make(key, 256, 256, (g, w) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, w);
    g.fillStyle = fg;
    g.strokeStyle = fg;
    draw(g, w);
  });
}

const flower = (g, x, y, r) => {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    g.beginPath();
    g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.7, 0, Math.PI * 2);
    g.fill();
  }
};

export const wallpapers = {
  bedroom: () =>
    wallpaper('wp-bedroom', '#9fb4c8', 'rgba(255,255,255,0.55)', (g) => {
      flower(g, 64, 64, 10);
      flower(g, 192, 192, 10);
      g.fillStyle = 'rgba(40,60,90,0.25)';
      flower(g, 192, 64, 6);
      flower(g, 64, 192, 6);
    }),
  living: () =>
    wallpaper('wp-living', '#cdb88e', 'rgba(120,80,40,0.22)', (g, w) => {
      g.fillRect(0, 0, 18, w);
      g.fillRect(128, 0, 18, w);
      g.fillStyle = 'rgba(120,70,30,0.3)';
      for (let y = 16; y < w; y += 64) {
        flower(g, 72, y, 5);
        flower(g, 200, y + 32, 5);
      }
    }),
  kitchen: () =>
    wallpaper('wp-kitchen', '#c9d1a0', 'rgba(90,110,40,0.25)', (g, w) => {
      g.lineWidth = 4;
      for (let i = 0; i <= w; i += 64) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, w); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
      }
    }),
  hall: () =>
    wallpaper('wp-hall', '#a8704a', 'rgba(60,30,10,0.3)', (g, w) => {
      g.lineWidth = 3;
      for (let y = -64; y < w + 64; y += 64)
        for (let x = 0; x <= w; x += 64) {
          g.beginPath();
          g.moveTo(x, y); g.lineTo(x + 32, y + 32); g.lineTo(x, y + 64); g.lineTo(x - 32, y + 32);
          g.closePath();
          g.stroke();
        }
    }),
  wallTile,
  // stairwell: the classic green oil paint up to 1.5 m
  landingPaint: () =>
    wallpaper('wp-landing', '#4c7358', 'rgba(255,255,255,0.05)', (g, w) => {
      const rnd = rng(5);
      for (let i = 0; i < 300; i++) g.fillRect(rnd() * w, rnd() * w, 2, 2);
    }),
};

// The legendary wall carpet (and a floor rug with another palette)
function carpet(key, p) {
  return make(
    key, 512, 320,
    (g, w, h) => {
      g.fillStyle = p.field;
      g.fillRect(0, 0, w, h);
      g.fillStyle = p.border;
      g.fillRect(10, 10, w - 20, h - 20);
      g.fillStyle = p.field;
      g.fillRect(34, 34, w - 68, h - 68);
      g.fillStyle = p.light;
      for (let x = 22; x < w - 10; x += 22) {
        diamond(g, x, 22, 6); diamond(g, x, h - 22, 6);
      }
      for (let y = 44; y < h - 30; y += 22) {
        diamond(g, 22, y, 6); diamond(g, w - 22, y, 6);
      }
      g.strokeStyle = p.dark;
      g.lineWidth = 2;
      for (let x = 34; x < w - 34; x += 28)
        for (let y = 34; y < h - 34; y += 28) {
          g.beginPath(); g.moveTo(x, y + 14); g.lineTo(x + 14, y); g.lineTo(x + 28, y + 14); g.lineTo(x + 14, y + 28); g.closePath(); g.stroke();
        }
      const cx = w / 2, cy = h / 2;
      g.fillStyle = p.border; diamond(g, cx, cy, 120, 0.62);
      g.fillStyle = p.light; diamond(g, cx, cy, 86, 0.62);
      g.fillStyle = p.field; diamond(g, cx, cy, 64, 0.62);
      g.fillStyle = p.accent; diamond(g, cx, cy, 34, 0.62);
      g.fillStyle = p.light; diamond(g, cx, cy, 12, 0.62);
      g.fillStyle = p.border;
      for (const [x, y] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) diamond(g, x, y, 50, 0.62);
      g.fillStyle = p.accent;
      for (const [x, y] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) diamond(g, x, y, 22, 0.62);
    },
    false,
  );
}
function diamond(g, x, y, r, sy = 1) {
  g.beginPath();
  g.moveTo(x, y - r * sy); g.lineTo(x + r, y); g.lineTo(x, y + r * sy); g.lineTo(x - r, y);
  g.closePath();
  g.fill();
}
export const wallCarpet = () => carpet('carpet', { field: '#8e1c1c', border: '#1e1f3a', light: '#e2c79a', dark: '#5e1010', accent: '#d9822b' });
export const floorRug = () => carpet('rug', { field: '#23305a', border: '#7a1a1a', light: '#d8c4a0', dark: '#161f40', accent: '#b2432b' });

// Panel building across the yard, some windows lit
export const cityFacade = () =>
  make('city', 1024, 512, (g, w, h) => {
    const rnd = rng(11);
    g.fillStyle = '#15181f';
    g.fillRect(0, 0, w, h);
    const cols = 20, rows = 10, cw = w / cols, rh = h / rows;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const lit = rnd() < 0.3;
        const tv = rnd() < 0.15;
        g.fillStyle = lit ? (tv ? '#6f8fd8' : `hsl(${35 + rnd() * 12},${70 + rnd() * 20}%,${55 + rnd() * 15}%)`) : '#0b0d12';
        g.fillRect(i * cw + cw * 0.25, j * rh + rh * 0.3, cw * 0.5, rh * 0.45);
      }
  }, false);

// Soft round glow around a bulb (additive sprite)
export const glow = () =>
  make('glow', 128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,0.9)');
    r.addColorStop(0.15, 'rgba(255,255,255,0.45)');
    r.addColorStop(0.45, 'rgba(255,255,255,0.1)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, w);
  }, false);

// a glow sprite for a lamp: cheap, no light, just reads as "this bulb is on"
export function glowSprite(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  s.scale.setScalar(size);
  return s;
}
