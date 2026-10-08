// The guys' physical bodies, take two (`?phys=new`, tuned in lab.html): crooked robots on their own legs.
// Thirteen rigid parts (feet on ankles). Every joint is a servo: a motor that turns the joint towards a
// target angle as fast as `speed` allows, up to a torque limit (his strength). Everything the controller does
// is a push between two of his own parts, so nothing invisible lifts, pulls or straightens him: the floor
// under his feet is the only thing holding him up. Standing, the hips keep the pelvis level, the knees hold
// the height and the ankles keep the hips over the feet. Balance beyond that is stepping: when the capture
// point (where his falling body would stop if he put a foot there) leaves his feet, a foot goes there.
// Walking is the same thing on purpose: lean, catch, lean, catch. Drunk: late and sloppy steps, weak joints,
// a sense of up that wanders off. Down is down: he lies there, then struggles back up (an animation from the
// pose he fell in, the first try may fail).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DIM } from './anim.js';
import { world } from './ragdoll.js';
import { TUNE } from '../config.js';

const ANKLE_Y = DIM.hip - DIM.thigh - DIM.shin; // ankle joint height above the floor
const G_STATIC = 1; // ragdoll.js: walls, furniture and the floor
// heavy feet: the solver can't hold a 68 kg body still on 1.2 kg feet (they creep over the floor)
const FOOT_KG = 4;
const G = 9.8;
const PARTS = {
  // name: [half extents, center (standing rest pose), mass, parent, joint pivot, torque limit N·m]
  pelvis: [[0.16, 0.08, 0.1], [0, DIM.hip - 0.04, 0], 10, null, null, 0],
  torso: [[0.18, 0.3, 0.105], [0, DIM.hip + 0.27, 0], 20, 'pelvis', [0, DIM.hip, 0], 320],
  head: [[0.14, 0.15, 0.13], [0, DIM.hip + DIM.neckY + 0.17, 0], 5, 'torso', [0, DIM.hip + DIM.neckY, 0], 40],
};
const SIDES = [-1, 1]; // leg/arm 0 is on the -x side (his right), 1 on +x (his left)
for (const [i, s] of SIDES.entries()) {
  PARTS[`thigh${i}`] = [[0.065, DIM.thigh / 2, 0.075], [s * 0.085, DIM.hip - DIM.thigh / 2, 0], 7, 'pelvis', [s * 0.085, DIM.hip, 0], 280];
  PARTS[`shin${i}`] = [[0.06, DIM.shin / 2, 0.07], [s * 0.085, ANKLE_Y + DIM.shin / 2, 0], 4, `thigh${i}`, [s * 0.085, DIM.hip - DIM.thigh, 0], 280];
  PARTS[`foot${i}`] = [[0.06, 0.03, 0.125], [s * 0.085, 0.03, 0.05], FOOT_KG, `shin${i}`, [s * 0.085, ANKLE_Y, 0], 150];
  PARTS[`upper${i}`] = [[0.048, DIM.upper / 2, 0.052], [s * DIM.shoulderX, DIM.hip + DIM.shoulderY - DIM.upper / 2, 0], 2.5, 'torso', [s * DIM.shoulderX, DIM.hip + DIM.shoulderY, 0], 50];
  PARTS[`fore${i}`] = [[0.043, (DIM.fore + 0.09) / 2, 0.048], [s * DIM.shoulderX, DIM.hip + DIM.shoulderY - DIM.upper - (DIM.fore + 0.09) / 2, 0], 1.8, `upper${i}`, [s * DIM.shoulderX, DIM.hip + DIM.shoulderY - DIM.upper, 0], 28];
}
const MASS = Object.values(PARTS).reduce((m, p) => m + p[2], 0);
const FOOT_ANKLE = new THREE.Vector3(0, ANKLE_Y - 0.03, -0.05); // the ankle in the foot's own frame
const WMAX = 20; // fastest a joint turns (rad/s)
const HIP_MASK = [1, 0.2, 1];
const BEND = { torso: 0.12, head: 0.35, pelvis: 0.08 }; // most the animation may bend a standing body (rad)
const REACH = 0.75; // longest step, foot to foot (m)
const LEG = DIM.thigh + DIM.shin - 0.02;

// scratch
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), qd = new THREE.Quaternion(), qe = new THREE.Quaternion();
const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vd = new THREE.Vector3(), ve = new THREE.Vector3(), vf = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), UPV = UP, XAX = new THREE.Vector3(1, 0, 0);
const mat = new THREE.Matrix4();
const toT = (q, out) => out.set(q.x, q.y, q.z, q.w);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const yawQ = (yaw, out) => out.setFromAxisAngle(UP, yaw);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.41;

// rotation from qNow to qWant as world axis * angle
function errRot(qWant, qNow, out) {
  qc.copy(qWant).multiply(qd.copy(qNow).invert());
  if (qc.w < 0) qc.set(-qc.x, -qc.y, -qc.z, -qc.w);
  const s = Math.sqrt(Math.max(0, 1 - qc.w * qc.w));
  if (s < 1e-5) return out.set(0, 0, 0);
  return out.set(qc.x, qc.y, qc.z).multiplyScalar((2 * Math.acos(Math.min(1, qc.w))) / s);
}

