// Sounds are synthesized with WebAudio; the only recordings are the guys' voices. Call init() from a click.
// Smart sound: whatever has a place (a guy's voice, the stereo, the knock at the front door, a car on the highway)
// plays through its own channel, a lowpass and a gain set by the walls and doors between it and Oleg
// (world/acoustics.js: the rooms graph, the doors open or shut), retuned a few times a second, not per frame.
// The bathroom and the stairwell ring, the yard has a little open air and the slap off the building across.
// Oleg's own sounds (and anything without a place) only take the echo of where he stands.
import { spaceAt, routes, ECHO, PLACES } from './world/acoustics.js';

// ---------- recorded voices: src/assets/voice/<who>_<kind>_<n>.mp3 ----------
// kinds: monolog (the talk action), koch (the «Коч!» chain), booze (after a drink), food (after eating), quote,
// vapeloop; who = event for the ones nobody in particular says (pat, puke, hush, neighbors, memfull).
const FILES = import.meta.glob('./assets/voice/*.mp3', { eager: true, query: '?inline', import: 'default' });
const CLIPS = {}; // 'temych_koch' -> [src, ...]
for (const [path, src] of Object.entries(FILES)) {
  const m = path.match(/\/([a-z]+_[a-z]+?)(?:_\d+)?\.mp3$/);
  if (m) (CLIPS[m[1]] ??= []).push(src);
}
const active = new Set();

// how loud a thing is at d meters (before the walls): a voice, the stereo, a knock on the door, a passing car
const near = (d) => (d < 1.5 ? 1 : Math.max(0.1, 1 - (d - 1.5) / 8));
const loud = (d) => (d < 5 ? 1 : Math.max(0.2, 5 / d));
const thud = (d) => (d < 3 ? 1 : Math.max(0.3, 1 - (d - 3) / 14));
const road = (d) => Math.max(0, 1 - d / 45);
const MUSIC = [1, 1, 1.25, 1.5]; // the stereo's volume knob (state.volume 1..3)
const OUTSIDE = new Set(['stairs', 'yard', 'shop']);

let ctx = null;
let mix = null; // everything ends here
let local = null; // Oleg's own sounds: nothing in the way
let music = null; // the stereo in the stenka
let door = null; // the front door: someone knocks
let musicTimer = null;
const echoes = {}; // 'tile' | 'stairwell' | 'open' -> { input, conv, on, offAt }
const channels = new Set(); // every live channel, retuned a few times a second

// the listener: where Oleg stands, which space that is, the ways from there to every other space
const ear = { x: 0, z: 0, y: 0, space: 'living' };
let world = { isOpen: () => true };
let table = null;
let retuneAt = 0;
let heardAt = 0; // when main.js last said where Oleg is (voices.update); in a story scene or the menu nobody does

// the doors: isOpen(id) -> is apt.doors[id] (or the balcony 'sash') open now. main.js hands it over once.
export function setWorld(w) {
  world = w;
  retuneAt = 0;
}

// ---------- channels ----------
// input (scale: 0.5 for the synth, 1 for recordings) -> lowpass -> gain -> mix; the gain also feeds the echoes
// at: [x, z, y?] or () => [x, z, y?] (null: Oleg's own); fall: loudness by distance; level: its own volume
function channel({ at = null, fall = near, level = 1, cap = Infinity, scale = 1 } = {}) {
  const input = ctx.createGain();
  input.gain.value = scale;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0;
  const out = ctx.createGain();
  input.connect(lp).connect(out).connect(mix);
  const sends = {};
  for (const [k, e] of Object.entries(echoes)) {
    sends[k] = ctx.createGain();
    sends[k].gain.value = 0;
    out.connect(sends[k]).connect(e.input);
  }
  const ch = { input, lp, out, sends, at, fall, level, cap, space: null, now: null };
  channels.add(ch);
  if (!table) table = routes(ear.space, world.isOpen);
  tune(ch, true);
  gate();
  return ch;
}

function drop(ch) {
  if (!channels.delete(ch)) return;
  for (const n of [ch.input, ch.lp, ch.out, ...Object.values(ch.sends)]) n.disconnect();
}

const ramp = (param, v, instant) => {
  if (instant) param.setValueAtTime(v, ctx.currentTime);
  else if (Math.abs(param.value - v) > v * 0.01 + 1e-4) param.setTargetAtTime(v, ctx.currentTime, 0.08);
};

