// Oleg's gaming PC in the bedroom. Its screen is a canvas drawn here.
//   Апгрейдер: buy cheap skins with Oleg's money, put one in, pick a pricier target and spin:
//     the chance is honest (your skin's price / target's price, minus the site's cut). Win: you get the
//     target. Lose: the skin is gone. Skins can be sold back to the balance.
//   КС: дуэль: terrorists pop out of doorways, shoot them before they shoot you.
// The guys sit down by themselves and spin the upgrader on Oleg's money; the others come over to watch.
// Oleg can drag them off the chair (E) or sit down himself (E): the camera flies to the screen.
import * as THREE from 'three';
import { TUNE } from '../config.js';
import { SPOTS } from '../world/layout.js';
import { rand, clamp, nearestNode } from './friends.js';

export const SKINS = [
  { name: 'P250 | Песчаная дюна', price: 12, rarity: 0, gun: 'pistol', color: '#c9b48a' },
  { name: 'MP9 | Ботаника', price: 35, rarity: 0, gun: 'smg', color: '#6f8f5a' },
  { name: 'Glock-18 | Ласка', price: 80, rarity: 1, gun: 'pistol', color: '#4a7bd6' },
  { name: 'USP-S | Кортекс', price: 150, rarity: 1, gun: 'pistol', color: '#d8d8d8' },
  { name: 'AK-47 | Сланец', price: 280, rarity: 2, gun: 'rifle', color: '#5b6066' },
  { name: 'M4A1-S | Ночной ужас', price: 520, rarity: 2, gun: 'rifle', color: '#5a3d8c' },
  { name: 'AWP | Атеерис', price: 900, rarity: 3, gun: 'sniper', color: '#e05a8a' },
  { name: 'AK-47 | Красная линия', price: 1600, rarity: 3, gun: 'rifle', color: '#b3242a' },
  { name: 'Desert Eagle | Кровавая паутина', price: 2800, rarity: 4, gun: 'pistol', color: '#a3121c' },
  { name: 'AWP | Азимов', price: 5200, rarity: 4, gun: 'sniper', color: '#f2f2f2' },
  { name: '★ Нож-бабочка | Убийство', price: 14000, rarity: 5, gun: 'knife', color: '#3b6fd1' },
];
const RARITY = ['#b0c3d9', '#4b69ff', '#8847ff', '#d32ce6', '#eb4b4b', '#e4ae39'];
const CW = 1024, CH = 602;
const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');
const R = new THREE.Raycaster();

