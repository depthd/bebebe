// Art-style prototypes, `?style=<id>`: a whole-game look laid over the normal build, to compare looks
// before one becomes the game's (docs/STYLE.md). Nothing here loads without the URL parameter.
// A style is src/styles/<id>.js with `export default { name, apply(ctx) }`; apply may return
// { update(dt, time) }, called every frame before the picture is drawn.
// ctx:
//   THREE, scene, renderer, camera, composer, apt, furn, outside, game (game/apt/furn/outside are absent in the showroom)
//   each(fn)         fn(mesh) for every mesh, sprite and line in the scene now and every one added later
//                    (new ones are picked up twice a second); a mesh is handed out once
//   linearPass(p)    a post pass on the linear picture, before tone mapping (after the drunk pass)
//   displayPass(p)   a post pass on display colours, after the output pass and before "Oleg's eyes"
import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const STYLES = import.meta.glob(['./*.js', '!./index.js']);

export const styleIds = () => Object.keys(STYLES).map((p) => p.slice(2, -3));

export async function applyStyle(id, base) {
  const load = STYLES[`./${id}.js`];
  if (!load) {
    console.warn(`no style "${id}"; there are: ${styleIds().join(', ')}`);
    return null;
  }
  const style = (await load()).default;
  const seen = new WeakSet();
  const handlers = [];
  const visit = (o) => {
    if (seen.has(o) || !(o.isMesh || o.isSprite || o.isLine || o.isPoints)) return;
    seen.add(o);
    for (const fn of handlers) fn(o);
  };
  const passes = () => base.composer?.passes ?? [];
  const outputAt = () => passes().findIndex((p) => p instanceof OutputPass);
  const ctx = {
    THREE,
    ...base,
    each(fn) {
      handlers.push(fn);
      base.scene.traverse((o) => seen.has(o) && (o.isMesh || o.isSprite || o.isLine || o.isPoints) && fn(o));
      base.scene.traverse(visit);
    },
    linearPass(p) {
      const i = outputAt();
      base.composer.insertPass(p, i < 0 ? passes().length : i);
    },
    displayPass(p) {
      const i = outputAt();
      base.composer.insertPass(p, i < 0 ? passes().length : i + 1);
    },
  };
  const live = (await style.apply(ctx)) ?? {};
  let scanIn = 0;
  console.info(`style: ${style.name ?? id}`);
  return {
    id,
    name: style.name ?? id,
    update(dt, time) {
      if ((scanIn -= dt) <= 0) {
        scanIn = 0.5;
        base.scene.traverse(visit);
      }
      live.update?.(dt, time);
    },
  };
}
