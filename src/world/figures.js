// Low-poly people, the cat, floating labels and small props (puddles, toy, table bottles).
// People face local +z (Object3D.lookAt points +z at the target).
import * as THREE from 'three';
import { blockyBottle } from './goods.js';
import { mat } from './apartment.js';
import { drawFace, faceAspect, hasMoodFaces, moodState, moodFace } from './faces.js';
import { createRig } from './anim.js';
import { iconTexture, hasRealIcon } from '../ui/icons.js';

// the "!" over someone with a problem: the Qwen icon if there is one, else a plain red badge
let badgeTex = null;
function alertTexture() {
  if (hasRealIcon('alert')) return iconTexture('alert');
  if (badgeTex) return badgeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(224,65,47,0.35)';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e0412f';
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 76px "Russo One", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('!', 64, 68);
  badgeTex = new THREE.CanvasTexture(c);
  badgeTex.colorSpace = THREE.SRGBColorSpace;
  return badgeTex;
}
import { skinMaterials } from './skins.js';

export function textSprite(text, { bg = 'rgba(20,18,24,0.78)', fg = '#fff', size = 40, scale = 0.001 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `bold ${size}px "Russo One", "Arial", sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + size;
  c.width = w;
  c.height = Math.ceil(size * 1.5);
  g.font = font;
  g.fillStyle = bg;
  const r = c.height / 2;
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, r);
  g.fill();
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // constant on-screen size, so a friend standing next to you doesn't get a giant name tag
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(c.width * scale, c.height * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// Name tag, problem bubble and speech bubble shared by both character styles.
function makeTags(root, name, label) {
  let nameTag = null, bubble = null, bubbleText = null, speech = null, speechLeft = 0, bounce = 0;
  let baseY = 2.0;
  if (label) {
    nameTag = textSprite(name);
    root.add(nameTag);
  }
  const place = () => {
    if (nameTag) nameTag.position.y = baseY;
    if (bubble) bubble.position.y = baseY + 0.3;
    if (speech) speech.position.y = baseY + (bubble ? 0.56 : 0.28);
  };
  place();
  return {
    setY(y) {
      baseY = y;
      place();
    },
    // a problem shows as a bouncing "!" next to him; what exactly is wrong you see when you look at him
    setStatus(text) {
      if (!!text === !!bubbleText) return (bubbleText = text);
      bubbleText = text;
      if (bubble) {
        root.remove(bubble);
        bubble = null;
      }
      if (text) {
        bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTexture(), transparent: true, depthTest: false, sizeAttenuation: false }));
        bubble.scale.set(0.055, 0.055, 1);
        bubble.renderOrder = 11;
        root.add(bubble);
      }
      place();
    },
    showName(v) {
      if (nameTag) nameTag.visible = v;
    },
    say(text, seconds = 3.5) {
      if (speech) {
        root.remove(speech);
        speech.material.map.dispose();
        speech.material.dispose();
      }
      speech = textSprite(`«${text}»`, { bg: 'rgba(250,246,236,0.95)', fg: '#1b1408', size: 34 });
      speechLeft = seconds;
      root.add(speech);
      place();
    },
    tick(dt) {
      if (bubble) {
        bounce += dt;
        bubble.position.y = baseY + 0.3 + Math.abs(Math.sin(bounce * 5)) * 0.08;
        const s = 0.055 + 0.008 * Math.sin(bounce * 10);
        bubble.scale.set(s, s, 1);
      }
      if (speech && (speechLeft -= dt) <= 0) {
        root.remove(speech);
        speech.material.map.dispose();
        speech.material.dispose();
        speech = null;
      }
    },
  };
}

// Low-poly body; the head is either a cube with the face on the front (style 'box')
// or a flat Doom-style billboard that always faces you (style 'sprite')
export function makePerson(opts) {
  return makeBoxPerson(opts);
}

function faceTexture(opts, { w = 128, h = 128, cutout = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  drawFace(c.getContext('2d'), opts.faceId, opts, 0, 0, w, h, () => (tex.needsUpdate = true), { cutout });
  return tex;
}

function makeBoxPerson(opts) {
  const { name, shirt, pants = '#2b2f3a', skin = '#e2b594', hair = '#3b2a1e', label = true } = opts;
  const who = opts.faceId;
  const root = new THREE.Group();
  const tilt = new THREE.Group(); // falling over: the whole body tips around the feet (name tags stay upright)
  root.add(tilt);
  const body = new THREE.Group();
  tilt.add(body);
  const m = { shirt: mat(shirt, { roughness: 0.9 }), pants: mat(pants, { roughness: 0.9 }), skin: mat(skin, { roughness: 0.7 }), hair: mat(hair) };
  const sk = skinMaterials(who); // clothes from a skin sheet, if this guy has one
  const rig = createRig(body, { m, sk, style: opts.style });
  const arms = rig.arms.map((a) => a.shoulder);

  // ---- head: mood pictures (<who>_<state>) if he has them, otherwise the photo / drawn face
  const mood = hasMoodFaces(who);
  let head, faceMat = null;
  const HH = 0.5; // big on purpose: the faces are the point
  if (opts.style === 'sprite') {
    // Doom-style head: a flat cut-out face that always turns to the camera
    const aspect = faceAspect(who);
    const tex = faceTexture({ ...opts, skin, hair }, { w: 256, h: Math.round(256 / aspect), cutout: true });
    head = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.1 }));
    head.scale.set(HH * aspect, HH, 1);
    head.center.set(0.5, 0);
    head.position.y = -0.01;
    rig.neck.add(head);
  } else {
    // cube head: face on the front (+z), hair on top and back
    faceMat = new THREE.MeshStandardMaterial({ map: faceTexture({ ...opts, skin, hair }), roughness: 0.8 });
    const h = sk?.head;
    const mats = h ? [h.sides[0], h.sides[1], h.top, m.skin, mood ? faceMat : h.front, h.back] : [m.skin, m.skin, m.hair, m.skin, faceMat, m.hair];
    head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.3).translate(0, 0.2, 0), mats);
    rig.neck.add(head);
  }

  // the photo / drawn face, used for moods that have no picture yet
  const legacy = { map: head.isSprite ? head.material.map : faceMat.map, aspect: faceAspect(who) };
  const moodTex = {};
  let faceState;
  const setFace = (state) => {
    if (!mood) return;
    state = moodState(who, state);
    if (state === faceState) return;
    faceState = state;
    if (!state) {
      if (head.isSprite) {
        head.material.map = legacy.map;
        head.material.needsUpdate = true;
        head.scale.set(HH * legacy.aspect, HH, 1);
        head.position.y = -0.01;
        rig.neckMesh.visible = true;
      } else {
        faceMat.map = legacy.map;
        faceMat.needsUpdate = true;
      }
      return;
    }
    moodFace(who, state).then((f) => {
      if (faceState !== state) return;
      if (!moodTex[state]) {
        let c = f.canvas;
        if (!head.isSprite) {
          // the cube face needs an opaque picture: hair colour behind the cut-out
          const bg = document.createElement('canvas');
          bg.width = c.width;
          bg.height = c.height;
          const g = bg.getContext('2d');
          g.fillStyle = hair;
          g.fillRect(0, 0, bg.width, bg.height);
          g.drawImage(c, 0, 0);
          c = bg;
        }
        moodTex[state] = new THREE.CanvasTexture(c);
        moodTex[state].colorSpace = THREE.SRGBColorSpace;
      }
      if (head.isSprite) {
        head.material.map = moodTex[state];
        head.material.needsUpdate = true;
        head.scale.set(HH * f.aspect, HH, 1);
        head.position.y = -0.1; // mood heads come with their own short neck: sit it in the collar
        rig.neckMesh.visible = false;
      } else {
        faceMat.map = moodTex[state];
        faceMat.needsUpdate = true;
      }
    });
  };
  setFace('default');

  // drinking picture (bottle + hand in frame): replaces the head and the left arm while sipping
  let drink = null, sipLeft = 0;
  if (opts.drinkFaceId) {
    const aspect = faceAspect(opts.drinkFaceId);
    const tex = faceTexture({ ...opts, faceId: opts.drinkFaceId, skin, hair }, { w: 384, h: Math.round(384 / aspect), cutout: true });
    drink = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.1 }));
    const dh = 0.72; // a bit bigger than the normal head: bottle and hand are in frame
    drink.scale.set(dh * aspect, dh, 1);
    drink.center.set(0.71, 0); // his head sits right of centre in the photo, the bottle sticks out left
    drink.position.y = -0.22;
    drink.visible = false;
    rig.neck.add(drink);
  }
  const showDrink = (on) => {
    drink.visible = on;
    head.visible = !on;
    arms[1].visible = !on; // arms[1] is the figure's left arm
  };

  const tags = makeTags(root, name, label);
  return {
    root, body, arms, rig, ...tags,
    setFace,
    // colour over the face: green when he's about to be sick
    setTint(c) {
      if (head.isSprite && head.material.color.getHexString() !== c.replace('#', '')) head.material.color.set(c);
    },
    // swaying on his feet (balance): forward lean p, sideways r (radians)
    setLean(p, r) {
      tilt.rotation.set(p, 0, r);
      tilt.position.y = 0;
    },
    // k: 0 standing .. 1 flat on the floor; dir: where he falls, relative to where he faces (radians)
    setFall(k, dir = 0) {
      const a = k * Math.PI * 0.5;
      tilt.rotation.set(Math.cos(dir) * a, 0, -Math.sin(dir) * a);
      tilt.position.y = 0.13 * k; // the body has some thickness when lying
    },
    setLoop: (name, o) => rig.setLoop(name, o),
    play: (name, o) => rig.play(name, o),
    get busy() {
      return rig.busy;
    },
    // take a sip: the drinking photo if he has one, otherwise a 3D bottle to the mouth
    sip(seconds = 2.4, kind = 'beer') {
      if (drink) {
        sipLeft = seconds;
        showDrink(true);
        rig.play('drinkPhoto', { dur: seconds });
      } else rig.play('drink', { kind, dur: seconds });
    },
    setPose(p, y = 0) {
      rig.setPose(p);
      body.rotation.set(0, 0, 0);
      body.position.set(0, 0, 0);
      if (p === 'sit') body.position.y = -0.37 + y;
      else if (p === 'lie') {
        body.rotation.x = -Math.PI / 2;
        body.position.y = y + 0.12;
        body.position.z = 0.85;
      }
      tags.setY(p === 'lie' ? 1.1 + y : p === 'sit' ? 1.6 + y : 2.0);
    },
    update(dt, state = {}) {
      tags.tick(dt);
      if (sipLeft > 0 && (sipLeft -= dt) <= 0) showDrink(false);
      rig.update(dt, state);
    },
    get pose() {
      return rig.pose;
    },
  };
}

export function makeCat({ label = true } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // black Persian: a fluffy round body, flat face, big orange eyes
  const fur = mat('#1f1916', { roughness: 1 });
  const dark = mat('#120e0c', { roughness: 1 });
  body.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.2, 6, 10).rotateX(Math.PI / 2).translate(0, 0.17, 0), fur));
  const head = new THREE.Group();
  head.position.set(0, 0.26, 0.17);
  body.add(head);
  const skull = new THREE.Group(); // drawn head, until his photo is ready
  head.add(skull);
  skull.add(new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 12).scale(1.1, 0.95, 0.85), fur));
  const eye = new THREE.MeshStandardMaterial({ color: '#f08a1c', emissive: '#7a3a00', emissiveIntensity: 0.6, roughness: 0.2 });
  for (const x of [-0.04, 0.04]) {
    skull.add(new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.035, 4).translate(x * 1.4, 0.08, -0.01), dark)); // small Persian ears
    skull.add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8).translate(x, 0.01, 0.075), eye));
    skull.add(new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4).translate(x, 0.01, 0.092), mat('#050505')));
  }
  // his real face (src/assets/faces/cat_default.png): a flat head that turns to the camera, like the guys
  if (hasMoodFaces('cat')) {
    moodFace('cat', 'default').then((f) => {
      const tex = new THREE.CanvasTexture(f.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.05 }));
      const fh = 0.27;
      face.scale.set(fh * f.aspect, fh, 1);
      face.center.set(0.5, 0.35);
      face.userData.catFace = true;
      head.add(face);
      skull.visible = false;
    });
  }
  const legs = [];
  for (const [x, z] of [[-0.05, 0.1], [0.05, 0.1], [-0.05, -0.1], [0.05, -0.1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12).translate(0, -0.06, 0), fur);
    leg.position.set(x, 0.12, z);
    body.add(leg);
    legs.push(leg);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.26, 8).translate(0, 0.13, 0), fur); // bushy
  tail.position.set(0, 0.2, -0.17);
  tail.rotation.x = -0.6;
  body.add(tail);

  let tag = null;
  if (label) {
    tag = textSprite('Кот', { size: 34 });
    tag.position.y = 0.6;
    root.add(tag);
  }
  let bubble = null, bubbleText = null;
  return {
    root,
    showName(v) {
      if (tag) tag.visible = v;
    },
    setStatus(text) {
      if (!!text === !!bubbleText) return (bubbleText = text);
      bubbleText = text;
      if (bubble) {
        root.remove(bubble);
        bubble = null;
      }
      if (!text) return;
      bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTexture(), transparent: true, depthTest: false, sizeAttenuation: false }));
      bubble.scale.set(0.05, 0.05, 1);
      bubble.renderOrder = 11;
      bubble.position.y = 0.85;
      root.add(bubble);
    },
    // play = { run, crouch (0..1, ready to pounce), pounce (0..1 through the jump), bat (0..1 paw swipe) }
    animate(t, walking, play = {}) {
      const { run = false, crouch = 0, pounce = 0, bat = 0 } = play;
      const freq = run ? 24 : 14, amp = run ? 0.85 : 0.5;
      const s = walking ? Math.sin(t * freq) * amp : 0;
      legs[0].rotation.x = legs[3].rotation.x = s;
      legs[1].rotation.x = legs[2].rotation.x = -s;
      // crouched low with the rear end wiggling, then the jump
      const hop = Math.sin(Math.PI * pounce);
      body.position.y = -0.05 * crouch + 0.22 * hop + (run && walking ? Math.abs(Math.sin(t * freq)) * 0.03 : 0);
      body.rotation.x = 0.12 * crouch + (pounce > 0 ? (pounce - 0.5) * 0.7 : 0); // nose up on take-off, down on landing
      body.rotation.z = crouch * Math.sin(t * 30) * 0.06;
      if (pounce > 0) legs[0].rotation.x = legs[1].rotation.x = -1.1 * hop; // front paws out
      if (bat > 0) legs[t % 2 < 1 ? 0 : 1].rotation.x = -1.6 * Math.sin(Math.PI * bat);
      tail.rotation.z = Math.sin(t * (crouch > 0 || run ? 9 : 3)) * (crouch > 0 ? 0.25 : 0.4);
      tail.rotation.x = run ? -1.1 : -0.6;
    },
  };
}

export function makePuddle(x, z) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 16).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#9aa53a', roughness: 0.15, transparent: true, opacity: 0.85 }),
  );
  mesh.scale.set(1 + Math.random() * 0.4, 1, 0.7 + Math.random() * 0.4);
  mesh.position.set(x, 0.008 + Math.random() * 0.002, z);
  return mesh;
}

export function makeToy() {
  const g = new THREE.Group();
  const grey = mat('#8d8d8d', { roughness: 1 });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8).scale(1, 0.7, 1.5).translate(0, 0.035, 0), grey));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4).translate(-0.025, 0.07, 0.05), mat('#e0a0a0')));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4).translate(0.025, 0.07, 0.05), mat('#e0a0a0')));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14).rotateX(Math.PI / 2).translate(0, 0.02, -0.13), mat('#d05050')));
  return g;
}

// Zinc bucket: for putting out the balcony fire. `water` = the water inside (shown when full)
export function makeBucket() {
  const g = new THREE.Group();
  const zinc = mat('#a9b1b8', { metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.28, 18, 1, true).translate(0, 0.14, 0), zinc));
  g.add(new THREE.Mesh(new THREE.CircleGeometry(0.11, 18).rotateX(-Math.PI / 2).translate(0, 0.005, 0), zinc));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 6, 20).rotateX(Math.PI / 2).translate(0, 0.28, 0), zinc)); // rim
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.006, 6, 16, Math.PI), mat('#70757a', { metalness: 0.7 }));
  handle.position.y = 0.28;
  g.add(handle);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.14, 18).rotateX(-Math.PI / 2).translate(0, 0.22, 0), new THREE.MeshStandardMaterial({ color: '#6fb6e6', roughness: 0.05, transparent: true, opacity: 0.85 }));
  water.visible = false;
  g.add(water);
  g.userData.water = water;
  return g;
}

export function makeBottle(kind) {
  return new THREE.Group().add(blockyBottle(kind === 'vodka' ? 'vodka' : 'beer'));
}

export function makePlate() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.02, 16).translate(0, 0.01, 0), mat('#f7f7f2', { roughness: 0.3 })));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1).translate(0, 0.02, 0), mat('#e8d9a0'))); // olivier
  return g;
}

// Broken marker: a crooked red cross floating over the item
export function makeBrokenMark() {
  const g = new THREE.Group();
  const red = new THREE.MeshBasicMaterial({ color: '#ff3b30' });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05).rotateZ(Math.PI / 4), red));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05).rotateZ(-Math.PI / 4), red));
  return g;
}