export class PC {
  constructor(game) {
    this.game = game;
    const item = game.furn.items.loftBed;
    let screen = null, monitor = null, chair = null;
    item.group.traverse((o) => {
      if (o.userData.pcScreen) screen = o;
      if (o.userData.pcMonitor) monitor = o;
      if (o.userData.pcChair) chair = o;
    });
    const sb = new THREE.Box3().setFromObject(screen), mb = new THREE.Box3().setFromObject(monitor);
    const sc = sb.getCenter(new THREE.Vector3()), mc = mb.getCenter(new THREE.Vector3()), size = sb.getSize(new THREE.Vector3());
    // the screen sits in front of the bezel: that's where it faces
    const alongX = size.x < size.z;
    this.normal = alongX ? new THREE.Vector3(Math.sign(sc.x - mc.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(sc.z - mc.z));
    const w = alongX ? size.z : size.x;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(w, size.y), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.plane.position.copy(sc).addScaledVector(this.normal, 0.004);
    this.plane.lookAt(this.plane.position.clone().add(this.normal));
    game.dynamic.add(this.plane);
    this.center = sc;
    const target = {
      name: 'Комп Олега', pc: true,
      info: () => (this.user ? `${this.user.name} лудит на твои деньги` : 'Апгрейдер и КС'),
      actions: () => (this.user
        ? [{ key: 'E', text: `Оттащить ${this.user.name === 'Лёха' ? 'Лёху' : this.user.name === 'Темыч' ? 'Темыча' : this.user.name === 'Кирилл' ? 'Кирилла' : 'Алексея'} от компа`, cost: TUNE.cost.lead, run: () => this.kick() }]
        : [{ key: 'E', text: 'Сесть за комп', run: () => this.sit() }]),
    };
    this.plane.userData.target = target;
    monitor.userData.target = target;
    // where the guys sit and stand around it
    const cp = new THREE.Box3().setFromObject(chair).getCenter(new THREE.Vector3());
    const look = [sc.x, sc.z];
    const side = alongX ? [0, 1] : [1, 0];
    const back = [this.normal.x, this.normal.z];
    SPOTS.pcChair = { id: 'pcChair', p: [cp.x, cp.z], node: nearestNode(cp.x, cp.z), pose: 'sit', y: -0.03, look };
    for (const [i, s] of [[1, 0.55], [2, -0.55]]) {
      const x = cp.x + back[0] * 0.55 + side[0] * s, z = cp.z + back[1] * 0.55 + side[1] * s;
      SPOTS[`pcWatch${i}`] = { id: `pcWatch${i}`, p: [x, z], node: nearestNode(x, z), look };
    }
    // the camera when Oleg sits down
    this.cam = { pos: sc.clone().addScaledVector(this.normal, 0.44).add(new THREE.Vector3(0, 0.02, 0)), look: sc.clone() };
    this.reset();
  }

  reset() {
    this.skins = []; // Oleg's account on the site (indices into SKINS)
    this.sel = 0;
    this.goal = 4;
    this.spin = null;
    this.result = null;
    this.buying = false;
    this.app = 'upgrader';
    this.cs = null;
    this.user = null;
    this.focus = null;
    this.botT = 2;
    this.mouse = { x: -99, y: -99 };
    this.buttons = [];
    this.angle = 0;
    this.draw();
  }

  busy() {
    return !!this.user || !!this.focus;
  }

  // ---------- Oleg at the PC ----------

  sit() {
    if (this.user) return;
    this.focus = { cam: this.cam };
    this.buying = false;
    this.game.toast('Esc — встать из-за компа', 'info');
  }

  cancel() {
    this.focus = null;
    this.cs = null;
    this.app = 'upgrader';
  }

  hint() {
    if (this.app === 'cs') return 'Стреляй ЛКМ, пока они не выстрелили · Esc — встать';
    return 'ЛКМ — жми на сайте · Esc — встать';
  }

  progress() {
    return null;
  }

  // a guy sits down at the PC (his activity started)
  sitFriend(f) {
    this.user = f;
    this.botT = rand(1.5, 3);
    f.setProblem({
      id: 'gamble', text: 'крутит апгрейдер на твои деньги — оттащи его от компа', short: 'ЛУДИТ', drain: -0.6,
      actions: () => [{ key: 'E', text: 'Оттащить от компа', cost: TUNE.cost.lead, run: () => this.kick() }],
    });
  }

  standFriend(f) {
    if (this.user !== f) return;
    this.user = null;
    if (f.problem?.id === 'gamble') f.clearProblem(false);
  }

  kick() {
    const f = this.user;
    if (!f) return;
    this.user = null;
    if (f.problem?.id === 'gamble') f.clearProblem(true);
    f.fun = clamp(f.fun - 6);
    f.pcBan = this.game.state.t + 30; // not straight back
    f.endActivity();
  }

  // ---------- upgrader ----------

  chance() {
    const own = SKINS[this.skins[this.sel]], goal = SKINS[this.goal];
    if (!own || !goal) return 0;
    return clamp((own.price / goal.price) * TUNE.pc.edge, 0.01, 0.85);
  }

  buy(i, by) {
    const g = this.game, s = SKINS[i];
    if (g.state.money < s.price) {
      if (!by) g.toastOnce('pcMoney', 'Не хватает денег', 'warn', 2);
      return false;
    }
    g.state.money -= s.price;
    g.state.stats.spent += s.price;
    this.skins.push(i);
    this.sel = this.skins.length - 1;
    this.fixGoal();
    g.sfx.click();
    return true;
  }

  sell() {
    const g = this.game, i = this.skins[this.sel];
    if (i == null || this.spin) return;
    const got = Math.round(SKINS[i].price * TUNE.pc.sell);
    g.state.money += got;
    this.skins.splice(this.sel, 1);
    this.sel = Math.max(0, Math.min(this.sel, this.skins.length - 1));
    g.sfx.ding();
  }

  // the target has to be pricier than what you put in
  fixGoal(step = 0) {
    const own = SKINS[this.skins[this.sel]];
    const min = own ? own.price : 0;
    const ok = SKINS.map((s, i) => i).filter((i) => SKINS[i].price > min);
    if (!ok.length) return;
    let k = ok.indexOf(this.goal);
    if (k < 0) k = 0;
    this.goal = ok[(k + step + ok.length) % ok.length];
  }

  startSpin(by = null) {
    if (this.spin || this.skins[this.sel] == null) return;
    const p = this.chance(), win = Math.random() < p;
    const T = Math.PI * 2;
    const land = win ? rand(0.03, 0.97) * p * T : p * T + rand(0.03, 0.97) * (1 - p) * T;
    const from = this.angle % T;
    this.spin = { t: 0, dur: 3.4, from, to: T * 4 + land, win, by, p, lastTick: 0 };
    this.result = null;
  }

  endSpin() {
    const g = this.game, s = this.spin;
    this.spin = null;
    const ownI = this.skins[this.sel];
    const goal = SKINS[this.goal];
    if (s.win) this.skins[this.sel] = this.goal;
    else this.skins.splice(this.sel, 1);
    this.sel = Math.max(0, Math.min(this.sel, this.skins.length - 1));
    this.result = { win: s.win, name: s.win ? goal.name : SKINS[ownI].name, t: 2.5 };
    this.fixGoal();
    // the room reacts
    const watchers = g.friends.filter((f) => f.activity?.id === 'watch' || f === this.user);
    const P = TUNE.pc;
    if (s.win) {
      g.sfx.ding();
      for (const f of watchers) {
        f.fun = clamp(f.fun + P.winFun);
        f.figure.play('shout');
      }
      if (!s.by) g.oleg.fun = clamp(g.oleg.fun + P.winFun);
    } else {
      for (const f of watchers) {
        f.fun = clamp(f.fun + (f === s.by ? -2 : P.loseFun));
        f.figure.play(f === s.by ? 'shout' : 'laugh');
      }
    }
  }

  // a guy in the chair: buys junk with Oleg's money and spins for something pricier
  friendTick(f, dt) {
    if (this.user !== f) return;
    f.fun = clamp(f.fun + TUNE.pc.playFun * dt);
    if (this.spin) return;
    this.botT -= dt;
    if (this.botT > 0) return;
    this.botT = rand(2, 3.5);
    const g = this.game;
    if (!this.skins.length || Math.random() < 0.3) {
      const cheap = SKINS.map((s, i) => i).filter((i) => SKINS[i].price <= 300 && SKINS[i].price <= g.state.money);
      if (!cheap.length) {
        f.endActivity();
        return;
      }
      this.buy(cheap[Math.floor(Math.random() * cheap.length)], f);
    }
    this.sel = Math.floor(Math.random() * this.skins.length);
    const own = SKINS[this.skins[this.sel]].price;
    const goals = SKINS.map((s, i) => i).filter((i) => SKINS[i].price > own * 1.8 && SKINS[i].price < own * 12);
    this.goal = goals.length ? goals[Math.floor(Math.random() * goals.length)] : SKINS.length - 1;
    this.startSpin(f);
  }

  // ---------- КС: дуэль ----------

  startCS() {
    this.app = 'cs';
    this.cs = { hp: 100, kills: 0, need: TUNE.pc.csKills, enemies: [], next: 0.9, over: null, flash: 0, recoil: 0, t: 0 };
  }

  tickCS(dt, click) {
    const c = this.cs, g = this.game;
    if (!c || c.over) return;
    c.t += dt;
    c.flash = Math.max(0, c.flash - dt * 3);
    c.recoil = Math.max(0, c.recoil - dt * 8);
    const HOLES = CS_HOLES;
    c.next -= dt;
    if (c.next <= 0 && c.enemies.filter((e) => !e.dead).length < 2) {
      const free = HOLES.map((h, i) => i).filter((i) => !c.enemies.some((e) => e.hole === i && !e.gone));
      const hole = free[Math.floor(Math.random() * free.length)];
      c.enemies.push({ hole, t: 0, fire: rand(0.85, 1.25) / Math.sqrt(g.pace), dead: false, deadT: 0 });
      c.next = rand(0.5, 1.2);
    }
    if (click) {
      c.recoil = 1;
      g.sfx.shot?.();
      for (const e of c.enemies) {
        if (e.dead) continue;
        const h = HOLES[e.hole], s = h.s, pop = Math.min(1, e.t / 0.18);
        const ex = h.x, ey = h.y;
        const head = Math.hypot(this.mouse.x - ex, this.mouse.y - (ey - 96 * s * pop)) < 16 * s;
        const body = Math.abs(this.mouse.x - ex) < 24 * s && this.mouse.y < ey && this.mouse.y > ey - 84 * s * pop;
        if (head || body) {
          e.dead = true;
          e.head = head;
          c.kills += 1;
          g.sfx.pat();
          break;
        }
      }
    }
    for (const e of c.enemies) {
      if (e.dead) {
        e.deadT += dt;
        continue;
      }
      e.t += dt;
      if (e.t >= e.fire) {
        e.dead = true;
        e.gone = true;
        c.hp -= 25;
        c.flash = 1;
        g.sfx.shot?.();
      }
    }
    c.enemies = c.enemies.filter((e) => !(e.dead && e.deadT > 0.6) && !e.gone);
    if (c.kills >= c.need || c.hp <= 0) {
      c.over = c.hp > 0 ? 'win' : 'lose';
      const watchers = g.friends.filter((f) => f.activity?.id === 'watch');
      const P = TUNE.pc;
      if (c.over === 'win') {
        g.oleg.fun = clamp(g.oleg.fun + P.csWin);
        for (const f of watchers) {
          f.fun = clamp(f.fun + P.csWatch);
          f.figure.play('shout');
        }
      } else {
        g.oleg.fun = clamp(g.oleg.fun - 4);
        for (const f of watchers) {
          f.fun = clamp(f.fun + 3);
          f.figure.play('laugh');
        }
      }
    }
  }

  // ---------- frame ----------

  update(dt, { ray, pressed }) {
    if (this.focus && ray) {
      R.ray.copy(ray);
      const hit = R.intersectObject(this.plane)[0];
      if (hit?.uv) this.mouse = { x: hit.uv.x * CW, y: (1 - hit.uv.y) * CH };
    }
    const click = this.focus && pressed;
    if (this.spin) {
      const s = this.spin;
      s.t += dt;
      const k = Math.min(1, s.t / s.dur), e = 1 - Math.pow(1 - k, 3);
      this.angle = s.from + (s.to - s.from) * e;
      const tick = Math.floor(this.angle / 0.35);
      if (tick !== s.lastTick && k < 0.95) {
        s.lastTick = tick;
        if (this.focus || this.near()) this.game.sfx.click();
      }
      if (k >= 1) this.endSpin();
    }
    if (this.result) this.result.t -= dt;
    if (this.app === 'cs') this.tickCS(dt, click && this.mouse.y > 56);
    if (click) {
      const b = this.buttons.find((b) => this.mouse.x >= b.x && this.mouse.x <= b.x + b.w && this.mouse.y >= b.y && this.mouse.y <= b.y + b.h);
      if (b) b.fn();
    }
    // redraw: always while someone looks at it / it moves, otherwise now and then
    this.drawT = (this.drawT ?? 0) - dt;
    if (this.focus || this.spin || this.app === 'cs' || this.drawT <= 0) {
      this.drawT = 0.5;
      if (this.focus || this.near() || this.spin) this.draw();
    }
  }

  near() {
    const [x, z] = this.game.olegPos;
    return Math.hypot(x - this.center.x, z - this.center.z) < 7;
  }

  // ---------- drawing ----------

  btn(x, y, w, h, fn) {
    this.buttons.push({ x, y, w, h, fn });
    return this.mouse.x >= x && this.mouse.x <= x + w && this.mouse.y >= y && this.mouse.y <= y + h;
  }

  draw() {
    const c = this.ctx;
    this.buttons = [];
    c.fillStyle = '#121317';
    c.fillRect(0, 0, CW, CH);
    this.drawTop(c);
    if (this.app === 'cs') this.drawCS(c);
    else this.drawUpgrader(c);
    if (this.focus && this.app !== 'cs') {
      // the mouse pointer
      c.fillStyle = '#fff';
      c.strokeStyle = '#000';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(this.mouse.x, this.mouse.y);
      c.lineTo(this.mouse.x + 16, this.mouse.y + 14);
      c.lineTo(this.mouse.x + 6, this.mouse.y + 15);
      c.lineTo(this.mouse.x, this.mouse.y + 22);
      c.closePath();
      c.fill();
      c.stroke();
    }
    this.tex.needsUpdate = true;
  }

  drawTop(c) {
    c.fillStyle = '#1a1b20';
    c.fillRect(0, 0, CW, 56);
    // logo
    c.fillStyle = '#f5c518';
    c.beginPath();
    c.moveTo(22, 38); c.lineTo(36, 18); c.lineTo(50, 38); c.lineTo(43, 38); c.lineTo(36, 28); c.lineTo(29, 38);
    c.fill();
    c.font = '800 24px Arial';
    c.fillStyle = '#fff';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillText('UPGRADER', 60, 29);
    // tabs (Oleg only)
    const tabs = [['upgrader', 'Апгрейд'], ['cs', 'КС: дуэль']];
    let x = 260;
    for (const [id, label] of tabs) {
      const on = this.app === id;
      const hover = this.focus && this.btn(x, 10, 150, 36, () => (id === 'cs' ? this.startCS() : ((this.app = 'upgrader'), (this.cs = null))));
      c.fillStyle = on ? '#f5c518' : hover ? '#2c2e36' : '#22242b';
      roundRect(c, x, 10, 150, 36, 8);
      c.fill();
      c.fillStyle = on ? '#141414' : '#cfd2da';
      c.font = '700 18px Arial';
      c.textAlign = 'center';
      c.fillText(label, x + 75, 29);
      x += 162;
    }
    // balance = Oleg's money
    c.textAlign = 'right';
    c.fillStyle = '#f5c518';
    c.font = '800 22px Arial';
    c.fillText(`${fmt(this.game.state?.money ?? 0)} ₽`, CW - 80, 29);
    c.strokeStyle = '#f5c518';
    c.lineWidth = 2;
    roundRect(c, CW - 68, 12, 32, 32, 6);
    c.stroke();
    c.fillStyle = this.user ? '#ff5a4f' : '#7fd48a';
    c.beginPath();
    c.arc(CW - 52, 28, 7, 0, Math.PI * 2);
    c.fill();
  }

  drawUpgrader(c) {
    const own = SKINS[this.skins[this.sel]], goal = SKINS[this.goal];
    const p = this.chance();
    // ---- left: inventory
    c.textAlign = 'left';
    c.fillStyle = '#8c909c';
    c.font = '700 15px Arial';
    c.fillText('ТВОИ СКИНЫ', 24, 82);
    const list = this.skins.slice(-6);
    const off = this.skins.length - list.length;
    list.forEach((si, k) => {
      const i = off + k, s = SKINS[si], y = 96 + k * 62;
      const hover = this.focus && this.btn(20, y, 290, 54, () => !this.spin && ((this.sel = i), this.fixGoal()));
      c.fillStyle = i === this.sel ? '#2a2c35' : hover ? '#23252c' : '#1b1c22';
      roundRect(c, 20, y, 290, 54, 8);
      c.fill();
      c.fillStyle = RARITY[s.rarity];
      c.fillRect(20, y + 6, 4, 42);
      drawGun(c, s, 70, y + 27, 0.42);
      c.fillStyle = '#e8e8ea';
      c.font = '600 14px Arial';
      c.fillText(s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name, 120, y + 20);
      c.fillStyle = '#f5c518';
      c.font = '700 14px Arial';
      c.fillText(`${fmt(s.price)} ₽`, 120, y + 40);
    });
    if (!this.skins.length) {
      c.fillStyle = '#5d606b';
      c.font = '15px Arial';
      c.fillText('Пусто. Купи дешёвый скин ↓', 24, 120);
    }
    // buy / sell
    const by = 480;
    if (this.focus) {
      const hb = this.btn(20, by, 140, 44, () => (this.buying = !this.buying));
      c.fillStyle = hb || this.buying ? '#3a3d48' : '#2a2c35';
      roundRect(c, 20, by, 140, 44, 8);
      c.fill();
      c.fillStyle = '#fff';
      c.font = '700 16px Arial';
      c.textAlign = 'center';
      c.fillText('Купить скин', 90, by + 22);
      const hs = this.btn(170, by, 140, 44, () => this.sell());
      c.fillStyle = hs ? '#3a3d48' : '#2a2c35';
      roundRect(c, 170, by, 140, 44, 8);
      c.fill();
      c.fillStyle = own ? '#7fd48a' : '#555';
      c.fillText(own ? `Продать ${fmt(own.price * TUNE.pc.sell)}` : 'Продать', 240, by + 22);
    }
    // ---- centre: the wheel
    const cx = 512, cy = 258, r = 132;
    c.lineWidth = 22;
    c.strokeStyle = '#2a2c33';
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
    if (p > 0) {
      const grad = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      grad.addColorStop(0, '#9be15d');
      grad.addColorStop(1, '#f5c518');
      c.strokeStyle = grad;
      c.beginPath();
      c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      c.stroke();
    }
    // the arrow
    const a = this.angle - Math.PI / 2;
    c.save();
    c.translate(cx, cy);
    c.rotate(a);
    c.fillStyle = '#f5c518';
    c.beginPath();
    c.moveTo(r + 18, 0);
    c.lineTo(r - 22, -9);
    c.lineTo(r - 22, 9);
    c.closePath();
    c.fill();
    c.restore();
    c.textAlign = 'center';
    c.fillStyle = '#9be15d';
    c.font = '800 46px Arial';
    c.fillText(`${(p * 100).toFixed(2)}%`, cx, cy - 6);
    c.font = '600 16px Arial';
    if (this.result && this.result.t > 0) {
      c.fillStyle = this.result.win ? '#9be15d' : '#ff5a4f';
      c.fillText(this.result.win ? 'Апгрейд успешен!' : 'Не повезло…', cx, cy + 32);
    } else {
      c.fillStyle = '#8c909c';
      c.fillText(this.spin ? 'Крутим…' : 'шанс апгрейда', cx, cy + 32);
    }
    // the upgrade button
    const canSpin = !this.spin && own && goal && goal.price > own.price;
    const hu = this.focus && canSpin && this.btn(372, 430, 280, 58, () => this.startSpin());
    c.fillStyle = canSpin ? (hu ? '#ffd84a' : '#f5c518') : '#3a3a30';
    roundRect(c, 372, 430, 280, 58, 10);
    c.fill();
    c.fillStyle = canSpin ? '#151515' : '#777';
    c.font = '800 22px Arial';
    c.fillText(this.user ? `Крутит ${this.user.name}` : 'Апгрейд', 512, 459);
    // ---- right: the target
    const rx = 704;
    c.fillStyle = '#1b1c22';
    roundRect(c, rx, 72, 300, 340, 12);
    c.fill();
    if (goal) {
      const glow = c.createRadialGradient(rx + 150, 200, 10, rx + 150, 200, 150);
      glow.addColorStop(0, RARITY[goal.rarity] + '88');
      glow.addColorStop(1, '#1b1c2200');
      c.fillStyle = glow;
      c.fillRect(rx, 72, 300, 300);
      drawGun(c, goal, rx + 150, 200, 1);
      c.fillStyle = '#fff';
      c.font = '700 17px Arial';
      c.fillText(goal.name, rx + 150, 112);
      c.fillStyle = '#f5c518';
      c.font = '800 22px Arial';
      c.fillText(`${fmt(goal.price)} ₽`, rx + 150, 340);
      if (this.focus && !this.spin) {
        const hl = this.btn(rx + 12, 370, 60, 36, () => this.fixGoal(-1));
        const hr = this.btn(rx + 228, 370, 60, 36, () => this.fixGoal(1));
        for (const [x, h, t] of [[rx + 12, hl, '◀'], [rx + 228, hr, '▶']]) {
          c.fillStyle = h ? '#3a3d48' : '#2a2c35';
          roundRect(c, x, 370, 60, 36, 8);
          c.fill();
          c.fillStyle = '#fff';
          c.font = '700 18px Arial';
          c.fillText(t, x + 30, 389);
        }
      }
    }
    c.fillStyle = '#5d606b';
    c.font = '13px Arial';
    c.fillText('цель апгрейда', rx + 150, 88);
    // ---- buying overlay
    if (this.buying && this.focus) {
      c.fillStyle = '#0d0e12ee';
      roundRect(c, 20, 76, 984, 392, 12);
      c.fill();
      c.textAlign = 'left';
      c.fillStyle = '#fff';
      c.font = '800 20px Arial';
      c.fillText('Купить скин (деньги с телефона)', 40, 104);
      SKINS.slice(0, 6).forEach((s, i) => {
        const x = 40 + (i % 3) * 320, y = 126 + Math.floor(i / 3) * 160;
        const can = (this.game.state?.money ?? 0) >= s.price;
        const h = this.btn(x, y, 300, 146, () => this.buy(i) && (this.buying = false));
        c.fillStyle = h && can ? '#2c2e38' : '#1d1e25';
        roundRect(c, x, y, 300, 146, 10);
        c.fill();
        c.fillStyle = RARITY[s.rarity];
        c.fillRect(x, y + 140, 300, 6);
        drawGun(c, s, x + 150, y + 62, 0.7);
        c.textAlign = 'center';
        c.fillStyle = can ? '#e8e8ea' : '#666';
        c.font = '600 15px Arial';
        c.fillText(s.name, x + 150, y + 108);
        c.fillStyle = can ? '#f5c518' : '#6b5a20';
        c.font = '800 18px Arial';
        c.fillText(`${fmt(s.price)} ₽`, x + 150, y + 130);
        c.textAlign = 'left';
      });
    }
    // ---- footer
    c.textAlign = 'left';
    c.fillStyle = '#5d606b';
    c.font = '13px Arial';
    c.fillText('Сайт забирает свою долю: шанс = цена твоего скина / цена цели × 0,9', 24, 580);
  }

  drawCS(c) {
    const s = this.cs;
    // de_dust: sky, sandy walls, dark doorways, crates
    const sky = c.createLinearGradient(0, 56, 0, 300);
    sky.addColorStop(0, '#7fb0d8');
    sky.addColorStop(1, '#d9c9a0');
    c.fillStyle = sky;
    c.fillRect(0, 56, CW, CH - 56);
    c.fillStyle = '#c9a66b';
    c.fillRect(0, 170, CW, 340);
    c.fillStyle = '#b48f55';
    for (let x = 0; x < CW; x += 64) c.fillRect(x, 170, 2, 340);
    c.fillStyle = '#a37f4a';
    c.fillRect(0, 500, CW, 102);
    for (const h of CS_HOLES) {
      c.fillStyle = '#2b2116';
      c.fillRect(h.x - 46 * h.s, h.y - 130 * h.s, 92 * h.s, 130 * h.s);
    }
    // crates
    c.fillStyle = '#8a6a3a';
    for (const [x, y, w] of [[90, 470, 90], [560, 480, 70], [900, 460, 100]]) {
      c.fillRect(x, y - w, w, w);
      c.strokeStyle = '#5e4524';
      c.lineWidth = 4;
      c.strokeRect(x + 4, y - w + 4, w - 8, w - 8);
      c.beginPath();
      c.moveTo(x + 4, y - w + 4);
      c.lineTo(x + w - 4, y - 4);
      c.stroke();
    }
    if (!s) return;
    // terrorists
    for (const e of s.enemies) {
      const h = CS_HOLES[e.hole], k = h.s, pop = Math.min(1, e.t / 0.18);
      c.save();
      c.translate(h.x, h.y);
      if (e.dead) {
        c.rotate(Math.min(1.4, e.deadT * 4) * (e.hole % 2 ? 1 : -1));
        c.globalAlpha = Math.max(0, 1 - e.deadT * 1.5);
      }
      c.fillStyle = '#3a3226';
      c.fillRect(-22 * k, -84 * k * pop, 44 * k, 84 * k * pop); // body
      c.fillStyle = '#1e1a14';
      c.beginPath();
      c.arc(0, -96 * k * pop, 15 * k, 0, Math.PI * 2); // balaclava
      c.fill();
      c.fillStyle = '#d9b48c';
      c.fillRect(-8 * k, -100 * k * pop, 16 * k, 5 * k); // eyes slit
      c.fillStyle = '#111';
      c.fillRect(8 * k, -60 * k * pop, 40 * k, 7 * k); // AK
      if (!e.dead) {
        // how soon he fires
        c.strokeStyle = '#ff3b30';
        c.lineWidth = 4;
        c.beginPath();
        c.arc(0, -96 * k * pop, 24 * k, -Math.PI / 2, -Math.PI / 2 + (e.t / e.fire) * Math.PI * 2);
        c.stroke();
      } else if (e.head) {
        c.fillStyle = '#ff3b30';
        c.font = `800 ${18 * k}px Arial`;
        c.textAlign = 'center';
        c.fillText('HEADSHOT', 0, -130 * k);
      }
      c.restore();
    }
    // HUD
    c.textAlign = 'left';
    c.font = '800 30px Arial';
    c.fillStyle = s.hp > 30 ? '#f2f2f2' : '#ff5a4f';
    c.fillText(`✚ ${Math.max(0, s.hp)}`, 24, 570);
    c.textAlign = 'right';
    c.fillStyle = '#f2f2f2';
    c.fillText(`${s.kills}/${s.need}`, CW - 24, 570);
    // gun with recoil
    c.fillStyle = '#1c1c1c';
    c.save();
    c.translate(760 + s.recoil * 10, 560 + s.recoil * 18);
    c.rotate(-0.25 - s.recoil * 0.1);
    c.fillRect(0, -18, 260, 36);
    c.fillRect(30, 10, 34, 60);
    c.fillStyle = '#5a3a1e';
    c.fillRect(200, -14, 90, 28);
    c.restore();
    if (s.flash > 0) {
      c.fillStyle = `rgba(255,30,20,${0.45 * s.flash})`;
      c.fillRect(0, 56, CW, CH - 56);
    }
    // crosshair
    if (this.focus) {
      const { x, y } = this.mouse;
      c.strokeStyle = '#4dff6a';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x - 16, y); c.lineTo(x - 5, y);
      c.moveTo(x + 5, y); c.lineTo(x + 16, y);
      c.moveTo(x, y - 16); c.lineTo(x, y - 5);
      c.moveTo(x, y + 5); c.lineTo(x, y + 16);
      c.stroke();
    }
    if (s.over) {
      c.fillStyle = '#000000aa';
      c.fillRect(0, 56, CW, CH - 56);
      c.textAlign = 'center';
      c.fillStyle = s.over === 'win' ? '#9be15d' : '#ff5a4f';
      c.font = '900 64px Arial';
      c.fillText(s.over === 'win' ? 'ПОБЕДА' : 'ТЕБЯ УБИЛИ', CW / 2, 260);
      const h = this.focus && this.btn(CW / 2 - 120, 320, 240, 56, () => this.startCS());
      c.fillStyle = h ? '#ffd84a' : '#f5c518';
      roundRect(c, CW / 2 - 120, 320, 240, 56, 10);
      c.fill();
      c.fillStyle = '#151515';
      c.font = '800 22px Arial';
      c.fillText('Ещё раунд', CW / 2, 349);
    } else if (s.t < 1.2) {
      c.textAlign = 'center';
      c.fillStyle = '#fff';
      c.font = '900 40px Arial';
      c.fillText(`Убей ${s.need}, пока не убили тебя`, CW / 2, 120);
    }
  }
}