// a ball joint with a servo on it: three motor rows (world x, y, z) drive the parts' relative spin
class Servo extends CANNON.Constraint {
  constructor(a, pa, b, pb) {
    super(a, b, { collideConnected: false });
    this.ball = new CANNON.PointToPointConstraint(a, pa, b, pb);
    this.motors = [0, 1, 2].map((k) => {
      const m = new CANNON.RotationalMotorEquation(a, b, 0);
      m.axisA.set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      m.axisB.copy(m.axisA);
      return m;
    });
    this.equations.push(...this.ball.equations, ...this.motors);
  }
  update() {
    this.ball.update();
  }
  // turn `who` ('a' or 'b') towards world orientation q at k 1/s (its spin relative to the other part:
  // driving the absolute spin would integrate the other part's motion when this one can't move), up to tmax N·m
  drive(who, q, k, tmax, h, abs, mask = null, ff = null) {
    const me = who === 'b' ? this.bodyB : this.bodyA, other = who === 'b' ? this.bodyA : this.bodyB;
    const w = errRot(q, toT(me.quaternion, qe), ve).multiplyScalar(k);
    if (ff) w.add(ff);
    const l = w.length();
    if (l > WMAX) w.multiplyScalar(WMAX / l);
    // the row says axis·(spinA - spinB) = target
    const sg = who === 'b' ? -1 : 1, imp = tmax * h;
    const [mx, my, mz] = this.motors;
    this.worldAxes();
    mx.targetVelocity = sg * w.x;
    my.targetVelocity = sg * w.y;
    mz.targetVelocity = sg * w.z;
    for (const [k, m] of this.motors.entries()) {
      const c = mask ? imp * mask[k] : imp;
      m.maxForce = c;
      m.minForce = -c;
    }
  }
  worldAxes() {
    if (this.axesWorld) return;
    for (const [k, m] of this.motors.entries()) {
      m.axisA.set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      m.axisB.copy(m.axisA);
    }
    this.axesWorld = true;
  }
  // rows about his own left / up / forward: `rates` is the wanted spin of a (the shin) relative to b (the
  // foot) about each, `caps` [min, max] torque per row (N·m)
  rows(left, fwd, rates, caps, h) {
    const ax = [left, UPV, fwd];
    for (const [k, m] of this.motors.entries()) {
      m.axisA.set(ax[k].x, ax[k].y, ax[k].z);
      m.axisB.copy(m.axisA);
      m.targetVelocity = rates[k];
      m.minForce = caps[k][0] * h;
      m.maxForce = caps[k][1] * h;
    }
    this.axesWorld = false;
  }
  // no target: just joint friction
  loose(tmax, h) {
    this.worldAxes();
    for (const m of this.motors) {
      m.targetVelocity = 0;
      m.maxForce = tmax * h;
      m.minForce = -tmax * h;
    }
  }
}

// what each body part presses on static things (floor, furniture) with, from the last physics step
const touch = { step: -1, up: new Map() };
function pressing() {
  if (touch.step === world.stepnumber) return touch.up;
  touch.step = world.stepnumber;
  touch.up.clear();
  for (const c of world.contacts) {
    if (c.bi.type === CANNON.Body.STATIC) touch.up.set(c.bj, (touch.up.get(c.bj) ?? 0) + c.ni.y * c.multiplier);
    else if (c.bj.type === CANNON.Body.STATIC) touch.up.set(c.bi, (touch.up.get(c.bi) ?? 0) - c.ni.y * c.multiplier);
  }
  return touch.up;
}

// two-bone leg: hip joint H to ankle A, knee forward along F. Writes the thigh and shin world rotations,
// returns the knee bend (rad)
const ik = { d: new THREE.Vector3(), pole: new THREE.Vector3(), u: new THREE.Vector3(), w: new THREE.Vector3(), X: new THREE.Vector3(), Y: new THREE.Vector3(), Z: new THREE.Vector3() };
function basisQ(Y, F, out) {
  ik.Y.copy(Y).normalize();
  ik.Z.copy(F).addScaledVector(ik.Y, -F.dot(ik.Y));
  if (ik.Z.lengthSq() < 1e-6) ik.Z.set(0, 0, 1).addScaledVector(ik.Y, -ik.Y.z);
  ik.Z.normalize();
  ik.X.crossVectors(ik.Y, ik.Z);
  return out.setFromRotationMatrix(mat.makeBasis(ik.X, ik.Y, ik.Z));
}
function legIK(H, A, F, qThigh, qShin) {
  const L1 = DIM.thigh, L2 = DIM.shin, { d, pole, u, w } = ik;
  d.subVectors(A, H);
  const dist = clamp(d.length(), 0.3, L1 + L2 - 1e-3);
  d.normalize();
  pole.copy(F).addScaledVector(d, -F.dot(d));
  if (pole.lengthSq() < 1e-6) pole.set(0, 0, 1);
  pole.normalize();
  const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  u.copy(d).multiplyScalar(Math.cos(a)).addScaledVector(pole, Math.sin(a)); // hip -> knee
  w.copy(d).multiplyScalar(dist).addScaledVector(u, -L1).divideScalar(L2); // knee -> ankle
  basisQ(vc.copy(u).negate(), F, qThigh);
  basisQ(vc.copy(w).negate(), F, qShin);
  return Math.acos(clamp(u.dot(w), -1, 1));
}

let bit = 2;
export class Robot {
  constructor(rig) {
    this.rig = rig;
    this.group = bit;
    bit = bit === 16 ? 2 : bit * 2;
    this.bodies = {};
    for (const [name, [he, c, mass]] of Object.entries(PARTS)) {
      // arms pass through furniture and walls (a gesture over the table shouldn't shove him off his feet);
      // they still hit people
      const arm = name.startsWith('upper') || name.startsWith('fore');
      const b = new CANNON.Body({ mass, linearDamping: 0.02, angularDamping: 0.08, collisionFilterGroup: this.group, collisionFilterMask: -1 ^ this.group ^ (arm ? G_STATIC : 0) });
      // the shin's box stops short of the ankle, so a leaning shin doesn't prop itself on the floor by a corner
      if (name.startsWith('shin')) b.addShape(new CANNON.Box(new CANNON.Vec3(he[0], he[1] - 0.04, he[2])), new CANNON.Vec3(0, 0.04, 0));
      else b.addShape(new CANNON.Box(new CANNON.Vec3(...he)));
      b.rest = new CANNON.Vec3(...c);
      this.bodies[name] = b;
    }
    this.servos = {};
    for (const [name, [, c, , parent, pivot, tmax]] of Object.entries(PARTS)) {
      if (!parent) continue;
      const pc = PARTS[parent][1];
      const s = new Servo(this.bodies[parent], new CANNON.Vec3(pivot[0] - pc[0], pivot[1] - pc[1], pivot[2] - pc[2]), this.bodies[name], new CANNON.Vec3(pivot[0] - c[0], pivot[1] - c[1], pivot[2] - c[2]));
      s.name = name;
      s.parent = parent;
      s.tmax = tmax;
      this.servos[name] = s;
    }
    this.isRobot = true;
    this.active = false;
    this.state = 'up'; // up | down | getup
    this.stun = 0; // s of weak legs after a hard knock
    this.lastPush = null; // what knocked him (the game's 'shove', 'bump', 'slip'...)
    this.kin = null;
    // set by the owner every frame
    this.goal = null; // [x, z] to walk to, null = stand
    this.speed = null; // m/s, null = TUNE.robot.walkSpeed
    this.drunk = 0;
    this.yawWant = 0;
    this.stats = { steps: 0, falls: 0, feetN: 0, airT: 0, t: 0 };
    this.c = new THREE.Vector3(); // centre of mass
    this.v = new THREE.Vector3();
    this.seenC = new THREE.Vector3(); // what his (drunk) head thinks the body is doing
    this.seenV = new THREE.Vector3();
    this.vd = new THREE.Vector3(); // the velocity he's going for
    this.feet = [0, 1].map(() => ({ down: false, n: 0, at: new THREE.Vector3() }));
    this.gait = { swing: -1, t: 0, T: 0.36, from: new THREE.Vector3(), to: new THREE.Vector3(), dwell: 0, next: 0, wantT: 0, miss: new THREE.Vector3() };
    this.wander = { x: 0, z: 0 };
    this.debug = { xi: new THREE.Vector3(), S: new THREE.Vector3(), to: new THREE.Vector3() };
  }

