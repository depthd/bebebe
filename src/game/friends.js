// The guys and the cat: movement, activities, problems (the chaos Oleg has to calm down).
import { TUNE } from '../config.js';
import { SPOTS, CAT_SPOTS, roomAt } from '../world/layout.js';
import { makePerson, makeCat } from '../world/figures.js';
import { Ragdoll } from '../world/ragdoll.js';
import { Robot } from '../world/robot.js';
import { route } from './nav.js';
import { NAV } from '../world/layout.js';

// `?phys=new`: the guys are robots on their own legs (world/robot.js): the body is the truth, the game
// follows it. Otherwise the old ragdolls, pulled along to where the game says they are
export const ROBOTS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('phys') === 'new';
export const makeBody = (rig) => (ROBOTS ? new Robot(rig) : new Ragdoll(rig));

export const nearestNode = (x, z) => Object.entries(NAV).reduce((b, [k, [nx, nz]]) => (Math.hypot(nx - x, nz - z) < b.d ? { k, d: Math.hypot(nx - x, nz - z) } : b), { k: 'living', d: 1e9 }).k;

export const rand = (a, b) => a + Math.random() * (b - a);
export const chance = (perSec, dt) => Math.random() < perSec * dt;
export const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const pickWeighted = (entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries.at(-1)?.[0];
};

// ---------- walking ----------

class Walker {
  constructor(game, figure, speed, canOpenDoors) {
    this.game = game;
    this.figure = figure;
    this.speed = speed;
    this.canOpenDoors = canOpenDoors;
    this.pos = [0, 0];
    this.y = 0;
    this.node = 'living';
    this.path = null;
    this.mode = 'idle';
    this.spot = null;
    this.heading = 0;
    this.t = Math.random() * 10;
  }
  get room() {
    return roomAt(this.pos[0], this.pos[1]);
  }
  place(spot) {
    this.pos = [...spot.p];
    this.node = spot.node;
    this.spot = spot;
    this.arrive(spot);
  }
  arrive(spot) {
    this.y = spot.y ?? 0;
    this.figure.setPose?.(spot.pose ?? 'stand', this.y);
    if (spot.look) this.heading = Math.atan2(spot.look[0] - this.pos[0], spot.look[1] - this.pos[1]);
    this.applyTransform();
  }
  // point `dist` meters in front of him
  front(dist) {
    return [this.pos[0] + Math.sin(this.heading) * dist, this.pos[1] + Math.cos(this.heading) * dist];
  }
  // put the figure where the walker is; ox/oz/yaw = visual wobble on top (drunk)
  applyTransform(ox = 0, oz = 0, yaw = 0) {
    const root = this.figure.root;
    root.position.set(this.pos[0] + ox, this.spot?.pose || this.mode === 'walk' ? 0 : this.y, this.pos[1] + oz);
    root.rotation.y = this.heading + yaw;
    // sitting down / getting up: slide from where the body was instead of jumping there
    const b = this.blend;
    if (b) {
      const k = Math.min(1, b.t / b.dur), e = k * k * (3 - 2 * k);
      root.position.set(b.x + (root.position.x - b.x) * e, b.y + (root.position.y - b.y) * e, b.z + (root.position.z - b.z) * e);
      root.rotation.y = b.yaw + Math.atan2(Math.sin(root.rotation.y - b.yaw), Math.cos(root.rotation.y - b.yaw)) * e;
    }
  }
  startBlend(dur = 0.55) {
    const r = this.figure.root.position;
    this.blend = { x: r.x, y: r.y, z: r.z, yaw: this.figure.root.rotation.y, t: 0, dur };
  }
  // where a body can stand to use this spot: the spot itself, or (a seat, a bed, a spot inside furniture)
  // the first free point from it towards its nav node
  approach(spot) {
    const g = this.game, [px, pz] = spot.p;
    if (!spot.pose && !g.bodyBlocked(px, pz, 0.3)) return spot.p;
    const [nx, nz] = NAV[spot.node] ?? spot.p;
    for (let k = 1; k <= 24; k++) {
      const t = k / 24, x = px + (nx - px) * t, z = pz + (nz - pz) * t;
      if (!g.bodyBlocked(x, z, 0.3)) return [x, z];
    }
    return [nx, nz];
  }
  // a physical body leaving a seat: it stands up next to it, the figure slides there
  leaveSeat() {
    if (!this.rag?.isRobot || this.figure.pose === 'stand' || !this.spot) return;
    this.startBlend(0.45);
    this.pos = [...this.approach(this.spot)];
  }
  // off the sofa / chair: standing on his feet where he is
  standUp() {
    this.leaveSeat();
    this.spot = null;
    this.y = 0;
    this.figure.setPose?.('stand');
    this.applyTransform();
  }
  walkTo(spot, onArrive, blocked) {
    this.leaveSeat();
    const r = route(this.node, this.pos, spot.node, spot.p, blocked);
    if (!r) return false;
    if (this.rag?.isRobot) r.points[r.points.length - 1] = this.approach(spot); // a body can't walk into the sofa
    if (this.canOpenDoors) {
      if (r.nodes.includes('balconyDoor')) this.game.doors.balcony.setOpen(true);
      if (r.nodes.includes('bathDoor')) this.game.doors.bath.setOpen(true);
    }
    this.path = r.points;
    this.target = spot;
    this.onArrive = onArrive;
    this.mode = 'walk';
    this.spot = null;
    this.figure.setPose?.('stand');
    this.y = 0;
    return true;
  }
  stepWalk(dt) {
    if (this.rag?.isRobot) {
      if (this.rag.active) return this.steer(dt);
      if (this.blend || this.rag.state === 'getup') return; // standing up first
    }
    let step = this.speed * dt;
    while (this.path.length && step > 0) {
      const [tx, tz] = this.path[0];
      const dx = tx - this.pos[0], dz = tz - this.pos[1];
      const d = Math.hypot(dx, dz);
      if (d <= step) {
        this.pos = [tx, tz];
        step -= d;
        this.path.shift();
      } else {
        this.pos[0] += (dx / d) * step;
        this.pos[1] += (dz / d) * step;
        this.heading = Math.atan2(dx, dz);
        step = 0;
      }
    }
    if (!this.path.length) this.finishWalk();
  }
  finishWalk() {
    this.mode = 'idle';
    this.node = this.target.node;
    this.spot = this.target;
    // a body sits down on the seat from where it stands
    if (this.rag?.isRobot && this.target.pose) {
      this.startBlend();
      this.pos = [...this.target.p];
    }
    this.arrive(this.target);
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.();
  }
  // a physical body walks itself: aim it at the next point of the path, notice when it got there
  // (or got stuck on something: then the next point, and in the end it's there enough)
  steer(dt) {
    const rb = this.rag, [x, z] = this.pos;
    if (rb.state !== 'up') return; // on the floor or getting up: the path waits
    while (this.path.length > 1 && Math.hypot(this.path[0][0] - x, this.path[0][1] - z) < 0.5) this.path.shift();
    const [tx, tz] = this.path[0], d = Math.hypot(tx - x, tz - z), last = this.path.length === 1;
    const p = (this.prog ??= { t: 0, x, z, stuck: 0 });
    p.t += dt;
    if (p.t > 1.5) {
      p.stuck = Math.hypot(x - p.x, z - p.z) < 0.25 ? p.stuck + p.t : 0;
      Object.assign(p, { t: 0, x, z });
    }
    if ((last && d < 0.35) || p.stuck > 9 || (last && p.stuck > 3 && d < 1.5)) {
      this.prog = null;
      rb.goal = null;
      return this.finishWalk();
    }
    if (!last && p.stuck > 3) {
      this.path.shift();
      p.stuck = 0;
    }
    // keep clear of the furniture, the walls and the others on the way (bodies bump and fall)
    const [ax, az] = this.avoid(x, z, tx, tz, d);
    rb.goal = [x + ax * Math.min(d, 1), z + az * Math.min(d, 1)];
    this.heading = Math.atan2(tx - x, tz - z);
  }
  // the way to (tx, tz), bent away from whatever is close: a unit direction
  avoid(x, z, tx, tz, d) {
    const g = this.game;
    let ax = (tx - x) / (d || 1), az = (tz - z) / (d || 1);
    const near = Math.min(1, d / 0.8); // close to where he's going: let him get there
    for (const o of [...g.friends, { pos: g.olegPos, rag: { active: true } }]) {
      if (o === this || !o.rag?.active) continue;
      const ox = x - o.pos[0], oz = z - o.pos[1], od = Math.hypot(ox, oz);
      if (od > 1e-3 && od < 1) {
        const w = 1.6 * (1 - od);
        ax += (ox / od) * w;
        az += (oz / od) * w;
      }
    }
    for (const c of [...g.apt.colliders, ...g.furn.colliders]) {
      if (c.enabled === false) continue;
      let cx, cz;
      if (c.seg) {
        const [sx, sz, ex, ez] = c.seg, vx = ex - sx, vz = ez - sz;
        const t = Math.max(0, Math.min(1, ((x - sx) * vx + (z - sz) * vz) / (vx * vx + vz * vz)));
        [cx, cz] = [sx + vx * t, sz + vz * t];
      } else [cx, cz] = [Math.max(c.x0, Math.min(c.x1, x)), Math.max(c.z0, Math.min(c.z1, z))];
      const ox = x - cx, oz = z - cz, od = Math.hypot(ox, oz) - (c.r ?? 0);
      if (od > 1e-3 && od < 0.5) {
        const w = 1.2 * (1 - od / 0.5) * near;
        ax += (ox / (od + (c.r ?? 0))) * w;
        az += (oz / (od + (c.r ?? 0))) * w;
      }
    }
    const l = Math.hypot(ax, az) || 1;
    return [ax / l, az / l];
  }
}

