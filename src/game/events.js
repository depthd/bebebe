// Party events that need Oleg himself (which ones run tonight: TUNE.NIGHTS[n].events):
//   toast   — someone yells "Тост!", the guys gather at the table; come over and drink (Q) in time
//   quarrel — two drunk guys get into it; stand between them or they fight and break stuff
//   fire    — Kirill's grill sets the balcony on fire; fill the bucket from the hand shower, throw it
import * as THREE from 'three';
import { TUNE } from '../config.js';
import { SPOTS } from '../world/layout.js';
import { particles } from '../world/particles.js';
import { rand, clamp, nearestNode } from './friends.js';

const TOAST_SPOTS = ['table1', 'table2', 'table3', 'sofaA'];

export class PartyEvents {
  constructor(game) {
    this.game = game;
    this.fire = null;
    this.fireMesh = this.buildFire();
  }

  reset() {
    this.t = rand(22, 32); // first event
    this.toast = null;
    this.quarrel = null;
    if (this.fire) this.putOut(false);
  }

  update(dt) {
    const g = this.game, E = TUNE.events;
    if (this.toast) this.tickToast(dt);
    if (this.quarrel) this.tickQuarrel(dt);
    this.tickFire(dt);
    if (this.toast || this.quarrel) return;
    this.t -= dt * g.pace;
    if (this.t > 0) return;
    this.t = rand(...E.every);
    const opts = [];
    if (g.hasEvent('toast') && g.tableBooze() >= 2 && this.free().length >= 3) opts.push('toast');
    if (g.hasEvent('quarrel') && this.pair()) opts.push('quarrel', 'quarrel');
    const pick = opts[Math.floor(Math.random() * opts.length)];
    if (pick === 'toast') this.startToast();
    else if (pick === 'quarrel') this.startQuarrel();
  }

  free() {
    return this.game.friends.filter((f) => !f.problem && !f.event && !f.follow && !f.wasted && f.figure.pose !== 'lie');
  }

  // ---------- toast ----------

  startToast() {
    const g = this.game, guys = this.free();
    if (!guys.length) return;
    const host = guys[Math.floor(Math.random() * guys.length)];
    host.figure.play('shout');
    this.toast = { left: TUNE.events.toastWindow, guys, drank: false };
    guys.forEach((f, i) => {
      f.event = 'toast';
      f.endActivity(true);
      f.walkTo(SPOTS[TOAST_SPOTS[i % TOAST_SPOTS.length]]);
    });
    g.alert('Тост! Подойди к столу и выпей (Q)', 'Зал', 'info');
  }

  // Oleg drank: counts if he's at the table during a toast
  olegDrank() {
    if (!this.toast) return;
    const g = this.game, t = g.furn.items.partyTable;
    const [ox, oz] = g.olegPos;
    if (Math.hypot(ox - (t.x0 + t.x1) / 2, oz - (t.z0 + t.z1) / 2) < TUNE.events.toastReach) this.toast.drank = true;
  }

  tickToast(dt) {
    const g = this.game, k = this.toast, E = TUNE.events;
    k.left -= dt;
    k.guys = k.guys.filter((f) => f.event === 'toast' && !f.problem);
    for (const f of k.guys) {
      if (f.mode === 'walk') continue;
      if (!f.figure.busy && Math.random() < dt * 0.6) f.figure.play(Math.random() < 0.5 ? 'laugh' : 'talk');
    }
    if (k.drank) {
      for (const f of k.guys) {
        f.fun = clamp(f.fun + E.toastFun);
        f.figure.play('drink');
        const tb = g.state.table;
        if (tb.vodka > 0) tb.vodka -= 1;
        else if (tb.beer > 0) tb.beer -= 1;
        f.drink?.(TUNE.drink.vodka, 0, 'vodka');
      }
      g.oleg.fun = clamp(g.oleg.fun + E.toastOlegFun);
      g.olegHelped();
      this.endToast();
    } else if (k.left <= 0) {
      for (const f of k.guys) {
        f.fun = clamp(f.fun - E.toastMiss);
      }
      this.endToast();
    }
  }

  endToast() {
    for (const f of this.game.friends) if (f.event === 'toast') f.event = null;
    this.toast = null;
  }

  // ---------- quarrel ----------

