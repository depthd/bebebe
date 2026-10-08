// Active ragdolls: the guys are physical bodies (cannon-es). Eleven rigid parts on ball joints; motors in
// every joint (PD torques) try to follow the pose the animation wants, a "cerebellum" keeps the pelvis
// upright and at standing height, a soft pull walks it to where the guy wants to be. Drunk = weak motors,
// a weak cerebellum and random shoves: he lurches, stumbles, catches himself or goes down for real, then
// struggles back up like an early walking robot. Sitting / lying poses stay kinematic (physics off).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DIM } from './anim.js';

export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.8, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 12;
world.defaultContactMaterial.friction = 0.6;
world.defaultContactMaterial.restitution = 0.05;

const G_STATIC = 1, G_OLEG = 32;
const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), collisionFilterGroup: G_STATIC, collisionFilterMask: -1 });
ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(ground);

// walls and furniture as static boxes (doors switch on and off with their colliders)
const doorBodies = [];
export function addStatics(colliders, height) {
  for (const c of colliders) {
    let body;
    if (c.seg) {
      const [ax, az, bx, bz] = c.seg;
      const len = Math.hypot(bx - ax, bz - az);
      body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(len / 2, height / 2, c.r)) });
      body.position.set((ax + bx) / 2, height / 2, (az + bz) / 2);
      body.quaternion.setFromEuler(0, -Math.atan2(bz - az, bx - ax), 0);
    } else {
      const hx = (c.x1 - c.x0) / 2, hz = (c.z1 - c.z0) / 2;
      if (hx <= 0 || hz <= 0) continue;
      body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, height / 2, hz)) });
      body.position.set((c.x0 + c.x1) / 2, height / 2, (c.z0 + c.z1) / 2);
    }
    body.collisionFilterGroup = G_STATIC;
    body.collisionFilterMask = -1;
    world.addBody(body);
    if (c.enabled !== undefined || c.floor) doorBodies.push({ c, body });
  }
}

// Oleg: a kinematic capsule that shoves people for real
const oleg = new CANNON.Body({ type: CANNON.Body.KINEMATIC, collisionFilterGroup: G_OLEG, collisionFilterMask: -1 });
oleg.addShape(new CANNON.Sphere(0.22), new CANNON.Vec3(0, 0.45, 0));
oleg.addShape(new CANNON.Sphere(0.22), new CANNON.Vec3(0, 1.0, 0));
oleg.addShape(new CANNON.Sphere(0.18), new CANNON.Vec3(0, 1.45, 0));
world.addBody(oleg);

const PARTS = {
  // name: [half extents, center (in the standing rest pose, pelvis at DIM.hip), mass, parent, joint pivot]
  pelvis: [[0.16, 0.08, 0.1], [0, DIM.hip - 0.04, 0], 10, null, null],
  torso: [[0.18, 0.3, 0.105], [0, DIM.hip + 0.27, 0], 20, 'pelvis', [0, DIM.hip, 0]],
  head: [[0.14, 0.15, 0.13], [0, DIM.hip + DIM.neckY + 0.17, 0], 5, 'torso', [0, DIM.hip + DIM.neckY, 0]],
};
for (const [i, s] of [[0, -1], [1, 1]]) {
  PARTS[`thigh${i}`] = [[0.065, DIM.thigh / 2, 0.075], [s * 0.085, DIM.hip - DIM.thigh / 2, 0], 7, 'pelvis', [s * 0.085, DIM.hip, 0]];
  PARTS[`shin${i}`] = [[0.06, DIM.shin / 2, 0.07], [s * 0.085, DIM.hip - DIM.thigh - DIM.shin / 2, 0], 4, `thigh${i}`, [s * 0.085, DIM.hip - DIM.thigh, 0]];
  PARTS[`upper${i}`] = [[0.048, DIM.upper / 2, 0.052], [s * DIM.shoulderX, DIM.hip + DIM.shoulderY - DIM.upper / 2, 0], 2.5, 'torso', [s * DIM.shoulderX, DIM.hip + DIM.shoulderY, 0]];
  PARTS[`fore${i}`] = [[0.043, (DIM.fore + 0.09) / 2, 0.048], [s * DIM.shoulderX, DIM.hip + DIM.shoulderY - DIM.upper - (DIM.fore + 0.09) / 2, 0], 1.8, `upper${i}`, [s * DIM.shoulderX, DIM.hip + DIM.shoulderY - DIM.upper, 0]];
}
// motor stiffness per joint as a natural frequency (rad/s): torque = I (w0^2 err - 2 zeta w0 relSpeed),
// scaled by the part's own inertia so the controller is stable for light parts too
const W0 = { torso: 13, head: 9, thigh0: 13, thigh1: 13, shin0: 13, shin1: 13, upper0: 7, upper1: 7, fore0: 6, fore1: 6 };
const inertia = (b) => (b.inertia.x + b.inertia.y + b.inertia.z) / 3;

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), qy = new THREE.Quaternion();
const va = new THREE.Vector3(), vb = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const toT = (q, out = new THREE.Quaternion()) => out.set(q.x, q.y, q.z, q.w);