// ---------- activities ----------

const ACTIVITIES = {
  table: { spots: ['table1', 'table2', 'table3'], dur: [12, 20], label: 'бухает за столом' },
  sofa: { spots: ['sofaA', 'sofaB'], dur: [8, 14], label: 'на диване', fun: 0.5 },
  kitchen: { spots: ['kitchen'], dur: [6, 10], label: 'трётся на кухне', fun: 0.4 },
  balcony: { spots: ['balcony'], dur: [6, 10], label: 'дышит на балконе', fun: 0.4 },
  grill: { spots: ['grill'], dur: [22, 32], label: 'жарит шашлык' },
  anime: { spots: ['olegBed'], dur: [15, 25], label: 'смотрит аниме', fun: 0.9 },
  vape: { spots: ['balcony', 'bathStand'], dur: [10, 16], label: 'парит вейп', fun: 0.6 },
  toilet: { spots: ['toilet'], dur: [3, 5], label: 'в туалете' },
  // Oleg's PC (src/game/pc.js): one spins the upgrader on Oleg's money, the others come and watch
  pc: { spots: ['pcChair'], dur: [25, 40], label: 'лудит в апгрейдер', when: (g, f) => !g.pc.busy() && g.state.money >= 50 && !(f.pcBan > g.state.t) },
  watch: { spots: ['pcWatch1', 'pcWatch2'], dur: [10, 18], label: 'смотрит, как лудят', fun: TUNE.pc.watchFun, when: (g) => g.pc.busy() },
};

// ---------- characters ----------

export const CHARS = {
  alexey: {
    name: 'Алексей', shirt: '#b3352d', hair: '#2a1a10',
    start: 'table1', prefs: { table: 7, sofa: 2, balcony: 1, kitchen: 1, pc: 1.5, watch: 3 }, drinker: true,
    tick(f, g, dt) {
      const T = TUNE.alexey;
      if (f.problem) return;
      if (f.activity?.id === 'table' && g.tableBooze() > 0 && chance(T.hogChance * g.diff, dt)) f.setProblem(PROBLEMS.hog(f, g));
      else if (f.drunk > 25 && f.mode !== 'walk' && chance(T.cryChance * g.diff, dt)) f.setProblem(PROBLEMS.cry(f, g));
    },
  },
  lyokha: {
    name: 'Лёха', shirt: '#1e1e20', pants: '#1c1c1e', hair: '#a07a50', // clothes come from src/assets/skins/lyokha.png
    start: 'table2', prefs: { table: 6, sofa: 2, kitchen: 1, pc: 2.5, watch: 3 }, drinker: true,
    tick(f, g) {
      // a warning first: he goes green and says so; feed him now (food in hand, E on him) and it passes
      const L = TUNE.lyokha;
      if (!f.wasted && !f.warned && f.drunk >= L.wastedAt - L.warnBefore) {
        f.warned = true;
      }
      if (f.warned && f.drunk < L.wastedAt - L.warnBefore - 10) f.warned = false;
      if (!f.problem && !f.wasted && f.mode !== 'walk' && f.drunk >= L.wastedAt) startWasted(f, g);
    },
    wantsDrink: (f) => !f.wasted,
  },
  kirill: {
    name: 'Кирилл', shirt: '#2f5c9e', hair: '#1c1c1c', drinkFaceId: 'kirillDrink',
    start: 'sofaA', prefs: { grill: 6, anime: 3, table: 2, sofa: 1, pc: 1, watch: 2 }, drinker: true,
    needsBooze: false, // drinks when there is booze, but an empty table doesn't upset him
  },
  temych: {
    name: 'Темыч', shirt: '#6b3fa0', hair: '#a07040',
    start: 'sofaB', prefs: { vape: 5, sofa: 3, table: 3, pc: 2, watch: 3 }, drinker: true,
    quotes: ['Сука. Пацаны, на следующей неделе также…', 'Сукааааа', 'СУКААААА'], // text for his quote clip
  },
};

// ---------- problems ----------
// A problem: { id, text (log), short (bubble), drain, actions(g) -> [{key, text, run}], tick(dt) }

