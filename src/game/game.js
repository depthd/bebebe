// Night simulation: fun, hut condition, money, fridge/table stock, visitors, deliveries,
// puddles, broken things, the stove, the grill, the cat toy and Oleg himself.
import * as THREE from 'three';
import { TUNE } from '../config.js';
import { TOY_SPOTS, VISITOR_SPOT, CAT_SPOTS, SPOTS, roomAt } from '../world/layout.js';
import { makePerson, makePuddle, makeToy, makeBottle, makePlate, makeBrokenMark, makeBucket } from '../world/figures.js';
import { Friend, Cat, clamp, rand, makeBody } from './friends.js';
import { particles } from '../world/particles.js';
import { Interactions } from './interact.js';
import { Cooking } from './cooking.js';
import { PartyEvents } from './events.js';
import { PC } from './pc.js';
import { Living } from './living.js';
import { Shop } from './shop.js';
import { step as physicsStep, moveOleg, updateDoors } from '../world/ragdoll.js';

export const ITEMS = {
  beer: { name: 'Пиво', icon: '🍺' },
  vodka: { name: 'Водка', icon: '🍾' },
  food: { name: 'Еда', icon: '🍕' },
  mop: { name: 'Тряпка', icon: '🧽' },
  shower: { name: 'Лейка душа', icon: '🚿' },
  cat: { name: 'Кот', icon: '🐱' },
  tools: { name: 'Инструменты', icon: '🔧' },
  toy: { name: 'Мышка', icon: '🐭' },
  bucket: { name: 'Ведро', icon: '🪣' },
  pelmeni: { name: 'Пельмени', icon: '🥟' },
  water: { name: 'Ведро воды', icon: '🪣' },
};

const FRIEND_IDS = ['alexey', 'lyokha', 'kirill', 'temych'];
// "Пиво ×4, Пиво ×4, Пельмени" -> "Пиво ×4 ×2, Пельмени"
const summarize = (titles) => Object.entries(titles.reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {})).map(([t, n]) => (n > 1 ? `${t} — ${n} шт` : t)).join(', ');
const BREAKABLE = ['stenka', 'ficus', 'microwave', 'sisterDesk', 'kitchenTable', 'wardrobe', 'loftBed', 'olegBed', 'sofa'];

class Inventory {
  constructor(game) {
    this.game = game;
    this.slots = [null, null, null, null];
    this.portion = [1, 1, 1, 1]; // food drained badly is only part of a portion
    this.sel = 0;
  }
  selectedItem() {
    return this.slots[this.sel];
  }
  has(type) {
    return this.slots.includes(type);
  }
  add(type, portion = 1) {
    const i = this.slots.indexOf(null);
    if (i < 0) {
      this.game.toast('Руки заняты — освободи слот (G — выбросить)', 'warn');
      return false;
    }
    this.slots[i] = type;
    this.portion[i] = portion;
    if (!this.slots[this.sel]) this.sel = i;
    return true;
  }
  selectedPortion() {
    return this.portion[this.sel] ?? 1;
  }
  // the same slot now holds something else (an empty bucket filled up, and back)
  swap(from, to) {
    const i = this.slots.indexOf(from);
    if (i >= 0) this.slots[i] = to;
  }
  consume() {
    this.slots[this.sel] = null;
    this.portion[this.sel] = 1;
  }
  remove(type) {
    const i = this.slots.indexOf(type);
    if (i >= 0) this.slots[i] = null;
  }
  select(i) {
    this.sel = (i + this.slots.length) % this.slots.length;
  }
  drop() {
    const item = this.slots[this.sel];
    if (!item) return;
    this.slots[this.sel] = null;
    if (item === 'shower') return this.game.hands.returnShower();
    // outside the flat there's no fridge to put it back in: in the shop it goes back on the shelf
    if (this.game.outside && roomAt(...this.game.olegPos) == null) {
      if (this.game.shop?.putBack(item)) return;
      if (['beer', 'vodka', 'food', 'pelmeni'].includes(item)) return;
    }
    if (item === 'pelmeni') return void this.game.state.fridge.pelmeni++;
    if (item === 'toy') this.game.dropToy();
    else if (item === 'bucket' || item === 'water') this.game.dropBucket(item === 'water');
    else if (item === 'cat') this.game.dropCat();
    else if (['beer', 'vodka', 'food'].includes(item)) this.game.state.fridge[item] += 1; // back to the fridge
  }
}

export class Game {
  constructor({ scene, apt, furn, sfx, voices }) {
    this.scene = scene;
    this.voices = voices;
    this.apt = apt;
    this.furn = furn;
    this.doors = apt.doors;
    this.sfx = sfx;
    this.dynamic = new THREE.Group();
    scene.add(this.dynamic);
    particles.attach(scene);
    this.toasts = [];
    this.toastKeys = {};
    this.onEnd = null;
    this.night = 1;
    this.style = 'sprite';
    this.friends = [];
    this.inv = new Inventory(this);
    this.olegPos = [0, 0];

    this.hands = new Interactions(this);
    this.hands.attachShower(this.furn.items.tub.group);
    this.buildStaticTargets();
    this.buildTableProps();
    this.buildStoveProps();
    this.buildGrillProps();
    this.toy = makeToy();
    this.toy.userData.target = { name: 'Мышка кота', actions: () => [{ key: 'E', text: 'Взять мышку', run: () => this.pickToy() }] };
    this.toyVel = new THREE.Vector3();
    this.toyLoose = false; // thrown / dropped on the floor: the cat goes after it
    this.dynamic.add(this.toy);
    this.buildBucket();
    this.events = new PartyEvents(this);
    this.pc = new PC(this);
    this.living = new Living(this);
  }

  // the stairwell, the yard and the shop (built in main.js, see world/outside.js)
  attachOutside(out) {
    this.outside = out;
    this.shop = new Shop(this, out);
  }

  // ---------- partying (Oleg is at the party too) ----------

  // friends close to Oleg in the same room
  company() {
    const [x, z] = this.olegPos, room = roomAt(x, z)?.id, V = TUNE.vibe;
    return this.friends.filter((f) => !f.fallen && f.room?.id === room && Math.hypot(f.pos[0] - x, f.pos[1] - z) < V.near);
  }

  vibeTick(dt) {
    const V = TUNE.vibe, o = this.oleg;
    const c = this.company();
    this.vibe = c.length;
    o.dance = Math.max(0, (o.dance ?? 0) - dt);
    if (c.length) {
      this.aloneT = 0;
      o.fun = clamp(o.fun + V.withFriends * Math.min(3, c.length) * dt);
      for (const f of c) f.fun = clamp(f.fun + V.hostBonus * dt);
    } else {
      this.aloneT = (this.aloneT ?? 0) + dt;
      if (this.aloneT > V.missAfter) {
        for (const f of this.friends) if (!f.problem) f.fun = clamp(f.fun - V.missDrain * dt);
      }
    }
  }

  // Oleg drank: next to the guys it's a cheers
  cheers() {
    const V = TUNE.vibe, c = this.company();
    if (c.length < 1 || this.state.t < (this.cheersCd ?? 0)) return;
    this.cheersCd = this.state.t + V.cheersCd;
    this.oleg.fun = clamp(this.oleg.fun + V.cheers);
    c.forEach((f, i) => {
      f.fun = clamp(f.fun + V.cheers);
      f.figure.play('laugh');
    });
    this.sfx.ding();
  }

  // T with nothing to do: dance (only with music on)
  olegDance() {
    const V = TUNE.vibe, o = this.oleg;
    if (!this.state.music) return;
    if (o.dance > 0 || !this.spend(V.danceCost)) return;
    o.dance = V.dance;
    o.fun = clamp(o.fun + V.danceFun);
    for (const f of this.company()) {
      f.fun = clamp(f.fun + V.danceFun);
      f.figure.play('laugh');
    }
  }