  // the rig joint drawn from a body
  joint(name) {
    const r = this.rig;
    if (name === 'pelvis') return r.pelvis;
    if (name === 'torso') return r.spine;
    if (name === 'head') return r.neck;
    const i = Number(name.at(-1));
    if (name.startsWith('thigh')) return r.legs[i].hip;
    if (name.startsWith('shin')) return r.legs[i].knee;
    if (name.startsWith('foot')) return r.legs[i].ankle;
    if (name.startsWith('upper')) return r.arms[i].shoulder;
    return r.arms[i].elbow;
  }

  // standing in the rest pose at (x, z) facing yaw, physics on
  enable(x, z, yaw) {
    if (this.active) return;
    yawQ(yaw, qa);
    for (const b of Object.values(this.bodies)) {
      va.set(b.rest.x, b.rest.y, b.rest.z).applyQuaternion(qa);
      b.position.set(x + va.x, va.y, z + va.z);
      b.quaternion.set(qa.x, qa.y, qa.z, qa.w);
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      world.addBody(b);
    }
    for (const s of Object.values(this.servos)) world.addConstraint(s);
    this.active = true;
    this.state = 'up';
    this.yawNow = this.yawWant = yaw;
    this.gait.swing = -1;
    this.gait.dwell = 0.2;
    this.hipH = null;
    this.measure();
    this.seenC.copy(this.c);
    this.seenV.set(0, 0, 0);
    this.vd.set(0, 0, 0);
  }

  disable() {
    if (!this.active) return;
    for (const b of Object.values(this.bodies)) world.removeBody(b);
    for (const s of Object.values(this.servos)) world.removeConstraint(s);
    this.active = false;
  }

  // the animation's own joint state, so its springs don't fight the physics
  restore() {
    if (!this.kin) return;
    for (const [name, q] of Object.entries(this.kin.q)) this.joint(name).quaternion.copy(q);
    this.rig.pelvis.position.copy(this.kin.pelvisPos);
  }

  // after the animation ran: what it wants each joint to be (the upper body follows it; the legs only
  // borrow how bent the knees are)
  capture() {
    this.kin ??= { q: {}, pelvisPos: new THREE.Vector3() };
    for (const name of Object.keys(PARTS)) (this.kin.q[name] ??= new THREE.Quaternion()).copy(this.joint(name).quaternion);
    this.kin.pelvisPos.copy(this.rig.pelvis.position);
    // a body on its own feet can't throw itself about like the animation (a belly laugh would put him on his
    // back): the spine and the neck bend only so far
    for (const [name, max] of [['torso', BEND.torso], ['head', BEND.head], ['pelvis', BEND.pelvis]]) {
      const q = this.kin.q[name], a = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      if (a > max) q.slerp(IDENT, 1 - max / a);
    }
  }

  get pelvis() {
    return this.bodies.pelvis.position;
  }

  // torso's up vector · world up: 1 upright, 0 lying
  get upright() {
    return va.set(0, 1, 0).applyQuaternion(toT(this.bodies.torso.quaternion, qa)).y;
  }

  get walking() {
    return this.state === 'up' && (this.vd.lengthSq() > 0.04 || this.gait.swing >= 0);
  }

  // a shove: dir (world angle), strength in m/s on the upper body
  push(dir, strength) {
    if (!this.active) return;
    for (const [name, k] of [['torso', 1], ['head', 1], ['pelvis', 0.5]]) {
      const b = this.bodies[name];
      b.applyImpulse(new CANNON.Vec3(Math.sin(dir) * strength * k * b.mass, 0, Math.cos(dir) * strength * k * b.mass));
    }
  }

  // centre of mass and its velocity
  measure() {
    const c = this.c.set(0, 0, 0), v = this.v.set(0, 0, 0);
    for (const b of Object.values(this.bodies)) {
      c.x += b.position.x * b.mass;
      c.y += b.position.y * b.mass;
      c.z += b.position.z * b.mass;
      v.x += b.velocity.x * b.mass;
      v.y += b.velocity.y * b.mass;
      v.z += b.velocity.z * b.mass;
    }
    c.divideScalar(MASS);
    v.divideScalar(MASS);
  }

  ankle(i, out) {
    const f = this.bodies[`foot${i}`];
    return out.copy(FOOT_ANKLE).applyQuaternion(toT(f.quaternion, qa)).add(vb.set(f.position.x, f.position.y, f.position.z));
  }

  // the knee: towards `knee` (rad of bend), plus how fast that target is moving
  knee(i, knee, k, tmax, h, mode) {
    const sv = this.servos[`shin${i}`], th = this.bodies[`thigh${i}`];
    this.kneeWas ??= [knee, knee];
    this.kneeMode ??= [mode, mode];
    // the target jumps when the leg switches between swing and stance: that's not a speed to follow
    if (this.kneeMode[i] !== mode) this.kneeWas[i] = knee;
    this.kneeMode[i] = mode;
    const rate = clamp((knee - this.kneeWas[i]) / h, -6, 6);
    this.kneeWas[i] = knee;
    const qt = toT(th.quaternion, qe);
    const ff = vf.set(1, 0, 0).applyQuaternion(qt).multiplyScalar(rate);
    sv.drive('b', qc.copy(qt).multiply(qd.setFromAxisAngle(XAX, knee)), k, tmax, h, false, null, ff);
  }