const PROBLEMS = {
  // wants a drink / food but the table is empty; solved by restocking the table or handing it over
  want(f, g, what) {
    const booze = what === 'booze';
    return {
      id: booze ? 'wantBooze' : 'wantFood',
      text: booze ? 'хочет бухнуть, а на столе пусто' : 'голодный, а на столе пусто',
      short: booze ? 'ХОЧЕТ БУХАТЬ' : 'ГОЛОДНЫЙ',
      drain: 1.2,
      tick() {
        const has = booze ? g.tableBooze() > 0 : g.state.table.food > 0;
        const fine = booze ? f.thirst < 50 : f.hunger < 50;
        if (has || fine) f.clearProblem(false);
      },
      actions: () => [],
    };
  },
  hog(f, g) {
    let t = 0;
    return {
      id: 'hog', text: 'присосался к бутылке, бухло на столе тает', short: 'ПЬЁТ ИЗ ГОРЛА', drain: -0.5,
      tick(dt) {
        t += dt;
        if (t >= TUNE.alexey.hogDrainEvery) {
          t = 0;
          const tb = g.state.table;
          if (tb.vodka > 0) tb.vodka -= 1;
          else if (tb.beer > 0) tb.beer -= 1;
          if (!g.tableBooze()) {
            f.clearProblem(false);
          }
        }
      },
      actions: () => [{
        key: 'E', text: 'Отобрать бутылку', cost: TUNE.cost.takeBottle,
        run() {
          f.fun -= 5;
          f.clearProblem(true);
          g.inv.add('beer');
        },
      }],
    };
  },
  cry(f, g) {
    const right = Math.random() < 0.5 ? 'pat' : 'hug';
    const tried = new Set();
    const attempt = (kind) => () => {
      if (kind === right) {
        f.fun += 20;
        f.clearProblem(true);
      } else {
        tried.add(kind);
        f.fun -= 5;
        g.state.noise += 5;
        g.toast('Не то… Алексей рыдает громче', 'bad');
      }
    };
    return {
      id: 'cry', text: 'плачет', short: 'ПЛАЧЕТ', drain: 2,
      tick(dt) {
        for (const o of g.friends) if (o !== f && o.room === f.room) o.fun -= 0.3 * dt;
      },
      actions: () => [
        !tried.has('pat') && { key: 'E', text: 'Погладить по головке', cost: TUNE.cost.comfort, run: attempt('pat') },
        !tried.has('hug') && { key: 'R', text: 'Обнять', cost: TUNE.cost.comfort, run: attempt('hug') },
      ].filter(Boolean),
    };
  },
  puke(f, g) {
    let t = TUNE.lyokha.pukeEvery - 1.6; // the first puddle comes right after the first visible heave
    return {
      id: 'puke', text: 'блюёт — возьми лейку у ванны и полей его', short: 'БЛЮЁТ', drain: 1.5,
      tick(dt) {
        t += dt;
        if (t >= TUNE.lyokha.pukeEvery && f.mode !== 'walk') {
          t = 0;
          const [x, z] = f.front(0.55);
          g.addPuddle(x + rand(-0.12, 0.12), z + rand(-0.12, 0.12));
          g.reactToPuke(f);
        }
      },
      actions: () => showerActions(f, g),
    };
  },
  sleepTub(f, g) {
    return { id: 'sleepTub', text: 'вырубился в ванной — полей его из лейки', short: 'СПИТ В ВАННОЙ', drain: 1.5, actions: () => showerActions(f, g) };
  },
  smash(f, g) {
    let t = 0;
    return {
      id: 'smash', text: 'громит хату', short: 'ГРОМИТ ХАТУ', drain: -0.5,
      tick(dt) {
        t += dt;
        if (f.mode !== 'walk' && t >= TUNE.lyokha.smashEvery) {
          t = 0;
          g.breakSomething(f.room?.id);
          const next = ['sofaA', 'kitchen', 'bedroom', 'hall', 'table2'][Math.floor(Math.random() * 5)];
          f.walkTo({ ...SPOTS[next], pose: null, y: 0 }); // smashes standing, never sits down
        }
      },
      actions: () => [{
        key: 'E', text: 'Взять за плечо и вести в ванную', cost: TUNE.cost.lead,
        run() {
          // he follows Oleg along his footsteps; Oleg has to walk him into the bathroom himself
          f.path = null;
          f.mode = 'idle';
          f.standUp();
          f.follow = { trail: [[...f.pos]], idx: 0 };
          g.leading = f;
          f.problem = { id: 'led', text: 'идёт за тобой, веди в санузел', short: 'ИДЁТ ЗА ТОБОЙ', drain: 0, since: 0, actions: () => [] };
          f.figure.setStatus(null); // being handled: no "!"
          g.toast('Лёха идёт за тобой. Заведи его в санузел', 'info');
        },
      }],
    };
  },
  grillOut(f, g) {
    return {
      id: 'grillOut', text: 'мангал тухнет', short: 'МАНГАЛ ТУХНЕТ', drain: 1,
      actions: () => [{ key: 'E', text: 'Раздуть мангал', cost: TUNE.cost.fan, run: () => g.fanGrill() }],
    };
  },
  smoke(f, g) {
    return {
      id: 'smoke', text: 'задыхается в дыму на балконе', short: 'ЗАДЫХАЕТСЯ', drain: 2,
      tick() {
        if (g.doors.balcony.open) {
          f.clearProblem(true);
        }
      },
      actions: () => [],
    };
  },
  sleep(f, g, text = 'уснул под аниме') {
    return {
      id: 'sleep', text: `${text} — наведись и зажми ЛКМ, растолкаешь`, short: 'СПИТ', drain: 1.2,
      actions: () => [],
    };
  },
  cough(f, g) {
    return {
      id: 'cough', text: 'закашлялся от вейпа — похлопай по спине (ЛКМ)', short: 'КАШЛЯЕТ', drain: 2,
      actions: () => [],
    };
  },
  waitToilet(f, g) {
    return {
      id: 'waitToilet', text: 'ждёт туалет — занято', short: 'ЖДЁТ ТУАЛЕТ', drain: 1,
      tick() {
        if (!g.bathOccupied(f)) {
          f.clearProblem(false);
          f.startActivity('toilet');
        } else if (f.problem.since > TUNE.bladder.waitMax) {
          g.addPuddle(f.pos[0], f.pos[1]);
          g.state.hut -= TUNE.hut.peed;
          f.fun -= 10;
          f.bladder = 0;
          f.clearProblem(false);
        }
      },
      actions: () => [],
    };
  },
};

// Lyokha wasted in the bathroom: no button — take the hand shower from the tub and soak him (see interact.js)
function showerActions() {
  return [];
}

function startWasted(f, g) {
  f.wasted = true;
  f.endActivity(true);
  const kind = pickWeighted([['puke', 0.45], ['sleepTub', 0.25], ['smash', 0.3]]);
  if (kind === 'puke') {
    // holds his mouth on the way; the puddle and the reaction come when he actually throws up
    f.setProblem(PROBLEMS.puke(f, g));
    f.walkTo(SPOTS.bathStand);
  } else if (kind === 'sleepTub') {
    f.walkTo(SPOTS.tub, () => f.setProblem(PROBLEMS.sleepTub(f, g)));
  } else {
    f.setProblem(PROBLEMS.smash(f, g));
  }
}

// ---------- friend ----------

export class Friend extends Walker {
  constructor(game, id) {
    const def = CHARS[id];
    super(game, makePerson({ ...def, style: game.style, faceId: id }), 1.8, true);
    this.rag = makeBody(this.figure.rig); // the physical body (world/robot.js or world/ragdoll.js)
    this.hookBody();
    this.id = id;
    this.def = def;
    this.name = def.name;
    this.fun = TUNE.start.friendFun;
    this.drunk = 0;
    this.bladder = rand(0, 40);
    this.thirst = rand(10, 40);
    this.hunger = rand(0, 30);
    this.activity = null;
    this.problem = null;
    this.wasted = false;
    this.talkCooldown = 0;
    this.seed = Math.random() * 10;
    this.figure.root.userData.friend = this;
    const spot = SPOTS[def.start];
    this.place(spot);
    const act = Object.entries(ACTIVITIES).find(([, a]) => a.spots.includes(def.start))?.[0];
    this.activity = { id: act, spot, left: rand(...ACTIVITIES[act].dur), t: 0, plateT: 0 };
  }

  // a robot body tells the game when it hits the floor and when it's up again
  hookBody() {
    const rb = this.rag;
    if (!rb?.isRobot) return;
    rb.onFall = () => {
      this.fallen = { phys: true, robot: true, t: 0, why: rb.lastPush ?? 'drunk' };
      this.figure.play('flail');
      this.fun = clamp(this.fun - 3);
      this.game.someoneFell(this, this.fallen.why);
    };
    rb.onGetup = () => {
      this.fallen = null;
      rb.lastPush = null;
    };
  }

  // play one of his recorded clips (src/assets/voice/<id>_<kind>_N.mp3); the sound follows him
  voice(kind, opts = {}) {
    if (this.game.hushed) return null; // someone is at the door: everybody keeps quiet
    return this.game.voices?.play(`${this.id}_${kind}`, { pos: () => this.pos, ...opts });
  }

  unusedMonolog() {
    return this.game.voices?.list(`${this.id}_monolog`).find((src) => !this.game.usedClips.has(src)) ?? null;
  }

  // a line out loud: the recording + a speech bubble + a gesture
  speak(kind = 'monolog', text = null) {
    const h = kind ? this.voice(kind) : null;
    if (!h && !text) return false;
    this.figure.say(text ?? '…', h ? Math.max(2.5, h.audio.duration || 4) : 3.5);
    if (/сук/i.test(text ?? '')) this.figure.play('shout');
    else if (!this.figure.busy) this.figure.play(this.fun > 60 ? 'laugh' : 'talk', { dur: 3 });
    return true;
  }

  // catchphrases now and then (Temych). Monologues are what you get when Oleg talks to him.
  chatter(dt) {
    if (!this.def.quotes) return;
    this.chatT = (this.chatT ?? rand(10, 30)) - dt;
    if (this.chatT > 0 || this.problem || this.figure.pose === 'lie' || this.game.talk?.friend === this) return;
    this.chatT = rand(30, 55);
    if ((this.game.voices?.count(/_(monolog|quote)$/) ?? 0) > 0) return;
    if (!this.speak('quote', this.def.quotes[0])) this.speak(null, this.def.quotes[Math.floor(Math.random() * this.def.quotes.length)]);
  }

