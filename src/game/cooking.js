// Pelmeni, hands-on and in 3D. The camera flies down to the pot, the mouse moves real objects:
//   cook:  shake the salt cellar over the pot (move the mouse up and down), then stir with the ladle
//          in circles; the pelmeni swirl with you. Then they boil on the stove.
//   drain: the pot over the sink; hold the button and move right to tilt it. Water pours out;
//          tip it too far or too fast and pelmeni slide out into the sink.
import * as THREE from 'three';
import { mat } from '../world/apartment.js';
import { particles } from '../world/particles.js';

const TAU = Math.PI * 2;
const V = new THREE.Vector3();
const PELMENI = 12;
const R = 0.11; // pot inner radius

function pelmenMesh() {
  const g = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 10, 6, 0, TAU, 0, Math.PI / 2).scale(1.2, 0.6, 0.8),
    mat('#f4ecd6', { roughness: 0.7 }),
  );
  return g;
}

export class Cooking {
  constructor(game) {
    this.game = game;
    const s = game.furn.items.stove, k = game.furn.items.sink;
    // which way the stove / sink face into the kitchen (world)
    const front = (it) => ({ '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] })[it.facing];
    this.stove = { c: new THREE.Vector3((s.x0 + s.x1) / 2, 0.89, (s.z0 + s.z1) / 2), f: front(s) };
    this.sink = { c: new THREE.Vector3((k.x0 + k.x1) / 2, 0.87, (k.z0 + k.z1) / 2), f: front(k) };

    // the pot: body, water and pelmeni
    const pot = new THREE.Group();
    const steel = mat('#c3c7cc', { metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide });
    pot.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.005, 0.16, 24, 1, true).translate(0, 0.08, 0), steel));
    pot.add(new THREE.Mesh(new THREE.CircleGeometry(R + 0.005, 24).rotateX(-Math.PI / 2).translate(0, 0.002, 0), steel));
    for (const sx of [-1, 1]) pot.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.015, 0.03).translate(sx * (R + 0.035), 0.14, 0), mat('#222')));
    const water = new THREE.Mesh(new THREE.CircleGeometry(R, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8cc3dc', transparent: true, opacity: 0.8, roughness: 0.1 }));
    water.position.y = 0.12;
    pot.add(water);
    this.pel = [];
    for (let i = 0; i < PELMENI; i++) {
      const m = pelmenMesh();
      const p = { mesh: m, a: Math.random() * TAU, r: 0.02 + Math.random() * 0.075, rot: Math.random() * TAU, inPot: true, v: new THREE.Vector3() };
      pot.add(m);
      this.pel.push(p);
    }
    pot.visible = false;
    game.dynamic.add(pot);
    this.pot = pot;
    this.water = water;
    this.swirl = 0;

    this.shaker = new THREE.Group();
    this.shaker.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.09, 12).translate(0, 0.045, 0), mat('#f5f2ea')));
    this.shaker.add(new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.02, 12).translate(0, 0.1, 0), mat('#b9bec6', { metalness: 0.6 })));
    this.shaker.rotation.x = Math.PI; // upside down, holes to the pot
    this.ladle = new THREE.Group();
    this.ladle.add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8, 0, TAU, Math.PI / 2, Math.PI / 2), mat('#b9bec6', { metalness: 0.7, side: THREE.DoubleSide })));
    this.ladle.add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.34).translate(0, 0.17, 0).rotateZ(-0.5), mat('#6e4a2c')));
    for (const o of [this.shaker, this.ladle]) {
      o.visible = false;
      game.dynamic.add(o);
    }
    this.focus = null;
  }

  // where the camera goes for each stage
  camFor(kind) {
    const b = kind === 'drain' ? this.sink : this.stove;
    const [fx, fz] = b.f;
    return kind === 'drain'
      ? { pos: new THREE.Vector3(b.c.x + fx * 0.75, 1.45, b.c.z + fz * 0.75 + 0.05), look: new THREE.Vector3(b.c.x, 1.05, b.c.z) }
      : { pos: new THREE.Vector3(b.c.x + fx * 0.32, 1.55, b.c.z + fz * 0.32), look: new THREE.Vector3(b.c.x, 0.95, b.c.z) };
  }

  potOnStove() {
    this.pot.visible = true;
    this.pot.position.copy(this.stove.c);
    this.pot.rotation.set(0, 0, 0);
    this.water.visible = true;
    this.water.scale.setScalar(1);
    this.water.position.y = 0.12;
    for (const p of this.pel) {
      p.inPot = true;
      if (p.mesh.parent !== this.pot) this.pot.add(p.mesh);
    }
  }

  start(kind, done) {
    if (kind === 'cook') this.potOnStove();
    this.focus = { kind, stage: kind === 'cook' ? 'salt' : 'drain', done, salt: 0, turns: 0, lastAng: null, tilt: 0, target: 0, grabX: null, water: 1, cam: this.camFor(kind), t: 0, finished: 0 };
    if (kind === 'drain') {
      // lift the pot over the sink
      this.pot.position.copy(this.sink.c).add(V.set(0, 0.28, 0));
      this.pot.rotation.set(0, 0, 0);
    }
    this.shaker.visible = kind === 'cook';
    this.ladle.visible = false;
    return this.focus;
  }

  cancel() {
    if (!this.focus) return;
    const kind = this.focus.kind;
    this.end();
    if (kind === 'drain') this.potOnStove(); // put it back, still full
    else this.pot.visible = false;
  }

  end() {
    this.focus = null;
    this.shaker.visible = this.ladle.visible = false;
  }

  hint() {
    const f = this.focus;
    if (!f) return null;
    return (
      {
        salt: 'Посоли: тряси солонку над кастрюлей (мышь вверх-вниз)',
        stir: 'Помешай: зажми ЛКМ и води ложкой по кругу',
        drain: 'Зажми ЛКМ и веди вправо — наклон. Резко или слишком круто — пельмени в раковину',
      }[f.stage] ?? ''
    );
  }

  progress() {
    const f = this.focus;
    if (!f) return 0;
    if (f.stage === 'salt') return (f.salt / 40) * 0.5;
    if (f.stage === 'stir') return 0.5 + Math.min(1, f.turns / 3) * 0.5;
    return 1 - f.water;
  }

  // point: mouse ray hit on a horizontal plane (world); dy: mouse vertical movement this frame (px)
  update(dt, { ray, down, dx, dy }) {
    const f = this.focus;
    // pelmeni always float and swirl in the pot
    this.swirl *= Math.exp(-dt * 1.2);
    for (const p of this.pel) {
      if (!p.inPot) continue;
      p.a += (0.25 + this.swirl) * dt * (0.09 / (p.r + 0.03));
      p.rot += dt * (0.4 + this.swirl * 3);
      p.mesh.position.set(Math.cos(p.a) * p.r, this.water.visible ? this.water.position.y + 0.004 + Math.sin(p.a * 3 + p.rot) * 0.003 : 0.02, Math.sin(p.a) * p.r);
      p.mesh.rotation.set(0, p.rot, 0);
    }
    if (!f) return;
    f.t += dt;
    const c = this.pot.position;
    const hitPlane = (y) => {
      const t = (y - ray.origin.y) / ray.direction.y;
      return t > 0 ? ray.origin.clone().addScaledVector(ray.direction, t) : null;
    };

    if (f.stage === 'salt') {
      const p = hitPlane(c.y + 0.32);
      if (p) this.shaker.position.lerp(p, Math.min(1, dt * 18));
      this.shaker.rotation.z = Math.max(-0.4, Math.min(0.4, dy * 0.02));
      const shake = Math.abs(dy) / Math.max(dt, 1e-3);
      if (shake > 400 && Math.random() < Math.min(1, dt * shake / 60)) {
        particles.drops(this.shaker.position.clone().add(V.set(0, -0.12, 0)), V.set(0, -0.3, 0), { n: 3, color: '#ffffff', speed: 1.2, spread: 0.3, size: 0.005 });
        if (Math.hypot(this.shaker.position.x - c.x, this.shaker.position.z - c.z) < R) f.salt += 1;
      }
      if (f.salt >= 40) {
        f.stage = 'stir';
        this.shaker.visible = false;
        this.ladle.visible = true;
      }
    } else if (f.stage === 'stir') {
      const p = hitPlane(c.y + 0.13);
      if (p) {
        const off = V.set(p.x - c.x, 0, p.z - c.z);
        if (off.length() > R - 0.02) off.setLength(R - 0.02);
        this.ladle.position.set(c.x + off.x, c.y + 0.13, c.z + off.z);
        const d = off.length(), ang = Math.atan2(off.z, off.x);
        if (down && d > 0.03) {
          if (f.lastAng !== null) {
            let da = ang - f.lastAng;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            f.turns += Math.abs(da) / TAU;
            this.swirl = Math.min(4, this.swirl + Math.abs(da) * 2);
          }
          f.lastAng = ang;
        } else f.lastAng = null;
      }
      if (f.turns >= 3) this.finish(1);
    } else if (f.stage === 'drain') {
      // tilt toward the sink with the mouse
      if (down) {
        f.target = Math.max(0, Math.min(1.7, f.target + dx * 0.004));
      } else f.target = Math.max(0, f.target - dt * 1.5);
      const prev = f.tilt;
      f.tilt += (f.target - f.tilt) * Math.min(1, dt * 8);
      const speed = Math.abs(f.tilt - prev) / Math.max(dt, 1e-3);
      const [fx, fz] = this.sink.f;
      // rotate around the horizontal axis across the sink front
      this.pot.rotation.set(fz * f.tilt, 0, -fx * f.tilt);
      const lip = c.clone().add(V.set(-fx * R, 0.15, -fz * R));
      if (f.tilt > 0.45 && f.water > 0) {
        const flow = (f.tilt - 0.45) / 0.8;
        f.water = Math.max(0, f.water - flow * dt * 0.4);
        particles.drops(lip, V.set(-fx * 0.4, -0.5, -fz * 0.4), { n: 3, color: '#a9dcff', speed: 1.2, spread: 0.3, size: 0.01 });
      }
      this.water.scale.setScalar(0.35 + 0.65 * f.water);
      this.water.position.y = 0.03 + 0.09 * f.water;
      this.water.visible = f.water > 0.02;
      // too steep or too jerky: a pelmen slides out
      const risk = (f.tilt > 1.05 ? (f.tilt - 1.05) * 3 : 0) + (speed > 2.5 && f.tilt > 0.5 ? 0.8 : 0);
      const inside = this.pel.filter((p) => p.inPot);
      if (inside.length && Math.random() < risk * dt * 3) {
        const p = inside[Math.floor(Math.random() * inside.length)];
        p.inPot = false;
        const wp = p.mesh.getWorldPosition(new THREE.Vector3());
        this.game.dynamic.attach(p.mesh);
        p.mesh.position.copy(lip).lerp(wp, 0.3);
        p.v.set(-fx * 0.5, 0.2, -fz * 0.5);
        this.game.toastOnce('pelmen', 'Пельмень улетел в раковину!', 'bad', 1.5);
      }
      if (f.water <= 0.02 && f.tilt < 0.25) this.finish(this.pel.filter((p) => p.inPot).length / PELMENI);
    }
    // fallen pelmeni drop into the sink
    for (const p of this.pel) {
      if (p.inPot || p.mesh.parent !== this.game.dynamic) continue;
      if (p.mesh.position.y > this.sink.c.y - 0.12) {
        p.v.y -= 9.8 * dt;
        p.mesh.position.addScaledVector(p.v, dt);
      }
    }
  }

  finish(score) {
    const f = this.focus;
    this.end();
    if (f.kind === 'drain') {
      this.pot.visible = false;
      for (const p of this.pel) if (!p.inPot) this.game.dynamic.remove(p.mesh);
    }
    f.done(score);
  }
}
