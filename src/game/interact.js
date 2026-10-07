// Hands-on actions in the 3D world: aim and hold the left mouse button.
//   shower head (on its hose from the tub mixer): spray whoever you aim at; soaks a wasted Lyokha sober
//   rag: scrub a puddle by moving the mouse while holding the button
//   empty hand on a coughing guy: pat him on the back, click by click, in a steady rhythm
//   empty hand on a sleeping guy: hold and shake the mouse left-right to shake him awake
//   the cat's mouse: click to throw it, the cat chases it
//   bucket: hold LMB at the tub to fill it from the hand shower; with water, click to throw it (fire, people)
// Everything costs Oleg's strength while he does it. Returns what to show under the crosshair.
import * as THREE from 'three';
import { TUNE } from '../config.js';
import { particles } from '../world/particles.js';
import { mat } from '../world/apartment.js';

const V = new THREE.Vector3(), V2 = new THREE.Vector3();

export class Interactions {
  constructor(game) {
    this.game = game;
    this.hose = null;
    this.mixer = null; // world position of the shower mixer
    this.patLast = -9;
    this.fill = 0; // the bucket filling up under the hand shower
    this.showerHeadMesh = null;
  }

  // the tub's shower head: taking it off the wall gives you the hand shower
  attachShower(tubGroup) {
    this.headParts = [];
    let mixer = null;
    tubGroup.traverse((o) => {
      if (o.userData.showerHead || o.userData.staticHose) this.headParts.push(o);
      if (o.userData.mixer) mixer = o;
    });
    if (!mixer || !this.headParts.length) return;
    mixer.geometry.computeBoundingSphere();
    this.mixer = mixer.geometry.boundingSphere.center.clone();
    this.showerHeadMesh = { set visible(v) { for (const p of this.parts) p.visible = v; }, parts: this.headParts };
    const tube = new THREE.Mesh(new THREE.BufferGeometry(), mat('#8b9298', { metalness: 0.6, roughness: 0.35 }));
    tube.visible = false;
    tube.frustumCulled = false;
    this.game.dynamic.add(tube);
    this.hose = tube;
  }

  showerHeld() {
    return this.game.inv.has('shower');
  }

  takeShower() {
    if (!this.game.inv.add('shower')) return;
    this.showerHeadMesh.visible = false;
    this.hose.visible = true;
  }

  returnShower(msg) {
    this.game.inv.remove('shower');
    this.showerHeadMesh.visible = true;
    this.hose.visible = false;
    if (msg) this.game.toast(msg, 'info');
  }

  energy(cost) {
    const o = this.game.oleg;
    if (o.energy <= 0) {
      this.game.toastOnce('tired', 'Нет сил. Подожди пару секунд или поешь', 'warn', 3);
      return false;
    }
    o.energy = Math.max(0, o.energy - cost);
    return true;
  }