  pair() {
    const drunk = this.free().filter((f) => f.drunk > TUNE.events.quarrelDrunk && f.activity?.id !== 'grill' && f.mode !== 'walk');
    if (drunk.length < 2) return null;
    drunk.sort(() => Math.random() - 0.5);
    return [drunk[0], drunk[1]];
  }

  startQuarrel() {
    const g = this.game, pair = this.pair();
    if (!pair) return;
    const [a, b] = pair;
    a.endActivity(true);
    b.endActivity(true);
    a.standUp?.();
    a.path = null;
    a.mode = 'idle';
    const [px, pz] = a.front(0.85);
    b.walkTo({ id: 'quarrel', node: nearestNode(px, pz), p: [px, pz], pose: null, look: [...a.pos] });
    const q = { a, b, left: TUNE.events.quarrelTime / Math.sqrt(g.pace), sep: 0, lineT: 0, side: 0, fight: 0 };
    this.quarrel = q;
    for (const [f, o] of [[a, b], [b, a]]) {
      f.event = 'quarrel';
      f.setProblem({ id: 'quarrel', text: `срётся с ${o.name === 'Лёха' ? 'Лёхой' : o.name === 'Темыч' ? 'Темычем' : o.name === 'Кирилл' ? 'Кириллом' : 'Алексеем'} — встань между ними`, short: 'СРУТСЯ', drain: 1.2, actions: () => [] }, true);
    }
    a.figure.play('shout');
  }

  // where Oleg has to stand: between the two of them
  between() {
    const q = this.quarrel;
    if (!q) return 0;
    const [ox, oz] = this.game.olegPos;
    const [ax, az] = q.a.pos, [bx, bz] = q.b.pos;
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
    const t = ((ox - ax) * vx + (oz - az) * vz) / L2;
    const d = Math.hypot(ox - ax - vx * t, oz - az - vz * t);
    return t > 0.1 && t < 0.9 && d < 0.55;
  }