  // per physics tick
  control(h) {
    if (!this.active || !this.kin) return;
    const R = TUNE.robot, B = this.bodies, S = this.servos, st = this.stats;
    // how drunk his legs are: hardly at first, a lot near the end (CONCEPT: up to ~50% he only sways, at 80%
    // he goes down about every half a minute)
    const d = clamp(this.drunk, 0, 1) ** R.drunkCurve;
    const up = pressing();
    let feetN = 0;
    for (const [i, f] of this.feet.entries()) {
      f.n = up.get(B[`foot${i}`]) ?? 0;
      f.down = up.has(B[`foot${i}`]);
      feetN += f.n;
    }
    st.feetN = feetN;
    st.t += h;
    if (!this.feet[0].down && !this.feet[1].down) st.airT += h;
    this.measure();
    // safety: no part spins or flies faster than a body can (keeps the solver sane)
    for (const b of Object.values(B)) {
      const w = b.angularVelocity, v = b.velocity;
      const wl = Math.hypot(w.x, w.y, w.z), vl = Math.hypot(v.x, v.y, v.z);
      if (wl > 30) w.scale(30 / wl, w);
      if (vl > 12) v.scale(12 / vl, v);
    }
    const tilt = Math.acos(clamp(this.upright, -1, 1));
    if (this.state === 'up' && (tilt > R.fallAt || this.c.y < 0.45)) {
      this.stats.why = (this.stats.why ?? '') + (tilt > R.fallAt ? 'T' : 'L');
      this.fall();
    }
    if (this.state !== 'up') return this.limp(h);

    // strength: drunk joints are weaker and slower; knocked hard, the legs give for a moment
    this.stun = Math.max(0, this.stun - h);
    const str = R.strength * (1 - R.weak * d) * (this.boost ?? 1) * (this.stun > 0 ? 0.35 : 1);
    const k = R.speed * (1 - 0.35 * d);
    // what his head thinks the body is doing: drunk, it lags behind
    const lag = R.late * d;
    const a = lag > 1e-3 ? Math.min(1, h / lag) : 1;
    this.seenC.lerp(this.c, a);
    this.seenV.lerp(this.v, a);
    // where he wants to go
    va.set(0, 0, 0);
    if (this.goal) {
      va.set(this.goal[0] - this.c.x, 0, this.goal[1] - this.c.z);
      const dist = va.length();
      // a sharp turn: slow down; one sharper than ~50°: walk round it in an arc (spinning on the spot is
      // where a robot falls over its own feet)
      const yn = this.yawNow ?? 0;
      let face = Math.atan2(va.x, va.z) - yn;
      face = Math.atan2(Math.sin(face), Math.cos(face));
      const sp = Math.min((this.speed ?? R.walkSpeed) * (1 - 0.3 * d), 0.4 + dist * 1.6);
      if (dist <= 0.12) va.set(0, 0, 0);
      else if (Math.abs(face) > 0.9) {
        const a = yn + Math.sign(face) * 0.9;
        va.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(Math.min(sp, 0.45));
      } else va.multiplyScalar((sp * Math.max(0.4, Math.cos(face))) / dist);
    }
    this.vd.lerp(va, Math.min(1, h * 2.5));
    const moving = this.vd.lengthSq() > 0.04;
    // facing: where he walks, else where he's told to look; turning takes time
    const yw = moving ? Math.atan2(this.vd.x, this.vd.z) : this.yawWant;
    this.yawNow ??= yw;
    const dy = Math.atan2(Math.sin(yw - this.yawNow), Math.cos(yw - this.yawNow));
    this.yawNow += clamp(dy, -(moving ? 1.2 : 0.8) * h, (moving ? 1.2 : 0.8) * h);
    // drunk: his sense of up wanders, and he leans with it
    const tau = 1.2, sig = R.wander * clamp(this.drunk, 0, 1) * Math.sqrt(2 / tau); // he sways from the first glass
    this.wander.x += (-this.wander.x / tau) * h + sig * Math.sqrt(h) * gauss();
    this.wander.z += (-this.wander.z / tau) * h + sig * Math.sqrt(h) * gauss();
    // the pelvis he wants: level (plus the animation's small sway), facing yawNow, leaning into the walk
    const lean = moving ? 0.03 * Math.min(1, this.vd.length() / R.walkSpeed) : 0;
    const qPd = yawQ(this.yawNow, new THREE.Quaternion()).multiply(qa.setFromEuler(new THREE.Euler(lean + this.wander.x, 0, this.wander.z))).multiply(this.kin.q.pelvis);
    const fwd = new THREE.Vector3(Math.sin(this.yawNow), 0, Math.cos(this.yawNow));
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x); // his +x
    // how high the hips: knees a bit bent (a robot), more when the animation bends them
    const kneeAnim = 0.5 * (2 * Math.acos(Math.min(1, Math.abs(this.kin.q.shin0.w))) + 2 * Math.acos(Math.min(1, Math.abs(this.kin.q.shin1.w))));
    const hipH = moving || this.gait.swing >= 0 ? DIM.hip - R.crouch - 0.03 : DIM.hip - R.crouch - 0.2 * Math.max(0, kneeAnim - 0.05) + (this.kin.pelvisPos.y - DIM.hip);

    // ---- stepping
    const g = this.gait;
    for (const i of [0, 1]) this.ankle(i, this.feet[i].at);
    const sup = this.debug.S.set(0, 0, 0);
    let ns = 0;
    for (const i of [0, 1]) {
      if (g.swing === i) continue;
      const fb = this.bodies[`foot${i}`].position;
      sup.x += fb.x;
      sup.z += fb.z;
      ns++;
    }
    sup.divideScalar(Math.max(1, ns));
    const w0 = Math.sqrt(G / Math.max(0.5, this.c.y));
    const xi = this.debug.xi.copy(this.seenC).addScaledVector(this.seenV, 1 / w0).setY(0);
    if (g.swing < 0) {
      g.dwell -= h;
      const leg = this.stepWanted(xi, sup, fwd, left, moving, d);
      if (leg < 0) g.wantT = 0;
      else if ((g.wantT += h) >= R.late * d * (0.4 + Math.random()) && g.dwell <= 0) this.startStep(leg, d, fwd, left);
    } else {
      g.t += h;
      const u = g.t / g.T;
      if (u < 0.7) this.place(g.swing, g.to, fwd, left, d);
      // down when it's touched the floor near where it was going (a foot that catches the floor on the way
      // there just scuffs it), or when time's up
      const fa = this.feet[g.swing].at, near = Math.hypot(fa.x - g.to.x, fa.z - g.to.z) < 0.12;
      if ((u > 0.5 && this.feet[g.swing].down && (near || u > 0.9)) || u > 1.4) {
        g.swing = -1;
        g.dwell = moving ? 0.02 : 0.1;
      }
    }

