// Tiny particle system for body effects: vomit, tears, vape vapor, smoke, "Z" while sleeping.
// One shared instance; attach() it to the scene once, update() every frame.
import * as THREE from 'three';

const MAX = 260;
let scene = null;
const live = [];

const sphere = new THREE.SphereGeometry(1, 6, 4);
const dropMats = {};
const dropMat = (color) => (dropMats[color] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.3 }));

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function zTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 52px "Russo One", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(20,20,40,0.8)';
  g.strokeText('Z', 32, 34);
  g.fillStyle = '#e8f0ff';
  g.fillText('Z', 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let soft = null, zTex = null;

function add(p) {
  if (!scene) return;
  if (live.length >= MAX) kill(0);
  scene.add(p.obj);
  live.push(p);
}
function kill(i) {
  const p = live[i];
  scene.remove(p.obj);
  if (p.obj.isSprite) p.obj.material.dispose();
  live.splice(i, 1);
}

export const particles = {
  attach(s) {
    scene = s;
    soft ??= softTexture();
    zTex ??= zTexture();
  },
  clear() {
    while (live.length) kill(live.length - 1);
  },
  // liquid drops flying out with gravity (vomit, tears)
  drops(pos, dir, { n = 6, color = '#9aa53a', speed = 1.6, spread = 0.5, size = 0.02 } = {}) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(sphere, dropMat(color));
      const s = size * (0.6 + Math.random() * 0.8);
      m.scale.setScalar(s);
      m.position.copy(pos);
      const v = new THREE.Vector3(
        dir.x + (Math.random() - 0.5) * spread,
        dir.y + (Math.random() - 0.5) * spread,
        dir.z + (Math.random() - 0.5) * spread,
      ).multiplyScalar(speed * (0.6 + Math.random() * 0.6));
      add({ obj: m, v, life: 2, kind: 'drop' });
    }
  },
  // soft cloud that grows and fades (vape vapor, smoke)
  puff(pos, vel, { color = '#ffffff', size0 = 0.08, size1 = 0.6, life = 1.6, opacity = 0.55 } = {}) {
    const m = new THREE.SpriteMaterial({ map: soft, color, transparent: true, depthWrite: false, opacity });
    const s = new THREE.Sprite(m);
    s.position.copy(pos);
    s.scale.setScalar(size0);
    add({ obj: s, v: vel.clone(), life, max: life, kind: 'puff', size0, size1, opacity });
  },
  zzz(pos) {
    const m = new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.position.copy(pos);
    s.scale.setScalar(0.1);
    add({ obj: s, v: new THREE.Vector3(0.05, 0.22, 0), life: 2.2, max: 2.2, kind: 'z', size0: 0.1, size1: 0.22, opacity: 1 });
  },
  update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.life -= dt;
      const o = p.obj;
      if (p.kind === 'drop') {
        p.v.y -= 9.8 * dt;
        o.position.addScaledVector(p.v, dt);
        if (o.position.y <= 0.01 || p.life <= 0) {
          kill(i);
          continue;
        }
      } else {
        const k = 1 - p.life / p.max;
        o.position.addScaledVector(p.v, dt);
        p.v.multiplyScalar(1 - dt * 0.8);
        if (p.kind === 'z') o.position.x += Math.sin(p.life * 5) * 0.003;
        o.scale.setScalar(p.size0 + (p.size1 - p.size0) * Math.sqrt(k));
        o.material.opacity = p.opacity * (1 - k);
        if (p.life <= 0) kill(i);
      }
    }
  },
};