  // ---------- drunk physics ----------

  // somebody hit the floor: the others laugh (that's the party), the table may lose a bottle
  someoneFell(f, why) {
    const st = this.state, C = TUNE.chaos;
    const near = (x, z, r) => Math.hypot(x - f.pos[0], z - f.pos[1]) < r;
    if (st.t > (this.laughCd ?? 0)) {
      this.laughCd = st.t + 3;
      const watchers = this.friends.filter((w) => w !== f && !w.fallen && near(w.pos[0], w.pos[1], 5));
      watchers.forEach((w, i) => {
        w.fun = clamp(w.fun + C.laugh);
        w.figure.play('laugh');
      });
      if (near(...this.olegPos, 6)) this.oleg.fun = clamp(this.oleg.fun + 2);
    }
    const t = this.furn.items.partyTable;
    if (f.pos[0] > t.x0 - 0.6 && f.pos[0] < t.x1 + 0.6 && f.pos[1] > t.z0 - 0.6 && f.pos[1] < t.z1 + 0.6 && this.tableBooze() > 0) {
      if (st.table.beer > 0) st.table.beer -= 1;
      else st.table.vodka -= 1;
      this.sfx.crash();
      this.toast(`${f.name} рухнул на стол — бутылка вдребезги`, 'bad', 'Зал');
    } else this.sfx.pat();
  }

  bodyBlocked(x, z, r = 0.16) {
    for (const c of [...this.apt.colliders, ...this.furn.colliders]) {
      if (c.enabled === false) continue;
      if (c.seg) {
        const [ax, az, bx, bz] = c.seg;
        const vx = bx - ax, vz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
        if (Math.hypot(x - ax - vx * t, z - az - vz * t) < c.r + r) return true;
      } else if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
    }
    return false;
  }

  shove(f, dx, dz) {
    const x = f.pos[0] + dx, z = f.pos[1] + dz;
    if (!this.bodyBlocked(x, z) || this.bodyBlocked(...f.pos)) f.pos = [x, z];
  }

  // people don't walk through each other: overlapping bodies push apart; running into a drunk guy
  // knocks him over; two drunks walking into each other may go down
  bumps() {
    const C = TUNE.chaos, t = this.state.t, R2 = C.radius * 2;
    const ppl = this.friends.filter((f) => !f.fallen && f.figure.pose === 'stand' && !f.follow && f.figure.root.visible && !f.rag?.active);
    for (const key in this.stuck ?? {}) this.stuck[key] = Math.max(0, this.stuck[key] - 1 / 120);
    for (let i = 0; i < ppl.length; i++) {
      for (let j = i + 1; j < ppl.length; j++) {
        const a = ppl[i], b = ppl[j];
        let dx = b.pos[0] - a.pos[0], dz = b.pos[1] - a.pos[1];
        const d = Math.hypot(dx, dz);
        if (d >= R2 || d < 1e-4) continue;
        dx /= d;
        dz /= d;
        // stuck face to face in a doorway for a second: they squeeze past each other
        if ((a.ghost ?? 0) > t || (b.ghost ?? 0) > t) continue;
        const pairKey = a.id + b.id;
        this.stuck ??= {};
        this.stuck[pairKey] = (this.stuck[pairKey] ?? 0) + 1 / 60;
        if (this.stuck[pairKey] > 1) {
          a.ghost = b.ghost = t + 1.5;
          this.stuck[pairKey] = 0;
          continue;
        }
        const push = (R2 - d) / 2;
        this.shove(a, -dx * push, -dz * push);
        this.shove(b, dx * push, dz * push);
        // walking into each other: both step to their right to pass
        if (a.mode === 'walk' || b.mode === 'walk') {
          const side = 0.03;
          this.shove(a, -dz * side, dx * side);
          this.shove(b, dz * side, -dx * side);
        }
        if ((a.mode === 'walk' || b.mode === 'walk') && a.drunk + b.drunk > C.bumpDrunk && (a.bumpCd ?? 0) < t && (b.bumpCd ?? 0) < t) {
          a.bumpCd = b.bumpCd = t + 2;
          // a shoulder bump: both get knocked back, the drunker the harder to stay up
          a.push(Math.atan2(-dx, -dz), 0.8 + 1.4 * (a.drunk / 100), 'bump');
          b.push(Math.atan2(dx, dz), 0.8 + 1.4 * (b.drunk / 100), 'bump');
        }
      }
    }
    // Oleg walks into people: they get pushed; at a run a drunk one goes flying
    const [ox, oz] = this.olegPos, sp = this.olegSpeed ?? 0, RO = C.radius + 0.17;
    if (this.oleg.fall) return;
    // ragdolls: running into one is a hit to his upper body; the physics decides if he stays up
    for (const f of this.friends) {
      if (!f.rag?.active || f.fallen || sp < 0.8 || (f.shoveCd ?? 0) > t) continue;
      const P = f.rag.pelvis, dx = P.x - ox, dz = P.z - oz, d = Math.hypot(dx, dz);
      if (d > 0.5) continue;
      f.shoveCd = t + 1;
      f.rag.push(Math.atan2(dx, dz), sp * (0.5 + 1.2 * f.drunk / 100));
      f.rag.stun = 0.9 * (f.drunk / 100); // a drunk one loses his footing for a moment
      f.rag.lastPush = 'shove';
    }
    for (const f of ppl) {
      let dx = f.pos[0] - ox, dz = f.pos[1] - oz;
      const d = Math.hypot(dx, dz);
      if (d >= RO || d < 1e-4) continue;
      dx /= d;
      dz /= d;
      this.shove(f, dx * (RO - d), dz * (RO - d));
      if (sp > 0.8 && (f.shoveCd ?? 0) < t) {
        f.shoveCd = t + 1.2;
        // Oleg's momentum goes into his balance: a walk-by sways him, a run into a drunk one floors him
        f.push(Math.atan2(dx, dz), sp * (0.6 + 1.2 * f.drunk / 100), 'shove');
      }
    }
  }

  // Oleg hits the floor: whatever is in his hands goes too
  olegFall(why) {
    const o = this.oleg;
    if (o.fall || o.blackout > 0) return;
    o.fall = { t: 0, dur: 2 };
    this.sfx.pat();
    const it = this.inv.selectedItem();
    const msg = why === 'slip' ? 'Олег поскользнулся на блевоте' : 'Олег наебнулся';
    if (it === 'beer' || it === 'vodka') {
      this.inv.consume();
      this.sfx.crash();
      this.toast(`${msg} — бутылка вдребезги`, 'bad');
    } else if (it === 'food') {
      this.inv.consume();
      this.toast(`${msg} — еда на полу`, 'bad');
    } else if (it === 'water') {
      this.inv.swap('water', 'bucket');
      this.sfx.splash();
      this.toast(`${msg} и облился из ведра`, 'bad');
    } else if (it === 'cat') {
      this.inv.remove('cat');
      this.dropCat();
      this.toast(`${msg}, кот удрал`, 'bad');
    } else this.toast(msg, 'bad');
    o.fun = clamp(o.fun - 3);
    o.energy = Math.max(0, o.energy - 10);
    const near = this.friends.filter((w) => !w.fallen && Math.hypot(w.pos[0] - this.olegPos[0], w.pos[1] - this.olegPos[1]) < 6);
    near.forEach((w, i) => {
      w.fun = clamp(w.fun + TUNE.chaos.laugh);
      w.figure.play('laugh');
    });
  }