    // ---- joints
    const P = B.pelvis, qP = toT(P.quaternion, new THREE.Quaternion());
    const pp = new THREE.Vector3(P.position.x, P.position.y, P.position.z);
    // where the hips should be: standing, over the feet; walking, wherever the body carries them
    const hc = new THREE.Vector3(0, 0.04, 0).applyQuaternion(qP).add(pp);
    let hipWant = hipH;
    if (g.swing >= 0) {
      const sh = vb.set(SIDES[g.swing] * 0.085, 0.04, 0).applyQuaternion(qP).add(pp);
      const dxz = Math.hypot(g.to.x - sh.x, g.to.z - sh.z);
      hipWant = Math.min(hipH, Math.max(0.72, ANKLE_Y + Math.sqrt(Math.max(0.2, LEG * LEG - dxz * dxz))));
    }
    this.hipH = (this.hipH ?? hc.y) + (hipWant - (this.hipH ?? hc.y)) * Math.min(1, h * 8);
    const hDes = new THREE.Vector3(hc.x, this.hipH, hc.z);
    this.debug.hc = hc;
    this.debug.hDes = hDes;
    // ---- balance: he's an inverted pendulum on his ankles. On both feet the ankles are left free and a torque
    // (below) rolls the body over them; on one foot the ankle is stiff (so the hip has something to push
    // against) and rolls him on at the speed he wants. Either way no harder than a foot can push before it
    // rocks onto its heel, toe or edge
    const Hc = Math.max(0.4, this.c.y - ANKLE_Y);
    const single = g.swing >= 0;
    const ffSag = moving ? (this.vd.x * fwd.x + this.vd.z * fwd.z) / Hc : 0, ffLat = moving ? -(this.vd.x * left.x + this.vd.z * left.z) / Hc : 0;
    const qT = new THREE.Quaternion(), qS = new THREE.Quaternion();
    for (const [i, s] of SIDES.entries()) {
      const th = S[`thigh${i}`], sh = S[`shin${i}`], ft = S[`foot${i}`];
      if (g.swing === i) {
        // swing: the foot along an arc to where it's going. A catching foot gets there over the floor first and
        // then comes down (one still travelling when it lands falls short, and a short catch is no catch)
        const u = g.t / g.T, e = smooth(Math.min(1, u / (moving ? 1 : R.catchAt)));
        const tgt = va.lerpVectors(g.from, g.to, e);
        const far = Math.min(1, Math.hypot(g.to.x - g.from.x, g.to.z - g.from.z) / 0.6); // long steps lift higher
        tgt.y = ANKLE_Y + R.stepHeight * (1 + far) * Math.sin(Math.PI * Math.min(1, u)) - Math.max(0, u - 1) * 0.15;
        const H = vb.set(s * 0.085, 0.04, 0).applyQuaternion(qP).add(pp);
        const knee = legIK(H, tgt, fwd, qT, qS);
        // a swinging leg is light: it needs speed, not strength (a strong one stamps and bounces off the floor)
        th.drive('b', qT, k * 1.4, 170 * str, h, true);
        this.knee(i, knee, k * 1.4, 110 * str, h, 'swing');
        ft.drive('b', yawQ(this.yawNow, qb), k, 25 * str, h, true);
      } else {
        // stance: the hips hold the pelvis, the knee the height; the ankle only keeps the leg from
        // twisting on the foot (tipping over it is the balance torque below)
        const H = vb.set(s * 0.085, 0, 0).applyQuaternion(qPd).add(hDes);
        // the foot belongs on the floor: a stance foot that came up gets pushed back down
        const ffwd = vd.set(0, 0, 1).applyQuaternion(toT(B[`foot${i}`].quaternion, qb)).setY(0).normalize().add(fwd).normalize();
        const knee = legIK(H, vf.copy(this.feet[i].at).setY(ANKLE_Y), ffwd, qT, qS);
        // the hip holds the pelvis level; turning it (about the vertical) only as hard as a foot can grip the floor
        th.drive('a', qPd, k, th.tmax * str, h, true, HIP_MASK);
        this.knee(i, knee, k, sh.tmax * str, h, 'stance');
        // the ankle: the shin rolls over the foot at the rate that moves the body where it should go,
        // no harder than the foot can push before it rocks onto its heel, toe or edge
        const n = Math.max(this.feet[i].n, this.feet[i].down ? 150 : 0);
        const tw = clamp(errRot(qS, toT(B[`shin${i}`].quaternion, qe), ve).y * k, -6, 6);
        if (single) ft.rows(left, fwd, [ffSag, tw, ffLat], [[-0.13 * n - 3, 0.06 * n + 3], [-40 * str, 40 * str], [-0.045 * n - 2, 0.045 * n + 2]], h);
        else ft.rows(left, fwd, [0, tw, 0], [[-3, 3], [-40 * str, 40 * str], [-3, 3]], h);
      }
    }
    const stance = [0, 1].filter((i) => g.swing !== i);
    let nsum = 0;
    for (const i of stance) nsum += this.feet[i].n;
    if (!single && nsum > 30) {
      const kp = moving ? 0 : 600 * str, kd = 250 * str;
      const fx = -kp * (this.seenC.x - sup.x) - kd * (this.seenV.x - this.vd.x);
      const fz = -kp * (this.seenC.z - sup.z) - kd * (this.seenV.z - this.vd.z);
      // gravity tips him around his ankles: hold that too (the centre of pressure goes under the centre of mass).
      // Not along the line between his feet, though: there the floor holds him up by how the weight shares
      // between them (counting that too rolls him off a perfectly good stance after a step back)
      const ax = sup.x - fwd.x * 0.05, az = sup.z - fwd.z * 0.05;
      // (side by side the stance is narrow and stiff, so there it counts as before: weighted by how far one
      // foot is in front of the other)
      let ex = this.seenC.x - ax, ez = this.seenC.z - az;
      {
        const a0 = this.feet[0].at, a1 = this.feet[1].at;
        let ux = a1.x - a0.x, uz = a1.z - a0.z;
        const L = Math.hypot(ux, uz) || 1;
        ux /= L;
        uz /= L;
        const ea = ex * ux + ez * uz, out = Math.sign(ea) * Math.max(0, Math.abs(ea) - L / 2);
        const w = Math.abs(ux * fwd.x + uz * fwd.z);
        ex += (out - ea) * ux * w;
        ez += (out - ea) * uz * w;
      }
      const df = ex * fwd.x + ez * fwd.z, dl = ex * left.x + ez * left.z;
      const W = MASS * G;
      const sagAll = -W * df + Hc * (fx * fwd.x + fz * fwd.z);
      const latAll = W * dl - Hc * (fx * left.x + fz * left.z);
      for (const i of stance) {
        const n = this.feet[i].n, share = n / nsum;
        // his sagittal torque (about `left`, + rolls him forward) and lateral (about `fwd`, + rolls him right)
        const sag = clamp(sagAll * share, -0.13 * n, 0.05 * n);
        const lat = clamp(latAll * share, -0.045 * n, 0.045 * n);
        const tx = left.x * sag + fwd.x * lat, tz = left.z * sag + fwd.z * lat;
        const sb = B[`shin${i}`], fb2 = B[`foot${i}`];
        sb.torque.x += tx;
        sb.torque.z += tz;
        fb2.torque.x -= tx;
        fb2.torque.z -= tz;
      }
    }
    // ---- the one helping hand (TUNE.robot.assist, 0 = none): a little torque that stands the upper body
    // up, only while his feet press on the floor, weaker drunk. It holds no weight and can't save a guy
    // whose feet aren't under him; it just makes a sober one less of a skittle
    // and a reflex (TUNE.robot.reflex): tipping past ~20°, a sober one catches himself for half a second, a
    // drunk one hardly; then it needs time to come back, so a second shove right after still floors him
    this.reflexCd = Math.max(0, (this.reflexCd ?? 0) - h);
    if (this.reflexT > 0) {
      if ((this.reflexT -= h) <= 0) this.reflexCd = 2.5;
    } else if (tilt > 0.35 && this.reflexCd <= 0 && R.reflex > 0) this.reflexT = 0.6;
    const load = Math.min(1, (this.feet[0].n + this.feet[1].n) / (MASS * G));
    const asst = (R.assist + (this.reflexT > 0 ? R.reflex * (1 - d) : 0)) * (1 - 0.8 * d) * Math.max(load, this.reflexT > 0 ? 0.5 : 0);
    if (asst > 0) {
      for (const [name, share] of [['torso', 0.6], ['pelvis', 0.4]]) {
        const b = B[name];
        const u = va.set(0, 1, 0).applyQuaternion(toT(b.quaternion, qa));
        const ax = -u.z, az = u.x; // up_now x world up: axis * sin(tilt)
        const t = clamp(asst * share * 6, 0, asst * share);
        b.torque.x += clamp(t * 6 * ax - asst * share * 0.6 * b.angularVelocity.x, -t, t);
        b.torque.z += clamp(t * 6 * az - asst * share * 0.6 * b.angularVelocity.z, -t, t);
      }
    }
    // upper body: the animation's pose, relative to the parent part
    for (const name of ['torso', 'head', 'upper0', 'upper1', 'fore0', 'fore1']) {
      const sv = S[name];
      const arm = name.startsWith('upper') || name.startsWith('fore');
      const want = qc.copy(toT(B[sv.parent].quaternion, qe)).multiply(this.kin.q[name]);
      sv.drive('b', want, k * (arm ? 0.8 : 1), sv.tmax * str * (arm ? 1 - 0.3 * d : 1), h, false);
    }
  }

  // which leg should step now (-1: none)
  stepWanted(xi, sup, fwd, left, moving, d) {
    const g = this.gait;
    if (moving) return g.next;
    const ex = xi.x - sup.x, ez = xi.z - sup.z;
    const f = ex * fwd.x + ez * fwd.z, l = ex * left.x + ez * left.z;
    const fa = this.feet[0].at, fb = this.feet[1].at;
    const dx = fb.x - fa.x, dz = fb.z - fa.z;
    const spread = Math.abs(dx * left.x + dz * left.z) / 2, reach = Math.abs(dx * fwd.x + dz * fwd.z) / 2; // half the stance, sideways / lengthways
    const m = 0.03 + 0.05 * d;
    const crossed = dx * left.x + dz * left.z < 0.06;
    // turning in place: the feet follow the hips
    const fy = Math.atan2(Math.sin(this.yawNow - this.footYaw()), Math.cos(this.yawNow - this.footYaw()));
    // the heel is short: falling backwards he has to step sooner than falling forwards
    const inside = f < reach + 0.1 + m && f > -(reach + (TUNE.robot.backAt ?? 0.04) + m) && Math.abs(l) < spread + 0.05 + m;
    // feet far apart (after a catch): the hips can't come up between them, the far foot comes in
    if (inside && Math.hypot(dx, dz) > 0.45) {
      const da = Math.hypot(xi.x - fa.x, xi.z - fa.z), db = Math.hypot(xi.x - fb.x, xi.z - fb.z);
      return da > db ? 0 : 1;
    }
    if (inside && !crossed && Math.abs(fy) < 0.35) return -1;
    if (Math.abs(fy) >= 0.35 && inside) return g.next; // turning on the spot: left, right, left
    if (crossed) return g.next;
    // a foot carrying most of the weight can't be lifted: the other one goes, across if it has to
    const n0 = this.feet[0].n, n1 = this.feet[1].n;
    if (Math.abs(n0 - n1) > 0.1 * (n0 + n1)) return n0 < n1 ? 0 : 1;
    // sideways: the far leg crosses over (lifting the near one would take the floor away from the side he
    // falls to); TUNE.robot.cross = 0 steps out with the near one instead
    if (Math.abs(l) > Math.abs(f)) return (l > 0) === !TUNE.robot.cross ? 1 : 0;
    // forwards / backwards: the foot farther from where he's falling
    const da = Math.hypot(xi.x - fa.x, xi.z - fa.z), db = Math.hypot(xi.x - fb.x, xi.z - fb.z);
    return da > db ? 0 : 1;
  }

  footYaw() {
    let x = 0, z = 0;
    for (const i of [0, 1]) {
      va.set(0, 0, 1).applyQuaternion(toT(this.bodies[`foot${i}`].quaternion, qa));
      x += va.x;
      z += va.z;
    }
    return Math.atan2(x, z);
  }

  startStep(i, d, fwd, left) {
    const g = this.gait, R = TUNE.robot;
    g.swing = i;
    g.next = 1 - i;
    g.t = 0;
    g.wantT = 0;
    g.T = (this.vd.lengthSq() > 0.04 ? R.stepTime : R.stepTime * 0.7) * (1 + 0.35 * d * (Math.random() * 2 - 1));
    g.from.copy(this.feet[i].at);
    g.miss.set(gauss(), 0, gauss()).multiplyScalar(R.sloppy * d);
    this.place(i, g.to, fwd, left, d);
    this.stats.steps++;
  }

  // where the swing foot goes: where the capture point will be when it lands (it runs away from the
  // stance foot exponentially), a bit short of it when walking so the body carries on, out to his side
  place(i, out, fwd, left, d) {
    const R = TUNE.robot, g = this.gait, s = SIDES[i];
    const o = this.feet[1 - i].at, xi = this.debug.xi;
    const px = o.x + fwd.x * 0.05, pz = o.z + fwd.z * 0.05;
    const w0 = Math.sqrt(G / Math.max(0.5, this.c.y));
    const walking = this.vd.lengthSq() > 0.04;
    // where the capture point will be when the foot lands (it runs away exponentially), but a robot's
    // catch is slower than the prediction: aim short of the full run, or the feet end up a split apart
    const ex = Math.exp(w0 * Math.max(0.05, g.T - g.t)), e = walking ? ex : Math.min(R.lead, ex);
    const over = 1 + R.placeGain;
    let tx = px + (xi.x - px) * e * over, tz = pz + (xi.z - pz) * e * over;
    const b = R.stepTime / (Math.exp(w0 * R.stepTime) - 1);
    // out to his side: walking always (a gait needs its width); catching a fall only towards the fall
    // (a foot put on the wrong side of it can't stop anything)
    const side = (xi.x - px) * left.x + (xi.z - pz) * left.z;
    const wide = walking || side * s > 0 ? R.stepWidth : 0;
    tx += -this.vd.x * b * R.stride + left.x * s * wide + g.miss.x;
    tz += -this.vd.z * b * R.stride + left.z * s * wide + g.miss.z;
    // caught falling backwards he has only his heels to stand on: the foot goes past where he'd stop, so his
    // weight ends up over the middle of it, not over the heel he can't push with
    const back = (xi.x - px) * fwd.x + (xi.z - pz) * fwd.z;
    if (!walking && back < 0) {
      tx -= fwd.x * R.backStep;
      tz -= fwd.z * R.backStep;
    }
    // not onto the other foot (crossing over is fine: that's a stumble), not further than a leg can reach
    const rx = tx - o.x, rz = tz - o.z;
    let fr = rx * fwd.x + rz * fwd.z, lt = rx * left.x + rz * left.z;
    if (Math.abs(lt) < 0.13 && Math.abs(fr) < 0.3) lt = (lt * s > -0.05 ? s : -s) * 0.13;
    const len = Math.hypot(fr, lt);
    if (len > REACH) {
      fr *= REACH / len;
      lt *= REACH / len;
    }
    out.set(o.x + fwd.x * fr + left.x * lt, ANKLE_Y, o.z + fwd.z * fr + left.z * lt);
    this.debug.to.copy(out);
    return out;
  }

  fall() {
    this.state = 'down';
    this.downT = 0;
    this.lie = TUNE.robot.lie[0] + Math.random() * (TUNE.robot.lie[1] - TUNE.robot.lie[0]) + this.drunk * 2;
    this.stats.falls++;
    this.gait.swing = -1;
    this.onFall?.();
  }

  // on the floor: the joints go slack (a bit of the animation's flailing gets through)
  limp(h) {
    const S = this.servos, B = this.bodies;
    this.downT = (this.downT ?? 0) + h;
    for (const sv of Object.values(S)) {
      if (this.downT < 0.6 || sv.name.startsWith('foot')) sv.loose(sv.tmax * 0.03, h);
      else sv.drive('b', qc.copy(toT(B[sv.parent].quaternion, qe)).multiply(this.kin.q[sv.name]), 4, sv.tmax * 0.1, h, false);
    }
  }

  // draw the rig from the bodies
  sync(figure) {
    const r = this.rig, root = figure.root;
    root.rotation.set(0, 0, 0);
    figure.setLean?.(0, 0);
    figure.body.rotation.set(0, 0, 0);
    figure.body.position.set(0, 0, 0);
    if (this.state === 'getup') return this.playGetup(root);
    if (!this.active) return;
    const B = this.bodies;
    root.position.set(B.pelvis.position.x, 0, B.pelvis.position.z);
    const qp = toT(B.pelvis.quaternion, qa);
    va.set(0, 0.04, 0).applyQuaternion(qp);
    r.pelvis.position.set(va.x, B.pelvis.position.y + va.y, va.z);
    r.pelvis.quaternion.copy(qp);
    for (const sv of Object.values(this.servos)) {
      const qParent = toT(B[sv.parent].quaternion, qb).invert();
      this.joint(sv.name).quaternion.copy(qParent.multiply(toT(B[sv.name].quaternion, qc)));
    }
  }

  // ---- getting up: lying there long enough, he plays his way back onto his feet
  tick(dt) {
    if (this.state === 'down' && this.active && (this.downT ?? 0) > this.lie && this.bodiesStill()) this.startGetup();
    if (this.state === 'getup') {
      const gu = this.gu;
      gu.t += dt;
      if (gu.t >= gu.keys.at(-1).t) {
        this.state = 'up';
        this.enable(gu.x, gu.z, gu.yaw);
        this.boost = 1.6; // finds his feet: strong legs for a moment
        this.boostT = 1.2;
        this.onGetup?.();
      }
    }
    if (this.boostT > 0 && (this.boostT -= dt) <= 0) this.boost = 1;
  }

  bodiesStill() {
    const v = this.bodies.pelvis.velocity;
    return Math.hypot(v.x, v.y, v.z) < 0.5 || this.downT > this.lie + 3;
  }

  startGetup() {
    const B = this.bodies, R = TUNE.robot;
    const qp = toT(B.pelvis.quaternion, new THREE.Quaternion());
    const x = B.pelvis.position.x, z = B.pelvis.position.z;
    // the pose he lies in
    const from = { pelvis: new THREE.Vector3(0, 0.04, 0).applyQuaternion(qp).add(new THREE.Vector3(0, B.pelvis.position.y, 0)), q: qp.clone(), j: {} };
    for (const sv of Object.values(this.servos)) from.j[sv.name] = toT(B[sv.parent].quaternion, new THREE.Quaternion()).invert().multiply(toT(B[sv.name].quaternion, new THREE.Quaternion()));
    // face down or up, and which way his head points
    const fwdT = va.set(0, 0, 1).applyQuaternion(toT(B.torso.quaternion, qa));
    const faceDown = fwdT.y < 0;
    const head = vb.set(B.head.position.x - x, 0, B.head.position.z - z);
    const yaw = faceDown ? Math.atan2(head.x, head.z) : Math.atan2(-head.x, -head.z);
    const fail = Math.random() < R.retry * Math.min(1, 0.4 + this.drunk);
    this.disable();
    this.state = 'getup';
    this.gu = { t: 0, x, z, yaw, keys: getupKeys(from, faceDown, fail, this.drunk) };
  }

  playGetup(root) {
    const gu = this.gu, r = this.rig;
    root.position.set(gu.x, 0, gu.z);
    const keys = gu.keys;
    let k = 1;
    while (k < keys.length - 1 && keys[k].t <= gu.t) k++;
    const A = keys[k - 1], Bk = keys[k];
    const e = smooth((gu.t - A.t) / Math.max(1e-3, Bk.t - A.t));
    const qy = yawQ(gu.yaw, qd);
    const pose = (K, name) => K.j[name] ?? IDENT;
    // pelvis: keyframes after the first are in his own frame (yaw), the first is the world pose he lies in
    qa.copy(A.world ? A.q : qb.copy(qy).multiply(A.q));
    qc.copy(Bk.world ? Bk.q : qb.copy(qy).multiply(Bk.q));
    r.pelvis.quaternion.copy(qa).slerp(qc, e);
    const pa = A.world ? A.pelvis : va.copy(A.pelvis).applyQuaternion(qy);
    const pb = Bk.world ? Bk.pelvis : vb.copy(Bk.pelvis).applyQuaternion(qy);
    r.pelvis.position.lerpVectors(pa, pb, e);
    for (const name of Object.keys(PARTS)) {
      if (name === 'pelvis') continue;
      this.joint(name).quaternion.copy(pose(A, name)).slerp(pose(Bk, name), e);
    }
  }
}

