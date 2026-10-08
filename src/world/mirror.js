// The bathroom mirror: a real reflection, and Oleg's own body shows up in it
// (he's invisible to the main camera — first person — but the mirror sees him).
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { makePerson } from './figures.js';

// seen(camera): can the mirror really be seen from there (frustum culling can't tell, it sees through walls)
export function createMirror({ furn, scene, hands, style, seen }) {
  const sink = furn.items.bathSink;
  let src = null;
  sink.group.traverse((o) => o.userData.mirror && (src = o));
  if (!src) return null;
  src.geometry.computeBoundingBox();
  const bb = src.geometry.boundingBox;
  const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
  const n = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }[sink.facing];
  const alongX = Math.abs(n[2]) > 0;
  const w = alongX ? size.x : size.z, h = size.y;
  const mirror = new Reflector(new THREE.PlaneGeometry(w, h), { textureWidth: 512, textureHeight: 512, color: 0xb8c4c8, clipBias: 0.003 });
  mirror.position.copy(center).add(new THREE.Vector3(...n).multiplyScalar(0.012));
  mirror.lookAt(mirror.position.clone().add(new THREE.Vector3(...n)));
  src.visible = false;
  scene.add(mirror);

  // Oleg's body, only rendered for the reflection
  let oleg = makePerson({ name: 'Олег', faceId: 'oleg', style, shirt: '#3a3f52', pants: '#2b2f3a', hair: '#e8d08a', label: false });
  oleg.root.visible = false;
  scene.add(oleg.root);
  const orig = mirror.onBeforeRender;
  let primed = false; // the first frame always fills it, so it's never blank
  mirror.onBeforeRender = function (...args) {
    // the reflection draws the whole flat again: only while someone can actually see it,
    // otherwise it keeps its last picture (from afar nobody can tell)
    if (primed && !seen(args[2])) return;
    primed = true;
    mirror.userData.reflected = true; // read by the performance meter
    const hv = hands.root.visible;
    oleg.root.visible = true;
    hands.root.visible = false;
    orig.apply(this, args);
    oleg.root.visible = false;
    hands.root.visible = hv;
  };

  return {
    restyle(styleName) {
      scene.remove(oleg.root);
      oleg = makePerson({ name: 'Олег', faceId: 'oleg', style: styleName, shirt: '#3a3f52', pants: '#2b2f3a', hair: '#e8d08a', label: false });
      oleg.root.visible = false;
      scene.add(oleg.root);
    },
    update(dt, { x, z, yaw, moving, drunk, item }) {
      oleg.root.position.set(x, 0, z);
      oleg.root.rotation.y = yaw + Math.PI;
      oleg.setLoop(null);
      oleg.update(dt, { walking: moving, speed: 2.5, drunk: drunk / 100 });
      // near the mirror he waves at himself when the hands are empty
      if (!item && !moving && !oleg.busy && Math.random() < dt * 0.15) oleg.play('talk');
    },
  };
}