  // sounds that come from what he is doing: vaping, reacting to a drink
  sounds(dt) {
    const vaping = this.activity?.id === 'vape' && this.mode !== 'walk' && !this.problem && !this.game.hushed;
    this.vapeRetry = (this.vapeRetry ?? 0) - dt;
    if (vaping && !this.vapeH?.playing && this.vapeRetry <= 0) {
      this.vapeH = this.voice('vapeloop', { loop: true, gain: 0.8 });
      this.vapeRetry = 2;
    }
    if (!vaping && this.vapeH) {
      this.vapeH.stop();
      this.vapeH = null;
    }
    this.boozeCd = (this.boozeCd ?? 0) - dt;
    if (this.boozeIn > 0 && (this.boozeIn -= dt) <= 0) this.voice('booze');
  }

  // a reaction to food, now and then (Temych has one recorded)
  ate() {
    this.figure.play('eat');
    this.foodCd = (this.foodCd ?? 0);
    if (this.foodCd <= this.game.state.t && Math.random() < 0.6 && this.game.voices?.has(`${this.id}_food`)) {
      this.foodCd = this.game.state.t + rand(20, 35);
      setTimeout(() => this.voice('food'), 1800);
    }
  }

  // what a photo of him right now would show (null = nothing worth a shot)
  photoMoment() {
    if (this.fallen) return { cat: 'fall', caption: `${this.name} наебнулся` };
    const loop = this.animLoop();
    const n = this.name;
    const byLoop = {
      puke: `${n} блюёт`, holdMouth: `${n} сейчас блеванёт`, dance: `${n} танцует`, seatDance: `${n} танцует на диване`,
      cough: `${n} кашляет`, choke: `${n} задыхается в дыму`, sleep: `${n} спит`, cry: `${n} рыдает`, smash: `${n} громит хату`,
      smashWalk: `${n} громит хату`, chug: `${n} пьёт из горла`, vape: `${n} парит`, grill: `${n} жарит шашлык`,
      shiver: `${n} мокрый и дрожит`, phone: `${n} смотрит аниме`, needToilet: `${n} хочет в туалет`,
    };
    const cat = { puke: 'puke', holdMouth: 'puke', dance: 'dance', seatDance: 'dance', cough: 'cough', choke: 'cough', sleep: 'sleep', cry: 'cry', smash: 'smash', smashWalk: 'smash', chug: 'chug', vape: 'vape', grill: 'grill', shiver: 'wet', phone: 'anime', needToilet: 'toilet' }[loop];
    return cat ? { cat, caption: byLoop[loop] } : null;
  }

  drink(d, buzzTime = 0, kind = 'beer') {
    this.figure.sip(2.4, kind);
    // reaction to the drink right after the sip (not every time, or it turns into noise)
    if (this.boozeCd <= 0 && Math.random() < 0.55 && this.game.voices?.has(`${this.id}_booze`)) {
      this.boozeIn = 1.9;
      this.boozeCd = rand(18, 30);
    }
    this.fun += d.fun;
    this.drunk = clamp(this.drunk + d.drunk * (TUNE.drunkMult[this.id] ?? 1));
    if (buzzTime) this.buzz = Math.max(this.buzz ?? 0, buzzTime);
  }

  // what the body is doing right now (clip names from world/anim.js)
  animLoop() {
    if (this.debugLoop !== undefined) return this.debugLoop; // console testing: f.debugLoop = 'puke'
    if (this.fallen) return this.fallen.t > 0.45 && !this.fallen.up ? 'fallen' : null;
    if (this.activity?.id === 'pc' && this.figure.pose === 'sit' && this.mode !== 'walk') return 'typing';
    if (this.wetT > 0 && this.figure.pose !== 'lie') return 'shiver';
    const pid = this.problem?.id;
    if (this.mode === 'walk' || this.follow) return pid === 'smash' ? 'smashWalk' : pid === 'puke' || pid === 'led' ? 'holdMouth' : null;
    const byProblem = { hog: 'chug', cry: 'cry', puke: 'puke', sleepTub: 'sleep', sleep: 'sleep', smash: 'smash', grillOut: 'wave', smoke: 'choke', cough: 'cough', waitToilet: 'needToilet' };
    if (byProblem[pid]) return byProblem[pid];
    const act = this.activity?.id;
    const byActivity = { grill: 'grill', anime: 'phone', vape: 'vape' };
    if (byActivity[act]) return byActivity[act];
    if (this.game.state.music && this.room?.id === 'living') return this.figure.pose === 'sit' ? 'seatDance' : 'dance';
    return null;
  }

  // face picture: busy with his thing, otherwise by how much fun he has
  faceState() {
    if (this.problem && ['cry', 'puke', 'sleep', 'cough'].includes(this.problem.id)) return this.problem.id; // if there's a picture
    if (!this.problem && ['grill', 'anime', 'vape'].includes(this.activity?.id) && this.mode !== 'walk') return 'doing';
    if (this.fun <= 3) return 'sad';
    if (this.fun < 30) return 'angry';
    if (this.fun > 70) return 'happy';
    return 'default';
  }

  animate(dt) {
    const d = this.drunk / 100;
    const [ox, oz] = this.game.olegPos;
    this.figure.showName?.(Math.hypot(ox - this.pos[0], oz - this.pos[1]) < 3.2); // names only up close
    const loop = this.animLoop();
    this.figure.setLoop(loop);
    this.figure.setFace?.(this.faceState());
    this.figure.setTint?.((this.warned && !this.wasted) || this.problem?.id === 'puke' ? '#a8f0a0' : '#ffffff');
    // small random gestures so nobody stands like a statue
    if (!this.problem && this.mode !== 'walk' && this.figure.pose !== 'lie' && (!loop || loop === 'dance' || loop === 'seatDance') && !this.figure.busy && this.activity?.id !== 'pc') {
      this.ambientT = (this.ambientT ?? rand(2, 6)) - dt;
      if (this.ambientT <= 0) {
        this.ambientT = rand(3.5, 8);
        const opts = [['talk', 3], ['lookAround', 2], ['scratch', 1]];
        if (this.fun > 65) opts.push(['laugh', 3]);
        this.figure.play(pickWeighted(opts));
      }
    }
    // drunk walking: weaving from side to side, the body turning with it
    this.wetT = Math.max(0, (this.wetT ?? 0) - dt);
    this.wet = Math.max(0, (this.wet ?? 0) - dt * 0.03);
    this.shake = Math.max(0, (this.shake ?? 0) - dt * 2.5);
    const walk = !this.fallen && ((this.mode === 'walk' && this.game.talk?.friend !== this) || (this.follow && this.walkingNow));
    const n = Math.sin(this.t * 1.3 + this.seed) * 0.6 + Math.sin(this.t * 2.9 + this.seed * 2) * 0.4;
    const lat = walk ? 0.17 * d * n : 0;
    const jig = this.shake * Math.sin(this.t * 45) * 0.06; // being shaken awake
    this.applyTransform(Math.cos(this.heading) * (lat + jig), -Math.sin(this.heading) * (lat + jig), walk ? 0.35 * d * Math.sin(this.t * 2.1 + this.seed) : 0);
    const talking = this.game.talk?.friend === this; // stands still while telling his story
    // on his feet he's a physical ragdoll; sitting / lying / carried the animation drives him alone
    const rag = this.rag;
    if (this.blend && (this.blend.t += dt) >= this.blend.dur) this.blend = null;
    if (rag?.isRobot) {
      rag.drunk = d;
      rag.yawWant = this.heading;
      if (rag.state === 'getup') this.blend = null;
    }
    const phys = rag && !this.game.noPhysics && this.figure.pose === 'stand' && this.figure.root.visible && !(this.fallen && !this.fallen.phys) && !this.blend;
    if (phys && !rag.active && rag.state !== 'getup') rag.enable(this.pos[0], this.pos[1], this.heading);
    else if (!phys && rag?.active) rag.disable();
    if (rag?.active) rag.restore();
    else this.balanceTick(dt);
    const b = rag?.active ? null : this.bal;
    this.figure.update(dt, { walking: walk && !(this.lurch > 0) && !talking, speed: this.speed, drunk: d, music: this.game.state.music, bal: b && { p: b.p, r: b.r, m: Math.hypot(b.p, b.r) }, physical: !!rag?.active });
    if (rag?.active) rag.capture(this.heading);
  }