  olegPhysics(dt) {
    const o = this.oleg, C = TUNE.chaos, sp = this.olegSpeed ?? 0;
    if (o.fall) {
      o.fall.t += dt;
      if (o.fall.t >= o.fall.dur) o.fall = null;
      return;
    }
    // drunk and running: the feet don't keep up
    if (sp > 4 && o.drunk > C.olegTripAt && Math.random() < ((o.drunk - C.olegTripAt) / (100 - C.olegTripAt)) * C.olegTrip * dt) this.olegFall('trip');
    // puddles
    if (sp > 1 && (this.olegSlipCd ?? 0) < this.state.t) {
      const [x, z] = this.olegPos;
      if (this.puddles.some((p) => Math.hypot(p.position.x - x, p.position.z - z) < 0.3)) {
        this.olegSlipCd = this.state.t + 3;
        if (Math.random() < C.olegSlip + o.drunk / 300 + (sp > 4 ? 0.2 : 0)) this.olegFall('slip');
      }
    }
  }

  // 0 standing .. 1 on the floor (for the camera)
  get olegFallK() {
    const f = this.oleg.fall;
    if (!f) return 0;
    if (f.t < 0.35) return (f.t / 0.35) ** 2;
    if (f.t < f.dur - 0.6) return 1;
    return Math.max(0, 1 - (f.t - (f.dur - 0.6)) / 0.6);
  }

  // ---------- the bucket (for the balcony fire) ----------

  buildBucket() {
    const tub = this.furn.items.tub, wc = this.furn.items.toilet;
    // on the floor in front of the tub, at the end away from the toilet
    const wcx = (wc.x0 + wc.x1) / 2;
    const x = Math.abs(tub.x0 - wcx) > Math.abs(tub.x1 - wcx) ? tub.x0 + 0.3 : tub.x1 - 0.3;
    this.bucketHome = [x, tub.z1 + 0.28];
    this.bucket = makeBucket();
    this.bucket.userData.target = { name: 'Ведро', actions: () => [{ key: 'E', text: 'Взять ведро', run: () => this.inv.add('bucket') && (this.bucket.visible = false) }] };
    this.bucket.traverse((o) => o !== this.bucket && (o.userData.target = this.bucket.userData.target));
    this.dynamic.add(this.bucket);
    this.placeBucket(...this.bucketHome);
  }

  placeBucket(x, z) {
    this.bucket.position.set(x, 0, z);
    this.bucket.visible = true;
  }

  dropBucket(full) {
    const [x, z] = this.olegPos, yaw = this.olegYaw ?? 0;
    let px = x - Math.sin(yaw) * 0.5, pz = z - Math.cos(yaw) * 0.5;
    if (this.toyBlocked(px, pz)) [px, pz] = [x, z];
    this.placeBucket(px, pz);
    if (full) {
      particles.drops(new THREE.Vector3(px, 0.3, pz), new THREE.Vector3(0, 1, 0), { n: 30, color: '#a9dcff', speed: 2, spread: 1, size: 0.02 });
      this.sfx.splash();
    }
  }

  // problem frequency: grows each night, and every night starts calm and ramps up (TUNE.warmup)
  // swap every guy's look between 'box' (cube heads) and 'sprite' (Doom-style billboards)
  restyle(style) {
    this.style = style;
    for (const f of this.friends) {
      const old = f.figure;
      const nf = makePerson({ ...f.def, style, faceId: f.id });
      nf.root.position.copy(old.root.position);
      nf.root.rotation.copy(old.root.rotation);
      nf.root.userData = old.root.userData;
      nf.setPose(old.pose, f.y);
      if (f.problem) nf.setStatus(f.problem.short);
      this.dynamic.remove(old.root);
      this.dynamic.add(nf.root);
      f.figure = nf;
      f.rag?.disable();
      f.rag = makeBody(nf.rig);
      f.hookBody();
    }
  }

  // this night's setup (TUNE.NIGHTS)
  get N() {
    return TUNE.NIGHTS[Math.min(this.night, TUNE.NIGHTS.length) - 1];
  }
  get pace() {
    return this.N.pace;
  }
  hasEvent(id) {
    return this.N.events.includes(id);
  }

  get diff() {
    const W = TUNE.warmup;
    const ramp = Math.min(1, Math.max(0, (this.state.t - W.calm) / W.ramp));
    return this.N.trouble * (W.min + (1 - W.min) * ramp);
  }

  // ---------- night lifecycle ----------

  startNight(n) {
    this.night = n;
    this.voices?.stopAll();
    this.usedClips = new Set();
    this.talk = null;
    this.leading = null;
    if (this.hands?.showerHeld()) this.hands.returnShower();
    this.reactCd = 0;
    this.koch = null;
    this.kochT = null;
    const S = TUNE.start, NS = this.N;
    this.state = {
      t: 0,
      totalFun: S.totalFun,
      hut: S.hut,
      money: NS.money,
      fridge: { ...NS.fridge },
      table: { ...NS.table },
      music: false,
      volume: 1,
      noise: 0,
      anger: 0,
      neighborCd: 10,
      policeVisits: 0,
      stats: { helped: 0, bribes: 0, spent: 0 },
      photos: [],
      photoCats: new Set(),
    };
    this.oleg = { fun: 80, drunk: 0, blackout: 0, energy: TUNE.energy.max, thirst: 0, fall: null, dance: 0 };
    this.inv = new Inventory(this);
    this.toasts = [];
    this.toastKeys = {};
    this.over = null;
    this.orders = [];
    this.visitor?.figure && this.dynamic.remove(this.visitor.figure.root);
    for (const l of this.leaving ?? []) this.dynamic.remove(l.figure.root);
    this.leaving = [];
    this.visitorGap = 0;
    this.visitor = null;
    this.visitorQueue = [];
    this.pending = [];
    this.stove = { phase: 'idle', t: 0 };
    this.grill = { lit: false, heat: 0 };
    particles.clear();
    this.events?.reset();
    this.pc?.reset();
    if (this.cooking) {
      this.cooking.end(); // a night can end in the middle of the pelmeni close-up
      this.cooking.pot.visible = false;
    }
    this.living?.reset();
    this.shop?.reset();
    this.placeBucket(...this.bucketHome);
    for (const p of this.puddles ?? []) this.dynamic.remove(p);
    this.puddles = [];
    for (const it of Object.values(this.furn.items)) this.setBroken(it, false);

    for (const f of this.friends) {
      f.rag?.disable();
      this.dynamic.remove(f.figure.root);
    }
    this.friends = FRIEND_IDS.map((id) => new Friend(this, id));
    for (const f of this.friends) {
      this.dynamic.add(f.figure.root);
      f.figure.root.userData.target = { name: f.name, friend: f, info: () => (f.problem ? f.problem.text : f.statusText), actions: () => f.actions(this) };
    }
    if (this.cat) this.dynamic.remove(this.cat.figure.root);
    this.cat = new Cat(this);
    this.cat.figure.root.userData.target = { name: 'Кот', cat: this.cat, info: () => this.cat.statusText, actions: () => this.cat.actions(this) };
    this.dynamic.add(this.cat.figure.root);

    this.doors.balcony.setOpen(true);
    this.doors.bath.setOpen(true);
    this.doors.entrance.setOpen(false);
    this.lastToy = -1;
    this.respawnToy();
  }

  // how close the neighbours are to knocking, 0..1
  get noiseLevel() {
    const N = TUNE.noise;
    return Math.min(1, this.state.noise / Math.max(10, N.neighborAt - this.state.anger * N.angerStep));
  }