  // input: { down, pressed, mx, my (mouse movement this frame, px), target, origin, dir, hand }
  update(dt, input) {
    const g = this.game, T = TUNE.hands;
    const held = g.inv.selectedItem();
    const tgt = input.target;
    let hud = null;

    // ---- hose follows the hand; too far from the tub and it snaps back
    if (this.showerHeld() && this.hose) {
      const [ox, oz] = g.olegPos;
      if (Math.hypot(ox - this.mixer.x, oz - this.mixer.z) > T.hoseLength) this.returnShower('Шланг не достаёт — лейка вернулась на место');
      else if (input.hand) {
        const a = this.mixer, b = input.hand;
        const mid = a.clone().lerp(b, 0.5);
        mid.y = Math.min(a.y, b.y) - 0.5 - a.distanceTo(b) * 0.15; // it sags
        const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).setY(mid.y + 0.2), mid, mid.clone().lerp(b, 0.5), b]);
        this.hose.geometry.dispose();
        this.hose.geometry = new THREE.TubeGeometry(curve, 24, 0.012, 6, false);
      }
    }

    // ---- spraying
    if (held === 'shower' && input.down && input.hand) {
      if (this.energy(T.sprayCost * dt)) {
        particles.drops(input.hand, V.copy(input.dir).multiplyScalar(1).add(V2.set(0, 0.1, 0)), { n: 3, color: '#a9dcff', speed: 5, spread: 0.12, size: 0.012 });
        for (const f of g.friends) {
          const chest = V.set(f.pos[0], f.figure.pose === 'lie' ? f.y + 0.35 : 1.3, f.pos[1]);
          const to = V2.copy(chest).sub(input.origin);
          const dist = to.length();
          if (dist > T.sprayRange || to.normalize().dot(input.dir) < Math.cos(0.2)) continue;
          f.soak(dt);
          hud = { label: `Поливаешь: ${f.name}`, progress: f.wet };
        }
      }
      hud ??= { label: 'Поливаешь', progress: null };
    }

    // ---- the cat's mouse: throw it, he runs after it
    if (held === 'toy' && input.hand && !tgt?.cat) {
      if (input.pressed) g.throwToy(input.hand, input.dir);
      else hud = { label: 'ЛКМ — кинуть мышку коту', progress: null };
    }

    // ---- the bucket: fill it from the hand shower at the tub, carry it, throw the water
    if (held === 'bucket') {
      if (tgt?.tub && this.headParts?.length) {
        if (input.down) {
          this.fill += dt / TUNE.events.fillTime;
          const head = this.headParts[0].getWorldPosition(V);
          if (input.hand) particles.drops(head, V2.copy(input.hand).sub(head).normalize(), { n: 2, color: '#a9dcff', speed: 3, spread: 0.08, size: 0.012 });
          if (this.fill >= 1) {
            this.fill = 0;
            g.inv.swap('bucket', 'water');
            g.sfx.splash();
          }
        }
        hud = { label: input.down ? 'Набираешь воду…' : 'Зажми ЛКМ — набрать воды из лейки', progress: this.fill };
      } else hud = g.events.fire ? { label: 'Набери воды: ведро к ванне, ЛКМ', progress: null } : null;
    } else this.fill = 0;
    if (held === 'water') {
      if (input.pressed && input.hand) {
        particles.drops(input.hand, V.copy(input.dir).add(V2.set(0, 0.25, 0)).normalize(), { n: 70, color: '#a9dcff', speed: 4.2, spread: 0.3, size: 0.026 });
        g.sfx.splash();
        g.handAnim = 'use';
        // where the water lands: the point on the aim line nearest the fire, up to ~3 m out
        const fire = g.events.fireMesh.position;
        const t = Math.max(0.5, Math.min(3, V.copy(fire).sub(input.origin).dot(input.dir)));
        g.events.splash(V.copy(input.origin).addScaledVector(input.dir, t));
        for (const f of g.friends) {
          const to = V2.set(f.pos[0], 1.3, f.pos[1]).sub(input.origin);
          if (to.length() < 2.4 && to.normalize().dot(input.dir) > Math.cos(0.35)) f.soak(4);
        }
        g.inv.swap('water', 'bucket');
      } else hud = { label: g.events.fire ? 'ЛКМ — плеснуть на огонь' : 'ЛКМ — плеснуть водой', progress: null };
    }

    // ---- scrubbing a puddle with the rag
    const puddle = tgt?.puddle;
    if (held === 'mop' && puddle) {
      const motion = Math.hypot(input.mx, input.my);
      if (input.down && motion > 0.5 && this.energy(T.scrubCost * dt)) {
        puddle.dirt = Math.max(0, puddle.dirt - motion * T.scrubRate);
        const s = 0.35 + 0.65 * puddle.dirt;
        puddle.mesh.scale.set(puddle.sx * s, 1, puddle.sz * s);
        puddle.mesh.material.opacity = 0.3 + 0.55 * puddle.dirt;
        if (Math.random() < dt * 20) particles.puff(puddle.mesh.position.clone().setY(0.05), V.set(0, 0.2, 0), { color: '#ffffff', size0: 0.03, size1: 0.12, life: 0.6, opacity: 0.7 });
        if (puddle.dirt <= 0) g.removePuddle(puddle.mesh);
      }
      hud = { label: input.down ? 'Трёшь…' : 'Зажми ЛКМ и три мышкой', progress: 1 - puddle.dirt };
    }

    // ---- patting a coughing guy on the back
    const friend = tgt?.friend;
    if (!held && friend?.problem?.id === 'cough') {
      const p = friend.problem;
      p.pats ??= 0;
      if (input.pressed) {
        const gap = g.state.t - this.patLast;
        this.patLast = g.state.t;
        if (this.energy(T.patCost)) {
          friend.figure.play('jolt');
          g.sfx.pat();
          if (gap < 0.3) g.toastOnce('pat', 'Полегче, спокойно', 'warn', 2);
          else p.pats += 1;
          if (p.pats === 1) g.voices?.play('event_pat', { pos: friend.pos });
          if (p.pats >= T.pats) {
            friend.fun += 10;
            friend.clearProblem(true);
            friend.endActivity();
          }
        }
      }
      hud = { label: 'Хлопай ЛКМ по спине, в ритм', progress: (p.pats ?? 0) / T.pats };
    }

    // ---- shaking a sleeping guy awake: hold LMB on him (he stays grabbed while the button is down);
    // shaking the mouse left-right wakes him faster
    if (!input.down) this.grab = null;
    const sleeper = (input.down && this.grab) || (friend?.problem?.id === 'sleep' ? friend : null);
    if (!held && sleeper?.problem?.id === 'sleep') {
      const p = sleeper.problem;
      p.wake ??= 0;
      if (input.down && this.energy(T.shakeCost * dt)) {
        this.grab = sleeper;
        p.wake += dt * T.wakeHold + Math.abs(input.mx) * T.shakeRate;
        sleeper.shake = Math.min(1, (sleeper.shake ?? 0) + dt * 2 + Math.abs(input.mx) * 0.02);
      } else p.wake = Math.max(0, p.wake - dt * 0.12);
      if (p.wake >= 1) {
        this.grab = null;
        sleeper.fun += 5;
        sleeper.clearProblem(true);
        sleeper.endActivity();
        sleeper.figure.play('shout');
      }
      hud = { label: input.down ? 'Расталкиваешь… (тряси мышью — быстрее)' : 'Зажми ЛКМ — растолкать', progress: Math.min(1, p.wake) };
    }

    return hud;
  }
}