// error rotation from current to wanted, as a torque axis*angle
function errTorque(qWant, qNow, out) {
  qc.copy(qWant).multiply(qb.copy(qNow).invert());
  if (qc.w < 0) qc.set(-qc.x, -qc.y, -qc.z, -qc.w);
  const s = Math.sqrt(Math.max(0, 1 - qc.w * qc.w));
  const angle = 2 * Math.acos(Math.min(1, qc.w));
  if (s < 1e-4) return out.set(0, 0, 0);
  return out.set(qc.x / s, qc.y / s, qc.z / s).multiplyScalar(angle);
}

let bit = 2;
export class Ragdoll {
  constructor(rig) {
    this.rig = rig;
    this.group = bit;
    bit = bit === 16 ? 2 : bit * 2;
    this.bodies = {};
    for (const [name, [he, c, mass]] of Object.entries(PARTS)) {
      const b = new CANNON.Body({ mass, linearDamping: 0.05, angularDamping: 0.3, collisionFilterGroup: this.group, collisionFilterMask: -1 ^ this.group });
      b.addShape(new CANNON.Box(new CANNON.Vec3(...he)));
      if (name.startsWith('shin')) b.addShape(new CANNON.Box(new CANNON.Vec3(0.06, 0.03, 0.125)), new CANNON.Vec3(0, -he[1] - 0.02, 0.05)); // the foot
      b.rest = new CANNON.Vec3(...c);
      this.bodies[name] = b;
    }
    this.joints = [];
    for (const [name, [, c, , parent, pivot]] of Object.entries(PARTS)) {
      if (!parent) continue;
      const a = this.bodies[parent], b = this.bodies[name];
      const pc = PARTS[parent][1];
      const ca = new CANNON.PointToPointConstraint(a, new CANNON.Vec3(pivot[0] - pc[0], pivot[1] - pc[1], pivot[2] - pc[2]), b, new CANNON.Vec3(pivot[0] - c[0], pivot[1] - c[1], pivot[2] - c[2]));
      this.joints.push({ name, parent, c: ca });
    }
    this.active = false;
    this.targets = {};
    this.kin = null;
    this.limp = 0; // 0 normal .. 1 a rag
    this.assist = 0; // getting up: extra help from the cerebellum
    this.swayAmp = 45; // how hard the room sways for a fully drunk guy (m/s^2 on the upper body)
  }

  // rig joint for a body
  joint(name) {
    const r = this.rig;
    if (name === 'pelvis') return r.pelvis;
    if (name === 'torso') return r.spine;
    if (name === 'head') return r.neck;
    const i = Number(name.at(-1));
    if (name.startsWith('thigh')) return r.legs[i].hip;
    if (name.startsWith('shin')) return r.legs[i].knee;
    if (name.startsWith('upper')) return r.arms[i].shoulder;
    return r.arms[i].elbow;
  }

  // put the bodies in the standing pose at (x, z) facing yaw, and switch physics on
  enable(x, z, yaw) {
    if (this.active) return;
    qy.setFromAxisAngle(up, yaw);
    for (const b of Object.values(this.bodies)) {
      va.set(b.rest.x, b.rest.y, b.rest.z).applyQuaternion(qy);
      b.position.set(x + va.x, va.y, z + va.z);
      b.quaternion.set(qy.x, qy.y, qy.z, qy.w);
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      world.addBody(b);
    }
    for (const j of this.joints) world.addConstraint(j.c);
    this.active = true;
    this.limp = 0;
    this.yawNow = yaw;
  }

  disable() {
    if (!this.active) return;
    for (const b of Object.values(this.bodies)) world.removeBody(b);
    for (const j of this.joints) world.removeConstraint(j.c);
    this.active = false;
  }

  // the animation's own joint state (so its springs don't fight the physics)
  restore() {
    if (!this.kin) return;
    for (const [name, q] of Object.entries(this.kin.q)) this.joint(name).quaternion.copy(q);
    this.rig.pelvis.position.copy(this.kin.pelvisPos);
  }