  get clock() {
    const mins = 22 * 60 + (this.state.t / TUNE.nightSeconds) * 8 * 60;
    const h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  gameMinutes(sec) {
    return Math.round((sec * 480) / TUNE.nightSeconds);
  }

  // ---------- messages ----------

  toast(text, kind = 'info', room = null) {
    this.toasts.push({ text, kind, room, life: kind === 'alert' ? 5 : 3.5 });
    if (this.toasts.length > 3) this.toasts.shift();
  }
  alert(text, room, kind = 'alert') {
    this.toast(text, kind, room);
    if (kind === 'alert') this.sfx.alarm();
  }
  toastOnce(key, text, kind, cooldown) {
    const now = this.state.t;
    if (this.toastKeys[key] !== undefined && now - this.toastKeys[key] < cooldown) return;
    this.toastKeys[key] = now;
    this.toast(text, kind);
    return true;
  }
  olegHelped() {
    this.oleg.fun += TUNE.fun.helpBonus;
    this.state.stats.helped += 1;
  }

  // ---------- world helpers ----------

  tableBooze() {
    return this.state.table.beer + this.state.table.vodka;
  }

  bathOccupied(except) {
    const bathClosed = !this.doors.bath.open;
    return this.friends.some(
      (f) =>
        f !== except &&
        (f.activity?.id === 'toilet' ||
          (f.mode === 'walk' && f.target?.id === 'toilet') ||
          (f.activity?.id === 'vape' && f.activity.spot.id === 'bathStand' && bathClosed) ||
          (f.problem?.id === 'puke' && f.room?.id === 'bath')),
    );
  }

  addPuddle(x, z) {
    const room = roomAt(x, z);
    if (!room || room.id === 'landing') return;
    const p = makePuddle(x, z);
    const puddle = { mesh: p, dirt: 1, sx: p.scale.x, sz: p.scale.z };
    p.userData.target = {
      name: 'Блевота',
      puddle,
      info: () => (this.inv.selectedItem() === 'mop' ? '' : this.inv.has('mop') ? 'Возьми тряпку в руку (1–4)' : 'Нужна тряпка — висит у раковины в санузле'),
      actions: () => [],
    };
    this.dynamic.add(p);
    this.puddles.push(p);
  }

  removePuddle(p) {
    if (!this.puddles.includes(p)) return;
    this.dynamic.remove(p);
    this.puddles = this.puddles.filter((q) => q !== p);
    this.state.hut += TUNE.hut.clean;
    this.olegHelped();
  }

  setBroken(item, v) {
    item.broken = v;
    if (v && !item.mark) {
      item.mark = makeBrokenMark();
      item.mark.position.set((item.x0 + item.x1) / 2, 1.3, (item.z0 + item.z1) / 2);
      this.dynamic.add(item.mark);
    }
    if (!v && item.mark) {
      this.dynamic.remove(item.mark);
      item.mark = null;
    }
  }

  breakSomething(roomId) {
    const items = BREAKABLE.map((id) => this.furn.items[id]).filter((it) => it && !it.broken);
    const inRoom = items.filter((it) => roomAt((it.x0 + it.x1) / 2, (it.z0 + it.z1) / 2)?.id === roomId);
    const pool = inRoom.length ? inRoom : items;
    if (!pool.length) return;
    const it = pool[Math.floor(Math.random() * pool.length)];
    this.setBroken(it, true);
    this.state.hut -= TUNE.hut.smash;
    this.state.noise += TUNE.noise.smashHit;
    this.sfx.crash();
  }

  pickToy() {
    if (!this.inv.add('toy')) return;
    this.toy.visible = false;
    this.toyLoose = false;
    this.cat.playLeft = 0;
  }

  // the mouse leaves Oleg's hand: thrown along `dir`, or just dropped in front of the cat
  throwToy(from, dir, speed = TUNE.cat.throwSpeed) {
    if (!this.inv.has('toy')) return;
    this.inv.remove('toy');
    this.toy.position.copy(from);
    this.toy.position.y = Math.max(0.3, from.y);
    this.toyVel.copy(dir).setY(0).normalize().multiplyScalar(speed);
    this.toyVel.y = 1.2 + dir.y * speed * 0.5;
    this.toy.visible = true;
    this.toyLoose = true;
    this.sfx.whoosh?.();
  }

  // G: just put it on the floor in front of Oleg
  dropToy() {
    const [x, z] = this.olegPos, yaw = this.olegYaw ?? 0;
    let px = x - Math.sin(yaw) * 0.5, pz = z - Math.cos(yaw) * 0.5;
    if (this.toyBlocked(px, pz)) [px, pz] = [x, z];
    this.toy.position.set(px, 0.4, pz);
    this.toyVel.set(0, 0, 0);
    this.toy.visible = true;
    this.toyLoose = true;
  }

  // R on the cat: toss it on the floor right in front of him
  giveToy(cat) {
    if (!this.inv.has('toy')) return;
    this.inv.remove('toy');
    let [px, pz] = cat.front(0.45);
    if (this.toyBlocked(px, pz)) [px, pz] = cat.pos;
    this.toy.position.set(px, 0.35, pz);
    this.toyVel.set(0, 0.5, 0);
    this.toy.visible = true;
    this.toyLoose = true;
  }

  // a swipe of the paw sends it skidding
  kickToy(angle, speed, up = 1.2) {
    this.toyVel.set(Math.sin(angle) * speed, up, Math.cos(angle) * speed);
    this.toy.position.y = Math.max(this.toy.position.y, 0.02);
  }

  toyBlocked(x, z) {
    const r = 0.06;
    for (const c of [...this.apt.colliders, ...this.furn.colliders]) {
      if (c.enabled === false) continue;
      if (c.seg) {
        const [ax, az, bx, bz] = c.seg;
        const vx = bx - ax, vz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
        if (Math.hypot(x - ax - vx * t, z - az - vz * t) < c.r + r) return true;
      } else if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
    }
    return !roomAt(x, z);
  }

  updateToy(dt) {
    if (!this.toyLoose) return;
    const p = this.toy.position, v = this.toyVel;
    if (p.y <= 0.006 && Math.hypot(v.x, v.z) < 0.03 && Math.abs(v.y) < 0.01) return; // lying still
    v.y -= 9.8 * dt;
    const nx = p.x + v.x * dt, nz = p.z + v.z * dt;
    if (this.toyBlocked(nx, p.z)) v.x *= -0.45;
    else p.x = nx;
    if (this.toyBlocked(p.x, nz)) v.z *= -0.45;
    else p.z = nz;
    p.y += v.y * dt;
    if (p.y <= 0.005) {
      p.y = 0.005;
      v.y = v.y < -1.2 ? -v.y * 0.35 : 0; // a little bounce, then it slides
      const k = Math.max(0, 1 - 2.6 * dt);
      v.x *= k;
      v.z *= k;
    }
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.05) this.toy.rotation.y = Math.atan2(v.x, v.z) + Math.PI;
  }

  respawnToy() {
    this.toyLoose = false;
    let i;
    do i = Math.floor(Math.random() * TOY_SPOTS.length);
    while (i === this.lastToy && TOY_SPOTS.length > 1);
    this.lastToy = i;
    const s = TOY_SPOTS[i];
    this.toy.position.set(s.p[0], s.y + 0.005, s.p[1]);
    this.toy.rotation.y = Math.random() * Math.PI * 2;
    this.toy.visible = true;
  }

  // put the cat down in front of Oleg (G, or Q while holding him = pet instead)
  dropCat() {
    const [x, z] = this.olegPos;
    const yaw = this.olegYaw ?? 0;
    this.cat.putDown(x - Math.sin(yaw) * 0.6, z - Math.cos(yaw) * 0.6);
  }

