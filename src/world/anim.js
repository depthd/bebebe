// Procedural body animation for the guys.
//
// Rig: pelvis -> spine -> neck (head), pelvis -> hip -> knee (legs), spine -> shoulder -> elbow -> hand.
// Every frame a fresh target pose is built from layers:
//   1. base: stand / walk / sit / lie
//   2. loop: what he is doing right now (puke, cry, vape, chug, grill, dance...)
//   3. one-shot: short actions on top (a sip, a bite, a gesture, a stumble)
//   4. drunk: swaying, drooping head, bent knees, stepping to keep balance
// Hands can reach named points (mouth, eyes, knees, hair...) with two-bone IK. Everything is
// smoothed towards the target, so switching clips instantly still looks like a body moving.
//
// Joint conventions (rotation.x): hips/shoulders negative = forward, knees positive = bend,
// elbows negative = bend, spine positive = lean forward, neck negative = look up.
// Arms/legs index 0 = right (x < 0), 1 = left. side = -1 / +1.
import * as THREE from 'three';
import { blockyBottle } from './goods.js';
import { mat } from './apartment.js';
import { particles } from './particles.js';

export const DIM = { hip: 0.9, thigh: 0.44, shin: 0.41, shoulderX: 0.225, shoulderY: 0.52, upper: 0.28, fore: 0.25, grip: 0.05, neckY: 0.56 };
const SIDES = [-1, 1];

// head reference points (neck-local) for the two head styles
const HEAD = {
  box: { mouthY: 0.1, eyeY: 0.21, hairY: 0.3, front: 0.16 },
  sprite: { mouthY: 0.12, eyeY: 0.24, hairY: 0.36, front: 0.1 },
};

// ---------- helpers ----------

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (o, k, v, w) => (o[k] += (v - o[k]) * w);
// smooth noise in [-1, 1]
const nz = (t, s) => Math.sin(t + s) * 0.5 + Math.sin(t * 2.31 + s * 1.7) * 0.3 + Math.sin(t * 0.53 + s * 3.1) * 0.2;
// a short bump every `period` seconds
const pulse = (t, period, width) => {
  const x = (t % period) / period;
  return x < width ? Math.sin((Math.PI * x) / width) : 0;
};

function vSlice(geo, v0, v1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true;
  return geo;
}

// ---------- props held in a hand (built along +z, origin at the grip) ----------

const PROPS = {
  // the same blocky bottles as on the table and the shop shelves, laid along +z (neck forward)
  beer() {
    const b = blockyBottle('beer');
    b.rotation.x = Math.PI / 2;
    b.position.z = -0.1;
    return new THREE.Group().add(b);
  },
  vodka() {
    const b = blockyBottle('vodka');
    b.rotation.x = Math.PI / 2;
    b.position.z = -0.12;
    return new THREE.Group().add(b);
  },
  snack() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6).scale(1.3, 0.7, 1).translate(0, 0, 0.05), mat('#efdca6')));
    return g;
  },
  vape() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.018, 0.1).translate(0, 0, 0.02), mat('#1c1c22', { metalness: 0.6, roughness: 0.3 })));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.03).translate(0, 0, 0.085), mat('#2e8bd6')));
    return g;
  },
  chairLeg() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.55).translate(0, 0, 0.18), mat('#7a4a28')));
    return g;
  },
  cardboard() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.008, 0.24).translate(0, 0, 0.12), mat('#b88a55')));
    return g;
  },
  skewer() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5).rotateX(Math.PI / 2).translate(0, 0, 0.2), mat('#b8b8b8', { metalness: 0.8 })));
    for (let i = 0; i < 4; i++) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04).translate(0, 0, 0.22 + i * 0.055), mat('#6e3218')));
    return g;
  },
  phone() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.01), mat('#111')));
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.135).translate(0, 0, 0.0055), new THREE.MeshBasicMaterial({ color: '#ff8fd0' })));
    return g;
  },
};

export const makeProp = (name) => PROPS[name]?.() ?? null;

// ---------- clips ----------
// A clip writes into the target pose `p`. `c` = context: T (time), dt, drunk, beat, side helpers, emit().

function defaultPose() {
  return {
    body: { x: 0, y: 0, z: 0 },
    pelvis: { x: 0, y: 0, z: 0 },
    spine: { x: 0.03, y: 0, z: 0 },
    neck: { x: 0, y: 0, z: 0 },
    legs: SIDES.map((s) => ({ x: 0, z: s * 0.03, knee: 0.04 })),
    arms: SIDES.map((s) => ({ x: 0.05, y: 0, z: s * 0.1, elbow: -0.15, ik: null, ikW: 0, prop: null, look: null })),
  };
}

