// Clothes from an unfolded "papercraft" skin sheet (front/back/side views of each body part).
// Coordinates are in pixels of the sheet: [x, y, w, h]. A part can be stacked from several pieces
// (e.g. upper and lower legs drawn separately on the sheet).
import * as THREE from 'three';
import lyokha from '../assets/skins/lyokha.png?inline';

export const SKINS = {
  lyokha: {
    src: lyokha,
    hairTop: '#a07a50',
    torsoFront: [[268, 100, 62, 92]],
    torsoBack: [[411, 107, 57, 83]],
    torsoSide: [[268, 100, 8, 92]],
    armFront: [[238, 102, 27, 76]],
    armBack: [[470, 110, 27, 68]],
    legFrontL: [[269, 201, 29, 40], [269, 249, 29, 68]],
    legFrontR: [[301, 201, 29, 40], [302, 249, 28, 68]],
    legBackL: [[412, 249, 28, 68]],
    legBackR: [[442, 249, 28, 68]],
    headFront: [[73, 40, 46, 52]],
    headBack: [[133, 38, 51, 54]],
    headSide: [[198, 38, 52, 54]],
  },
};

const images = {};
function sheet(id) {
  if (!images[id]) {
    const img = new Image();
    images[id] = { img, ready: false, waiters: [] };
    img.onload = () => {
      images[id].ready = true;
      images[id].waiters.forEach((fn) => fn());
    };
    img.src = SKINS[id].src;
  }
  return images[id];
}

// texture made of one or more sheet pieces stacked vertically; flip = mirror horizontally
function partTexture(id, pieces, flip = false) {
  const w = 64, h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const g = c.getContext('2d');
    const total = pieces.reduce((s, p) => s + p[3], 0);
    let y = 0;
    g.save();
    if (flip) {
      g.translate(w, 0);
      g.scale(-1, 1);
    }
    for (const [sx, sy, sw, sh] of pieces) {
      const dh = (sh / total) * h;
      g.drawImage(sheet(id).img, sx, sy, sw, sh, 0, y, w, dh);
      y += dh;
    }
    g.restore();
    tex.needsUpdate = true;
  };
  const s = sheet(id);
  if (s.ready) draw();
  else s.waiters.push(draw);
  return tex;
}

const matOf = (id, pieces, flip) => new THREE.MeshStandardMaterial({ map: partTexture(id, pieces, flip), roughness: 0.9 });

// Per-face materials for the box body, in BoxGeometry order [+x, -x, +y, -y, +z(front), -z(back)].
export function skinMaterials(id) {
  const s = SKINS[id];
  if (!s) return null;
  const dark = new THREE.MeshStandardMaterial({ color: '#1c1c1e', roughness: 0.9 });
  const side = matOf(id, s.torsoSide);
  const arm = matOf(id, s.armFront);
  const armBack = matOf(id, s.armBack);
  const legs = ['L', 'R'].map((k) => {
    const front = matOf(id, s[`legFront${k}`]);
    const back = matOf(id, s[`legBack${k}`]);
    return [front, front, dark, dark, front, back];
  });
  return {
    torso: [side, side, dark, dark, matOf(id, s.torsoFront), matOf(id, s.torsoBack)],
    arm: [arm, arm, dark, dark, arm, armBack],
    legs,
    head: s.headFront && {
      // +x is the figure's left side: the sheet's profile looks right, so mirror it for that side
      front: matOf(id, s.headFront),
      sides: [matOf(id, s.headSide, true), matOf(id, s.headSide)],
      back: matOf(id, s.headBack),
      top: new THREE.MeshStandardMaterial({ color: s.hairTop, roughness: 0.9 }),
    },
  };
}