  fanGrill() {
    this.grill.heat = 100;
    this.sfx.whoosh();
  }

  catFell() {
    const c = this.cat;
    c.gone = true;
    c.clearProblem(false);
    c.figure.root.visible = false;
    this.state.totalFun -= TUNE.cat.fallPenalty;
    for (const f of this.friends) f.fun -= 15;
    this.alert('КОТ ВЫПАЛ С БАЛКОНА!', 'Балкон');
    this.pending.push({
      at: this.state.t + 20,
      fn: () =>
        this.queueVisitor({
          type: 'cat', name: 'Соседка с котом', shirt: '#8e6c8a', patience: 30,
          onOpen: () => {
            c.gone = false;
            c.figure.root.visible = true;
            c.fun = 50;
            c.path = null;
            c.mode = 'idle';
            c.place(CAT_SPOTS.catHall);
            this.toast('Соседка принесла кота. Живой! Третий этаж, кусты', 'good');
          },
          onTimeout: () => this.toast('Соседка ушла с котом… придёт ещё', 'bad'),
          retry: true,
        }),
    });
  }

  // ---------- Oleg ----------

  // pay for an action with Oleg's strength; false (and a hint) if he has none left
  spend(cost) {
    if (!cost) return true;
    if (this.oleg.energy < cost) {
      this.toastOnce('tired', 'Нет сил. Подожди пару секунд или поешь', 'warn', 3);
      this.sfx.click();
      return false;
    }
    this.oleg.energy -= cost;
    return true;
  }


  useSelf() {
    const item = this.inv.selectedItem();
    if (item === 'cat') {
      // stroke the cat in your arms
      if (!this.spend(TUNE.cost.petCat)) return;
      this.cat.fun = clamp(this.cat.fun + TUNE.cat.pet);
      this.oleg.fun += 2;
      this.sfx.purr();
      return;
    }
    const d = TUNE.give[item];
    if (!d) return;
    const part = this.inv.selectedPortion();
    this.inv.consume();
    const E = TUNE.energy;
    this.oleg.energy = Math.min(E.max, this.oleg.energy + ({ food: E.fromFood, beer: E.fromBeer, vodka: E.fromVodka }[item] ?? 0) * part);
    this.oleg.fun += d.fun * part;
    if (item === 'beer' || item === 'vodka') {
      this.oleg.thirst = Math.max(0, this.oleg.thirst - TUNE.olegThirst[item]);
      this.events.olegDrank();
      this.cheers();
    }
    this.oleg.drunk = clamp(this.oleg.drunk + d.drunk);
    this.sfx.gulp();
    if (this.oleg.drunk >= TUNE.oleg.blackoutAt) {
      this.oleg.blackout = TUNE.oleg.blackoutSeconds;
      this.alert('Олег вырубился…', null);
    }
  }

  // ---------- visitors & delivery ----------

  queueVisitor(v, urgent = false) {
    if (urgent) this.visitorQueue.unshift(v);
    else this.visitorQueue.push(v);
  }