const CS_HOLES = [
  { x: 150, y: 330, s: 0.8 }, { x: 330, y: 300, s: 0.7 }, { x: 520, y: 320, s: 0.75 },
  { x: 700, y: 300, s: 0.7 }, { x: 880, y: 330, s: 0.8 }, { x: 250, y: 470, s: 1.05 }, { x: 760, y: 470, s: 1.05 },
];

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// a little gun silhouette in the skin's colour
function drawGun(c, s, x, y, k) {
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  c.fillStyle = s.color;
  c.strokeStyle = '#0008';
  c.lineWidth = 3;
  const shape = {
    pistol: [[-50, -14], [50, -14], [50, 4], [-10, 4], [-14, 40], [-38, 40], [-30, 4], [-50, 4]],
    smg: [[-70, -12], [60, -12], [60, 6], [10, 6], [6, 36], [-12, 36], [-10, 6], [-50, 6], [-70, 20]],
    rifle: [[-110, -6], [-60, -14], [90, -14], [90, -4], [110, -4], [110, 4], [30, 6], [24, 40], [6, 40], [8, 6], [-60, 6], [-110, 22]],
    sniper: [[-120, -4], [-60, -12], [120, -10], [120, -2], [20, 4], [14, 36], [-2, 36], [0, 6], [-60, 6], [-120, 24]],
    knife: [[-60, -6], [10, -10], [70, -2], [10, 8], [-60, 8]],
  }[s.gun];
  c.beginPath();
  shape.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
  c.closePath();
  c.fill();
  c.stroke();
  if (s.gun === 'sniper' || s.gun === 'rifle') {
    c.fillStyle = '#222';
    c.fillRect(-20, -26, 50, 10); // scope / sight
  }
  c.restore();
}