// the walls between the channel's place and the ear: how loud, how muffled, which echoes
function tune(ch, instant = false) {
  let gain = ch.level, cut = 20000;
  const wet = {};
  const mine = ECHO[ear.space];
  if (mine) wet[mine[0]] = mine[1];
  const p = typeof ch.at === 'function' ? ch.at() : ch.at;
  if (p) {
    const s = spaceAt(p[0], p[1], p[2] ?? 0) ?? ch.space ?? ear.space;
    ch.space = s;
    const r = table[s] ?? { db: 30, oct: 5 };
    gain = Math.min(ch.cap, gain * ch.fall(Math.hypot(p[0] - ear.x, p[1] - ear.z, (p[2] ?? 0) - ear.y))) * 10 ** (-r.db / 20);
    cut = Math.max(160, 20000 / 2 ** r.oct);
    const theirs = ECHO[s];
    if (theirs) wet[theirs[0]] = Math.max(wet[theirs[0]] ?? 0, theirs[1]);
  }
  ramp(ch.out.gain, gain, instant);
  ramp(ch.lp.frequency, cut, instant);
  for (const [k, send] of Object.entries(ch.sends)) ramp(send.gain, wet[k] ?? 0, instant);
  ch.now = { space: ch.space, gain, cut, wet };
}

// an echo only runs while something sends to it (and its tail rings out)
function gate() {
  const t = performance.now();
  for (const [k, e] of Object.entries(echoes)) {
    if ([...channels].some((ch) => ch.now?.wet[k] > 0)) {
      e.offAt = t + 4000;
      if (!e.on) e.input.connect(e.conv);
      e.on = true;
    } else if (e.on && t > e.offAt) {
      e.input.disconnect(e.conv);
      e.on = false;
    }
  }
}

function retune() {
  const t = performance.now();
  if (t < retuneAt) return;
  retuneAt = t + 150; // ~7 times a second
  ear.space = spaceAt(ear.x, ear.z, ear.y) ?? ear.space;
  table = routes(ear.space, world.isOpen);
  for (const ch of channels) tune(ch);
  gate();
}

// Oleg's own sounds. Nobody says where he is (a story scene after the night): no room's echo on them then
function own() {
  if (performance.now() - heardAt > 500 && ECHO[ear.space]) {
    ear.space = 'living';
    table = routes(ear.space, world.isOpen);
    for (const ch of channels) tune(ch, true);
  }
  return local.input;
}

// a one-shot's way out: Oleg's own ears, or a channel at o.pos that lives as long as the sound
function out(o, dur, fall = near) {
  if (!o?.pos) return own();
  const ch = channel({ at: o.pos, fall, scale: 0.5 });
  setTimeout(() => drop(ch), (dur + 0.5) * 1000);
  return ch.input;
}

// ---------- echoes: generated impulses ----------
// rt: seconds to fade by 60 dB; tone: 1 bright .. 0.1 dark; sparse: share of samples that reflect;
// taps: [seconds, level] discrete echoes (the flutter between stairwell walls, the building across the yard)
function impulse(rt, { tone = 0.5, pre = 0.005, sparse = 1, taps = [] } = {}) {
  const sr = ctx.sampleRate, n = Math.ceil(sr * rt);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = Math.floor(pre * sr); i < n; i++) {
      lp += ((Math.random() < sparse ? Math.random() * 2 - 1 : 0) - lp) * tone;
      d[i] = lp * Math.exp((-6.9 * i) / n);
    }
    for (const [at, g] of taps) {
      const i = Math.floor((at + c * 0.004) * sr);
      if (i < n) d[i] += g * Math.exp((-6.9 * i) / n) * (c ? -1 : 1);
    }
  }
  return buf;
}
const IMPULSES = {
  tile: () => impulse(0.9, { tone: 0.65, pre: 0.003, taps: [[0.007, 0.5], [0.011, 0.4], [0.017, 0.3]] }), // small, tiled, bright
  stairwell: () => impulse(1.6, { tone: 0.3, pre: 0.01, taps: Array.from({ length: 12 }, (_, k) => [0.03 + k * 0.023, 0.6 * 0.82 ** k]) }), // concrete, flutter
  open: () => impulse(1.3, { tone: 0.15, pre: 0.02, sparse: 0.03, taps: [[0.09, 0.35], [0.175, 0.7], [0.31, 0.3], [0.36, 0.2]] }), // the panel house across
};