  showVisitor(v) {
    v.left = v.patience;
    v.knockT = 0;
    v.figure = makePerson({ name: v.name, shirt: v.shirt, pants: v.pants, style: this.style });
    const [x, z] = VISITOR_SPOT;
    v.figure.root.position.set(x, 0, z);
    const [dx, dz] = this.doors.entrance.center;
    v.figure.root.rotation.y = Math.atan2(dx - x, dz - z);
    this.dynamic.add(v.figure.root);
    this.visitor = v;
    // someone knocks: the whole party shuts up (voices stop, music goes quiet) and hushes each other
    this.voices?.stopAll();
    this.koch = null;
    const t = this.furn.items.partyTable;
    setTimeout(() => this.visitor === v && this.voices?.play('event_hush', { pos: [(t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2] }), 400);
  }

  // Oleg listens to a story: stuck facing him for the first part of the clip
  startTalk(friend, h) {
    this.talk = { friend, h, start: this.state.t, dur: null };
    friend.figure.say('…', 4);
  }

  get talkLocked() {
    const k = this.talk;
    if (!k) return false;
    const dur = k.dur ?? 6;
    return this.state.t - k.start < dur * TUNE.talk.lock;
  }

  // ---------- "Коч!": one guy yells it, others randomly pick it up, the chain fades out ----------
  kochCandidates() {
    const list = this.friends.filter((f) => this.voices?.has(`${f.id}_koch`) && !f.problem && this.talk?.friend !== f);
    if (this.voices?.has('oleg_koch')) list.push('oleg');
    return list;
  }

  kochShout(who) {
    const K = TUNE.koch;
    let h;
    if (who === 'oleg') h = this.voices.play('oleg_koch', { gain: 0.9 });
    else {
      h = who.voice('koch');
      who.figure.say('Кооооч!', 2.2);
      who.figure.play('shout');
      who.fun += K.fun;
    }
    this.koch.step += 1;
    this.koch.last = who;
    this.koch.h = h;
    this.koch.start = this.state.t;
    this.koch.gap = rand(0.1, 0.7);
    this.state.noise += K.noise;
    this.oleg.fun += K.olegFun;
  }

  kochTick(dt) {
    const K = TUNE.koch, st = this.state;
    if (this.hushed) return;
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    if (!this.koch) {
      if (st.t < K.firstAfter) return;
      this.kochT = (this.kochT ?? rand(...K.every)) - dt;
      if (this.kochT > 0) return;
      this.kochT = rand(...K.every) / this.diff;
      const starters = this.kochCandidates().filter((c) => c !== 'oleg');
      if (!starters.length) return;
      const who = pick(starters);
      this.koch = { step: 0 };
      // sometimes he goes out on the balcony and yells it out of the window, for the whole yard to hear
      if (Math.random() < K.balconyChance && !who.event && who.mode !== 'walk') {
        this.koch.waiting = true;
        who.endActivity(true);
        const ok = who.walkTo(SPOTS.balcony, () => {
          if (!this.koch?.waiting) return;
          this.koch.waiting = false;
          this.living.setWindow(true, who);
          who.figure.say('КООООЧ НА ВЕСЬ ДВОР!', 2.5);
          this.state.noise += K.balconyNoise;
          this.kochShout(who);
        });
        if (ok) return;
        this.koch.waiting = false;
      }
      this.kochShout(who);
      return;
    }
    // the next one answers when the current shout is mostly over
    const k = this.koch;
    if (k.waiting) return;
    const dur = Number.isFinite(k.h?.audio.duration) ? k.h.audio.duration : 2;
    if (st.t - k.start < Math.min(dur, 3) * 0.7 + k.gap && k.h?.playing !== false) return;
    const pool = this.kochCandidates().filter((c) => c !== k.last);
    const chance = K.chance * Math.pow(K.decay, k.step - 1);
    if (k.step >= K.max || !pool.length || Math.random() > chance) {
      this.koch = null;
      return;
    }
    this.kochShout(pick(pool));
  }

  // while someone is at the door the flat keeps quiet
  get hushed() {
    return !!this.visitor;
  }

  // ---------- photos ----------
  // subjects: [{ f (friend or cat), moment: { cat, caption } }] already filtered to what's in frame
  takePhoto(subjects, img) {
    const P = TUNE.photo, st = this.state;
    if (st.photos.length >= P.perNight) {
      this.voices?.play('event_memfull');
      this.toastOnce('memfull', 'Память заполнена', 'warn', 2);
      return;
    }
    this.sfx.shutter();
    const fresh = subjects.find((s) => !st.photoCats.has(s.moment.cat));
    if (!fresh) {
      this.toast(subjects.length ? 'Такое уже снимал сегодня' : 'Ничего интересного в кадре', 'info');
      return;
    }
    st.photoCats.add(fresh.moment.cat);
    st.photos.push({ caption: fresh.moment.caption, img });
    st.totalFun = clamp(st.totalFun + P.fun);
    if (fresh.f.fun !== undefined) fresh.f.fun = clamp(fresh.f.fun + P.friendFun);
    this.oleg.fun += 4;
    this.toast(`Снято: ${fresh.moment.caption} (${st.photos.length}/${P.perNight})`, 'good');
    return st.photos.at(-1);
  }

  // somebody near Lyokha reacts to the vomit (not every time)
  reactToPuke(f) {
    if (this.state.t < this.reactCd || Math.random() > 0.6) return;
    this.reactCd = this.state.t + 25;
    setTimeout(() => this.voices?.play('event_puke', { pos: [...f.pos] }), 1200); // after the splash, not before
  }

  // the visitor turns and walks off down the stairs; the next one comes up only after that
  dismissVisitor() {
    const v = this.visitor;
    if (!v) return;
    this.visitor = null;
    this.visitorGap = 1.8;
    const [dx, dz] = this.doors.entrance.center, [x, z] = VISITOR_SPOT;
    const away = Math.atan2(x - dx, z - dz);
    v.figure.root.rotation.y = away;
    this.leaving = [...(this.leaving ?? []), { figure: v.figure, dir: [Math.sin(away), Math.cos(away)], t: 1.6 }];
  }

  openEntrance() {
    const door = this.doors.entrance;
    door.setOpen(true);
    this.entranceCloseT = 2.5;
    const v = this.visitor;
    if (!v) return this.toast('Никого нет', 'info');
    v.onOpen();
    this.dismissVisitor();
  }

  spawnNeighbor() {
    this.queueVisitor({
      type: 'neighbor', name: 'Соседка снизу', shirt: '#a0526b', patience: TUNE.visitors.patience,
      onOpen: () => {
        const st = this.state;
        st.noise = Math.max(0, st.noise - TUNE.noise.calm);
        st.anger += 1;
        st.music = false;
        st.neighborCd = TUNE.noise.cooldown;
        // the moment the door opens: the hush stops, the neighbours get their reaction
        this.voices?.stopAll();
        this.voices?.play('event_neighbors');
        this.toast(`Соседка: «Сделайте потише!» Музыку выключили. Злость соседей: ${st.anger}`, 'warn');
      },
      onTimeout: () => {
        this.alert('Соседи забили на вас и вызвали ментов!', 'Прихожая');
        this.spawnPolice();
      },
    });
  }

  spawnPolice() {
    this.queueVisitor({
      type: 'police', name: 'Участковый', shirt: '#2b3f66', pants: '#1c2436', patience: TUNE.visitors.patience,
      onOpen: () => this.payPolice(false),
      onTimeout: () => {
        this.state.hut -= TUNE.hut.policeBreakIn;
        this.sfx.crash();
        this.alert('Менты выломали дверь!', 'Прихожая');
        this.payPolice(true);
      },
    }, true);
  }

  payPolice(forced) {
    const st = this.state, P = TUNE.police;
    const bribe = Math.round(P.bribe * (1 + P.bribeGrowth * st.policeVisits));
    const paid = Math.min(st.money, bribe);
    st.money -= paid;
    st.stats.bribes += paid;
    st.policeVisits += 1;
    st.anger = 1;
    st.noise = 0;
    st.music = false;
    st.neighborCd = TUNE.noise.cooldown * 1.5;
    if (paid < bribe) {
      st.hut -= 20;
      this.toast(`Денег на взятку не хватило (${paid}₽ из ${bribe}₽). Протокол, хата −20`, 'bad');
    } else this.toast(`${forced ? 'Пришлось' : 'Дал'} взятку ментам: −${bribe}₽`, 'bad');
  }

  // the phone's cart: { id: count } — all of it in one delivery
  buyCart(cart) {
    for (const [id, n] of Object.entries(cart)) for (let i = 0; i < n; i++) this.buy(id, true);
  }

  buy(id, quiet = false) {
    const item = TUNE.shop.find((s) => s.id === id);
    const st = this.state;
    if (!item || item.soon) return false;
    if (st.money < item.price) return quiet ? false : this.toast('Не хватает денег', 'bad');
    st.money -= item.price;
    st.stats.spent += item.price;
    this.sfx.ding();
    // one courier: whatever you buy while he's on the way goes into the same delivery
    const open = this.orders.find((o) => !o.done);
    if (open) {
      for (const [k, v] of Object.entries(item.gives)) open.gives[k] = (open.gives[k] ?? 0) + v;
      open.items.push(item.title);
      open.title = summarize(open.items);
      return true;
    }
    const eta = rand(TUNE.delivery.min, TUNE.delivery.max);
    this.orders.push({ title: item.title, items: [item.title], icon: item.icon, gives: { ...item.gives }, eta, total: eta });
    return true;
  }

  // ---------- targets ----------

  buildStaticTargets() {
    const it = this.furn.items;
    const T = (id, target) => it[id] && (it[id].group.userData.target = { name: it[id].label, ...target, item: it[id] });
    const fr = () => this.state.fridge;

    T('fridge', {
      info: () => `Пиво ${fr().beer} · Водка ${fr().vodka} · Еда ${fr().food} · Пельмени ${fr().pelmeni}`,
      actions: () => [
        this.inv.selectedItem() === 'pelmeni' && { key: 'E', text: 'Положить пельмени в морозилку', run: () => (this.inv.consume(), fr().pelmeni++) },
        this.inv.selectedItem() !== 'pelmeni' && fr().beer > 0 && { key: 'E', text: 'Взять пиво', run: () => this.inv.add('beer') && fr().beer-- },
        fr().vodka > 0 && { key: 'R', text: 'Взять водку', run: () => this.inv.add('vodka') && fr().vodka-- },
        fr().food > 0 && { key: 'T', text: 'Взять еду', run: () => this.inv.add('food') && fr().food-- },
      ].filter(Boolean),
    });
    T('partyTable', {
      info: () => {
        const t = this.state.table;
        return `На столе: пиво ${t.beer} · водка ${t.vodka} · еда ${t.food}`;
      },
      actions: () => {
        const item = this.inv.selectedItem();
        const D = TUNE.drink;
        if (item === 'beer') return [{ key: 'E', text: `Поставить пиво (+${D.beer.servings})`, run: () => (this.inv.consume(), (this.state.table.beer += D.beer.servings)) }];
        if (item === 'vodka') return [{ key: 'E', text: `Поставить водку (+${D.vodka.servings})`, run: () => (this.inv.consume(), (this.state.table.vodka += D.vodka.servings)) }];
        if (item === 'food') {
          const plates = Math.max(1, Math.round(D.plates * this.inv.selectedPortion()));
          return [{ key: 'E', text: `Выложить еду (+${plates})`, run: () => (this.inv.consume(), (this.state.table.food += plates)) }];
        }
        return [];
      },
    });
    T('stenka', {
      info: () => (this.state.music ? `Музыка: громкость ${this.state.volume}/3` : 'Музыка выключена'),
      actions: () => [{
        key: 'E', text: this.state.music ? 'Выключить музыку' : 'Врубить музыку',
        run: () => {
          if (it.stenka.broken) return this.toast('Музыка сломана — почини', 'warn');
          this.state.music = !this.state.music;
          this.state.volume = 1;
        },
      }, ...(this.state.music && this.state.volume > 1 ? [{ key: 'R', text: 'Сделать тише', run: () => (this.state.volume -= 1) }] : [])],
    });
    T('tub', {
      tub: true,
      info: () => (this.hands.showerHeld() ? 'Лейка у тебя: зажми ЛКМ и поливай' : this.inv.selectedItem() === 'bucket' ? 'Зажми ЛКМ — набрать воды из лейки' : ''),
      actions: () =>
        this.hands.showerHeld()
          ? [{ key: 'E', text: 'Повесить лейку обратно', run: () => this.hands.returnShower() }]
          : [{ key: 'E', text: 'Взять лейку душа', run: () => this.hands.takeShower() }],
    });
    T('bathSink', { actions: () => (this.inv.has('mop') ? [] : [{ key: 'E', text: 'Взять тряпку', run: () => this.inv.add('mop') }]) });
    T('wardrobe', { actions: () => (this.inv.has('tools') ? [] : [{ key: 'E', text: 'Взять инструменты', run: () => this.inv.add('tools') }]) });
    T('grill', {
      info: () => (this.grill.lit ? `Жар: ${Math.round(this.grill.heat)}%` : 'Не горит'),
      actions: () => (this.grill.lit ? [{ key: 'E', text: 'Раздуть мангал', cost: TUNE.cost.fan, run: () => this.fanGrill() }] : []),
    });
    T('stove', {
      info: () =>
        ({
          idle: this.state.fridge.pelmeni ? `Пельмени в холодосе: ${this.state.fridge.pelmeni}` : 'Пельменей нет — закажи',
          cooking: `Варятся… ещё ${Math.ceil(TUNE.stove.cookTime - this.stove.t)} с`,
          ready: 'ГОТОВО! Снимай, пока не сгорели',
        })[this.stove.phase],
      actions: () => {
        if (this.stove.phase === 'idle' && this.state.fridge.pelmeni > 0)
          return [{
            key: 'E', text: 'Сварить пельмени', cost: TUNE.cost.cook, mini: true,
            run: () =>
              this.startFocus('cook', TUNE.cost.cook, () => {
                this.state.fridge.pelmeni--;
                this.stove = { phase: 'cooking', t: 0 };
                this.cooking.potOnStove();
              }),
          }];
        if (this.stove.phase === 'ready')
          return [{
            key: 'E', text: 'Слить воду и снять', cost: TUNE.cost.drain, mini: true,
            run: () =>
              this.startFocus('drain', TUNE.cost.drain, (score) => {
                this.stove = { phase: 'idle', t: 0 };
                if (score <= 0) return this.toast('Все пельмени уплыли в раковину', 'bad');
                this.inv.add('food', score);
              }),
          }];
        return [];
      },
    });
    // everything else: just a name (plus repair if broken)
    for (const item of Object.values(it)) item.group.userData.target ??= { name: item.label, item };
    for (const item of Object.values(it)) {
      const target = item.group.userData.target;
      const base = target.actions ?? (() => []);
      const baseInfo = target.info;
      target.actions = () => {
        if (!item.broken) return base();
        if (!this.inv.has('tools')) return [];
        return [{
          key: 'R', text: 'Починить', cost: TUNE.cost.repair,
          run: () => {
            this.setBroken(item, false);
            this.state.hut += TUNE.hut.repair;
            this.olegHelped();
            this.sfx.fix();
          },
        }, ...base().filter((a) => a.key !== 'R')];
      };
      target.info = () => (item.broken ? (this.inv.has('tools') ? 'СЛОМАНО' : 'СЛОМАНО — инструменты в гардеробе') : baseInfo?.() ?? '');
    }

    // doors
    const d = this.doors;
    d.balcony.leaf.userData.target = { name: 'Балконная дверь', actions: () => [{ key: 'E', text: d.balcony.open ? 'Закрыть' : 'Открыть', run: () => d.balcony.toggle() }] };
    d.bath.leaf.userData.target = { name: 'Дверь в санузел', actions: () => [{ key: 'E', text: d.bath.open ? 'Закрыть' : 'Открыть', run: () => d.bath.toggle() }] };
    d.entrance.leaf.userData.target = {
      name: 'Входная дверь',
      info: () => (this.visitor ? 'Кто-то стучит' : ''),
      actions: () => [{ key: 'E', text: 'Открыть дверь', run: () => this.openEntrance() }],
    };
  }

  buildTableProps() {
    const t = this.furn.items.partyTable;
    const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
    const alongZ = t.z1 - t.z0 > t.x1 - t.x0;
    const at = (a, b) => (alongZ ? [cx + b, cz + a] : [cx + a, cz + b]);
    const place = (obj, a, b) => {
      const [x, z] = at(a, b);
      obj.position.set(x, 0.76, z);
      this.dynamic.add(obj);
      return obj;
    };
    this.tableProps = {
      beer: [[-0.4, -0.2], [-0.3, -0.25], [0.35, 0.25], [0.42, 0.18]].map(([a, b]) => place(makeBottle('beer'), a, b)),
      vodka: [[-0.35, 0.22], [0.3, -0.22]].map(([a, b]) => place(makeBottle('vodka'), a, b)),
      food: [[-0.25, 0.05], [0.25, -0.02], [0, 0.28], [0, -0.28]].map(([a, b]) => place(makePlate(), a, b)),
    };
  }


  buildStoveProps() {
    this.cooking = new Cooking(this);
  }

  // close-up hands-on scene (pelmeni): the camera flies in, the mouse moves real objects
  startFocus(kind, cost, done) {
    if (this.cooking.focus || this.over || !this.spend(cost)) return;
    this.cooking.start(kind, done);
  }

  buildGrillProps() {
    const g = this.furn.items.grill;
    const light = new THREE.PointLight('#ff7a2a', 0, 3, 2);
    light.position.set((g.x0 + g.x1) / 2, 0.9, (g.z0 + g.z1) / 2);
    this.dynamic.add(light);
    let coals = null;
    g.group.traverse((o) => o.userData.coals && (coals = o));
    this.grillProps = { light, coals };
  }

  // ---------- tick ----------

  update(dt) {
    if (this.over) return;
    const st = this.state;
    st.t += dt;

    for (const p of this.pending.filter((p) => p.at <= st.t)) p.fn();
    this.pending = this.pending.filter((p) => p.at > st.t);

    // story time
    if (this.talk) {
      const k = this.talk;
      const d = k.h.audio.duration;
      if (!k.dur && Number.isFinite(d) && d > 0) {
        k.dur = d;
        k.friend.figure.say('…', d);
      }
      const done = !k.h.playing && st.t - k.start > 0.5;
      if (done || st.t - k.start > (k.dur ?? 6) + 0.3 || k.friend.problem) this.talk = null;
    }

    this.kochTick(dt);

    // Oleg
    const o = this.oleg;
    o.fun = clamp(o.fun - TUNE.fun.olegBoredom * this.pace * dt + (st.music ? 0.2 * dt : 0));
    o.drunk = clamp(o.drunk - TUNE.oleg.drunkDecay * dt);
    o.energy = Math.min(TUNE.energy.max, o.energy + TUNE.energy.regen * dt);
    const OT = TUNE.olegThirst;
    o.thirst = Math.min(100, o.thirst + OT.rate * this.pace * dt);
    if (o.thirst > OT.from) {
      o.fun -= OT.drain * dt * ((o.thirst - OT.from) / (100 - OT.from));
    }
    if (o.blackout > 0) {
      o.blackout -= dt;
      if (o.blackout <= 0) o.drunk = 60;
    }

    for (const f of this.friends) f.update(dt);
    // the ragdolls: motors follow the animation, the world pushes back
    const [ox, oz] = this.olegPos, last = this.lastOleg ?? [ox, oz];
    moveOleg(ox, oz, (ox - last[0]) / Math.max(dt, 1e-3), (oz - last[1]) / Math.max(dt, 1e-3));
    this.lastOleg = [ox, oz];
    updateDoors();
    physicsStep(dt, (h) => {
      for (const f of this.friends) {
        if (!f.rag?.active) continue;
        if (f.rag.isRobot) f.rag.control(h); // walks to its own goal (friends.js steers it)
        else f.rag.control(f.pos, f.drunk / 100, f.mode === 'walk', h);
      }
    });
    for (const f of this.friends) {
      f.physicsTick(dt);
      if (f.rag?.active) f.rag.sync(f.figure);
    }
    this.bumps();
    this.olegPhysics(dt);
    this.vibeTick(dt);
    particles.update(dt);
    this.updateToy(dt);
    this.events.update(dt);
    this.living.update(dt);
    this.shop?.update(dt, this.olegPos);
    this.cat.update(dt);
    for (const d of Object.values(this.doors)) d.update(dt);
    if (this.entranceCloseT > 0) {
      this.entranceCloseT -= dt;
      const [cx, cz] = this.doors.entrance.center;
      if (Math.hypot(this.olegPos[0] - cx, this.olegPos[1] - cz) < 0.9) this.entranceCloseT = 0.5; // don't slam it on Oleg
      else if (this.entranceCloseT <= 0) this.doors.entrance.setOpen(false);
    }

    // stove
    const S = TUNE.stove;
    if (this.stove.phase === 'cooking') {
      this.stove.t += dt;
      if (this.stove.t >= S.cookTime) {
        this.stove = { phase: 'ready', t: 0 };
        this.alert('Пельмени сварились — снимай!', 'Кухня');
      }
    } else if (this.stove.phase === 'ready') {
      this.stove.t += dt;
      if (this.stove.t >= S.burnAfter) {
        this.stove = { phase: 'idle', t: 0 };
        st.hut -= S.burnHut;
        this.alert('Пельмени сгорели! Вонь на всю хату', 'Кухня');
      }
    }
    if (!this.cooking.focus && this.stove.phase === 'idle' && this.cooking.pot.visible) this.cooking.pot.visible = false;

    // grill glow
    const glow = this.grill.lit ? 0.3 + (this.grill.heat / 100) * 1.8 : 0;
    this.grillProps.light.intensity = glow * (0.8 + Math.random() * 0.4);
    if (this.grillProps.coals) this.grillProps.coals.material.emissiveIntensity = glow;

    // noise, neighbours, police
    const N = TUNE.noise, src = N.sources;
    const has = (id) => this.friends.some((f) => f.problem?.id === id);
    let noise = 0;
    if (st.music && !this.hushed) noise += src.music;
    if (!this.hushed) noise += this.living.noise();
    if (has('cry')) noise += src.cry;
    if (has('puke')) noise += src.puke;
    if (has('smash')) noise += src.smash;
    if (has('cough')) noise += src.cough;
    if (this.grill.lit) noise += src.smoke;
    if (this.cat.problem?.id === 'locked') noise += src.cat;
    if (this.doors.entrance.open && st.music) noise += src.openDoor;
    noise += this.puddles.length * src.smell;
    st.noise = Math.max(0, st.noise + (noise - N.decay) * dt);
    st.neighborCd -= dt;
    const threshold = N.neighborAt - st.anger * N.angerStep;
    const policeWaiting = this.visitor?.type === 'police' || this.visitorQueue.some((v) => v.type === 'police' || v.type === 'neighbor');
    if (!policeWaiting && st.neighborCd <= 0 && st.noise >= threshold) {
      st.neighborCd = N.cooldown;
      if (st.anger >= TUNE.police.angerLimit) {
        this.alert('Соседи психанули и сразу вызвали ментов', null);
        this.spawnPolice();
      } else this.spawnNeighbor();
    }

    // deliveries
    for (const order of this.orders) {
      order.eta -= dt;
      if (order.eta <= 0 && !order.done) {
        order.done = true;
        this.queueVisitor({
          type: 'courier', name: 'Курьер', shirt: '#e0a21b', patience: TUNE.visitors.courierPatience,
          onOpen: () => {
            for (const [k, v] of Object.entries(order.gives)) st.fridge[k] = (st.fridge[k] ?? 0) + v;
          },
          onTimeout: () => this.toast(`Курьер ушёл с заказом (${order.title}). Деньги сгорели`, 'bad'),
        });
      }
    }
    this.orders = this.orders.filter((x) => !x.done);

    // visitor at the door (one at a time: the next waits until the last one has walked off)
    for (const l of this.leaving ?? []) {
      l.t -= dt;
      l.figure.root.position.x += l.dir[0] * 1.2 * dt;
      l.figure.root.position.z += l.dir[1] * 1.2 * dt;
      l.figure.update(dt, { walking: true, speed: 1.2 });
      if (l.t <= 0) this.dynamic.remove(l.figure.root);
    }
    this.leaving = (this.leaving ?? []).filter((l) => l.t > 0);
    this.visitorGap = Math.max(0, (this.visitorGap ?? 0) - dt);
    if (!this.visitor && this.visitorQueue.length && this.visitorGap <= 0) this.showVisitor(this.visitorQueue.shift());
    const v = this.visitor;
    if (v) {
      v.left -= dt;
      v.knockT -= dt;
      if (v.knockT <= 0) {
        v.knockT = TUNE.visitors.knockEvery;
        this.sfx.knock();
        v.figure.play('knock');
      }
      v.figure.update(dt);
      if (v.left <= 0) {
        this.dismissVisitor();
        v.onTimeout();
        if (v.retry) this.pending.push({ at: st.t + 15, fn: () => this.queueVisitor({ ...v, figure: null }) });
      }
    }

    // hut
    const H = TUNE.hut;
    const broken = Object.values(this.furn.items).filter((i) => i.broken).length;
    st.hut -= (this.puddles.length * H.puddle + broken * H.broken + (st.music ? H.music : 0)) * dt;
    st.hut = clamp(st.hut);

    // total fun: drifts to the average, crashes while anyone is at zero
    const people = [...this.friends.map((f) => f.fun), o.fun, ...(this.cat.gone ? [] : [this.cat.fun])];
    const avg = people.reduce((a, b) => a + b, 0) / people.length;
    const zeros = people.filter((x) => x <= 0).length;
    st.totalFun += (avg - st.totalFun) * TUNE.totalFun.follow * dt - zeros * TUNE.totalFun.zeroDrain * dt;
    st.totalFun = clamp(st.totalFun);
    o.fun = clamp(o.fun);

    // table props
    const t = st.table;
    this.tableProps.beer.forEach((b, i) => (b.visible = i < Math.ceil(t.beer / TUNE.drink.beer.servings)));
    this.tableProps.vodka.forEach((b, i) => (b.visible = i < Math.ceil(t.vodka / TUNE.drink.vodka.servings)));
    this.tableProps.food.forEach((p, i) => (p.visible = i < t.food));

    // toasts
    for (const x of this.toasts) x.life -= dt;
    this.toasts = this.toasts.filter((x) => x.life > 0);

    // end of night
    if (st.totalFun <= 0) this.end(false, 'Туса сдохла. Все разъехались по домам.');
    else if (st.hut <= 0) this.end(false, 'Хату разнесли в хлам. Мама Олега в шоке.');
    else if (st.t >= TUNE.nightSeconds) this.end(true, '06:00. Все живы, хата стоит.');
  }

  end(win, reason) {
    this.over = { win, reason, night: this.night };
    this.state.music = false;
    this.onEnd?.(this.over);
  }
}
