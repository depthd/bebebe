// Art style "doom" (?style=doom): Думовская хрущёвка, the flat as a mid-90s Build-engine level.
//  - about 400 lines, nearest upscale, no MSAA, no tone mapping;
//  - sector light: every room has one light level (zal bright, hall dim, stairwell and yard dark),
//    dying off with distance in 32 bands (lib/doom-sector.js, lib/doom-material.js), no per-pixel lights;
//  - 64-128 px per metre textures, quantised to one 256-colour palette (lib/doom-textures.js), and a
//    palette LUT pass at the end so the bands and the drunk blur snap to the same 256 colours;
//  - the photo heads as digitised sprites (80 px, ordered dither) that take the sector light;
//  - fullbright floors so bottles, puddles, doors, the cat's eyes and the guys never vanish in the dark.
// Knobs: &lines=480 (resolution), &wobble=1 (PS1 vertex snap + affine textures, off by default).
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as T from '../world/textures.js';
import { lut3D, snapHex } from './lib/doom-palette.js';
import { createSector } from './lib/doom-sector.js';
import { createTextures, uvPerMetre } from './lib/doom-textures.js';
import { createWorldMaterials } from './lib/doom-material.js';

const TUNE = {
  lines: 400, // drawing-buffer height
  band: [3, 13], // light dims from 3 m and is fully dimmed at 13 m (by 30% in a lit room, more in dark ones)
  tint: 0.6, // how much of the lamp colour gets into the sector light (0 white .. 1 the lamp's colour)
  floor: { item: 0.5, person: 0.4, bright: 1 }, // fullbright floors (display-space light)
  headMin: 0.35, // a face never gets darker than this
  pxPerM: { prop: 128 },
  heads: { head: 80, drink: 120, cat: 48 }, // sprite heights in px
  dither: 1 / 32, // ordered dither on the heads: offsets up to ±1/32 of the range
  vignette: 0.12, // the sober vignette (fx.js has 0.3): in 256 colours it shows as rings
};

const isHead = (o) => o.isSprite && o.material.alphaTest > 0 && o.material.sizeAttenuation !== false && o.material.blending !== THREE.AdditiveBlending;

// the head sprites take the sector light: their colour stays the game's (green when he's sick)
const HEAD_LIT = new WeakMap();
function headCompile(shader) {
  shader.uniforms.uDoomLit = HEAD_LIT.get(this);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uDoomLit;')
    .replace('#include <opaque_fragment>', 'outgoingLight *= uDoomLit;\n#include <opaque_fragment>');
}