export function init() {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    // a limiter at -1 dB: the echoes add to the sound, the loudest moments must not clip (0.94 undoes its makeup gain)
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -1;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.15;
    limit.connect(ctx.destination);
    mix = ctx.createGain();
    mix.gain.value = 0.94;
    mix.connect(limit);
    for (const [k, make] of Object.entries(IMPULSES)) {
      const conv = ctx.createConvolver();
      conv.buffer = make();
      conv.connect(mix);
      echoes[k] = { input: ctx.createGain(), conv, on: false, offAt: 0 };
    }
    local = channel({ scale: 0.5 });
    music = channel({ at: PLACES.stereo, fall: loud, scale: 0.5 });
    door = channel({ at: () => (OUTSIDE.has(ear.space) ? PLACES.doorOut : PLACES.doorIn), fall: thud, scale: 0.5 });
  } catch {
    ctx = null;
  }
}

export const voices = {
  has: (key) => !!CLIPS[key]?.length,
  list: (key) => CLIPS[key] ?? [],
  // play a random clip of `key` ('lyokha_booze'), or a given `src`; pos = [x, z] or () => [x, z]: where he is
  // (distance and walls); rate < 1 plays it slower and lower, like a tape (a drunk guy's voice)
  play(key, { pos = null, gain = 1, loop = false, src = null, rate = 1 } = {}) {
    const list = CLIPS[key];
    if (!ctx || !list?.length) return null;
    const a = new Audio(src ?? list[Math.floor(Math.random() * list.length)]);
    if (rate !== 1) {
      a.preservesPitch = a.mozPreservesPitch = a.webkitPreservesPitch = false;
      a.defaultPlaybackRate = a.playbackRate = rate;
    }
    let ch = null;
    try {
      ch = channel({ at: pos, fall: near, level: gain, cap: 1 });
      ctx.createMediaElementSource(a).connect(ch.input);
    } catch {
      if (ch) drop(ch);
      ch = null; // plays straight out, distance only
      a.volume = Math.min(1, gain);
    }
    const h = {
      key, audio: a, pos, gain, rate, ch,
      get playing() {
        return !a.ended && !a.paused;
      },
      stop() {
        a.pause();
        active.delete(h);
        if (ch) drop(ch);
      },
    };
    a.loop = loop;
    a.addEventListener('ended', () => h.stop());
    a.play().catch(() => h.stop());
    active.add(h);
    return h;
  },
  // how many clips whose key matches `re` are playing right now
  count(re) {
    let n = 0;
    for (const h of active) if (re.test(h.key) && h.playing) n++;
    return n;
  },
  // where Oleg is: [x, z, floor height]; every frame is fine, the channels are retuned a few times a second
  update(pos) {
    [ear.x, ear.z] = pos;
    ear.y = pos[2] ?? 0;
    heardAt = performance.now();
    if (ctx) retune();
  },
  stopAll() {
    for (const h of [...active]) h.stop();
  },
};

// what each channel does right now (the sound check in the console: (await import('/src/audio.js')).soundCheck())
export function soundCheck() {
  const r = (v) => Math.round(v * 1000) / 1000;
  const row = (name, ch) => ch?.now && { name, space: ch.now.space, gain: r(ch.now.gain), cut: Math.round(ch.now.cut), wet: ch.now.wet };
  return {
    ear: { ...ear },
    echoesOn: Object.keys(echoes).filter((k) => echoes[k].on),
    channels: [row('local', local), row('music', music), row('door', door), ...[...active].map((h) => row(h.key, h.ch))].filter(Boolean),
  };
}

function tone(freq, dur, { type = 'square', vol = 0.15, when = 0, slide = 0, to = null } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(to ?? own());
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.3, when = 0, freq = 800, q = 1, to = null, sweep = 0, swell = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  // swell: share of the sound spent growing (a car coming), the rest fading; 0 = a hit that fades
  for (let i = 0; i < data.length; i++) {
    const k = i / data.length;
    data[i] = (Math.random() * 2 - 1) * (k < swell ? k / swell : (1 - k) / (1 - swell));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur); // the pitch drops as it goes by
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(to ?? own());
  src.start(t);
}

