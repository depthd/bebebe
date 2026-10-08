// The 3D models in src/assets/models (built by `npm run assets`, all CC0, see LICENSES.md there).
// They are separate .glb files, not inlined: a model's textures would triple in size as base64.
// loadModels() runs once before the world is built; model(id) hands out a copy that shares
// geometry and materials with the loaded original.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const URLS = import.meta.glob('../assets/models/*.glb', { eager: true, query: '?url', import: 'default' });
const loaded = {};
const sizes = {};

export async function loadModels() {
  const loader = new GLTFLoader();
  await Promise.all(
    Object.entries(URLS).map(async ([path, url]) => {
      const id = path.split('/').pop().replace('.glb', '');
      loaded[id] = (await loader.loadAsync(url)).scene;
      sizes[id] = new THREE.Box3().setFromObject(loaded[id]).getSize(new THREE.Vector3());
    }),
  );
}

// width (x), height (y), depth (z) in meters, as built
export const modelSize = (id) => sizes[id];

export function model(id) {
  if (!loaded[id]) throw new Error(`model ${id} is missing: add it to scripts/assets/assets.json and run npm run assets`);
  return loaded[id].clone();
}