  // after the animation ran: what it wants each joint to be
  capture(yaw) {
    this.kin ??= { q: {}, pelvisPos: new THREE.Vector3() };
    for (const name of Object.keys(PARTS)) (this.kin.q[name] ??= new THREE.Quaternion()).copy(this.joint(name).quaternion);
    this.kin.pelvisPos.copy(this.rig.pelvis.position);
    this.yaw = yaw;
  }

  get pelvis() {
    return this.bodies.pelvis.position;
  }

  // torso's up vector dot world up: < 0.45 = on the floor
  get upright() {
    return va.set(0, 1, 0).applyQuaternion(toT(this.bodies.torso.quaternion, qa)).y;
  }

  // a shove: dir (world angle), strength in m/s on the torso
  push(dir, strength) {
    const t = this.bodies.torso;
    t.applyImpulse(new CANNON.Vec3(Math.sin(dir) * strength * t.mass, 0, Math.cos(dir) * strength * t.mass));
  }

  // per physics tick: motors, cerebellum, walking pull, drunk shoves
  control(target, drunk, walking, h = 1 / 180) {
    if (!this.active || !this.kin) return;
    if (this.grace > 0) {
      // just got up: the help fades out over a couple of seconds
      this.grace -= h;
      this.assist = Math.max(0, 0.8 * (this.grace / 2));
    }
    const d = Math.min(1, drunk);
    this.stun = Math.max(0, (this.stun ?? 0) - h);
    const limp = Math.max(this.limp, this.stun > 0 ? 0.7 : 0);
    const strength = Math.max(0.02, (1 - 0.4 * d) * (1 - limp) + this.assist);
    const zeta = 1 - 0.45 * d; // drunk: springy, overshooting joints
    const B = this.bodies;
    const F = this.flags ?? {}; // debugging: switch parts of the controller off
    // joints: the child chases (parent * what the animation wants)
    if (F.joints !== false) for (const j of this.joints) {
      if (F.only && !j.name.startsWith(F.only)) continue;
      const a = B[j.parent], b = B[j.name];
      const arm = j.name.startsWith('upper') || j.name.startsWith('fore');
      const w0 = W0[j.name] * Math.sqrt(strength) * (arm ? 1 - 0.4 * d : 1);
      // the motor turns both parts: size it on the pair's reduced inertia so the light one doesn't blow up
      const Ia = inertia(a), Ib = inertia(b), I = ((Ia * Ib) / (Ia + Ib)) * 1.6;
      toT(a.quaternion, qa).multiply(this.kin.q[j.name]);
      errTorque(qa, toT(b.quaternion, qb), va).multiplyScalar(I * w0 * w0);
      vb.set(b.angularVelocity.x - a.angularVelocity.x, b.angularVelocity.y - a.angularVelocity.y, b.angularVelocity.z - a.angularVelocity.z).multiplyScalar(I * 2 * zeta * w0);
      va.sub(vb).clampLength(0, 120); // a motor has a limit
      b.torque.x += va.x; b.torque.y += va.y; b.torque.z += va.z;
      a.torque.x -= va.x; a.torque.y -= va.y; a.torque.z -= va.z;
    }
    // safety: no part spins or flies faster than a body can (keeps the solver sane)
    for (const b of Object.values(B)) {
      const w = b.angularVelocity, v = b.velocity;
      const wl = Math.hypot(w.x, w.y, w.z), vl = Math.hypot(v.x, v.y, v.z);
      if (wl > 25) w.scale(25 / wl, w);
      if (vl > 12) v.scale(12 / vl, v);
    }
    // cerebellum: pelvis and torso held upright in the world, turning towards where he wants to face
    // at a body's pace (an instant 180 would yank him off his feet)
    this.yawNow ??= this.yaw ?? 0;
    let dy = (this.yaw ?? 0) - this.yawNow;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yawNow += Math.max(-1 / 30, Math.min(1 / 30, dy)); // ~6 rad/s at 180 Hz
    qy.setFromAxisAngle(up, this.yawNow).multiply(this.kin.q.pelvis);
    const wr = 11 * Math.sqrt(strength) * (1 - 0.2 * d);
    if (F.upright !== false) for (const [body, q, mul] of [[B.pelvis, qy, 3], [B.torso, qa.copy(qy).multiply(this.kin.q.torso), 6]]) {
      const I = inertia(body) * mul;
      errTorque(q, toT(body.quaternion, qb), va).multiplyScalar(I * wr * wr);
      body.torque.x += va.x - body.angularVelocity.x * I * 2 * zeta * wr;
      body.torque.y += va.y - body.angularVelocity.y * I * 2 * zeta * wr;
      body.torque.z += va.z - body.angularVelocity.z * I * 2 * zeta * wr;
    }
    // legs hold the weight: a spring on the pelvis height plus his weight (buckles when drunk / limp)
    const P = B.pelvis, M = 65;
    const want = this.kin.pelvisPos.y - 0.04;
    const wy = 9 * Math.sqrt(strength);
    const fy = M * (wy * wy * (want - P.position.y) - 2 * wy * P.velocity.y) + M * 9.8 * Math.min(1, strength);
    if (F.support !== false) P.force.y += Math.max(0, Math.min(M * 25, fy));
    // walk to where the game logic says he is
    const wx = 4 * Math.sqrt(strength) * (1 - 0.35 * d);
    if (F.drive !== false) {
      // the whole body is pulled along (each part by its mass), so walking itself doesn't tip him
      let ax = wx * wx * (target[0] - P.position.x) - 2 * wx * P.velocity.x;
      let az = wx * wx * (target[1] - P.position.z) - 2 * wx * P.velocity.z;
      const al = Math.hypot(ax, az);
      if (al > 6) (ax *= 6 / al), (az *= 6 / al);
      for (const b of Object.values(B)) {
        b.force.x += b.mass * ax;
        b.force.z += b.mass * az;
      }
    }
    // drunk: the room sways. A slow drift (seconds, not jitter) leans him one way, then another;
    // past a point the motors can't win and down he goes
    const sw = (this.sway ??= { x: 0, z: 0 });
    const tau = 0.8;
    sw.x += (-sw.x / tau) * h + (Math.random() - 0.5) * 2 * Math.sqrt(h) * 1.6;
    sw.z += (-sw.z / tau) * h + (Math.random() - 0.5) * 2 * Math.sqrt(h) * 1.6;
    const amp = this.swayAmp * (0.25 * d + 0.75 * d * d * d) * (walking ? 1.3 : 1) * (1 - this.limp);
    const T = B.torso, H = B.head;
    T.force.x += T.mass * amp * sw.x;
    T.force.z += T.mass * amp * sw.z;
    H.force.x += H.mass * amp * sw.x;
    H.force.z += H.mass * amp * sw.z;
  }

