// First-person hands: Oleg's arm holding the selected item, bobbing as he walks,
// lagging behind when he turns, lifting a bottle to his mouth, pushing forward when he does something.
// Drawn on top of everything (no depth test), so it never sinks into walls.
import * as THREE from 'three';
import { mat } from './apartment.js';
import { makeProp } from './anim.js';
import { makePlate, makeToy, makeBucket } from './figures.js';
import { moodFace, hasMoodFaces } from './faces.js';

function item(type) {
  const g = new THREE.Group();
  if (type === 'beer' || type === 'vodka') {
    const b = makeProp(type); // built along +z: stand it up in the hand
    b.rotation.x = -Math.PI / 2;
    b.position.y = 0.02;
    g.add(b);
  } else if (type === 'food') {
    const p = makePlate();
    p.scale.setScalar(1.3);
    p.position.set(-0.02, 0.05, -0.04);
    g.add(p);
  } else if (type === 'mop') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.12), mat('#d8c04e', { roughness: 1 })));
    g.children[0].position.y = 0.05;
  } else if (type === 'tools') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.03).translate(0, 0.1, 0), mat('#8a5a2c')));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.05).translate(0, 0.24, 0), mat('#9aa0a6', { metalness: 0.7, roughness: 0.3 })));
  } else if (type === 'shower') {
    // hand shower: handle in the fist, the head pointing forward
    const metal = mat('#b9bec4', { metalness: 0.7, roughness: 0.3 });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.2, 10).rotateX(Math.PI / 2).translate(0, 0, -0.06), metal));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.035, 16).rotateX(Math.PI / 2).translate(0, 0.015, -0.18), metal));
  } else if (type === 'pelmeni') {
    // a pack of frozen pelmeni
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.05).translate(0, 0.08, 0), mat('#e8eef8', { roughness: 0.6 })));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.161, 0.07, 0.051).translate(0, 0.12, 0), mat('#2f5fb8')));
  } else if (type === 'bucket' || type === 'water') {
    // held by the handle, hanging below the fist
    const b = makeBucket();
    b.userData.water.visible = type === 'water';
    b.scale.setScalar(0.9);
    b.position.set(0.02, -0.3, -0.02);
    g.add(b);
  } else if (type === 'toy') {
    const t = makeToy();
    t.scale.setScalar(1.4);
    t.position.y = 0.03;
    g.add(t);
  }
  return g;
}

// The cat in Oleg's arms: not the floor cat shrunk, but a cat made for this view. A round fluffy body
// across the bottom of the screen, his real face turned to Oleg, the tail hanging over the right arm,
// both forearms under him. He breathes and flicks the tail.
function heldCat() {
  const g = new THREE.Group();
  const fur = mat('#231b17', { roughness: 1 });
  const furLight = mat('#3a2e27', { roughness: 1 });
  const ball = (r, sx, sy, sz, x, y, z, m = fur) => {
    const o = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m);
    o.scale.set(sx, sy, sz);
    o.position.set(x, y, z);
    return o;
  };
  const body = new THREE.Group();
  body.add(ball(1, 0.2, 0.12, 0.14, 0.03, 0, 0));
  for (const [x, y, z, r] of [[0.15, 0.02, 0.02, 0.075], [-0.06, 0.04, 0.03, 0.08], [0.07, 0.06, -0.02, 0.07], [-0.12, -0.01, 0.05, 0.07]]) body.add(ball(r, 1, 0.9, 1, x, y, z, Math.random() < 0.5 ? fur : furLight));
  g.add(body);
  // the head: a dark fluffy ball, his photo face on the front
  const head = new THREE.Group();
  head.position.set(-0.17, 0.07, 0.06);
  head.add(ball(0.09, 1, 0.92, 0.9, 0, 0, -0.01));
  if (hasMoodFaces('cat')) {
    moodFace('cat', 'default').then((f) => {
      const tex = new THREE.CanvasTexture(f.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const h = 0.22;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(h * f.aspect, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05 }));
      face.position.set(0, 0.02, 0.06);
      face.renderOrder = 101;
      face.material.depthTest = false;
      face.material.depthWrite = false;
      head.add(face);
    });
  }
  g.add(head);
  // the tail over the right forearm, in three segments so it can curl
  const tail = new THREE.Group();
  tail.position.set(0.21, 0.01, 0);
  let seg = tail;
  const segs = [];
  for (let i = 0; i < 3; i++) {
    const s2 = new THREE.Group();
    s2.add(ball(0.035 - i * 0.006, 1, 2.2, 1, 0, -0.06, 0));
    s2.position.y = i ? -0.11 : 0;
    s2.rotation.z = 0.5;
    seg.add(s2);
    segs.push(s2);
    seg = s2;
  }
  g.add(tail);
  // Oleg's forearms under him
  const sleeve = mat('#3a3f52'), skin = mat('#e2b594', { roughness: 0.7 });
  for (const [sx, ry] of [[-1, 0.5], [1, -0.4]]) {
    const fa = new THREE.Group();
    fa.position.set(sx * 0.28, -0.13, 0.12);
    fa.rotation.set(0.2, ry, 0);
    fa.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.4).translate(0, 0, 0.05), sleeve));
    fa.add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.12).translate(-sx * 0.02, 0.02, -0.19), skin));
    g.add(fa);
  }
  g.userData.anim = (t) => {
    body.scale.y = 1 + Math.sin(t * 2.2) * 0.04; // breathing
    head.rotation.z = Math.sin(t * 0.7) * 0.08;
    head.rotation.y = Math.sin(t * 0.43) * 0.15;
    const flick = Math.max(0, Math.sin(t * 0.9)) ** 6;
    segs.forEach((sg, i) => (sg.rotation.z = 0.45 + Math.sin(t * 1.6 - i * 0.7) * 0.15 + flick * 0.5 * (i + 1)));
  };
  return g;
}