const IDENT = new THREE.Quaternion();
const E = (x, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
// a keyframe in his own frame: pelvis height and pitch, joints as [hipX, hipZ, knee] / [shoulderX, shoulderZ, elbow]
function key(t, { y, pitch = 0, roll = 0, fz = 0, spine = 0, neck = 0, legs, arms }) {
  const j = { torso: E(spine), head: E(neck) };
  for (const [i, s] of SIDES.entries()) {
    const [hx, hz, kn] = legs[i], [ax, az, el] = arms[i];
    j[`thigh${i}`] = E(hx, 0, s * hz);
    j[`shin${i}`] = E(kn);
    j[`foot${i}`] = IDENT;
    j[`upper${i}`] = E(ax, 0, s * az);
    j[`fore${i}`] = E(el);
  }
  return { t, pelvis: new THREE.Vector3(0, y, fz), q: E(pitch, 0, roll), j };
}

// the struggle back up, from the pose he lies in. Face down: push up, kneel, a foot forward, up.
// Face up: sit up, tuck the legs, squat, up. A failed first try sags back down halfway and goes again.
function getupKeys(from, faceDown, fail, drunk) {
  const slow = 1 + 0.8 * drunk;
  const start = { t: 0, pelvis: from.pelvis, q: from.q, j: from.j, world: true };
  const stand = (t) => key(t, { y: DIM.hip - 0.02, legs: [[0, 0.03, 0.12], [0, 0.03, 0.12]], arms: [[0.05, 0.12, -0.2], [0.05, 0.12, -0.2]] });
  let seq;
  if (faceDown) {
    const allFours = (t) => key(t, { y: 0.5, pitch: 1.25, fz: -0.05, neck: -0.6, legs: [[-1.25, 0.08, 1.45], [-1.25, 0.08, 1.45]], arms: [[-1.25, 0.15, -0.1], [-1.25, 0.15, -0.1]] });
    const kneel = (t) => key(t, { y: 0.55, pitch: 0.15, legs: [[-0.1, 0.08, 1.6], [-0.1, 0.08, 1.6]], arms: [[-0.4, 0.3, -0.6], [-0.4, 0.3, -0.6]] });
    const lunge = (t) => key(t, { y: 0.58, pitch: 0.25, spine: 0.2, legs: [[-1.45, 0.06, 1.45], [-0.1, 0.08, 1.6]], arms: [[-0.6, 0.35, -0.9], [-0.3, 0.4, -0.4]] });
    seq = [allFours(0.7), kneel(1.25), lunge(1.75)];
    if (fail) seq.push(key(2.15, { y: 0.42, pitch: 0.9, roll: 0.25, neck: -0.4, legs: [[-0.9, 0.2, 1.5], [-0.6, 0.1, 1.5]], arms: [[-1.4, 0.4, -0.2], [-1.0, 0.5, -0.3]] }), allFours(2.7), kneel(3.2), lunge(3.7));
  } else {
    const sit = (t) => key(t, { y: 0.14, pitch: -0.1, spine: 0.35, legs: [[-1.45, 0.1, 0.25], [-1.45, 0.1, 0.25]], arms: [[-0.6, 0.2, -0.3], [-0.6, 0.2, -0.3]] });
    const tuck = (t) => key(t, { y: 0.16, pitch: 0.2, spine: 0.6, legs: [[-2.0, 0.15, 2.3], [-2.0, 0.15, 2.3]], arms: [[-1.2, 0.2, -0.4], [-1.2, 0.2, -0.4]] });
    const squat = (t) => key(t, { y: 0.45, pitch: 0.6, spine: 0.3, legs: [[-1.9, 0.15, 2.3], [-1.9, 0.15, 2.3]], arms: [[-1.4, 0.15, -0.2], [-1.4, 0.15, -0.2]] });
    seq = [sit(0.6), tuck(1.1), squat(1.6)];
    if (fail) seq.push(key(2.0, { y: 0.12, pitch: -0.5, spine: 0.1, legs: [[-1.3, 0.25, 0.6], [-1.6, 0.2, 0.9]], arms: [[-0.3, 0.6, -0.2], [-0.3, 0.6, -0.2]] }), tuck(2.6), squat(3.1));
  }
  const last = seq.at(-1).t;
  seq.push(stand(last + 0.6));
  for (const k of seq) k.t *= slow;
  return [start, ...seq];
}