  tickQuarrel(dt) {
    const g = this.game, q = this.quarrel, E = TUNE.events;
    const { a, b } = q;
    if (a.problem?.id !== 'quarrel' || b.problem?.id !== 'quarrel') return this.endQuarrel();
    const close = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) < 1.6;
    if (b.mode === 'walk' && !close) return;
    // face each other and yell in turns
    a.heading = Math.atan2(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]);
    b.heading = Math.atan2(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]);
    if (q.fight > 0) {
      q.fight -= dt;
      if (!a.figure.busy) a.figure.play(Math.random() < 0.5 ? 'shout' : 'jolt');
      if (!b.figure.busy) b.figure.play(Math.random() < 0.5 ? 'jolt' : 'shout');
      if (Math.random() < dt * 3) g.sfx.pat();
      if (q.fight <= 0) {
        g.breakSomething(a.room?.id);
        g.state.noise += E.fightNoise;
        a.fun = clamp(a.fun - E.fightFun);
        b.fun = clamp(b.fun - E.fightFun);
        (Math.random() < 0.5 ? a : b).fall?.(0.8);
        this.endQuarrel();
      }
      return;
    }
    q.lineT -= dt;
    if (q.lineT <= 0) {
      q.lineT = rand(1.3, 2.1);
      const f = q.side ? b : a;
      f.figure.play('shout');
      q.side ^= 1;
    }
    if (this.between()) q.sep += dt;
    else q.sep = Math.max(0, q.sep - dt * 0.5);
    if (q.sep >= E.separate) {
      a.fun = clamp(a.fun + 6);
      b.fun = clamp(b.fun + 6);
      g.olegHelped();
      this.endQuarrel();
      return;
    }
    q.left -= dt;
    if (q.left <= 0) {
      q.fight = 2.5;
    }
  }

  endQuarrel() {
    const q = this.quarrel;
    this.quarrel = null;
    if (!q) return;
    for (const f of [q.a, q.b]) {
      f.event = null;
      if (f.problem?.id === 'quarrel') f.clearProblem(false);
      f.endActivity?.(true);
    }
  }

  // ---------- fire on the balcony ----------

  buildFire() {
    const g = new THREE.Group();
    const flame = (c, s) => new THREE.Mesh(new THREE.ConeGeometry(0.16 * s, 0.6 * s, 7, 1, true).translate(0, 0.3 * s, 0), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const flames = [flame('#ff4a10', 1.3), flame('#ff9a20', 1), flame('#ffe060', 0.6), flame('#ff6a18', 0.9), flame('#ffb030', 0.7)];
    flames.forEach((f, i) => {
      f.position.set(Math.cos(i * 2.4) * 0.12 * (i > 2), 0, Math.sin(i * 2.4) * 0.12 * (i > 2));
      g.add(f);
    });
    const light = new THREE.PointLight('#ff6a20', 0, 5, 2);
    light.position.y = 0.6;
    g.add(light);
    g.visible = false;
    g.userData = { flames, light };
    this.game.dynamic.add(g);
    // the fire is a target: shows how big it is
    for (const f of flames) f.userData.target = { name: 'Пожар', fire: true, info: () => `Горит: ${Math.round((this.fire?.size ?? 0) * 100)}%`, actions: () => [] };
    return g;
  }

  tickFire(dt) {
    const g = this.game, E = TUNE.events, F = this.fire;
    if (!F) {
      // the grill catches the balcony: more likely when it's fanned up hot and Kirill is drunk
      const kirill = g.friends.find((f) => f.id === 'kirill');
      if (!g.hasEvent('fire') || !g.grill.lit || kirill?.activity?.id !== 'grill' || g.state.t < E.fireNotBefore) return;
      let p = E.fireChance * g.diff;
      if (g.grill.heat > 85) p *= 3;
      if (kirill.drunk > 40) p *= 2;
      if (Math.random() < p * dt) this.ignite(kirill);
      return;
    }
    F.size = Math.min(1, F.size + E.fireGrow * g.pace * dt);
    if (F.size >= 1) F.full += dt;
    g.state.hut -= E.fireHut * F.size * dt;
    g.state.noise += E.fireNoise * F.size * dt;
    // flames flicker and grow
    const { flames, light } = this.fireMesh.userData;
    const s = 0.35 + F.size * 1.1;
    flames.forEach((m, i) => {
      const k = 0.75 + 0.35 * Math.sin(g.state.t * (9 + i * 3.1) + i) + 0.15 * Math.random();
      m.scale.set(s, s * k, s);
    });
    light.intensity = 2 + F.size * 6 + Math.random() * 1.5;
    if (Math.random() < dt * (4 + F.size * 10)) particles.puff(this.fireMesh.position.clone().setY(0.6 + F.size * 0.5), new THREE.Vector3(rand(-0.1, 0.1), 0.5, rand(-0.1, 0.1)), { color: '#3a3330', size0: 0.15, size1: 0.9 + F.size, life: 2.2, opacity: 0.5 });
    if (F.full > E.fireBurnout) {
      g.state.hut -= E.fireDisaster;
      g.alert('Балкон выгорел', 'Балкон');
      this.putOut(false);
    }
  }

  ignite(kirill) {
    const g = this.game, gr = g.furn.items.grill;
    this.fire = { size: 0.2, full: 0 };
    this.fireMesh.position.set((gr.x0 + gr.x1) / 2 - 0.35, 0, (gr.z0 + gr.z1) / 2);
    this.fireMesh.visible = true;
    g.sfx.whoosh();
    kirill.setProblem({
      id: 'fire', text: 'спалил балкон! Ведро у ванны: набери воды из лейки и плесни на огонь', short: 'ПОЖАР', drain: 3,
      actions: () => [],
    }, true);
    kirill.figure.play('shout');
  }

  // a bucket of water lands near `point`: knocks the fire down
  splash(point) {
    const F = this.fire;
    if (!F) return false;
    const p = this.fireMesh.position;
    if (Math.hypot(point.x - p.x, point.z - p.z) > TUNE.events.splashRadius) return false;
    F.size -= TUNE.events.splashPower;
    particles.puff(p.clone().setY(0.5), new THREE.Vector3(0, 0.8, 0), { color: '#e8e8e8', size0: 0.3, size1: 1.6, life: 2.5, opacity: 0.6 });
    if (F.size <= 0) this.putOut(true);
    return true;
  }

  putOut(byOleg) {
    const g = this.game;
    this.fire = null;
    this.fireMesh.visible = false;
    const kirill = g.friends.find((f) => f.id === 'kirill');
    if (kirill?.problem?.id === 'fire') {
      kirill.clearProblem(byOleg);
      if (byOleg) {
        kirill.fun = clamp(kirill.fun + 10);
      }
    }
  }
}