// the palette pass (three's LUTPass shader, sampled nearest): every display colour to its palette colour
const paletteShader = (lut) => ({
  uniforms: { tDiffuse: { value: null }, lut: { value: lut }, lutSize: { value: lut.image.width } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp sampler3D;
    uniform sampler2D tDiffuse;
    uniform sampler3D lut;
    uniform float lutSize;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 uvw = (0.5 + clamp(c.rgb, 0.0, 1.0) * (lutSize - 1.0)) / lutSize;
      gl_FragColor = vec4(texture(lut, uvw).rgb, c.a);
    }`,
});

export default {
  name: 'Doom',
  apply(ctx) {
    const { scene, renderer, camera, composer, apt, furn, outside, game } = ctx;
    const T0 = performance.now(); const tlog = (w) => console.info(`doom ${w} ${(performance.now() - T0).toFixed(0)} ms`);
    const params = new URLSearchParams(location.search);
    const lines = Number(params.get('lines')) || TUNE.lines;
    const wobble = params.get('wobble') === '1';

    // ---- 1) resolution: ~400 lines, nearest upscale, no MSAA, no tone mapping
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.domElement.style.imageRendering = 'pixelated';
    const camCanvas = document.getElementById('cam-canvas'); // the door camera's copy in the phone
    if (camCanvas) camCanvas.style.imageRendering = 'pixelated';
    for (const t of [composer.renderTarget1, composer.renderTarget2]) {
      t.samples = 0;
      t.dispose();
    }
    const filterPass = () => composer.passes.find((p) => p.uniforms?.uMode && p.uniforms?.uRes); // "Глаза Олега"
    let fitted = '';
    const fit = () => {
      const pr = lines / innerHeight;
      const key = `${innerWidth}x${innerHeight}`;
      if (key !== fitted || Math.abs(renderer.getPixelRatio() - pr) > 1e-4) {
        fitted = key;
        renderer.setPixelRatio(pr);
        renderer.setSize(innerWidth, innerHeight);
        composer.setPixelRatio(pr);
        composer.setSize(innerWidth, innerHeight);
      }
      const f = filterPass();
      if (f) f.uniforms.uRes.value = [Math.floor(innerWidth * pr), Math.floor(innerHeight * pr)];
    };
    fit();

    // ---- 2) sector light
    const sector = createSector({ apt, outside, game, tint: TUNE.tint });
    const band = new THREE.Vector2(...TUNE.band);
    tlog('sector');

    // ---- 5) textures: 64-128 px per metre, the palette, nearest
    const textures = createTextures();
    const KNOWN = new Map();
    for (const [k, fn] of Object.entries(T.wallpapers)) if (k !== 'wallTile') KNOWN.set(fn(), { size: () => [64, 64] }); // 0.5 m each
    KNOWN.set(T.parquet(), { size: () => [64, 64] });
    KNOWN.set(T.linoleum(), { size: () => [64, 64] });
    KNOWN.set(T.concrete(), { size: () => [64, 64] });
    KNOWN.set(T.wallTile(), { tiles: [6, 11] }); // 6 tiles a metre, redrawn pixel-exact
    KNOWN.set(T.floorTile(), { tiles: [10, 7] });
    KNOWN.set(T.wallCarpet(), { size: () => [128, 80] });
    KNOWN.set(T.floorRug(), { size: () => [128, 80] });
    KNOWN.set(T.cityFacade(), { size: (w, h) => [w / 2, h / 2] });

    // ---- what each mesh is: people, gameplay things, the always-bright bits
    const containers = new Set([scene, camera, game?.dynamic, apt?.group, furn?.group, outside?.group].filter(Boolean));
    const rootOf = (o) => {
      let r = o;
      while (r.parent && !containers.has(r.parent)) r = r.parent;
      return r;
    };
    const persons = new WeakMap();
    const isPerson = (root) => {
      if (persons.has(root)) return persons.get(root);
      const t = root.userData.target;
      let p = !!(t?.friend || t?.cat);
      if (!p) root.traverse((o) => (p ||= isHead(o)));
      persons.set(root, p);
      return p;
    };
    const bright = (m) => m.color?.getHexString() === 'f08a1c' || m.name?.startsWith('alarm_clock_01') || m.emissive?.getHexString() === '7a2cff';
    const floorOf = (mesh, m) => {
      if (bright(m)) return TUNE.floor.bright;
      if (isPerson(rootOf(mesh))) return TUNE.floor.person;
      for (let o = mesh; o; o = o.parent) {
        const t = o.userData.target;
        if (t && !t.item) return TUNE.floor.item; // furniture is a target too (t.item): it stays in the dark
        if (o === game?.dynamic) return TUNE.floor.item;
      }
      return 0;
    };
    const mapOf = (tex, mesh, src) => {
      const known = KNOWN.get(tex);
      if (known) return textures.get(tex, known);
      const alphaCut = src.alphaTest > 0 ? 0.5 : null;
      if (isPerson(rootOf(mesh))) return textures.get(tex, { size: (w, h) => [w / 4, h / 4], alphaCut }); // skin parts: 16 px a face
      if (mesh.userData.target?.name === 'Картина') return textures.get(tex, { size: (w, h) => (w > h ? [256, (256 * h) / w] : [(256 * w) / h, 256]) });
      const r = uvPerMetre(mesh, tex);
      return textures.get(tex, {
        alphaCut,
        size: (w, h) => {
          const s = r ? Math.min(1, TUNE.pxPerM.prop / (r * Math.sqrt(w * h))) : 128 / Math.max(w, h);
          const k = Math.max(s, 8 / Math.min(w, h));
          return [w * k, h * k];
        },
      });
    };
    const world = createWorldMaterials({ shared: { uniforms: sector.uniforms, band }, snap: snapHex, map: mapOf, wobble });

    // ---- heads: digitised sprites lit by the sector they're in
    const heads = new Map();
    const HEADOPT = Object.fromEntries(Object.entries(TUNE.heads).map(([k, px]) => [k, { size: (w, h) => [(px * w) / h, px], dither: TUNE.dither, alphaCut: 0.5 }]));
    const addHead = (s) => {
      const kind = s.userData.catFace ? 'cat' : s.scale.y > 0.6 ? 'drink' : 'head';
      const u = { value: new THREE.Vector3(1, 1, 1) };
      HEAD_LIT.set(s.material, u);
      s.material.onBeforeCompile = headCompile;
      s.material.needsUpdate = true;
      heads.set(s, { kind, u });
    };

    // ---- the one handler for every mesh and sprite, now and later
    const done = new WeakSet();
    const style = (o) => {
      if (done.has(o)) return;
      done.add(o);
      if (o.isSprite) {
        if (isHead(o)) addHead(o);
        return;
      }
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      let changed = false;
      const out = list.map((m) => {
        if (!m || world.isConverted(m) || m.isShaderMaterial) return m;
        if (m.isMeshBasicMaterial) {
          if (m.map && KNOWN.has(m.map)) m.map = textures.get(m.map, KNOWN.get(m.map)); // the city facade
          else if (m.map && m.alphaTest > 0 && m.map.isCanvasTexture) m.map = textures.get(m.map, HEADOPT.cat); // the cat's face in Oleg's arms
          return m;
        }
        if (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) {
          changed = true;
          return world.convert(m, floorOf(o, m), o);
        }
        return m;
      });
      if (changed) o.material = Array.isArray(o.material) ? out : out[0];
    };
    tlog('pre-each');
    ctx.each(style);
    tlog('each');

    // the drunk pass's film grain becomes sparkling palette noise at 256 colours: off; vignette lighter
    const drunk = composer.passes.find((p) => p.uniforms?.uDrunk);
    if (drunk) {
      drunk.material.fragmentShader = drunk.material.fragmentShader
        .replace('col.rgb *= 1.0 + (n - 0.5) * 0.06;', '')
        .replace('(0.3 + uDrunk * 0.6)', `(${TUNE.vignette.toFixed(3)} + uDrunk * 0.6)`);
      drunk.material.needsUpdate = true;
    }

    // ---- 6) the palette pass, after the drunk pass and the output pass
    ctx.displayPass(new ShaderPass(paletteShader(lut3D())));

    const v = new THREE.Vector3(), cam = new THREE.Vector3(), L = [0, 0, 0, 0];
    const attached = (o) => {
      for (; o; o = o.parent) if (o === scene) return true;
      return false;
    };
    window.__doom = { sector, textures, heads, TUNE };
    tlog('done');
    return {
      update() {
        fit();
        // new guys, bottles, puddles and hand props get the look on their first frame
        game?.dynamic.traverse(style);
        camera.traverse(style);
        textures.refresh();
        sector.update();
        camera.getWorldPosition(cam);
        for (const [s, h] of heads) {
          if (!attached(s)) continue;
          const raw = s.material.map;
          if (raw && !textures.isOut(raw)) s.material.map = textures.get(raw, HEADOPT[h.kind]); // a new mood face
          s.getWorldPosition(v);
          sector.sample(v.x, v.y, v.z, L);
          const d = v.distanceTo(cam);
          const k = 1 - THREE.MathUtils.smoothstep(d, band.x, band.y) * (1 - 0.7 * L[3]);
          const lit = [0, 1, 2].map((c) => Math.max(TUNE.headMin, Math.floor(L[c] * k * 31.99) / 31) ** 2.2);
          h.u.value.set(...lit);
        }
      },
    };
  },
};