  // draw the rig from the bodies
  sync(figure) {
    if (!this.active) return;
    const B = this.bodies, r = this.rig;
    const root = figure.root;
    root.position.set(B.pelvis.position.x, 0, B.pelvis.position.z);
    root.rotation.set(0, 0, 0);
    figure.setLean?.(0, 0);
    figure.body.rotation.set(0, 0, 0);
    figure.body.position.set(0, 0, 0);
    // pelvis: world pose (root, tilt and body are identity); the group's origin is the hip point
    const qp = toT(B.pelvis.quaternion, qa);
    va.set(0, 0.04, 0).applyQuaternion(qp);
    r.pelvis.position.set(0, B.pelvis.position.y + va.y, 0);
    r.pelvis.position.x = va.x;
    r.pelvis.position.z = va.z;
    r.pelvis.quaternion.copy(qp);
    for (const j of this.joints) {
      const qParent = toT(B[j.parent].quaternion, qb).invert();
      this.joint(j.name).quaternion.copy(qParent.multiply(toT(B[j.name].quaternion, qc)));
    }
  }
}

// Oleg's body follows the camera; velocity so that contacts carry his momentum
export function moveOleg(x, z, vx, vz) {
  oleg.position.set(x, 0, z);
  oleg.velocity.set(vx, 0, vz);
}

export function updateDoors() {
  for (const { c, body } of doorBodies) body.collisionResponse = c.enabled !== false && !c.floor;
}

// 1/180 s steps (what the motors are tuned for), but at most MAX_STEPS per frame: otherwise a slow frame
// needs more steps, which makes the next frame slower still. A slow frame takes fewer, longer steps instead
// (up to 1/90 s), so the bodies keep real time. At 60 fps nothing changes (3 steps); measured on seeded
// drunk nights at 24 fps: half the physics time, same falls, uprightness and lag behind the guy.
const MAX_STEPS = 4;
export function step(dt, before) {
  const H = 1 / 180;
  let acc = (step.acc ?? 0) + Math.min(dt, 0.1);
  let n = Math.floor(acc / H), h = H;
  if (n > MAX_STEPS) {
    n = MAX_STEPS;
    h = Math.min(1 / 90, acc / n);
  }
  for (let i = 0; i < n; i++) {
    before?.(h);
    world.step(h);
    acc -= h;
  }
  step.acc = Math.min(acc, H); // below 22 fps even long steps can't keep up: that time is dropped
}
