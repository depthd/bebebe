// The shop's long LED sign under the title screen: a dot-matrix panel drawn on a canvas.
// «5 НОЧЕЙ С ОЛЕГОМ», blinking and glitching now and then (dead rows, flicker, a horizontal jump,
// letters scrambling), and every 8–15 s for a second or two it says what it really thinks.
// It animates only while the menu is on screen (it watches the menu's `hidden`).
const TEXT = '5 НОЧЕЙ С ОЛЕГОМ';
const ALT = '5 НОЧЕЙ В ЖОПЕ ОЛЕГА';

// 5×7 dot font, rows top to bottom; Й gets its breve on the row above
const GLYPHS = {
  5: '##### #.... ####. ....# ....# #...# .###.',
  Н: '#...# #...# #...# ##### #...# #...# #...#',
  О: '.###. #...# #...# #...# #...# #...# .###.',
  Ч: '#...# #...# #...# .#### ....# ....# ....#',
  Е: '##### #.... #.... ####. #.... #.... #####',
  Й: '#...# #...# #..## #.#.# ##..# #...# #...#',
  С: '.###. #...# #.... #.... #.... #...# .###.',
  Л: '..### .#..# .#..# .#..# .#..# .#..# #...#',
  Г: '##### #.... #.... #.... #.... #.... #....',
  М: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  В: '####. #...# #...# ####. #...# #...# ####.',
  Ж: '#.#.# #.#.# .###. ..#.. .###. #.#.# #.#.#',
  П: '##### #...# #...# #...# #...# #...# #...#',
  А: '.###. #...# #...# ##### #...# #...# #...#',
  // only for scrambling
  Ш: '#...# #...# #.#.# #.#.# #.#.# #.#.# #####',
  Я: '.#### #...# #...# .#### ..#.# .#..# #...#',
  Ы: '#...# #...# #...# ##..# #.#.# #.#.# ##..#',
  Ф: '..#.. .###. #.#.# #.#.# .###. ..#.. ..#..',
  Х: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Ю: '#..#. #.#.# #.#.# ###.# #.#.# #.#.# #..#.',
  Э: '.###. #...# ....# ..### ....# #...# .###.',
  0: '.###. #...# #..## #.#.# ##..# #...# .###.',
  7: '##### ....# ...#. ..#.. .#... .#... .#...',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '%': '##... ##..# ...#. ..#.. .#... #..## ...##',
};
// a glyph = 8 row bitmasks: the accent row, then 7 rows (bit 4 = leftmost dot)
const FONT = {};
for (const [ch, s] of Object.entries(GLYPHS)) FONT[ch] = [ch === 'Й' ? 0b01110 : 0, ...s.split(' ').map((r) => parseInt(r.replace(/#/g, '1').replace(/\./g, '0'), 2))];
const JUNK = Object.keys(FONT);
const ROWS = 11; // a blank row, the accent row, 7 rows of letters, two blank rows
const TOP = 1; // the accent row
const SPACE = 4, ADVANCE = 6; // columns
const MIN_COLS = 117; // the long text and a margin

const width = (text) => [...text].reduce((w, ch) => w + (ch === ' ' ? SPACE : ADVANCE), 0) - 1;
const place = (text) => {
  let x = 0;
  return [...text].map((ch) => {
    const at = x;
    x += ch === ' ' ? SPACE : ADVANCE;
    return { ch, x: at };
  });
};
const TEXTS = { [TEXT]: { chars: place(TEXT), w: width(TEXT) }, [ALT]: { chars: place(ALT), w: width(ALT) } };

const rand = (a, b) => a + Math.random() * (b - a);
const junk = () => (Math.random() < 0.3 ? [0, ...Array.from({ length: 7 }, () => (Math.random() * 32) | 0)] : FONT[JUNK[(Math.random() * JUNK.length) | 0]]);

export function createLED(canvas, menu) {
  const wrap = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches; // no blinking, flicker or jumps
  const bg = document.createElement('canvas'), dot = document.createElement('canvas');
  let cols = 0, pitch = 0, grid = null, shade = null, dirty = true, raf = 0, last = 0, glow = -1;

  // sizes: the dots as big as the screen height allows, but the long text always fits across
  function layout() {
    const w = wrap.clientWidth - 12; // minus the housing's padding
    if (w <= 0) return false; // hidden: try again next frame
    dirty = false;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const maxH = Math.max(36, Math.min(92, innerHeight * 0.085));
    pitch = Math.max(2, Math.floor(Math.min(maxH / ROWS, w / MIN_COLS) * dpr)); // device pixels: crisp dots
    cols = Math.floor((w * dpr) / pitch);
    canvas.width = cols * pitch;
    canvas.height = ROWS * pitch;
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;
    grid = new Float32Array(cols * ROWS);
    shade = Float32Array.from({ length: cols * ROWS }, () => rand(0.8, 1)); // no two LEDs are the same
    for (let k = 0; k < 4; k++) shade[(TOP + 1 + ((Math.random() * 7) | 0)) * cols + ((Math.random() * cols) | 0)] = 0; // dead ones
    // small dots are squares (crisp), big ones round
    const round = pitch >= 7, r = round ? pitch * 0.36 : (pitch - 1) / 2;
    const disc = (g, x, y) => {
      if (round) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      } else g.fillRect(Math.round(x - r), Math.round(y - r), pitch - 1, pitch - 1);
    };
    bg.width = canvas.width;
    bg.height = canvas.height;
    const b = bg.getContext('2d');
    b.fillStyle = '#0b0504';
    b.fillRect(0, 0, bg.width, bg.height);
    b.fillStyle = '#2a0e0a';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < cols; x++) disc(b, (x + 0.5) * pitch, (y + 0.5) * pitch);
    // a lit dot: a halo (they add up into a glow) and a hot core
    dot.width = dot.height = pitch * 3;
    const d = dot.getContext('2d'), c = pitch * 1.5;
    const halo = d.createRadialGradient(c, c, 0, c, c, c);
    halo.addColorStop(0, 'rgba(255, 70, 35, 0.5)');
    halo.addColorStop(0.4, 'rgba(255, 50, 25, 0.14)');
    halo.addColorStop(1, 'rgba(255, 40, 20, 0)');
    d.fillStyle = halo;
    d.fillRect(0, 0, dot.width, dot.height);
    const core = d.createRadialGradient(c, c, 0, c, c, Math.max(r, 1));
    core.addColorStop(0, '#ffe6c8');
    core.addColorStop(0.5, '#ff7a4a');
    core.addColorStop(1, '#ff3a1c');
    d.fillStyle = core;
    disc(d, c, c);
    menu.style.setProperty('--led-space', `${wrap.offsetHeight}px`); // the menu keeps its card above the sign
    return true;
  }

  // what the sign is doing (seconds)
  let t = 0, alt = false, altEnd = 0, nextAlt = rand(8, 15), nextGlitch = rand(1.5, 3), nextBlink = rand(4, 7), blinkAt = -9;
  let deadRows = [], deadEnd = 0, flickEnd = 0, jump = 0, tear = 0, jumpEnd = 0, scramble = new Map(), scrEnd = 0, scrAll = false, scrRoll = 0;

  const burst = () => { // the switch to the other text: everything scrambles and jumps for a moment
    scrAll = true;
    scrEnd = t + 0.22;
    if (!calm) {
      jump = (Math.random() < 0.5 ? -1 : 1) * Math.round(rand(3, 8));
      tear = TOP + ((Math.random() * 8) | 0);
      jumpEnd = t + 0.12;
    }
  };
  const glitch = () => {
    const kinds = calm ? ['rows', 'scramble'] : ['rows', 'flicker', 'jump', 'scramble', 'scramble'];
    const k = kinds[(Math.random() * kinds.length) | 0];
    if (k === 'rows') {
      const r0 = TOP + 1 + ((Math.random() * 7) | 0);
      deadRows = Math.random() < 0.4 ? [r0, Math.min(TOP + 7, r0 + 1)] : [r0];
      deadEnd = t + rand(0.4, 1.5);
    } else if (k === 'flicker') flickEnd = t + rand(0.15, 0.4);
    else if (k === 'jump') {
      jump = (Math.random() < 0.5 ? -1 : 1) * Math.round(rand(2, 7));
      tear = Math.random() < 0.5 ? 0 : TOP + 1 + ((Math.random() * 6) | 0); // the whole line, or a tear below some row
      jumpEnd = t + rand(0.08, 0.22);
    } else {
      scramble.clear();
      const letters = TEXTS[TEXT].chars.map((c, i) => (c.ch === ' ' ? -1 : i)).filter((i) => i >= 0);
      for (let n = 1 + ((Math.random() * 3) | 0); n > 0; n--) scramble.set(letters[(Math.random() * letters.length) | 0], null);
      scrAll = false;
      scrEnd = t + rand(0.25, 0.7);
    }
  };

  function step(dt) {
    t += dt;
    if (!alt && t >= nextAlt) {
      alt = true;
      altEnd = t + rand(1, 2);
      burst();
    } else if (alt && t >= altEnd) {
      alt = false;
      nextAlt = t + rand(8, 15);
      burst();
    }
    if (!alt && t >= nextGlitch) glitch();
    if (t >= nextGlitch) nextGlitch = t + rand(1.2, 3.5);
    if (!calm && !alt && t >= nextBlink) blinkAt = t;
    if (t >= nextBlink) nextBlink = t + rand(5, 9);
    // the letters being scrambled change every 70 ms
    if (t < scrEnd && t >= scrRoll) {
      scrRoll = t + 0.07;
      const { chars } = TEXTS[alt ? ALT : TEXT];
      if (scrAll) chars.forEach((c, i) => c.ch !== ' ' && scramble.set(i, junk()));
      else for (const i of scramble.keys()) scramble.set(i, junk());
    }
    if (t >= scrEnd && scramble.size) scramble.clear();
  }

  function paint() {
    const { chars, w } = TEXTS[alt ? ALT : TEXT];
    const x0 = Math.floor((cols - w) / 2), shift = t < jumpEnd ? jump : 0;
    const dead = t < deadEnd ? deadRows : [];
    grid.fill(0);
    chars.forEach(({ ch, x }, i) => {
      const g = (t < scrEnd && scramble.get(i)) || FONT[ch];
      if (!g) return;
      for (let r = 0; r < 8; r++) {
        const row = TOP + r;
        if (!g[r] || dead.includes(row)) continue;
        for (let c = 0; c < 5; c++) {
          const col = x0 + x + c + (row >= tear ? shift : 0);
          if (g[r] & (16 >> c) && col >= 0 && col < cols) grid[row * cols + col] = 1;
        }
      }
    });
    // blink: off, on, off, on (two flashes in 0.6 s); flicker: never quite off
    const b = t - blinkAt;
    const on = b >= 0.6 || (b >= 0.2 && b < 0.4) ? 1 : 0;
    const level = on * (t < flickEnd ? rand(0.45, 1) : 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(bg, 0, 0);
    if (level > 0) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < grid.length; i++) {
        if (!grid[i] || !shade[i]) continue;
        ctx.globalAlpha = shade[i] * level;
        ctx.drawImage(dot, (i % cols) * pitch - pitch, ((i / cols) | 0) * pitch - pitch);
      }
    }
    // the sign's light on everything around it
    if (Math.abs(level - glow) > 0.08) wrap.style.setProperty('--glow', (glow = level).toFixed(2));
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (dirty && !layout()) return;
    step(dt);
    paint();
  }

  // run only while the menu shows
  const sync = () => {
    if (!menu.hidden && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (menu.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
  addEventListener('resize', () => (dirty = true));
  let seenW = 0;
  new ResizeObserver(() => {
    if (wrap.clientWidth !== seenW) dirty = true;
    seenW = wrap.clientWidth;
  }).observe(wrap);
  sync();
}
