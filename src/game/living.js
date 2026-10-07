// The flat lives on its own:
//   TV in the stenka: channels on its screen (football, news, 18+, anime, cartoons), volume 1..3
//   music: volume 1..3 (state.volume), louder = more fun and more noise for the neighbours
//   the guys turn things on by themselves, switch to 18+, crank the volume up
//   balcony: an opening sash; the cat can only fall out through it; the guys open it (vaping, yelling
//   "Коч!" out of it), Oleg can close it
import * as THREE from 'three';
import { TUNE } from '../config.js';
import { BALCONY, CAT_SPOTS, H } from '../world/layout.js';
import { mat } from '../world/apartment.js';
import { rand, clamp } from './friends.js';

const CHANNELS = ['Футбол', 'Новости', '18+', 'Аниме', 'Мультики'];
const TW = 512, TH = 288;

export class Living {
  constructor(game) {
    this.game = game;
    this.buildTV();
    this.buildWindow();
    this.reset();
  }

  reset() {
    this.tv = { on: false, ch: 0, vol: 1, switchT: 0 };
    if (this.game.state) this.game.state.volume = 1; // no state yet when built (before the first night)
    this.prankT = rand(25, 40);
    this.setWindow(false);
  }

  // ---------- TV ----------

  buildTV() {
    const g = this.game;
    let screen = null;
    g.furn.items.stenka.group.traverse((o) => o.userData.tvScreen && (screen = o));
    const b = new THREE.Box3().setFromObject(screen), c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
    const alongX = size.x < size.z;
    const room = g.furn.items.partyTable;
    const toRoom = alongX ? Math.sign((room.x0 + room.x1) / 2 - c.x) : Math.sign((room.z0 + room.z1) / 2 - c.z);
    const normal = alongX ? new THREE.Vector3(toRoom, 0, 0) : new THREE.Vector3(0, 0, toRoom);
    this.canvas = document.createElement('canvas');
    this.canvas.width = TW;
    this.canvas.height = TH;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? size.z : size.x, size.y), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.screen.position.copy(c).addScaledVector(normal, 0.012);
    this.screen.lookAt(this.screen.position.clone().add(normal));
    g.dynamic.add(this.screen);
    this.tvPos = c;
    this.screen.userData.target = {
      name: 'Телик',
      info: () => (this.tv.on ? `${CHANNELS[this.tv.ch]} · громкость ${this.tv.vol}/3` : 'Выключен'),
      actions: () => (this.tv.on
        ? [
          { key: 'E', text: 'Выключить телик', run: () => this.setTV(false) },
          { key: 'R', text: 'Переключить канал', run: () => this.switchCh() },
          ...(this.tv.vol > 1 ? [{ key: 'T', text: 'Сделать тише', run: () => (this.tv.vol -= 1) }] : []),
        ]
        : [{ key: 'E', text: 'Включить телик', run: () => this.setTV(true) }]),
    };
  }

  setTV(on) {
    this.tv.on = on;
    if (on) this.tv.switchT = 0.4;
  }

  switchCh(to) {
    this.tv.ch = to ?? (this.tv.ch + 1) % CHANNELS.length;
    this.tv.switchT = 0.4;
  }

  drawTV(t) {
    const c = this.ctx, tv = this.tv;
    if (!tv.on) {
      c.fillStyle = '#050607';
      c.fillRect(0, 0, TW, TH);
      this.tex.needsUpdate = true;
      return;
    }
    if (tv.switchT > 0) {
      // static between channels
      const img = c.createImageData(TW / 4, TH / 4);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      c.drawImage(this.canvas, 0, 0, TW / 4, TH / 4, 0, 0, TW, TH);
      this.tex.needsUpdate = true;
      return;
    }
    const ch = CHANNELS[tv.ch];
    if (ch === 'Футбол') {
      c.fillStyle = '#2f8a3a';
      c.fillRect(0, 0, TW, TH);
      c.strokeStyle = '#e8f5e8';
      c.lineWidth = 3;
      c.strokeRect(20, 20, TW - 40, TH - 40);
      c.beginPath();
      c.moveTo(TW / 2, 20);
      c.lineTo(TW / 2, TH - 20);
      c.stroke();
      c.beginPath();
      c.arc(TW / 2, TH / 2, 40, 0, Math.PI * 2);
      c.stroke();
      const bx = TW / 2 + Math.sin(t * 0.7) * 180, by = TH / 2 + Math.sin(t * 1.3) * 90;
      for (let i = 0; i < 10; i++) {
        c.fillStyle = i < 5 ? '#d83a2e' : '#f2f2f2';
        c.beginPath();
        c.arc(bx + Math.sin(t * 0.9 + i * 1.7) * 90 + (i < 5 ? -40 : 40), by + Math.cos(t * 1.1 + i * 2.3) * 60, 6, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(bx, by, 4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#000a';
      c.fillRect(14, 12, 150, 26);
      c.fillStyle = '#fff';
      c.font = '700 16px Arial';
      c.fillText(`ЗЕН 1:1 СПМ  ${String(Math.floor(t / 2) % 90).padStart(2, '0')}'`, 20, 31);
    } else if (ch === 'Новости') {
      c.fillStyle = '#123a6b';
      c.fillRect(0, 0, TW, TH);
      c.fillStyle = '#0b2648';
      c.fillRect(0, TH - 60, TW, 60);
      c.fillStyle = '#d9b48c';
      c.beginPath();
      c.arc(TW / 2, 110, 38, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#20232a';
      c.fillRect(TW / 2 - 70, 148, 140, 90);
      c.fillStyle = '#c22';
      c.fillRect(0, TH - 60, 110, 60);
      c.fillStyle = '#fff';
      c.font = '800 20px Arial';
      c.fillText('НОВОСТИ', 8, TH - 24);
      c.font = '600 18px Arial';
      const msg = 'В хрущёвке на окраине жалуются на шум… Соседи вызывают участкового… Курс доллара…   ';
      const off = (t * 70) % (msg.length * 9);
      c.fillText(msg + msg, 120 - off, TH - 24);
    } else if (ch === '18+') {
      // censored: pink mosaic and a big sticker
      for (let x = 0; x < TW; x += 32) for (let y = 0; y < TH; y += 32) {
        const k = 0.5 + 0.5 * Math.sin(x * 0.05 + y * 0.03 + t * 3);
        c.fillStyle = `rgb(${200 + 50 * k},${130 + 40 * k},${140 + 30 * k})`;
        c.fillRect(x, y, 32, 32);
      }
      c.fillStyle = '#000';
      c.fillRect(TW / 2 - 110, TH / 2 - 40, 220, 80);
      c.fillStyle = '#ff3b6a';
      c.font = '900 56px Arial';
      c.textAlign = 'center';
      c.fillText('18+', TW / 2, TH / 2 + 20);
      c.textAlign = 'left';
    } else if (ch === 'Аниме') {
      const sky = c.createLinearGradient(0, 0, 0, TH);
      sky.addColorStop(0, '#ff9ac8');
      sky.addColorStop(1, '#8fd0ff');
      c.fillStyle = sky;
      c.fillRect(0, 0, TW, TH);
      for (let i = 0; i < 12; i++) {
        c.fillStyle = '#fff8';
        c.beginPath();
        c.arc((i * 97 + t * 40) % TW, (i * 53) % TH, 3, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#ffe2cf';
      c.beginPath();
      c.ellipse(TW / 2, 160, 70, 85, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#3a2a6a';
      c.beginPath();
      c.ellipse(TW / 2, 110, 82, 60, 0, Math.PI, 0);
      c.fill();
      for (const s of [-1, 1]) {
        c.fillStyle = '#fff';
        c.beginPath();
        c.ellipse(TW / 2 + s * 30, 160, 18, 24, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#5a3fd0';
        c.beginPath();
        c.ellipse(TW / 2 + s * 30, 164, 12, 17, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#fff';
      c.font = '700 22px Arial';
      c.fillText('Сэмпай!!', 30, 50);
    } else {
      c.fillStyle = '#ffd34d';
      c.fillRect(0, 0, TW, TH);
      const x = (t * 90) % (TW + 100) - 50;
      c.fillStyle = '#8a5a2c';
      c.fillRect(x - 30, 170, 60, 60);
      c.fillStyle = '#e04a2c';
      c.beginPath();
      c.arc(x, 150, 30, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#333';
      c.font = '800 24px Arial';
      c.fillText('Ну, погоди!', 20, 40);
    }
    this.tex.needsUpdate = true;
  }

  // ---------- balcony sash ----------

  buildWindow() {
    // one pane of the balcony glazing (the one by the cat's windowsill) opens outward on its hinge:
    // same frame, same plane as the rest of the glazing (apartment.js), between two of its mullions
    const g = this.game, b = BALCONY, rail = CAT_SPOTS.catRail;
    const f = 0.05, n = Math.max(1, Math.round((b.x1 - b.x0) / 0.8)), seg = (b.x1 - b.x0) / n;
    const k = Math.max(0, Math.min(n - 1, Math.floor((rail.p[0] - b.x0) / seg)));
    const x0 = b.x0 + k * seg + f / 2, x1 = b.x0 + (k + 1) * seg - f / 2, w = x1 - x0;
    const y0 = b.railH + f, y1 = H - 0.05 - f;
    const z = b.z0 + b.rail / 2; // the glazing plane
    const pivot = new THREE.Group();
    pivot.position.set(x0, 0, z);
    const frame = mat('#eeeae2', { roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: '#a9c3d6', transparent: true, opacity: 0.2, roughness: 0.05, side: THREE.DoubleSide });
    const bar = (a, b2, c0, c1) => new THREE.Mesh(new THREE.BoxGeometry(b2 - a, c1 - c0, 0.035).translate((a + b2) / 2, (c0 + c1) / 2, -0.03), frame);
    const t = 0.04;
    pivot.add(bar(0, w, y0, y0 + t), bar(0, w, y1 - t, y1), bar(0, t, y0, y1), bar(w - t, w, y0, y1));
    pivot.add(new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * t, y1 - y0 - 2 * t).translate(w / 2, (y0 + y1) / 2, -0.03), glass));
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.03).translate(w - 0.08, (y0 + y1) / 2, 0), mat('#c9c4b8', { metalness: 0.6 }))); // handle, inside
    g.dynamic.add(pivot);
    this.sash = pivot;
    this.sashOpen = 0;
    const target = {
      name: 'Створка на балконе',
      info: () => (this.windowOpen ? 'Открыта: кот может выпасть' : 'Закрыта'),
      actions: () => [{ key: 'E', text: this.windowOpen ? 'Закрыть створку' : 'Открыть створку', run: () => this.setWindow(!this.windowOpen) }],
    };
    pivot.traverse((o) => (o.userData.target = target));
  }

  setWindow(open, by) {
    this.windowOpen = open;
  }

  // ---------- frame ----------

  update(dt) {
    const g = this.game, st = g.state, P = TUNE.living;
    // sash swings out / in
    this.sashOpen += ((this.windowOpen ? 1 : 0) - this.sashOpen) * Math.min(1, dt * 5);
    this.sash.rotation.y = this.sashOpen * 1.1; // swings out over the yard
    // TV
    const tv = this.tv;
    tv.switchT = Math.max(0, tv.switchT - dt);
    this.drawT = (this.drawT ?? 0) - dt;
    const [ox, oz] = g.olegPos;
    if (this.drawT <= 0 && Math.hypot(ox - this.tvPos.x, oz - this.tvPos.z) < 9) {
      this.drawT = 0.1;
      this.drawTV(st.t);
    }
    if (tv.on) {
      for (const f of g.friends) if (f.room?.id === 'living' && !f.problem) f.fun = clamp(f.fun + P.tvFun * tv.vol * dt);
    }
    // the guys mess with the TV, the music and the window
    this.prankT -= dt * g.pace;
    if (this.prankT <= 0 && !g.hushed) {
      this.prankT = rand(...P.prankEvery);
      this.prank();
    }
  }

  // extra noise for the neighbours from the TV and loud music
  noise() {
    const st = this.game.state, P = TUNE.living;
    return (this.tv.on ? P.tvNoise * this.tv.vol : 0) + (st.music ? P.musicLoud * (st.volume - 1) : 0);
  }

  prank() {
    const g = this.game, st = g.state;
    const free = g.friends.filter((f) => !f.problem && !f.fallen && !f.event && f.mode !== 'walk');
    if (!free.length) return;
    const f = free[Math.floor(Math.random() * free.length)];
    const say = () => f.figure.play('shout');
    const opts = [];
    if (!st.music) opts.push('musicOn');
    else if (st.volume < 3) opts.push('musicUp', 'musicUp');
    if (!this.tv.on) opts.push('tvOn');
    else opts.push('tvPorn', 'tvSwitch', ...(this.tv.vol < 3 ? ['tvUp'] : []));
    if (!this.windowOpen && (f.room?.id === 'balcony' || f.activity?.id === 'vape')) opts.push('window');
    const pick = opts[Math.floor(Math.random() * opts.length)];
    if (pick === 'musicOn') {
      st.music = true;
      say('Чё так тихо? Врубаю музон!');
    } else if (pick === 'musicUp') {
      st.volume += 1;
      say(st.volume === 3 ? 'НА МАКСИМУМ!' : 'Погромче сделаю');
    } else if (pick === 'tvOn') {
      this.setTV(true);
      this.switchCh(Math.floor(Math.random() * CHANNELS.length));
      say('О, телик!');
    } else if (pick === 'tvPorn') {
      this.switchCh(2);
      say('Ахахах, пацаны, смотрите чё нашёл');
      for (const w of g.friends) if (w !== f && w.room?.id === f.room?.id) {
        w.fun = clamp(w.fun + 4);
        w.figure.play('laugh');
      }
    } else if (pick === 'tvSwitch') {
      this.switchCh();
      say(['Футбол давай!', 'Переключи', 'О, это смотрел'][Math.floor(Math.random() * 3)]);
    } else if (pick === 'tvUp') {
      this.tv.vol += 1;
      say('Не слышно же ничё!');
    } else if (pick === 'window') {
      this.setWindow(true, f);
      say('Душно, открою');
    }
  }
}