// o: optional { pos: [x, z] } for a sound that happens somewhere (through the walls); without it it's Oleg's own
export const sfx = {
  alarm: () => (tone(880, 0.12, { vol: 0.08 }), tone(660, 0.18, { vol: 0.08, when: 0.13 })),
  // on the front door: heard from the hall inside, from the landing outside
  knock: () => door && [0, 0.18, 0.36].forEach((w) => noise(0.09, { vol: 0.9, when: w, freq: 180, q: 2, to: door.input })),
  ding: () => (tone(1320, 0.25, { type: 'sine', vol: 0.12 }), tone(1760, 0.3, { type: 'sine', vol: 0.1, when: 0.12 })),
  crash: (o) => {
    if (!ctx) return;
    const to = out(o, 0.6);
    noise(0.5, { vol: 0.8, freq: 2500, q: 0.5, to });
    noise(0.3, { vol: 0.6, freq: 400, when: 0.05, to });
  },
  splash: (o) => ctx && noise(0.8, { vol: 0.5, freq: 3000, q: 0.3, to: out(o, 0.8) }),
  purr: () => [0, 0.12, 0.24, 0.36].forEach((w) => tone(55, 0.1, { type: 'sawtooth', vol: 0.05, when: w })),
  gulp: () => (tone(300, 0.08, { type: 'sine', vol: 0.2, slide: -150 }), tone(260, 0.08, { type: 'sine', vol: 0.2, when: 0.15, slide: -120 })),
  whoosh: (o) => ctx && noise(0.4, { vol: 0.4, freq: 900, q: 0.4, to: out(o, 0.4) }),
  fix: () => [0, 0.15, 0.3].forEach((w) => tone(1200, 0.05, { vol: 0.08, when: w })),
  click: () => tone(1500, 0.03, { vol: 0.05 }),
  pat: (o) => ctx && noise(0.07, { vol: 0.7, freq: 350, q: 1.5, to: out(o, 0.07) }),
  shutter: () => (noise(0.04, { vol: 0.8, freq: 5000, q: 0.7 }), noise(0.06, { vol: 0.6, freq: 2500, q: 0.7, when: 0.08 })),
  squeak: () => tone(2400, 0.07, { type: 'sine', vol: 0.06, slide: 600 }), // the toy mouse under a paw
  shot: () => (noise(0.16, { vol: 0.7, freq: 1400, q: 0.5 }), tone(110, 0.12, { type: 'sine', vol: 0.25, slide: -60 })), // КС on the PC
  // the story's scenes (game/story.js): a door behind you, steps, a bat to the head and the ringing after it
  creak: () => (tone(170, 0.7, { type: 'sawtooth', vol: 0.035, slide: 110 }), tone(260, 0.45, { type: 'sawtooth', vol: 0.025, when: 0.3, slide: -90 })),
  steps: () => [0, 0.42].forEach((w) => noise(0.08, { vol: 0.6, freq: 240, q: 1.6, when: w })),
  bonk: () => (noise(0.14, { vol: 1.2, freq: 260, q: 1.1 }), tone(95, 0.35, { type: 'sine', vol: 0.6, slide: -55 }), tone(3100, 2.6, { type: 'sine', vol: 0.025, when: 0.08 })),
  // a text: the phone buzzes twice, then a soft two-note chime (ui/phone.js)
  sms: () => ([0, 0.17].forEach((w) => tone(140, 0.11, { type: 'sawtooth', vol: 0.035, when: w })), tone(1046.5, 0.1, { type: 'sine', vol: 0.07, when: 0.36 }), tone(1568, 0.18, { type: 'sine', vol: 0.06, when: 0.46 })),
  // a car on the highway behind the yard's far fence goes by (world/yard.js): it swells, the pitch drops
  car: (pos, speed = 16) => ctx && noise(1.6, { vol: 0.3 * Math.min(1.3, speed / 16), freq: 1300, q: 0.6, sweep: 0.45, swell: 0.45, to: out({ pos }, 1.6, road) }),
};

// Party music: a dumb 4-chord loop with a kick. Plays while the stereo is on, from the stenka (through the walls).
const CHORDS = [[220, 277, 330], [174.6, 220, 261.6], [261.6, 330, 392], [196, 246.9, 293.7]];
export function setMusic(on, volume = 1) {
  if (!ctx) return;
  music.level = MUSIC[volume] ?? 1;
  if (on && !musicTimer) {
    let step = 0;
    const beat = 0.3;
    const to = music.input;
    musicTimer = setInterval(() => {
      const chord = CHORDS[Math.floor(step / 8) % 4];
      tone(chord[0] / 2, beat * 0.9, { type: 'sawtooth', vol: 0.06, to });
      if (step % 2 === 0) tone(120, 0.15, { type: 'sine', vol: 0.35, slide: -80, to });
      if (step % 2 === 1) noise(0.05, { vol: 0.12, freq: 8000, q: 0.5, to });
      if (step % 4 === 0) chord.forEach((f) => tone(f, beat * 1.8, { type: 'triangle', vol: 0.035, to }));
      step++;
    }, 300);
  } else if (!on && musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}