  // after the physics step: the body on the floor? he fell. Lying long enough: he struggles back up
  physicsTick(dt) {
    const rag = this.rag;
    if (rag?.isRobot) {
      // the body is where he is
      rag.tick(dt);
      if (rag.state === 'getup') this.pos = [rag.gu.x, rag.gu.z];
      else if (rag.active) this.pos = [rag.pelvis.x, rag.pelvis.z];
      return;
    }
    if (!rag?.active) return;
    const F = this.fallen;
    if (!F && rag.upright < 0.45) {
      this.fallen = { phys: true, t: 0, lie: rand(1.0, 2.0) + (this.drunk / 100) * 2.5, why: rag.lastPush ?? 'drunk' };
      rag.limp = 1;
      this.figure.play('flail');
      this.fun = clamp(this.fun - 3);
      this.game.someoneFell(this, this.fallen.why);
    }
    // pulled too far from where he should be (stuck on furniture): put him back on his feet there
    const [px, pz] = [rag.pelvis.x, rag.pelvis.z];
    if (!this.fallen && Math.hypot(px - this.pos[0], pz - this.pos[1]) > 1.6) {
      rag.disable();
      rag.enable(this.pos[0], this.pos[1], this.heading);
    }
  }

  get statusText() {
    if (this.problem) return this.problem.short;
    if (this.mode === 'walk') return 'идёт';
    return this.activity ? ACTIVITIES[this.activity.id].label : 'тусит';
  }

  setProblem(p, replace = false) {
    if (this.problem && !replace) return;
    this.problem = p;
    p.since = 0;
    this.figure.setStatus(p.short);
  }

  clearProblem(helped) {
    this.problem = null;
    this.figure.setStatus(null);
    if (helped) this.game.olegHelped();
  }

  endActivity(silent) {
    const a = this.activity;
    this.activity = null;
    if (a?.id === 'grill') this.game.grill.lit = false;
    if (a?.id === 'pc') this.game.pc.standFriend(this);
    if (!silent && this.mode !== 'walk') this.leaveSoon = rand(0.5, 1.5);
  }

  spotFree(id) {
    return !this.game.friends.some((o) => o !== this && (o.spot?.id === id || o.target?.id === id && o.mode === 'walk'));
  }

  startActivity(id) {
    const def = ACTIVITIES[id];
    const spots = def.spots.filter((s) => this.spotFree(s));
    if (!spots.length) return false;
    const spotId = spots[Math.floor(Math.random() * spots.length)];
    const spot = SPOTS[spotId];
    return this.walkTo(spot, () => {
      this.activity = { id, spot, left: rand(...def.dur), t: 0, plateT: 0, closedT: 0, cook: 0 };
      this.onActivityStart(id);
    });
  }

  onActivityStart(id) {
    const g = this.game;
    if (id === 'grill') {
      g.grill.lit = true;
      g.grill.heat = 100;
    }
    if (id === 'pc') {
      if (g.pc.busy()) return this.endActivity(true);
      g.pc.sitFriend(this);
    }
    if (id === 'vape') {
      const door = this.activity.spot.id === 'balcony' ? g.doors.balcony : g.doors.bath;
      if (door.open) {
        door.setOpen(false);
      }
    }
  }

  chooseNext() {
    if (this.bladder >= 100) {
      if (this.game.bathOccupied(this)) {
        this.walkTo(SPOTS.hallWait, () => this.setProblem(PROBLEMS.waitToilet(this, this.game)));
      } else this.startActivity('toilet');
      return;
    }
    const N = TUNE.needs;
    if ((this.thirst > N.goAt || this.hunger > N.goAt) && (this.startActivity('table') || this.startActivity('sofa'))) return;
    const options = Object.entries(this.def.prefs).filter(([id]) => (!ACTIVITIES[id].when || ACTIVITIES[id].when(this.game, this)) && ACTIVITIES[id].spots.some((s) => this.spotFree(s)));
    if (!options.length) return;
    this.startActivity(pickWeighted(options));
  }

  // hit by the shower: gets wet and shivers; a wasted Lyokha comes round, anyone else just gets annoyed
  soak(dt) {
    const H = TUNE.hands;
    this.wet = Math.min(1, (this.wet ?? 0) + H.soak * dt);
    this.wetT = 0.4;
    const pid = this.problem?.id;
    if (pid === 'puke' || pid === 'sleepTub') {
      if (this.wet >= 1) {
        this.drunk = TUNE.lyokha.sober;
        this.wasted = false;
        this.fun += 10;
        this.wet = 0;
        this.clearProblem(true);
        this.game.sfx.splash();
        this.endActivity();
      }
    } else {
      this.fun -= 4 * dt;
    }
  }

  // being led by Oleg: walk along his trail, keep a step behind; the bathroom ends it
  stepFollow(dt) {
    const g = this.game, fo = this.follow;
    const [ox, oz] = g.olegPos;
    const last = fo.trail[fo.trail.length - 1];
    if (Math.hypot(ox - last[0], oz - last[1]) > 0.25) fo.trail.push([ox, oz]);
    const dOleg = Math.hypot(ox - this.pos[0], oz - this.pos[1]);
    if (dOleg > 7) {
      // Oleg ran off: he goes back to smashing
      this.follow = null;
      g.leading = null;
      this.problem = null;
      this.setProblem(PROBLEMS.smash(this, g));
      g.toast('Лёха отстал и опять громит хату', 'bad');
      return;
    }
    if (this.room?.id === 'bath') {
      this.follow = null;
      g.leading = null;
      this.problem = null;
      this.node = 'bath';
      this.walkTo(SPOTS.tub, () => this.setProblem(PROBLEMS.sleepTub(this, g)));
      g.olegHelped();
      return;
    }
    this.walkingNow = false;
    if (dOleg < 1.0) return; // close enough, wait
    if (this.rag?.isRobot && this.rag.active) {
      // his body walks the trail: aim at the next point of it
      const [x, z] = this.pos;
      while (fo.idx < fo.trail.length - 1 && Math.hypot(fo.trail[fo.idx][0] - x, fo.trail[fo.idx][1] - z) < 0.5) fo.idx++;
      const [tx, tz] = fo.trail[fo.idx];
      this.rag.goal = [tx, tz];
      this.heading = Math.atan2(tx - x, tz - z);
      this.walkingNow = true;
      return;
    }
    let step = this.speed * 1.1 * dt;
    while (step > 0 && fo.idx < fo.trail.length) {
      const [tx, tz] = fo.trail[fo.idx];
      const dx = tx - this.pos[0], dz = tz - this.pos[1], d = Math.hypot(dx, dz);
      if (d <= step) {
        this.pos = [tx, tz];
        step -= d;
        fo.idx++;
      } else {
        this.pos[0] += (dx / d) * step;
        this.pos[1] += (dz / d) * step;
        this.heading = Math.atan2(dx, dz);
        step = 0;
      }
    }
    this.walkingNow = true;
  }

  // ---- balance: an inverted pendulum on his feet (TUNE.balance) ----
  balanceTick(dt) {
    const B = TUNE.balance, g = this.game;
    const b = (this.bal ??= { p: 0, r: 0, vp: 0, vr: 0 });
    if (this.fallen || this.figure.pose !== 'stand' || !this.figure.setLean) {
      b.p = b.r = b.vp = b.vr = 0;
      return;
    }
    const d = this.drunk / 100, sdt = Math.min(dt, 1 / 30);
    // drunk: the floor won't stay still (more so on the move)
    const n = B.noise * (0.35 * d + 0.65 * d * d) * (this.mode === 'walk' ? 1.5 : 0.8) * Math.sqrt(sdt);
    b.vp += (Math.random() - 0.5) * 2 * n;
    b.vr += (Math.random() - 0.5) * 2 * n;
    // gravity tips him further, his muscles pull him back up (weaker when drunk)
    const kp = B.kp * (1 - 0.6 * d), kd = B.kd * (1 - 0.4 * d);
    b.vp += (B.g * Math.sin(b.p) - kp * b.p - kd * b.vp) * sdt;
    b.vr += (B.g * Math.sin(b.r) - kp * b.r - kd * b.vr) * sdt;
    b.p += b.vp * sdt;
    b.r += b.vr * sdt;
    const m = Math.hypot(b.p, b.r);
    const dir = this.heading + Math.atan2(-b.r, b.p); // which way he's tipping, in the world
    this.stepCd = (this.stepCd ?? 0) - dt;
    if (m > B.fallAt) {
      b.p = b.r = b.vp = b.vr = 0;
      this.figure.setLean(0, 0);
      this.fall(dir, this.lastPush ?? 'drunk');
      return;
    }
    // too far: catch himself with a step that way
    if (m > B.stepAt && this.stepCd <= 0) {
      this.stepCd = 0.3;
      const nx = this.pos[0] + Math.sin(dir) * B.stepLen, nz = this.pos[1] + Math.cos(dir) * B.stepLen;
      if (!g.bodyBlocked(nx, nz)) {
        this.pos = [nx, nz];
        // sober, a step kills the momentum; drunk, he stumbles on with it
        const keepA = 0.45 + 0.35 * d, keepV = 0.35 + 0.55 * d;
        b.p *= keepA;
        b.r *= keepA;
        b.vp *= keepV;
        b.vr *= keepV;
      }
    }
    if (m < 0.05) this.lastPush = null;
    this.figure.setLean(b.p, b.r);
  }