function base(p, c) {
  if (c.pose === 'sit') {
    for (const [i, s] of SIDES.entries()) {
      Object.assign(p.legs[i], { x: -1.5, z: s * 0.07, knee: 1.45 });
      Object.assign(p.arms[i], { x: -0.55, z: s * 0.12, elbow: -0.75 });
    }
    p.spine.x = -0.1;
    p.neck.x = 0.08 + 0.03 * Math.sin(c.T * 1.4);
    return;
  }
  if (c.pose === 'lie') {
    for (const [i, s] of SIDES.entries()) {
      Object.assign(p.legs[i], { x: 0, z: s * 0.05, knee: 0.1 });
      Object.assign(p.arms[i], { x: 0, z: s * 0.15, elbow: -0.2 });
    }
    p.spine.x = 0.02 * Math.sin(c.T * 1.2);
    return;
  }
  if (c.walking) {
    const ph = c.walkPhase;
    for (const [i] of SIDES.entries()) {
      const phi = ph + i * Math.PI;
      p.legs[i].x = 0.5 * Math.sin(phi);
      p.legs[i].knee = 0.1 + 0.75 * Math.max(0, -Math.cos(phi));
      p.arms[i].x = -0.42 * Math.sin(phi);
      p.arms[i].elbow = -0.25 - 0.25 * Math.max(0, Math.sin(phi));
    }
    p.body.y = 0.025 * Math.cos(2 * ph) - 0.015;
    p.spine.y = 0.09 * Math.sin(ph);
    p.pelvis.y = -0.07 * Math.sin(ph);
    p.spine.x = 0.07;
    return;
  }
  // idle: breathing, weight shift, looking around
  const br = Math.sin(c.T * 1.5 + c.seed);
  p.spine.x = 0.03 + 0.015 * br;
  p.body.x = 0.015 * nz(c.T * 0.35, c.seed);
  p.pelvis.z = -0.03 * nz(c.T * 0.35, c.seed);
  p.neck.y = 0.35 * nz(c.T * 0.3, c.seed + 2);
  p.neck.x = 0.05 * nz(c.T * 0.4, c.seed + 5);
}