export function createViewmodel(camera) {
  const root = new THREE.Group();
  camera.add(root);
  const arm = new THREE.Group();
  root.add(arm);
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.42).translate(0, 0, 0.19), mat('#3a3f52'));
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.1), mat('#e2b594', { roughness: 0.7 }));
  hand.position.z = -0.03;
  arm.add(sleeve, hand);
  const holder = new THREE.Group();
  holder.position.set(0, 0.03, -0.03);
  arm.add(holder);
  const cat = heldCat(); // the cat is held with both arms: its own rig instead of the one-hand arm
  cat.visible = false;
  root.add(cat);
  let catT = 0;

  const items = {};
  let current = null, shown = null;
  let swap = 0; // 0..1 lowered while switching
  let anim = null; // { name, t, dur }
  let bob = 0;
  let away = 1; // empty hands drop out of view; they come up only to do something
  let lastYaw = null, lastPitch = null;
  const lag = { x: 0, y: 0 };

  const noDepth = (o) =>
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.material = m.material.clone();
      m.material.depthTest = false;
      m.material.depthWrite = false;
      m.renderOrder = 100;
    });
  noDepth(arm);
  noDepth(cat);

  const tipLocal = new THREE.Vector3(0, 0.015, -0.21);
  const act = { spray: 0, scrub: 0, shake: 0, sx: 0, sy: 0 };
  return {
    root,
    // where water comes out of the shower head (world space)
    tip(out = new THREE.Vector3()) {
      holder.updateWorldMatrix(true, false);
      return holder.localToWorld(out.copy(tipLocal));
    },
    // continuous hand motions: spraying (arm pushed forward), scrubbing (follows the mouse), shaking
    setActivity({ spray = false, scrub = 0, shake = 0, mx = 0, my = 0 } = {}) {
      act.spray += ((spray ? 1 : 0) - act.spray) * 0.25;
      act.scrub = scrub;
      act.shake = shake;
      act.sx = Math.max(-0.08, Math.min(0.08, act.sx * 0.8 + mx * 0.004));
      act.sy = Math.max(-0.06, Math.min(0.06, act.sy * 0.8 + my * 0.004));
    },
    play(name) {
      anim = { name, t: 0, dur: name === 'drink' ? 1.3 : 0.45 };
    },
    update(dt, { item: type, moving = false, speed = 1, drunk = 0, visible = true, yaw = 0, pitch = 0 }) {
      root.visible = visible;
      if (!visible) return;
      // switching items: lower the hand, swap, raise it back
      if (type !== current) {
        current = type;
        swap = 1;
      }
      swap = Math.max(0, swap - dt * 4);
      if (swap < 0.5 && shown !== current) {
        if (shown && items[shown]) items[shown].visible = false;
        shown = current;
        if (shown && shown !== 'cat' && !items[shown]) {
          items[shown] = item(shown);
          noDepth(items[shown]);
          holder.add(items[shown]);
        }
        if (shown && items[shown]) items[shown].visible = true;
      }
      const lowered = Math.sin(Math.min(1, swap) * Math.PI);
      // bob while walking, breathe while standing
      bob += dt * (moving ? 8 * speed : 1.6);
      const by = moving ? Math.abs(Math.sin(bob)) * 0.018 : Math.sin(bob) * 0.004;
      const bx = moving ? Math.cos(bob) * 0.012 : 0;
      // lag behind the camera turning
      if (lastYaw !== null) {
        const dyaw = Math.atan2(Math.sin(yaw - lastYaw), Math.cos(yaw - lastYaw));
        lag.x += (Math.max(-0.08, Math.min(0.08, dyaw * 0.6)) - lag.x) * Math.min(1, dt * 10);
        lag.y += (Math.max(-0.06, Math.min(0.06, (pitch - lastPitch) * 0.6)) - lag.y) * Math.min(1, dt * 10);
      }
      lastYaw = yaw;
      lastPitch = pitch;
      lag.x *= 1 - Math.min(1, dt * 6);
      lag.y *= 1 - Math.min(1, dt * 6);
      // one-shot actions
      let ax = 0, ay = 0, az = 0, rx = 0, rz = 0;
      if (anim) {
        anim.t += dt;
        const k = Math.sin(Math.min(1, anim.t / anim.dur) * Math.PI);
        if (anim.name === 'drink') {
          ax = -0.2 * k;
          ay = 0.2 * k;
          az = 0.12 * k;
          rx = 1.1 * k;
          rz = 0.4 * k;
        } else {
          az = -0.12 * k;
          ay = 0.03 * k;
          rx = -0.3 * k;
        }
        if (anim.t >= anim.dur) anim = null;
      }
      const empty = !shown;
      away += ((empty && !act.shake && !anim ? 1 : 0) - away) * Math.min(1, dt * 8);
      const d = drunk / 100;
      // hands-on motions: push forward to spray, follow the mouse when scrubbing or shaking someone
      const hx = (act.scrub > 0 || act.shake > 0 ? act.sx : 0) + act.shake * Math.sin(bob * 12) * 0.03;
      const hy = (act.scrub > 0 ? -act.sy - 0.12 : 0) + (empty && act.shake > 0 ? 0.1 : 0);
      arm.position.set(
        0.24 + bx + lag.x + ax + hx - act.spray * 0.08 + Math.sin(bob * 0.3) * d * 0.03,
        -0.26 - by - lowered * 0.3 + lag.y + ay - away * 0.4 + hy + act.spray * 0.06,
        -0.42 + az - act.spray * 0.1 - (act.scrub > 0 ? 0.1 : 0),
      );
      arm.rotation.set(0.12 + rx - act.spray * 0.15 + (act.scrub > 0 ? -0.6 : 0), -0.18 + act.spray * 0.1, rz + Math.sin(bob * 0.25) * d * 0.1);
      // holding the cat: both arms, the one-hand arm is out of the way
      const holding = shown === 'cat';
      cat.visible = holding;
      arm.visible = !holding;
      if (holding) {
        catT += dt;
        cat.userData.anim(catT);
        cat.position.set(0.02 + bx * 0.6 + lag.x * 0.6, -0.27 - by * 0.7 - lowered * 0.35 + lag.y * 0.6 + (anim ? 0.04 * Math.sin(Math.min(1, anim.t / anim.dur) * Math.PI) : 0), -0.7);
        cat.scale.setScalar(0.85);
        cat.rotation.set(0.35, 0.08 + Math.sin(bob * 0.3) * d * 0.05, Math.sin(bob * 0.5) * 0.02);
      }
    },
  };
}