  // a kick to his balance: dir = where it pushes him (world), strength in rad/s
  push(dir, strength, why = 'shove') {
    if (this.rag?.active) {
      this.rag.push(dir, strength * 0.5);
      this.rag.lastPush = why;
      return;
    }
    const b = (this.bal ??= { p: 0, r: 0, vp: 0, vr: 0 });
    const rel = dir - this.heading;
    b.vp += Math.cos(rel) * strength;
    b.vr += -Math.sin(rel) * strength;
    this.lastPush = why;
  }

  // knocked over, slipped, or just too drunk: tips over around his feet, lies there, gets up
  fall(dir = this.heading, why = 'drunk') {
    if (this.fallen || this.figure.pose !== 'stand' || this.follow) return false;
    const g = this.game;
    if (this.rag?.isRobot && this.rag.active) {
      // knocked off his feet: a hard shove and the legs give for a moment; the physics does the rest
      this.rag.push(dir, 3);
      this.rag.stun = 1.2;
      this.rag.lastPush = why;
      return true;
    }
    if (this.rag?.active) {
      // a real fall: knock the body over and go limp; physicsTick sees him on the floor
      this.rag.push(dir, 3.5);
      this.rag.limp = 1;
      this.rag.lastPush = why;
      return true;
    }
    this.fallen = { t: 0, rel: dir - this.heading, lie: rand(1.2, 2.2) + (this.drunk / 100) * 2.5, why };
    this.figure.play('flail');
    this.fun = clamp(this.fun - 3);
    g.someoneFell(this, why);
    return true;
  }

  fallTick(dt) {
    const F = this.fallen;
    F.t += dt;
    if (F.robot) return; // the body gets itself up (world/robot.js); onGetup clears this
    if (F.phys) {
      // the ragdoll lies there, then gets up like a robot learning to stand
      const rag = this.rag;
      if (F.t > F.lie && !F.up) {
        F.up = true;
        rag.limp = 0;
        rag.assist = 1.4;
        this.figure.play('getup');
      }
      if (F.up && (rag.upright > 0.9 || F.t > F.lie + 4)) {
        if (rag.upright <= 0.9) {
          rag.disable(); // gave up struggling: back on his feet
          rag.enable(rag.pelvis.x, rag.pelvis.z, this.heading);
        }
        rag.assist = 0.8;
        rag.grace = 2; // finds his feet: the help fades out
        this.pos = [rag.pelvis.x, rag.pelvis.z];
        this.fallen = null;
      }
      if (!rag.active) {
        rag.assist = 0;
        this.fallen = null;
      }
      return;
    }
    const down = 0.45, up = 0.7;
    let k;
    if (F.t < down) k = (F.t / down) ** 2; // gravity
    else if (F.t < down + F.lie) k = 1;
    else if (F.t < down + F.lie + up) {
      if (!F.up) {
        F.up = true;
        this.figure.play('getup');
      }
      k = 1 - (F.t - down - F.lie) / up;
    } else {
      this.fallen = null;
      this.figure.setFall(0);
      return;
    }
    this.figure.setFall(k, F.rel);
  }

  // walking through a puddle: slippery, more so when drunk
  slipCheck() {
    const g = this.game;
    if ((this.slipCd ?? 0) > g.state.t) return;
    for (const pd of g.puddles) {
      if (Math.hypot(pd.position.x - this.pos[0], pd.position.z - this.pos[1]) > 0.35) continue;
      this.slipCd = g.state.t + 6;
      this.push(this.heading + Math.PI + rand(-0.6, 0.6), 1.6 + 2 * (this.drunk / 100), 'slip');
      return;
    }
  }

  // thirst and hunger grow; when they get strong he drops what he's doing and heads for the table
  needs(dt) {
    const N = TUNE.needs;
    const drinks = this.def.drinker && (this.def.wantsDrink?.(this) ?? true);
    const pace = this.game.pace;
    if (drinks) this.thirst = Math.min(100, this.thirst + N.thirst * pace * dt);
    this.hunger = Math.min(100, this.hunger + N.hunger * pace * dt);
    const act = this.activity?.id;
    const interruptible = !act || ['sofa', 'kitchen', 'balcony', 'anime'].includes(act);
    if (!this.problem && !this.event && this.mode !== 'walk' && interruptible && (this.thirst > N.wantAt - 15 || this.hunger > N.wantAt - 15)) {
      if (act === 'sofa') return; // the sofa is next to the table: he reaches from there
      if (act) this.endActivity(true);
      if (!this.startActivity('table')) this.startActivity('sofa');
    }
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.talkCooldown -= dt;
    this.fun -= TUNE.fun.boredom * g.pace * dt;
    this.bladder += TUNE.bladder.base * g.pace * dt;
    this.drunk = clamp(this.drunk - 0.4 * dt);
    if (g.state.music && this.room?.id === 'living') this.fun += (TUNE.fun.music + TUNE.living.musicFun * (g.state.volume - 1)) * dt;
    if (this.buzz > 0) {
      this.buzz -= dt;
      this.fun += TUNE.drink.beer.buzz * dt;
    }

    if (this.problem) {
      this.problem.since += dt;
      this.fun -= this.problem.drain * dt;
      this.problem.tick?.(dt);
    }

    const talking = g.talk?.friend === this;
    if (this.rag?.isRobot) this.rag.goal = null;
    if (this.fallen) this.fallTick(dt);
    else if (this.follow) this.stepFollow(dt);
    else if (talking) {
      const [ox, oz] = g.olegPos;
      this.heading = Math.atan2(ox - this.pos[0], oz - this.pos[1]);
      if (!this.figure.busy) this.figure.play(Math.random() < 0.3 ? 'laugh' : 'talk', { dur: 2.5 });
    } else if (this.mode === 'walk') {
      // drunk: stumbles now and then, and the pace keeps changing
      const d = this.drunk / 100;
      if (this.lurch > 0) this.lurch -= dt;
      else if (d > 0.4 && chance(0.12 * d, dt)) {
        this.lurch = 0.8;
        // a stumble: a kick forward-ish; whether he stays up is up to his balance
        this.figure.play('stumble');
        this.push(this.heading + rand(-0.8, 0.8), 0.6 + 1.2 * d, 'drunk');
      } else {
        this.stepWalk(dt * (1 - 0.35 * d * (0.5 + 0.5 * Math.sin(this.t * 1.9))));
        this.slipCheck();
      }
    } else if (this.event) {
      // at a party event (toast, quarrel): stays where it put him, see events.js
    } else if (this.activity) this.tickActivity(dt);
    else if (!this.problem) {
      this.leaveSoon = (this.leaveSoon ?? 0) - dt;
      if (this.leaveSoon <= 0) this.chooseNext();
    }

    this.def.tick?.(this, g, dt);
    this.fun = clamp(this.fun);
    this.needs(dt);
    this.chatter(dt);
    this.sounds(dt);
    this.animate(dt);
  }

