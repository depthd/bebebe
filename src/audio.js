// Sounds are synthesized with WebAudio; the only recordings are the guys' voices. Call init() from a click.

// ---------- recorded voices: src/assets/voice/<who>_<kind>_<n>.mp3 ----------
// kinds: monolog, booze (reaction to a drink), cough, quote, vapeloop; who = event for non-attributed ones.
const FILES = import.meta.glob('./assets/voice/*.mp3', { eager: true, query: '?inline', import: 'default' });
const CLIPS = {}; // 'temych_cough' -> [src, ...]
for (const [path, src] of Object.entries(FILES)) {
  const m = path.match(/\/([a-z]+_[a-z]+?)(?:_\d+)?\.mp3$/);
  if (m) (CLIPS[m[1]] ??= []).push(src);
}
const active = new Set();
let listener = [0, 0];
const falloff = (pos) => {
  if (!pos) return 1;
  const [x, z] = typeof pos === 'function' ? pos() : pos;
  const d = Math.hypot(x - listener[0], z - listener[1]);
  return d < 1.5 ? 1 : Math.max(0.1, 1 - (d - 1.5) / 8);
};

export const voices = {
  has: (key) => !!CLIPS[key]?.length,
  list: (key) => CLIPS[key] ?? [],
  // play a random clip of `key` ('lyokha_booze'), or a given `src`; pos = [x, z] or () => [x, z] for distance volume
  play(key, { pos = null, gain = 1, loop = false, src = null } = {}) {
    const list = CLIPS[key];
    if (!ctx || !list?.length) return null;
    const a = new Audio(src ?? list[Math.floor(Math.random() * list.length)]);
    const h = {
      key, audio: a, pos, gain,
      get playing() {
        return !a.ended && !a.paused;
      },
      stop() {
        a.pause();
        active.delete(h);
      },
    };
    a.loop = loop;
    a.volume = Math.min(1, gain * falloff(pos));
    a.addEventListener('ended', () => active.delete(h));
    a.play().catch(() => active.delete(h));
    active.add(h);
    return h;
  },
  // how many clips whose key matches `re` are playing right now
  count(re) {
    let n = 0;
    for (const h of active) if (re.test(h.key) && h.playing) n++;
    return n;
  },
  update(pos) {
    listener = pos;
    for (const h of active) h.audio.volume = Math.min(1, h.gain * falloff(h.pos));
  },
  stopAll() {
    for (const h of [...active]) h.stop();
  },
};

let ctx = null;
let master = null;
let musicTimer = null;

export function init() {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

function tone(freq, dur, { type = 'square', vol = 0.15, when = 0, slide = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.3, when = 0, freq = 800, q = 1 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  alarm: () => (tone(880, 0.12, { vol: 0.08 }), tone(660, 0.18, { vol: 0.08, when: 0.13 })),
  knock: () => [0, 0.18, 0.36].forEach((w) => noise(0.09, { vol: 0.9, when: w, freq: 180, q: 2 })),
  ding: () => (tone(1320, 0.25, { type: 'sine', vol: 0.12 }), tone(1760, 0.3, { type: 'sine', vol: 0.1, when: 0.12 })),
  crash: () => (noise(0.5, { vol: 0.8, freq: 2500, q: 0.5 }), noise(0.3, { vol: 0.6, freq: 400, when: 0.05 })),
  splash: () => noise(0.8, { vol: 0.5, freq: 3000, q: 0.3 }),
  purr: () => [0, 0.12, 0.24, 0.36].forEach((w) => tone(55, 0.1, { type: 'sawtooth', vol: 0.05, when: w })),
  gulp: () => (tone(300, 0.08, { type: 'sine', vol: 0.2, slide: -150 }), tone(260, 0.08, { type: 'sine', vol: 0.2, when: 0.15, slide: -120 })),
  whoosh: () => noise(0.4, { vol: 0.4, freq: 900, q: 0.4 }),
  fix: () => [0, 0.15, 0.3].forEach((w) => tone(1200, 0.05, { vol: 0.08, when: w })),
  click: () => tone(1500, 0.03, { vol: 0.05 }),
  pat: () => noise(0.07, { vol: 0.7, freq: 350, q: 1.5 }),
  shutter: () => (noise(0.04, { vol: 0.8, freq: 5000, q: 0.7 }), noise(0.06, { vol: 0.6, freq: 2500, q: 0.7, when: 0.08 })),
  squeak: () => tone(2400, 0.07, { type: 'sine', vol: 0.06, slide: 600 }), // the toy mouse under a paw
};

// Party music: a dumb 4-chord loop with a kick. Plays while the stereo is on.
const CHORDS = [[220, 277, 330], [174.6, 220, 261.6], [261.6, 330, 392], [196, 246.9, 293.7]];
export function setMusic(on) {
  if (!ctx) return;
  if (on && !musicTimer) {
    let step = 0;
    const beat = 0.3;
    musicTimer = setInterval(() => {
      const chord = CHORDS[Math.floor(step / 8) % 4];
      tone(chord[0] / 2, beat * 0.9, { type: 'sawtooth', vol: 0.06 });
      if (step % 2 === 0) tone(120, 0.15, { type: 'sine', vol: 0.35, slide: -80 });
      if (step % 2 === 1) noise(0.05, { vol: 0.12, freq: 8000, q: 0.5 });
      if (step % 4 === 0) chord.forEach((f) => tone(f, beat * 1.8, { type: 'triangle', vol: 0.035 }));
      step++;
    }, 300);
  } else if (!on && musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}