const LOOPS = {
  // at the PC: hands forward on the keyboard and the mouse, tapping away
  typing(p, c) {
    for (const [i, s] of SIDES.entries()) {
      Object.assign(p.arms[i], { x: -1.05 + 0.04 * Math.sin(c.T * (i ? 23 : 17)), z: s * 0.18, elbow: -0.85 + 0.06 * Math.sin(c.T * (i ? 19 : 29)) });
    }
    p.spine.x = 0.12;
    p.neck.x = 0.05;
  },
  // on the floor after falling over: arms and legs all over the place, twitching
  fallen(p, c) {
    for (const [i, s] of SIDES.entries()) {
      Object.assign(p.arms[i], { x: -2.4 + 0.25 * Math.sin(c.T * 3 + i), z: s * (0.9 + 0.2 * Math.sin(c.T * 2.3 + i)), elbow: -0.5 });
      Object.assign(p.legs[i], { x: -0.3 * (i ? 1 : 0.2), z: s * 0.25, knee: i ? 0.9 : 0.2 });
    }
    p.neck.x = -0.4 + 0.15 * Math.sin(c.T * 1.7);
    p.neck.y = 0.4 * Math.sin(c.T * 0.9);
  },
  // Alexey glued to the vodka bottle
  chug(p, c) {
    const a = p.arms[0];
    Object.assign(a, { ik: { at: 'mouth', off: [0, 0.15, 0.12] }, ikW: 1, prop: 'vodka', look: 'mouth' });
    p.neck.x = -0.75 + 0.05 * Math.sin(c.T * 9);
    p.spine.x = -0.2;
    const b = p.arms[1];
    b.x = -0.4 + 0.3 * Math.sin(c.T * 1.3);
    b.z = 0.45 + 0.25 * Math.sin(c.T * 2.2);
    b.elbow = -0.6;
  },
  cry(p, c) {
    const sob = pulse(c.T, 0.55, 0.35);
    const wail = c.T % 5 > 3.8; // every few seconds lifts his head and wails
    for (const a of p.arms) Object.assign(a, { ik: wail ? { at: 'chest', off: [0, 0, 0.06] } : { at: 'eye', off: [0, -0.03, 0.05] }, ikW: 1 });
    p.spine.x = 0.3 + 0.07 * sob;
    p.neck.x = wail ? -0.4 : 0.42 + 0.1 * sob;
    p.spine.z = 0.04 * Math.sin(c.T * 21) * sob;
    p.body.y -= 0.015 * sob;
    for (const l of p.legs) l.knee += 0.1;
    if (wail && c.every(0.2)) c.emit('tears');
  },
  holdMouth(p) {
    Object.assign(p.arms[0], { ik: { at: 'mouth', off: [0, -0.02, 0.05] }, ikW: 1 });
    p.spine.x += 0.15;
    p.neck.x += 0.15;
  },
  puke(p, c) {
    const period = 1.6;
    const x = (c.T % period) / period;
    const heave = x < 0.3 ? Math.sin((Math.PI * x) / 0.3) : 0;
    p.spine.x = 0.95 + 0.25 * heave;
    p.neck.x = -0.55 + 0.4 * heave;
    p.body.z = -0.1;
    p.body.y = -0.05 - 0.02 * heave;
    for (const [i, s] of SIDES.entries()) {
      Object.assign(p.legs[i], { x: -0.3, z: s * 0.08, knee: 0.5 });
      Object.assign(p.arms[i], { ik: { at: 'knee', off: [0, 0.05, 0.07] }, ikW: 1 });
    }
    if (x > 0.08 && x < 0.28 && c.every(0.05)) c.emit('vomit');
  },
  cough(p, c, opts = {}) {
    const burst = c.T % 1.9;
    const j = burst < 1.0 ? pulse(burst, 0.33, 0.55) : 0;
    Object.assign(p.arms[0], { ik: { at: 'mouth', off: [0, -0.04, 0.07] }, ikW: 1 });
    Object.assign(p.arms[1], { ik: { at: 'chest', off: [0, 0, 0.05] }, ikW: 1 });
    p.spine.x = 0.15 + 0.4 * j;
    p.neck.x = 0.1 + 0.3 * j;
    p.body.z += 0.03 * j;
    if (j > 0.8 && c.every(0.3)) c.emit(opts.smoke ? 'smoke' : 'vapor');
  },
  // Kirill in the grill smoke: coughing and waving the smoke away
  choke(p, c) {
    LOOPS.cough(p, c, { smoke: true });
    Object.assign(p.arms[1], { ik: null, ikW: 0, x: -1.5, z: 0.3 + 0.45 * Math.sin(c.T * 10), elbow: -0.5 });
    if (c.every(0.45)) c.emit('smokeCloud');
  },
  vape(p, c) {
    const x = (c.T + c.seed) % 4.5;
    const a = p.arms[0];
    a.prop = 'vape';
    if (x < 1.6) {
      Object.assign(a, { ik: { at: 'mouth', off: [0, -0.02, 0.07] }, ikW: 1, look: 'mouth' });
      p.neck.x = -0.05;
    } else Object.assign(a, { ik: { at: 'chest', off: [0, 0.03, 0.12] }, ikW: 1 });
    if (x > 1.7 && x < 2.7) {
      p.neck.x = -0.5;
      p.spine.x = -0.1;
      if (c.every(0.1)) c.emit('bigPuff');
    }
  },
  // Lyokha smashing the flat
  smash(p, c) {
    const x = (c.T % 1.3) / 1.3;
    const s = x < 0.6 ? smooth(0, 0.6, x) : 1 - smooth(0.6, 0.75, x);
    const a = p.arms[0];
    Object.assign(a, { prop: 'chairLeg', x: -0.3 - 2.5 * s, z: -0.25, elbow: -0.2 - 0.9 * s });
    p.spine.x = -0.15 * s + 0.4 * (1 - s);
    p.spine.y = 0.35 * s - 0.25 * (1 - s);
    p.neck.x = 0.1;
    Object.assign(p.arms[1], { x: -0.5, z: 0.6, elbow: -0.4 });
    for (const [i, s2] of SIDES.entries()) Object.assign(p.legs[i], { z: s2 * 0.13, knee: 0.3 });
  },
  smashWalk(p, c) {
    Object.assign(p.arms[0], { prop: 'chairLeg', x: -2.4, z: -0.2 + 0.12 * Math.sin(c.T * 6), elbow: -0.7 });
  },
  // Kirill calling Oleg to fix the grill
  wave(p, c) {
    Object.assign(p.arms[0], { x: -2.75, z: -0.25 + 0.35 * Math.sin(c.T * 8), elbow: -0.35 + 0.3 * Math.sin(c.T * 8) });
    p.body.y += 0.03 * Math.abs(Math.sin(c.T * 4));
    p.neck.x = -0.1;
  },
  grill(p, c) {
    p.spine.x = 0.3;
    p.neck.x = 0.3;
    for (const l of p.legs) l.knee = 0.15;
    Object.assign(p.arms[0], { prop: 'cardboard', x: -0.9, z: -0.35, elbow: -1.1 + 0.55 * Math.sin(c.T * 13) });
    Object.assign(p.arms[1], { prop: 'skewer', ik: { at: 'forward', off: [0, -0.1, 0.05] }, ikW: 1 });
  },
  // lying in bed with the phone above his face (anime)
  phone(p, c) {
    for (const a of p.arms) Object.assign(a, { ik: { at: 'aboveFace', off: [0, 0, 0] }, ikW: 1 });
    Object.assign(p.arms[0], { prop: 'phone', look: 'face' });
    if (c.T % 7 < 1.2) p.spine.x += 0.05 * Math.sin(c.T * 25); // laughing at the anime
  },
  sleep(p, c) {
    p.spine.x = 0.03 * Math.sin(c.T * 1.1);
    p.neck.z = 0.45;
    p.neck.x = -0.15;
    Object.assign(p.arms[0], { x: 0.05, z: -0.75, elbow: -0.25 }); // flopped aside
    Object.assign(p.arms[1], { ik: { at: 'belly', off: [-0.08, 0, 0.02] }, ikW: 1 }); // hand on the belly
    p.legs[1].z = 0.12;
    if (c.every(1.4)) c.emit('zzz');
  },
  // soaked with cold water: arms wrapped around himself, shaking
  shiver(p, c) {
    for (const [i, s] of SIDES.entries()) Object.assign(p.arms[i], { ik: { at: 'chest', off: [-s * 0.14, -0.04, 0.05] }, ikW: 1 });
    p.spine.x = 0.25;
    p.neck.x = 0.25;
    p.spine.z = 0.04 * Math.sin(c.T * 60);
    p.body.x += 0.01 * Math.sin(c.T * 55);
    for (const l of p.legs) l.knee = 0.2;
  },
  needToilet(p, c) {
    const j = Math.abs(Math.sin(c.T * 9));
    p.legs[0].z = 0.13;
    p.legs[1].z = -0.13;
    for (const l of p.legs) l.knee = 0.2 + 0.15 * j;
    p.body.y -= 0.03 * j;
    p.spine.x = 0.22;
    p.neck.x = 0.15 + 0.05 * Math.sin(c.T * 17);
    for (const a of p.arms) Object.assign(a, { ik: { at: 'crotch', off: [0, 0, 0.03] }, ikW: 1 });
  },
  dance(p, c) {
    const b = c.beat;
    const up = Math.max(0, Math.sin(b));
    p.body.y += 0.045 * up - 0.03;
    for (const l of p.legs) l.knee = 0.15 + 0.3 * (1 - up);
    Object.assign(p.arms[0], { x: -1.5 - 0.9 * up, z: -0.25, elbow: -1.3 + 0.7 * up });
    Object.assign(p.arms[1], { x: -0.6 - 0.5 * Math.max(0, Math.sin(b + Math.PI)), z: 0.35, elbow: -1.4 });
    p.neck.x = 0.2 * Math.sin(b * 2);
    p.spine.y = 0.25 * Math.sin(b / 2);
    p.pelvis.z = 0.1 * Math.sin(b);
  },
  seatDance(p, c) {
    const up = Math.max(0, Math.sin(c.beat));
    p.neck.x = 0.25 * Math.sin(c.beat * 2);
    Object.assign(p.arms[0], { x: -1.2 - 0.9 * up, z: -0.2, elbow: -1.2 + 0.5 * up });
    p.spine.z = 0.12 * Math.sin(c.beat / 2);
  },
};