  tickActivity(dt) {
    const g = this.game, a = this.activity, D = TUNE.drink;
    const def = ACTIVITIES[a.id];
    if (!this.problem) this.fun += (def.fun ?? 0) * dt;

    if (a.id === 'table' || a.id === 'sofa') { // the sofa is right by the table
      a.t += dt;
      a.plateT += dt;
      const every = TUNE.drinkEvery[this.id] / g.pace;
      const wants = this.def.drinker && (this.def.wantsDrink?.(this) ?? true);
      const N = TUNE.needs;
      if (wants && a.t >= every && this.problem?.id !== 'hog' && this.thirst > N.sipAt) {
        a.t = 0;
        const tb = g.state.table;
        const kind = tb.beer > 0 && tb.vodka > 0 ? (Math.random() < 0.5 ? 'beer' : 'vodka') : tb.beer > 0 ? 'beer' : tb.vodka > 0 ? 'vodka' : null;
        if (kind) {
          tb[kind] -= 1;
          this.drink(D[kind], D[kind].buzzTime, kind);
          this.thirst = Math.max(0, this.thirst - N.sip);
          this.bladder += TUNE.bladder.sip;
        } else if (this.def.needsBooze !== false && this.thirst > N.wantAt && !this.problem) this.setProblem(PROBLEMS.want(this, g, 'booze'));
      }
      if (a.plateT >= D.plateEvery && this.hunger > N.eatAt) {
        a.plateT = 0;
        if (g.state.table.food > 0) {
          g.state.table.food -= 1;
          this.ate();
          this.fun += D.plate.fun;
          this.hunger = Math.max(0, this.hunger - N.plate);
          this.drunk = clamp(this.drunk + D.plate.drunk);
        } else if (this.hunger > N.wantAt && !this.problem) this.setProblem(PROBLEMS.want(this, g, 'food'));
      }
    }

    if (a.id === 'pc') g.pc.friendTick(this, dt);

    if (a.id === 'grill') {
      const G = TUNE.grill;
      g.grill.heat = Math.max(0, g.grill.heat - G.decay * g.pace * dt);
      if (g.grill.heat >= G.lowAt) {
        this.fun += 0.6 * dt;
        a.cook += dt;
        if (a.cook >= G.shashlikEvery) {
          a.cook = 0;
          g.state.table.food += G.shashlikPlates;
        }
        if (this.problem?.id === 'grillOut') this.clearProblem(false);
      } else if (!this.problem) this.setProblem(PROBLEMS.grillOut(this, g));
      if (!g.doors.balcony.open) {
        a.closedT += dt;
        if (a.closedT >= G.smokeAfter && this.problem?.id !== 'smoke') this.setProblem(PROBLEMS.smoke(this, g), true);
      } else a.closedT = 0;
      if (g.doors.balcony.open && chance(G.draftChance * g.diff, dt)) {
        g.doors.balcony.setOpen(false);
      }
    }

    if (a.id === 'anime' && !this.problem && a.left < ACTIVITIES.anime.dur[0] - 5 && chance(TUNE.kirill.sleepChance * g.diff, dt)) {
      this.setProblem(PROBLEMS.sleep(this, g));
    }

    if (a.id === 'vape') {
      const door = a.spot.id === 'balcony' ? g.doors.balcony : g.doors.bath;
      if (!door.open) {
        a.closedT += dt;
        if (a.closedT >= TUNE.vape.coughAfter && !this.problem) {
          this.setProblem(PROBLEMS.cough(this, g));
          this.speak(null, 'Сукааааа');
        }
      }
    }

    if (a.id === 'toilet') this.bladder = Math.max(0, this.bladder - 40 * dt);

    if (!this.problem) {
      a.left -= dt;
      if (a.left <= 0) this.endActivity();
    }
  }

  // what Oleg can do to this friend right now
  actions(g) {
    const list = this.problem ? this.problem.actions(g) : [];
    const item = g.inv.selectedItem();
    if (!this.problem || !list.length) {
      if (item === 'beer' || item === 'vodka') {
        list.push({
          key: 'E', text: `Дать ${item === 'beer' ? 'пиво' : 'водку'}`,
          run: () => {
            if (!this.def.drinker) return;
            g.inv.consume();
            this.drink(TUNE.give[item], TUNE.give[item].buzzTime, item);
            this.thirst = Math.max(0, this.thirst - TUNE.needs.give);
            this.bladder += TUNE.bladder.sip;
            if (this.problem?.id === 'wantBooze') this.clearProblem(true);
          },
        });
      } else if (item === 'food') {
        list.push({
          key: 'E', text: 'Накормить',
          run: () => {
            const part = g.inv.selectedPortion();
            g.inv.consume();
            this.ate();
            this.fun += TUNE.give.food.fun * part;
            this.hunger = Math.max(0, this.hunger - TUNE.needs.give * part);
            if (this.problem?.id === 'wantFood') this.clearProblem(true);
            this.drunk = clamp(this.drunk + TUNE.give.food.drunk);
          },
        });
      }
      if (this.talkCooldown <= 0 && !this.problem && this.unusedMonolog()) {
        list.push({
          key: 'R', text: 'Потрещать',
          run: () => {
            // each story is told once a night; when he has told them all, there's nothing to talk about
            const src = this.unusedMonolog();
            const h = src && this.voice('monolog', { gain: 1.1, src });
            if (!h) return;
            g.usedClips.add(src);
            // he tells his story: Oleg has to stand and listen for the first half
            this.fun += TUNE.talk.fun;
            g.oleg.fun += TUNE.talk.olegFun;
            this.talkCooldown = TUNE.talk.cooldown;
            g.startTalk(this, h);
          },
        });
      }
    }
    return list;
  }
}

// ---------- cat ----------

export class Cat extends Walker {
  constructor(game) {
    super(game, makeCat(), 1.4, false);
    this.name = 'Кот';
    this.fun = TUNE.start.catFun;
    this.problem = null;
    this.idleLeft = rand(3, 6);
    this.balconyT = 0;
    this.railT = 0;
    this.playLeft = 0;
    this.gone = false;
    this.figure.root.userData.cat = this;
    this.place(CAT_SPOTS.catRug);
  }

  get statusText() {
    if (this.gone) return 'ВЫПАЛ С БАЛКОНА';
    if (this.carried) return 'у тебя на руках';
    if (this.problem) return this.problem.short;
    if (this.playLeft > 0) return 'играет с мышкой';
    return this.mode === 'walk' ? 'гуляет' : 'сидит';
  }

  blockedNodes() {
    const d = this.game.doors;
    return (n) => (!d.balcony.open && (n === 'balconyDoor' || n === 'balcony')) || (!d.bath.open && (n === 'bathDoor' || n === 'bath'));
  }

  setProblem(id, text, short, drain) {
    if (this.problem?.id === id) return;
    this.problem = { id, text, short, drain };
    this.figure.setStatus(short);
  }

  clearProblem(helped) {
    this.problem = null;
    this.figure.setStatus(null);
    if (helped) this.game.olegHelped();
  }

  // picked up: he's in Oleg's hands (an inventory slot), calm, and goes wherever Oleg goes
  pickUp() {
    const g = this.game;
    if (!g.inv.add('cat')) return false;
    if (this.problem?.id === 'rail') this.clearProblem(true);
    else if (this.problem) this.clearProblem(false);
    this.carried = true;
    this.path = null;
    this.mode = 'idle';
    this.railT = 0;
    this.balconyT = 0;
    this.figure.root.visible = false;
    g.sfx.purr();
    return true;
  }

  photoMoment() {
    if (this.carried || this.gone) return null;
    if (this.problem?.id === 'rail') return { cat: 'catWindow', caption: 'Кот лезет в окно' };
    if (this.playLeft > 0) return { cat: 'catToy', caption: 'Кот играет с мышкой' };
    return null;
  }

  // put down in front of Oleg
  putDown(x, z) {
    this.carried = false;
    this.pos = [x, z];
    this.node = nearestNode(x, z);
    this.spot = { id: 'floor', node: this.node, p: [x, z], pose: null };
    this.y = 0;
    this.mode = 'idle';
    this.idleLeft = rand(4, 8);
    this.figure.root.visible = true;
  }