// one-shots get (p, c, w, u, opts): w = fade in/out weight, u = seconds since start
const SHOTS = {
  drink: {
    dur: 2.4,
    run(p, c, w, u, o) {
      const a = p.arms[0];
      const tip = smooth(0.4, 1.0, u) * (1 - smooth(1.7, 2.1, u));
      Object.assign(a, { ik: { at: 'mouth', off: [0, 0.02 + 0.12 * tip, 0.14] }, ikW: w, prop: o.kind ?? 'beer', look: 'mouth' });
      mix(p.neck, 'x', -0.55 * tip + 0.04 * Math.sin(c.T * 10) * tip, w);
      mix(p.spine, 'x', -0.12, w);
    },
  },
  // the drinking photo shows the bottle and the hand, so the body only leans back
  drinkPhoto: {
    dur: 2.4,
    run(p, c, w) {
      mix(p.neck, 'x', -0.25, w);
      mix(p.spine, 'x', -0.1, w);
    },
  },
  eat: {
    dur: 2.8,
    run(p, c, w, u) {
      const a = p.arms[0];
      if (u < 1.3) Object.assign(a, { ik: { at: 'mouth', off: [0, -0.03, 0.08] }, ikW: w, prop: 'snack' });
      else {
        Object.assign(a, { ik: { at: 'chest', off: [0, -0.05, 0.14] }, ikW: w });
        p.neck.x += 0.05 * Math.sin(c.T * 15) * w; // chewing
      }
      mix(p.neck, 'x', 0.12, w);
    },
  },
  talk: {
    dur: 2.6,
    run(p, c, w) {
      const a = p.arms[1];
      mix(a, 'x', -0.85 + 0.3 * Math.sin(c.T * 5), w);
      mix(a, 'elbow', -1.3 + 0.3 * Math.sin(c.T * 7), w);
      mix(a, 'z', 0.3 + 0.2 * Math.sin(c.T * 3.3), w);
      p.neck.x += 0.08 * Math.sin(c.T * 4) * w;
    },
  },
  laugh: {
    dur: 2.2,
    run(p, c, w) {
      const s = Math.sin(c.T * 22);
      mix(p.spine, 'x', -0.2 + 0.05 * s, w);
      mix(p.neck, 'x', -0.4 + 0.06 * s, w);
      Object.assign(p.arms[1], { ik: { at: 'belly', off: [0, 0, 0.05] }, ikW: w });
    },
  },
  shout: {
    dur: 2.2,
    run(p, c, w) {
      for (const a of p.arms) Object.assign(a, { ik: { at: 'hair', off: [0, 0, 0] }, ikW: w });
      mix(p.neck, 'x', -0.7, w);
      mix(p.spine, 'x', -0.2, w);
      p.spine.z += 0.05 * Math.sin(c.T * 30) * w;
    },
  },
  // a pat on the back jolts him forward
  jolt: {
    dur: 0.35,
    run(p, c, w, u) {
      const k = Math.sin((Math.PI * u) / 0.35);
      p.spine.x += 0.35 * k * w;
      p.neck.x += 0.2 * k * w;
    },
  },
  // losing balance on the way down: windmilling arms, a leg kicking out
  flail: {
    dur: 0.6,
    run(p, c, w, u) {
      for (const [i, s] of SIDES.entries()) {
        mix(p.arms[i], 'x', -2.2 + 1.4 * Math.sin(c.T * 22 + i * Math.PI), w);
        mix(p.arms[i], 'z', s * (0.8 + 0.4 * Math.sin(c.T * 17)), w);
        mix(p.arms[i], 'elbow', -0.3, w);
      }
      mix(p.legs[0], 'x', -0.9 * Math.sin((Math.PI * u) / 0.6), w);
      mix(p.legs[1], 'knee', 0.6, w);
      mix(p.neck, 'x', -0.5, w);
    },
  },
  // getting up off the floor: push up with the arms, a knee under him
  getup: {
    dur: 0.7,
    run(p, c, w, u) {
      const k = 1 - u / 0.7;
      for (const [i, s] of SIDES.entries()) {
        mix(p.arms[i], 'x', -1.2 * k, w);
        mix(p.arms[i], 'z', s * 0.4 * k, w);
      }
      mix(p.legs[0], 'x', -1.2 * k, w);
      mix(p.legs[0], 'knee', 1.4 * k, w);
      mix(p.spine, 'x', 0.5 * k, w);
    },
  },
  stumble: {
    dur: 0.9,
    run(p, c, w, u) {
      const k = Math.sin((Math.PI * u) / 0.9);
      mix(p.spine, 'x', 0.6 * k, w);
      p.body.z += 0.12 * k * w;
      for (const [i, s] of SIDES.entries()) {
        mix(p.arms[i], 'x', -1.3, w);
        mix(p.arms[i], 'z', s * 0.55, w);
      }
      mix(p.legs[0], 'x', -0.7 * k, w);
      mix(p.legs[0], 'knee', 0.5, w);
      mix(p.legs[1], 'knee', 0.4, w);
    },
  },
  knock: {
    dur: 0.9,
    run(p, c, w) {
      const a = p.arms[0];
      mix(a, 'x', -1.45, w);
      mix(a, 'z', -0.1, w);
      mix(a, 'elbow', -1.7 + 0.55 * Math.max(0, Math.sin(c.T * 18)), w);
    },
  },
  scratch: {
    dur: 1.6,
    run(p, c, w) {
      Object.assign(p.arms[1], { ik: { at: 'hair', off: [0.02 * Math.sin(c.T * 20), 0, 0] }, ikW: w });
      mix(p.neck, 'x', 0.15, w);
    },
  },
  lookAround: {
    dur: 2.4,
    run(p, c, w, u) {
      mix(p.neck, 'y', 0.9 * Math.sin(u * 2.6), w);
    },
  },
};

// losing balance: windmill the arms, bend against the lean, a leg out
function balanceLayer(p, c) {
  const b = c.bal;
  if (!b || b.m < 0.04 || c.pose !== 'stand') return;
  const m = Math.min(1, b.m / 0.5);
  p.spine.x -= b.p * 0.9;
  p.spine.z -= b.r * 0.9;
  p.neck.x -= b.p * 0.5;
  for (const [i, s] of SIDES.entries()) {
    p.arms[i].x += m * (-1.8 + 1.1 * Math.sin(c.T * 15 + i * 2.2));
    p.arms[i].z += s * m * (0.9 + 0.5 * Math.sin(c.T * 11 + i));
    p.arms[i].elbow -= 0.3 * m;
  }
  const out = b.r > 0 ? 0 : 1; // the leg on the side he's tipping to steps out
  p.legs[out].z += SIDES[out] * 0.35 * m;
  p.legs[out].x -= 0.3 * m * Math.sign(b.p);
}

function drunkLayer(p, c) {
  const d = c.drunk;
  if (d < 0.05 || c.pose === 'lie') return;
  const n1 = nz(c.T * 0.9, c.seed), n2 = nz(c.T * 0.7, c.seed + 4), n3 = nz(c.T * 0.5, c.seed + 9);
  if (c.pose === 'sit') {
    p.spine.z += 0.2 * d * n1;
    p.neck.z += 0.35 * d * n3;
    p.neck.x += 0.35 * d;
    return;
  }
  p.body.x += 0.08 * d * n1;
  p.body.z += 0.05 * d * n2;
  p.pelvis.z -= 0.12 * d * n1;
  p.spine.z += 0.25 * d * n1;
  p.spine.x += 0.1 * d * (0.5 + 0.5 * n2);
  p.neck.z += 0.35 * d * n3;
  p.neck.x += 0.3 * d * (0.6 + 0.4 * n2);
  for (const [i, s] of SIDES.entries()) {
    p.arms[i].z += s * 0.2 * d;
    p.arms[i].elbow -= 0.1 * d;
    p.legs[i].knee += 0.12 * d;
    // step out to the side he is falling to
    const lean = s > 0 ? Math.max(0, n1) : Math.max(0, -n1);
    p.legs[i].z += s * 0.14 * d * lean;
  }
}

// ---------- the rig ----------