  update(dt) {
    if (this.gone) return;
    const g = this.game, C = TUNE.cat;
    this.t += dt;
    this.figure.showName?.(!this.carried && Math.hypot(g.olegPos[0] - this.pos[0], g.olegPos[1] - this.pos[1]) < 3.2); // like the guys: only up close
    if (this.carried) {
      this.pos = [...g.olegPos];
      this.fun = clamp(this.fun + C.heldFun * dt);
      return;
    }
    // a mouse on the floor nearby: he goes after it
    const toy = g.toyLoose ? g.toy.position : null;
    if (toy && this.playLeft <= 0 && this.problem?.id !== 'rail' && Math.hypot(toy.x - this.pos[0], toy.z - this.pos[1]) < C.noticeRange) {
      this.playLeft = C.toyPlay;
      this.path = null;
      this.mode = 'chase';
      this.spot = null;
      this.y = 0;
      this.ready = rand(0.3, 0.8);
    }
    this.running = false;
    if (this.playLeft > 0) {
      this.playLeft -= dt;
      this.fun += C.toyFun * dt;
      if (!toy) this.endPlay(false);
      else if (this.playLeft <= 0) this.endPlay(true);
      else this.chase(dt, toy);
    } else this.fun -= C.boredom * dt;

    const room = this.room?.id;
    const locked = this.mode !== 'walk' && ((room === 'balcony' && !g.doors.balcony.open) || (room === 'bath' && !g.doors.bath.open));
    if (locked && this.spot?.id !== 'catRail') this.setProblem('locked', room === 'balcony' ? 'заперт на балконе' : 'заперт в санузле', 'ЗАПЕРТ', C.lockedDrain);
    else if (this.problem?.id === 'locked') this.clearProblem(true);

    if (room === 'balcony') {
      this.balconyT += dt;
      // the sash is shut: he just sits on the windowsill; open: he climbs out
      if (this.problem?.id === 'rail' && !g.living.windowOpen) {
        this.clearProblem(true);
        this.place(CAT_SPOTS.catBalcony);
        this.balconyT = 0;
      }
      if (this.balconyT >= C.climbAfter && g.living.windowOpen && this.mode !== 'walk' && this.playLeft <= 0 && this.spot?.id !== 'catRail' && this.problem?.id !== 'rail') {
        this.walkTo(CAT_SPOTS.catRail, () => this.setProblem('rail', 'лезет в открытую створку на балконе!', 'В ОКНЕ', 0));
      }
      if (this.problem?.id === 'rail') {
        this.railT += dt;
        if (this.railT >= C.fallAfter) g.catFell();
      }
    } else this.balconyT = 0;

    if (this.problem) this.fun -= this.problem.drain * dt;

    if (this.mode === 'walk') this.stepWalk(dt);
    else if (this.playLeft <= 0 && this.problem?.id !== 'rail') {
      this.idleLeft -= dt;
      if (this.idleLeft <= 0) this.wander();
    }
    this.fun = clamp(this.fun);
    this.applyTransform();
    this.batT = Math.max(0, (this.batT ?? 0) - dt);
    this.figure.animate(this.t, this.mode === 'walk' || this.running, {
      run: this.running || (this.mode === 'walk' && this.playLeft > 0),
      crouch: this.crouch ?? 0,
      pounce: this.pounce ?? 0,
      bat: this.batT / 0.3,
    });
  }

  // playing: run after the mouse, crouch, wiggle, pounce, swipe it away with a paw, again
  chase(dt, toy) {
    const g = this.game, C = TUNE.cat;
    const toyRoom = roomAt(toy.x, toy.z)?.id, mine = this.room?.id;
    if (toyRoom && mine && toyRoom !== mine) {
      // it skidded into another room: walk round through the door
      if (this.mode !== 'walk' || this.chaseRoom !== toyRoom) {
        this.chaseRoom = toyRoom;
        this.crouch = this.pounce = 0;
        if (!this.walkTo({ id: 'toy', node: nearestNode(toy.x, toy.z), p: [toy.x, toy.z], pose: null }, () => (this.mode = 'chase'), this.blockedNodes())) this.endPlay(false);
      }
      return;
    }
    this.chaseRoom = null;
    if (this.mode === 'walk') this.path = null;
    this.mode = 'chase';
    const dx = toy.x - this.pos[0], dz = toy.z - this.pos[1], d = Math.hypot(dx, dz);
    const toyFast = Math.hypot(g.toyVel.x, g.toyVel.z) > 0.35;
    if (this.pounce > 0) {
      // in the air, landing on it
      this.pounce = Math.min(1, this.pounce + dt / 0.42);
      const [ax, az, bx, bz] = this.leap;
      this.pos = [ax + (bx - ax) * this.pounce, az + (bz - az) * this.pounce];
      if (this.pounce >= 1) {
        this.pounce = 0;
        if (d < 0.35) {
          g.kickToy(this.heading + rand(-1, 1), rand(1.4, 3.2), rand(0.8, 1.8));
          g.sfx.squeak?.();
        }
        this.ready = rand(0.6, 1.3);
      }
      return;
    }
    this.heading = Math.atan2(dx, dz);
    if (d > 0.9) {
      // after it at a run
      this.crouch = Math.max(0, (this.crouch ?? 0) - dt * 4);
      const step = Math.min(d - 0.5, C.run * dt);
      if (step > 0) {
        this.pos = [this.pos[0] + (dx / d) * step, this.pos[1] + (dz / d) * step];
        this.running = true;
      }
    } else if (toyFast) {
      // it's still sliding: creep after it, eyes on it
      this.crouch = Math.min(0.6, (this.crouch ?? 0) + dt * 2);
      const step = Math.min(d - 0.4, 0.7 * dt);
      if (step > 0) this.pos = [this.pos[0] + (dx / d) * step, this.pos[1] + (dz / d) * step];
    } else if (d > 0.3) {
      // it stopped: flat to the floor, tail going, rear end wiggling... and jump
      this.crouch = Math.min(1, (this.crouch ?? 0) + dt * 3);
      this.ready = (this.ready ?? 0) - dt;
      if (this.ready <= 0) {
        this.crouch = 0;
        this.pounce = 0.001;
        this.leap = [this.pos[0], this.pos[1], toy.x - (dx / d) * 0.12, toy.z - (dz / d) * 0.12];
      }
    } else if (this.batT <= 0) this.swipe();
  }

  swipe() {
    this.batT = 0.3;
    this.crouch = 0;
    this.game.kickToy(this.heading + rand(-1.3, 1.3), rand(0.7, 2.4), rand(0.5, 1.6));
    this.ready = rand(0.8, 1.6);
  }

  // done playing; `hid` = he knocked the mouse away under the furniture (go find it again)
  endPlay(hid) {
    const g = this.game;
    this.playLeft = 0;
    this.crouch = this.pounce = 0;
    this.path = null;
    this.mode = 'idle';
    this.idleLeft = rand(3, 6);
    this.node = nearestNode(this.pos[0], this.pos[1]);
    this.spot = { id: 'floor', node: this.node, p: [...this.pos], pose: null };
    if (hid && g.toyLoose) {
      g.respawnToy();
    }
  }

  wander() {
    const g = this.game;
    this.idleLeft = rand(5, 10);
    const options = Object.values(CAT_SPOTS)
      .filter((s) => s.id !== 'catRail' && s.id !== this.spot?.id)
      .filter((s) => !(s.balcony && !g.doors.balcony.open))
      .map((s) => [s, s.balcony ? TUNE.cat.balconyPull : 1]);
    const spot = pickWeighted(options);
    if (spot) this.walkTo(spot, null, this.blockedNodes());
  }

  actions(g) {
    if (this.gone || this.carried) return [];
    const list = [{
      key: 'E', text: this.problem?.id === 'rail' ? 'Схватить кота с окна!' : 'Взять на руки', cost: TUNE.cost.catRescue,
      run: () => this.pickUp(),
    }];
    if (this.playLeft <= 0) {
      list.push({
        key: 'T', text: 'Погладить', cost: TUNE.cost.petCat,
        run: () => {
          this.fun += TUNE.cat.pet;
          g.oleg.fun += 2;
          g.sfx.purr();
        },
      });
    }
    if (g.inv.has('toy') && this.playLeft <= 0) {
      list.push({
        key: 'R', text: 'Кинуть ему мышку',
        run: () => g.giveToy(this),
      });
    }
    return list;
  }
}