export function createRig(body, { m, sk, style }) {
  const pelvis = new THREE.Group();
  pelvis.position.y = DIM.hip;
  body.add(pelvis);
  const spine = new THREE.Group();
  pelvis.add(spine);
  spine.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.6, 0.21).translate(0, 0.26, 0), sk?.torso ?? m.shirt));
  const neck = new THREE.Group();
  neck.position.y = DIM.neckY;
  spine.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.1).translate(0, 0.03, 0), m.skin);
  neck.add(neckMesh);
  const shoe = mat('#1a1a1a', { roughness: 0.6 });

  const legs = SIDES.map((s, i) => {
    const hip = new THREE.Group();
    hip.position.x = s * 0.085;
    pelvis.add(hip);
    const lm = sk?.legs[i] ?? m.pants;
    hip.add(new THREE.Mesh(vSlice(new THREE.BoxGeometry(0.13, DIM.thigh, 0.15).translate(0, -DIM.thigh / 2, 0), 0.5, 1), lm));
    const knee = new THREE.Group();
    knee.position.y = -DIM.thigh;
    hip.add(knee);
    knee.add(new THREE.Mesh(vSlice(new THREE.BoxGeometry(0.12, DIM.shin, 0.14).translate(0, -DIM.shin / 2, 0), 0, 0.5), lm));
    knee.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.25).translate(0, -DIM.shin - 0.02, 0.05), shoe));
    return { hip, knee };
  });

  const arms = SIDES.map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * DIM.shoulderX, DIM.shoulderY, 0);
    spine.add(shoulder);
    const am = sk?.arm ?? m.shirt;
    shoulder.add(new THREE.Mesh(vSlice(new THREE.BoxGeometry(0.095, DIM.upper, 0.105).translate(0, -DIM.upper / 2, 0), 0.5, 1), am));
    const elbow = new THREE.Group();
    elbow.position.y = -DIM.upper;
    shoulder.add(elbow);
    elbow.add(new THREE.Mesh(vSlice(new THREE.BoxGeometry(0.085, DIM.fore, 0.095).translate(0, -DIM.fore / 2, 0), 0, 0.5), am));
    const hand = new THREE.Group();
    hand.position.y = -DIM.fore;
    elbow.add(hand);
    hand.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.07).translate(0, -0.045, 0), m.skin));
    const grip = new THREE.Group();
    grip.position.y = -DIM.grip;
    grip.rotation.x = -Math.PI / 2; // props point along the forearm, "up" when the arm hangs
    hand.add(grip);
    return { shoulder, elbow, hand, grip, props: {}, ikW: 0, ikPos: new THREE.Vector3(), ikTarget: new THREE.Vector3(), q: new THREE.Quaternion() };
  });

  const H = HEAD[style] ?? HEAD.box;
  const seed = Math.random() * 100;
  let T = Math.random() * 10;
  let walkPhase = 0;
  let pose = 'stand';
  let loop = null, loopOpts = {};
  let shot = null; // { name, u, opts }
  let events = [];

  const V = new THREE.Vector3(), V2 = new THREE.Vector3();
  const anchor = (name, s, off = [0, 0, 0], out = new THREE.Vector3()) => {
    const [ox, oy, oz] = off;
    const at = {
      mouth: () => neck.localToWorld(out.set(ox, H.mouthY + oy, H.front + oz)),
      face: () => neck.localToWorld(out.set(ox, H.eyeY - 0.03 + oy, H.front + oz)),
      eye: () => neck.localToWorld(out.set(s * 0.055 + ox, H.eyeY + oy, H.front + oz)),
      hair: () => neck.localToWorld(out.set(s * 0.15 + ox, H.hairY + oy, 0.02 + oz)),
      chest: () => spine.localToWorld(out.set(s * 0.06 + ox, 0.38 + oy, 0.12 + oz)),
      belly: () => spine.localToWorld(out.set(s * 0.05 + ox, 0.12 + oy, 0.12 + oz)),
      crotch: () => pelvis.localToWorld(out.set(s * 0.03 + ox, -0.06 + oy, 0.13 + oz)),
      forward: () => spine.localToWorld(out.set(s * 0.14 + ox, 0.3 + oy, 0.45 + oz)),
      aboveFace: () => neck.localToWorld(out.set(s * 0.07 + ox, H.eyeY - 0.02 + oy, 0.38 + oz)),
      knee: () => legs[s < 0 ? 0 : 1].knee.localToWorld(out.set(ox, 0.06 + oy, 0.08 + oz)),
    }[name];
    return at ? at() : out.set(0, 0, 0);
  };

  // two-bone IK: returns the shoulder quaternion (in spine space) and the elbow angle
  const pole = new THREE.Vector3(), dir = new THREE.Vector3(), u = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const basis = new THREE.Matrix4(), inv = new THREE.Matrix4();
  function solveIK(arm, s, targetWorld, qOut) {
    const L1 = DIM.upper, L2 = DIM.fore + DIM.grip;
    const t = spine.worldToLocal(V.copy(targetWorld));
    dir.copy(t).sub(arm.shoulder.position);
    let dist = dir.length();
    dist = Math.max(0.08, Math.min(L1 + L2 - 0.002, dist));
    dir.normalize();
    pole.set(s * 0.7, -0.6, -0.4).normalize(); // elbow goes out, down and a bit back
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-4) pole.set(s, 0, 0);
    pole.normalize();
    const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
    const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
    u.copy(dir).multiplyScalar(Math.cos(A)).addScaledVector(pole, Math.sin(A)); // upper arm direction
    Y.copy(u).negate();
    X.crossVectors(u, dir);
    if (X.lengthSq() < 1e-6) X.crossVectors(u, pole);
    X.normalize();
    Z.crossVectors(X, Y).normalize();
    basis.makeBasis(X, Y, Z);
    qOut.setFromRotationMatrix(basis);
    // forearm: target in upper-arm space, rotate about local x
    const elbowPos = V2.copy(arm.shoulder.position).addScaledVector(u, L1);
    const tl = t.sub(elbowPos).applyMatrix4(inv.copy(basis).transpose());
    return Math.atan2(-tl.z, -tl.y);
  }

  const fkQ = new THREE.Quaternion(), ikQ = new THREE.Quaternion(), eul = new THREE.Euler();
  // ---- the body is physical: every joint is a damped spring chasing the animation's target, pushed by
  // the body's own acceleration (stop short and the torso and arms swing on) and, when drunk, by random
  // shoves. Drunk = weaker, bouncier springs and more shoves: limbs flop, the head bobbles.
  const vel = new WeakMap();
  const swingQ = new THREE.Quaternion();
  const rootPos = new THREE.Vector3(), rootVel = new THREE.Vector3(), rootAcc = new THREE.Vector3(), tmp = new THREE.Vector3();
  let rootInit = false;
  const phys = { k: 260, zeta: 0.85, push: 0 };
  const spring = (obj, key, target, dt, kMul = 1, kick = 0) => {
    let v = vel.get(obj);
    if (!v) vel.set(obj, (v = {}));
    const k = phys.k * kMul, c = 2 * phys.zeta * Math.sqrt(k);
    const x = obj[key], vx = (v[key] ?? 0) + ((target - x) * k - (v[key] ?? 0) * c) * dt + kick;
    v[key] = vx;
    obj[key] = x + vx * dt;
  };
  const noise = (amt) => (Math.random() - 0.5) * 2 * amt;
  const mouthW = new THREE.Vector3(), faceW = new THREE.Vector3();

  function prop(arm, name) {
    for (const [k, o] of Object.entries(arm.props)) o.visible = k === name;
    if (name && !arm.props[name] && PROPS[name]) {
      arm.props[name] = PROPS[name]();
      arm.grip.add(arm.props[name]);
    }
    return name ? arm.props[name] : null;
  }

  const ctx = {
    get T() { return T; },
    seed,
    every(interval) {
      return Math.floor(T / interval) !== Math.floor((T - ctx.dt) / interval);
    },
    emit(type) {
      events.push(type);
    },
  };

  return {
    pelvis, spine, neck, neckMesh, arms, legs,
    get pose() { return pose; },
    setPose(p) {
      pose = p;
    },
    // continuous activity, e.g. 'puke'; null = nothing special
    setLoop(name, opts = {}) {
      loop = LOOPS[name] ? name : null;
      loopOpts = opts;
    },
    play(name, opts = {}) {
      if (!SHOTS[name]) return;
      shot = { name, u: 0, opts, dur: opts.dur ?? SHOTS[name].dur };
    },
    get busy() {
      return !!shot;
    },
    // physical: a ragdoll plays this body (world/ragdoll.js); then no fake inertia / shoves here, physics does that
    update(dt, { walking = false, speed = 1.8, drunk = 0, music = false, bal = null, physical = false } = {}) {
      T += dt;
      ctx.dt = dt;
      if (walking) walkPhase += dt * speed * ((2 * Math.PI) / 1.35);
      Object.assign(ctx, { pose, walking, walkPhase, drunk, beat: (T * 2 * Math.PI) / 0.6, music, bal });

      // ---- build the target pose
      const p = defaultPose();
      base(p, ctx);
      if (loop) LOOPS[loop](p, ctx, loopOpts);
      if (shot) {
        shot.u += dt;
        const w = smooth(0, 0.3, shot.u) * (1 - smooth(shot.dur - 0.35, shot.dur, shot.u));
        SHOTS[shot.name].run(p, ctx, w, shot.u, shot.opts);
        if (shot.u >= shot.dur) shot = null;
      }
      drunkLayer(p, ctx);
      balanceLayer(p, ctx);

      // ---- physics: how floppy tonight, and how the body is being thrown around
      const d = Math.min(1, drunk);
      phys.k = 260 * (1 - 0.6 * d);
      phys.zeta = 0.85 - 0.5 * d;
      const sdt = Math.min(dt, 1 / 30);
      const root = body.parent?.parent ?? body.parent;
      if (root) {
        root.getWorldPosition(tmp);
        if (!rootInit) {
          rootPos.copy(tmp);
          rootInit = true;
        }
        const nv = tmp.clone().sub(rootPos).divideScalar(Math.max(dt, 1e-3));
        if (nv.length() > 8) nv.set(0, 0, 0); // teleports are not accelerations
        rootAcc.copy(nv).sub(rootVel).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 30);
        rootVel.copy(nv);
        rootPos.copy(tmp);
        // into the body's frame: +z forward, +x to its left
        const yaw = root.rotation.y;
        const fwd = Math.sin(yaw) * rootAcc.x + Math.cos(yaw) * rootAcc.z;
        const side = Math.cos(yaw) * rootAcc.x - Math.sin(yaw) * rootAcc.z;
        phys.fwd = fwd;
        phys.side = side;
      }
      const lean = (amt) => (physical ? 0 : -(phys.fwd ?? 0) * amt * sdt); // speeding up throws the top back, braking throws it forward
      const roll = (amt) => (physical ? 0 : (phys.side ?? 0) * amt * sdt);
      const shove = physical ? 0 : 4 * d * d; // random drunk shoves (rad/s per frame)
      pelvis.position.x += (p.body.x - pelvis.position.x) * Math.min(1, dt * 9);
      pelvis.position.z += (p.body.z - pelvis.position.z) * Math.min(1, dt * 9);
      spring(pelvis.position, 'y', DIM.hip + p.body.y, sdt, 1.2);
      for (const a of ['x', 'y', 'z']) spring(pelvis.rotation, a, p.pelvis[a], sdt, 0.9, a === 'z' ? noise(shove * 0.3) : 0);
      spring(spine.rotation, 'x', p.spine.x, sdt, 0.8, lean(0.06) + noise(shove * 0.5));
      spring(spine.rotation, 'y', p.spine.y, sdt, 0.8);
      spring(spine.rotation, 'z', p.spine.z, sdt, 0.8, roll(0.05) + noise(shove * 0.6));
      // the head is heavy and loose on a drunk neck
      spring(neck.rotation, 'x', p.neck.x, sdt, 0.7 - 0.25 * d, lean(0.1) + noise(shove));
      spring(neck.rotation, 'y', p.neck.y, sdt, 0.7);
      spring(neck.rotation, 'z', p.neck.z, sdt, 0.7 - 0.25 * d, roll(0.1) + noise(shove));
      for (const [i, leg] of legs.entries()) {
        spring(leg.hip.rotation, 'x', p.legs[i].x, sdt, 1.4, noise(shove * 0.4));
        spring(leg.hip.rotation, 'z', p.legs[i].z, sdt, 1.4);
        spring(leg.knee.rotation, 'x', p.legs[i].knee, sdt, 1.4);
      }
      const k = 1 - Math.exp(-dt * 16 * (1 - 0.5 * d));
      body.parent?.updateMatrixWorld(true);
      body.updateMatrixWorld(true);

      // ---- arms: FK blended with IK
      for (const [i, arm] of arms.entries()) {
        const s = SIDES[i];
        const a = p.arms[i];
        fkQ.setFromEuler(eul.set(a.x, a.y, a.z));
        let elbow = a.elbow;
        const wantW = a.ik ? a.ikW : 0;
        if (a.ik) {
          anchor(a.ik.at, s, a.ik.off, arm.ikTarget);
          if (arm.ikW < 0.02) arm.ikPos.copy(arm.ikTarget);
          else arm.ikPos.lerp(arm.ikTarget, 1 - Math.exp(-dt * 14));
        }
        arm.ikW += (wantW - arm.ikW) * (1 - Math.exp(-dt * 8));
        if (arm.ikW > 0.01) {
          const e = solveIK(arm, s, arm.ikPos, ikQ);
          fkQ.slerp(ikQ, arm.ikW);
          elbow += (e - elbow) * arm.ikW;
        }
        arm.shoulder.quaternion.slerp(fkQ, k);
        // the arm swings on its own: inertia from the body, drunk flailing; less so when it holds something
        arm.swing ??= { x: 0, z: 0 };
        if (physical) arm.swing.x = arm.swing.z = 0;
        const free = 1 - arm.ikW;
        spring(arm.swing, 'x', 0, sdt, 0.5, free * (lean(0.12) + noise(shove * 0.9)));
        spring(arm.swing, 'z', 0, sdt, 0.5, free * (roll(0.12) * SIDES[i] + noise(shove * 0.8)));
        arm.shoulder.quaternion.multiply(swingQ.setFromEuler(eul.set(arm.swing.x, 0, arm.swing.z)));
        spring(arm.elbow.rotation, 'x', elbow, sdt, 1.1, noise(shove * 0.8) * free);
        const pr = prop(arm, a.prop);
        if (pr) {
          if (a.look) {
            arm.hand.updateMatrixWorld(true);
            pr.lookAt(anchor(a.look === 'face' ? 'face' : 'mouth', s, [0, 0, 0], V));
          } else pr.rotation.set(0, 0, 0);
        }
      }

      // ---- effects
      if (events.length) {
        body.updateMatrixWorld(true);
        const fwd = V2.set(0, 0, 1).transformDirection(neck.matrixWorld);
        for (const ev of events) {
          if (ev === 'vomit') particles.drops(anchor('mouth', 0, [0, -0.02, 0.02], mouthW), V.set(fwd.x * 0.8, -0.4, fwd.z * 0.8), { n: 4, color: '#9aa53a', speed: 1.5, spread: 0.35, size: 0.025 });
          if (ev === 'tears') for (const s of SIDES) particles.drops(anchor('eye', s, [0, -0.04, 0.02], faceW), V.set(0, -0.2, 0), { n: 1, color: '#9fd3ff', speed: 0.6, spread: 0.2, size: 0.012 });
          if (ev === 'vapor') particles.puff(anchor('mouth', 0, [0, 0, 0.05], mouthW), V.set(fwd.x * 0.5, 0.15, fwd.z * 0.5), { size0: 0.06, size1: 0.35, life: 1.2, opacity: 0.5 });
          if (ev === 'bigPuff') particles.puff(anchor('mouth', 0, [0, 0.02, 0.05], mouthW), V.set(fwd.x * 0.6, 0.35, fwd.z * 0.6), { size0: 0.1, size1: 0.8, life: 2.2, opacity: 0.55 });
          if (ev === 'smoke') particles.puff(anchor('mouth', 0, [0, 0, 0.05], mouthW), V.set(fwd.x * 0.3, 0.1, fwd.z * 0.3), { color: '#9a9a9a', size0: 0.08, size1: 0.4, life: 1.2, opacity: 0.45 });
          if (ev === 'smokeCloud') particles.puff(anchor('face', 0, [(Math.random() - 0.5) * 0.4, 0.05, 0.15], faceW), V.set(0, 0.12, 0), { color: '#8a8a8a', size0: 0.25, size1: 0.8, life: 2.5, opacity: 0.4 });
          if (ev === 'zzz') particles.zzz(anchor('face', 0, [0.1, 0.15, 0], faceW));
        }
        events = [];
      }
    },
    // world position of a head point (for game logic, e.g. where vomit lands)
    anchor(name, out = new THREE.Vector3()) {
      return anchor(name, 1, [0, 0, 0], out);
    },
  };
}
