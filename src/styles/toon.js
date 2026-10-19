// Art style "toon" (?style=toon): the flat as a frame of Масяня. Flat juicy colours, three steps of
// light instead of smooth shading, dark ink round everything that stands in a room, photo heads as
// stickers (white rim, ink outline) on the cartoon bodies. Design: the art-direction panel's spec
// (docs/STYLE.md); engine side only, on today's procedural world.
//   materials  MeshStandard -> MeshToon (3-band gradient, 0.35 floor), +15% saturation, colours pulled
//              half-way to a Soviet-cartoon palette, the darkest band tinted blue-violet
//   textures   canvas patterns redrawn in 4-6 flat colours, wallpaper motifs calmed down
//   ink        constant-pixel hulls on objects and people, crease lines inside boxes (in the material),
//              the flat's corners and reveals as one batch of fat lines (lib/toon-ink.js)
//   people     photo heads get a sticker rim and take the room's light in three steps; skin sheets flat
//   play       the thing you aim at gets a thick yellow outline; puddles lime with a highlight; the black
//              cat outlined in warm grey; hard cartoon puffs; navy fog outdoors only
// Knobs (URL): &posterface=1 posterizes the photo faces too; &toonbands=0 keeps the light falloff smooth.
import * as THREE from 'three';
import { roomAt } from '../world/layout.js';
import * as T from '../world/textures.js';
import { particles } from '../world/particles.js';
import { INK, posterize, skinPart, sticker, puffCanvas, saturate } from './lib/toon-paint.js';
import { RES, hullMaterial, hullGeometry, makeHull, lineMaterial, lineMesh, shellSegments } from './lib/toon-ink.js';

// the panel's palette, the pull targets for flat colours (ink, target yellow and night are used directly)
const PAL_SRGB = ['#7a4527', '#b5462f', '#d9a441', '#f1ece0', '#9fc7b0', '#7fb0d6', '#f1e3c4', '#b9c2c9', '#a8452e', '#a3232a', '#1f2346', '#c9d1a0', '#c47a45', '#9fb4c8']
  .map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

const HULL_MIN = 0.04; // m: bounding-sphere radius under which nothing gets a hull
const PUDDLE = '#b8d43a', TARGET = '#ffd25a', CAT_INK = '#7a6a5e', NIGHT = '#1a2440';

export default {
  name: 'Мультик',
  apply(ctx) {
    const { scene, renderer, camera, apt, furn, outside, game } = ctx;
    const params = new URLSearchParams(location.search);
    const BANDED = params.get('toonbands') !== '0';

    // ---------- renderer, light, fog ----------
    renderer.toneMapping = THREE.NeutralToneMapping; // ACES shifts the flat palette's hues
    renderer.toneMappingExposure = 1.0;
    scene.traverse((o) => o.isHemisphereLight && (o.intensity = 0.35));
    const fog = new THREE.FogExp2(NIGHT, 0); // always there (no recompiles), thick only outdoors
    scene.fog = fog;
    const nightBg = new THREE.Color(NIGHT), roomBg = scene.background?.isColor ? scene.background.clone() : null;

    // ---------- materials ----------
    const grad = new THREE.DataTexture(new Uint8Array([89, 179, 255]), 3, 1, THREE.RedFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.generateMipmaps = false;
    grad.needsUpdate = true;
    const ink = new THREE.Color(INK); // linear

    // fragment code shared by every toon material: three light steps on the falloff too (the lamp's
    // pool of light comes in rings, like a painted one) and the darkest step tinted blue-violet
    const toonFrag = (crease) => /* glsl */ `
      {
        const vec3 W = vec3(0.299, 0.587, 0.114);
        vec3 lightOnly = outgoingLight - totalEmissiveRadiance;
        float alb = max(dot(diffuseColor.rgb, W), 0.02);
        float lit = dot(lightOnly, W) / alb;
        ${BANDED ? `
        // the lamp's falloff in steps too (a painted pool of light): 1.0 / 0.7 / 0.42 of the full light,
        // and under 0.14 a dim ramp, lifted x3 so a dark room is dim, not black
        float q = lit >= 0.7 ? 1.0 + (lit - 0.7) * 0.08 : lit >= 0.35 ? 0.7 : lit >= 0.14 ? 0.42 : lit * 3.0;
        lightOnly *= q / max(lit, 1e-4);
        lit = q;` : ''}
        outgoingLight = lightOnly * mix(vec3(0.62, 0.6, 0.9), vec3(1.0), smoothstep(0.18, 0.45, lit)) + totalEmissiveRadiance;
      }
      ${crease ? `
      {
        vec2 fw = max(fwidth(vToonUv), vec2(1e-5));
        float e = min(min(vToonUv.x, 1.0 - vToonUv.x) / fw.x, min(vToonUv.y, 1.0 - vToonUv.y) / fw.y);
        outgoingLight = mix(vec3(${ink.r.toFixed(4)}, ${ink.g.toFixed(4)}, ${ink.b.toFixed(4)}), outgoingLight, smoothstep(0.6, 1.5, e));
      }` : ''}
      #include <opaque_fragment>`;
    const compilePlain = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', toonFrag(false));
    };
    const compileCrease = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vToonUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvToonUv = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vToonUv;').replace('#include <opaque_fragment>', toonFrag(true));
    };
    compilePlain.key = 'toon-plain';
    compileCrease.key = 'toon-crease';

    // colour: half-way to the nearest palette colour when it's close, then +15% saturation
    const hsl = {};
    function cartoonColor(src, { pull = 0.5 } = {}) {
      const c = src.clone();
      if (pull > 0) {
        const s = [c.clone().convertLinearToSRGB()].map((q) => [q.r * 255, q.g * 255, q.b * 255])[0];
        let best = null, bd = Infinity;
        for (const p of PAL_SRGB) {
          const d = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]);
          if (d < bd) [bd, best] = [d, p];
        }
        if (best && bd < 70) {
          const k = pull * (1 - bd / 70);
          c.setRGB(...s.map((v, i) => (v + (best[i] - v) * k) / 255), THREE.SRGBColorSpace);
        }
      }
      c.getHSL(hsl, THREE.SRGBColorSpace);
      c.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), hsl.l, THREE.SRGBColorSpace);
      return c;
    }

    // textures: which canvas pattern is which (textures.js caches them, so these are the very objects in use)
    const KIND = new Map();
    const tag = (fn, kind) => { try { KIND.set(fn(), kind); } catch { /* not built in this scene */ } };
    for (const k of Object.keys(T.wallpapers)) tag(T.wallpapers[k], k === 'wallTile' ? 'tile' : 'wallpaper');
    tag(T.parquet, 'parquet');
    tag(T.linoleum, 'lino');
    tag(T.floorTile, 'tile');
    tag(T.concrete, 'concrete');
    tag(T.wallCarpet, 'carpet');
    tag(T.floorRug, 'carpet');
    const texCache = new WeakMap();
    const derived = new Set(); // [src, out, kind] pairs whose source may still be drawn later (skins)
    function cartoonTexture(src) {
      if (!src?.image) return src;
      if (texCache.has(src)) return texCache.get(src);
      const img = src.image;
      const isCanvas = typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement;
      const isBitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
      let kind = KIND.get(src);
      if (!kind) kind = isCanvas ? (img.width === 64 && img.height === 128 ? 'skin' : 'canvas') : isBitmap ? 'photo' : null;
      if (!kind) {
        texCache.set(src, src); // the paintings (image files): left as they are
        return src;
      }
      const out = new THREE.CanvasTexture(document.createElement('canvas'));
      for (const k of ['wrapS', 'wrapT', 'flipY', 'colorSpace', 'anisotropy', 'channel', 'rotation', 'matrixAutoUpdate']) out[k] = src[k];
      out.repeat.copy(src.repeat);
      out.offset.copy(src.offset);
      out.center.copy(src.center);
      out.userData.toonFrom = src;
      const job = { src, out, kind, ver: -1 };
      redraw(job);
      if (kind === 'skin') derived.add(job); // the skin sheet loads after the material is made
      texCache.set(src, out);
      return out;
    }
    function redraw(job) {
      const { src, out, kind } = job;
      job.ver = src.version;
      const opts = {
        wallpaper: { k: 4, calm: 0.6 },
        tile: { k: 3 },
        parquet: { k: 5 },
        lino: { k: 4 },
        concrete: { k: 3 },
        carpet: { k: 5 },
        canvas: { k: 6 },
        photo: { k: 5, maxSize: 256 },
      }[kind];
      const c = kind === 'skin' ? skinPart(src.image) : posterize(src.image, opts);
      if (!c) return;
      out.image = c;
      out.needsUpdate = true;
    }

    const toonCache = new WeakMap();
    function toToon(src, { crease = false, person = false } = {}) {
      if (src.userData?.toon) return src;
      const key = `${crease ? 'c' : 'p'}${person ? 'h' : ''}`;
      let entry = toonCache.get(src);
      if (!entry) toonCache.set(src, (entry = {}));
      if (entry[key]) return entry[key];
      const m = new THREE.MeshToonMaterial({
        name: src.name,
        color: src.map ? src.color.clone() : cartoonColor(src.color, { pull: person ? 0 : 0.5 }),
        map: cartoonTexture(src.map),
        gradientMap: grad,
        emissive: src.emissive ? src.emissive.clone() : new THREE.Color(0),
        emissiveMap: src.emissiveMap ? cartoonTexture(src.emissiveMap) : null,
        emissiveIntensity: src.emissiveIntensity ?? 1,
        alphaMap: src.alphaMap ?? null,
        vertexColors: src.vertexColors,
        transparent: src.transparent,
        opacity: src.opacity,
        alphaTest: src.alphaTest,
        side: src.side,
        depthTest: src.depthTest,
        depthWrite: src.depthWrite,
        blending: src.blending,
        visible: src.visible,
        fog: src.fog,
        polygonOffset: src.polygonOffset,
        polygonOffsetFactor: src.polygonOffsetFactor,
        polygonOffsetUnits: src.polygonOffsetUnits,
        toneMapped: src.toneMapped,
      });
      // the chandelier's shades glow with their own picture
      if (src.emissiveMap && src.emissiveMap === src.map) m.emissiveMap = m.map;
      m.userData = { ...src.userData, toon: true, toonSrc: src };
      m.onBeforeCompile = crease ? compileCrease : compilePlain;
      m.customProgramCacheKey = () => (crease ? compileCrease.key : compilePlain.key);
      entry[key] = m;
      return m;
    }

    // a box with its own 0..1 UVs on every face (crease lines), never the flat's world-UV walls
    const unitUV = new WeakMap();
    function creaseable(geo) {
      if (geo.type !== 'BoxGeometry') return false;
      if (unitUV.has(geo)) return unitUV.get(geo);
      const uv = geo.attributes.uv;
      let ok = !!uv;
      for (let i = 0; ok && i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        if (u < -1e-3 || u > 1.001 || v < -1e-3 || v > 1.001) ok = false;
      }
      unitUV.set(geo, ok);
      return ok;
    }

    // ---------- where a mesh belongs ----------
    const roots = { apt: apt?.group, ceiling: apt?.ceiling, furn: furn?.group, out: outside?.group, dyn: game?.dynamic };
    const under = (o, root) => {
      if (!root) return false;
      for (let p = o; p; p = p.parent) if (p === root) return true;
      return false;
    };
    const targeted = (o) => {
      for (let p = o; p; p = p.parent) if (p.userData?.target) return true;
      return false;
    };
    // a person or the cat: the top object under a root that carries a cut-out head sprite
    const personCache = new WeakMap();
    function personOf(o) {
      let top = o;
      while (top.parent && top.parent !== scene && ![roots.dyn, roots.out, roots.furn, roots.apt].includes(top.parent)) top = top.parent;
      if (personCache.has(top)) return personCache.get(top);
      let head = false;
      top.traverse((q) => q.isSprite && q.material?.alphaTest > 0 && q.material.sizeAttenuation !== false && (head = true));
      // the rig: a body that has a neck group with a head sprite; the cat's drawn skull counts too
      const isCat = !!game?.cat && top === game.cat.figure?.root;
      const r = head || isCat ? top : null;
      if (r) personCache.set(top, r);
      return r; // not cached when null: his head may come a moment later
    }
    const isCat = (o) => !!game?.cat?.figure?.root && under(o, game.cat.figure.root);

    // ---------- ink ----------
    const inkMat = hullMaterial(INK, 2);
    const catInk = hullMaterial(CAT_INK, 2);
    const hiMat = hullMaterial(TARGET, 4);
    const shellMat = lineMaterial(INK, 2);
    const ownMats = new Set([inkMat, catInk, hiMat, shellMat]);
    const hulls = new WeakMap(); // mesh -> its hull

    function wantsHull(o, mats) {
      if (o.isInstancedMesh || o.isSkinnedMesh) return false;
      if (mats.some((m) => !m || m.transparent || m.side === THREE.DoubleSide || m.blending === THREE.AdditiveBlending || m.toneMapped === false || m.isShaderMaterial)) return false;
      if (o.name?.endsWith('_ink')) return false;
      if (o.parent?.children.some((s) => s !== o && s.name === `${o.name}_ink`)) return false; // baked hull in the GLB
      const geo = o.geometry;
      if (!geo?.attributes?.position) return false;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      o.updateWorldMatrix(true, false);
      const r = geo.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
      return r >= HULL_MIN;
    }
    function addHull(o, material = inkMat) {
      if (hulls.has(o)) return hulls.get(o);
      const g = hullGeometry(o.geometry);
      if (!g) return hulls.set(o, null), null;
      const h = makeHull(o, g, material);
      hulls.set(o, h);
      return h;
    }

    // ---------- the per-mesh pass ----------
    const shellMeshes = [];
    const puddles = new Set();
    const bulb = new THREE.MeshBasicMaterial({ color: '#ffe27a' });
    const heads = new Set();

    function handle(o) {
      if (o.userData.toonOwn || o.parent?.userData.toonOwn) return;
      if (o.isSprite) {
        const m = o.material;
        if (m?.alphaTest > 0 && m.sizeAttenuation !== false && m.map) trackHead(o);
        return;
      }
      if (!o.isMesh || o.isReflector) return;
      const list = [o.material].flat();
      if (list.some((m) => ownMats.has(m))) return;
      // baked hull from a toon kit GLB
      if (o.name?.endsWith('_ink') || list.some((m) => m?.name === 'ink')) {
        o.material = bakedInk;
        return;
      }
      const inApt = under(o, roots.apt), inOut = under(o, roots.out);
      const person = personOf(o);
      const isPuddle = game?.puddles?.includes(o) || (o.geometry?.type === 'CircleGeometry' && list[0]?.color?.getHexString?.() === '9aa53a');
      if (isPuddle) return makePuddle(o);
      // lamp bulbs: solid yellow
      if (list.length === 1 && list[0].isMeshBasicMaterial && list[0].color.getHexString() === 'fff2d0') o.material = bulb;
      // materials
      const crease = !inApt && creaseable(o.geometry);
      const conv = (m) => (m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) ? toToon(m, { crease, person: !!person }) : m);
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      const mats = [o.material].flat();
      // static structure (walls, linings, floors, frames, stairs): the shell lines; everything else: a hull
      const structural = (inApt || inOut || (!furn && !game && big(o))) && !targeted(o) && !person;
      if (structural && !mats.some((m) => m.transparent)) {
        shellMeshes.push(o);
        if (o.geometry?.type !== 'SphereGeometry') return;
      }
      if (!wantsHull(o, mats)) return;
      addHull(o, isCat(o) ? catInk : inkMat);
    }
    // showroom (no game): the room's walls and floor are the big ones
    const big = (o) => {
      const g = o.geometry;
      if (!g) return false;
      if (!g.boundingSphere) g.computeBoundingSphere();
      return g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() > 1.2;
    };
    const bakedInk = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

    // puddles: lime, a white highlight and an ink ring, all fading with the puddle
    const ringGeo = new THREE.RingGeometry(0.28, 0.305, 16).rotateX(-Math.PI / 2);
    const blobGeo = new THREE.CircleGeometry(0.05, 12).rotateX(-Math.PI / 2).scale(1.6, 1, 0.8).translate(0.07, 0.0015, -0.07);
    function makePuddle(o) {
      const src = o.material;
      const m = new THREE.MeshToonMaterial({ color: PUDDLE, gradientMap: grad, emissive: PUDDLE, emissiveIntensity: 0.22, transparent: true, opacity: src.opacity, depthWrite: false });
      m.userData.toon = true;
      o.material = m;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: src.opacity, depthWrite: false }));
      const blob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: src.opacity, depthWrite: false }));
      for (const c of [ring, blob]) {
        c.userData.toonOwn = true;
        c.raycast = () => {};
        o.add(c);
      }
      puddles.add(o);
    }

    // ---------- heads: stickers, lit in three steps ----------
    const stickers = new WeakMap(); // raw texture -> { tex, pad, w, h, ver }
    const POSTERFACE = params.get('posterface') === '1';
    function headCompile(sh) {
      sh.uniforms.uLit = this.userData.uLit;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLit;')
        .replace('#include <opaque_fragment>', 'outgoingLight *= uLit;\n#include <opaque_fragment>');
    }
    function trackHead(s) {
      const m = s.material;
      m.userData.uLit = { value: 1 };
      m.onBeforeCompile = headCompile;
      m.customProgramCacheKey = () => 'toon-head';
      m.needsUpdate = true;
      s.userData.toonLit = 1;
      heads.add(s);
    }
    function stickerOf(raw) {
      let p = stickers.get(raw);
      if (p && p.ver === raw.version) return p;
      if (p?.tried === raw.version) return p.tex ? p : null;
      const img = raw.image;
      const h = img?.height ?? 0;
      const r = h ? sticker(img, { white: Math.max(3, Math.round(h * 0.03)), ink: Math.max(2, Math.round(h * 0.022)), poster: POSTERFACE }) : null;
      if (!r) {
        stickers.set(raw, { ...(p ?? {}), tried: raw.version });
        return p?.tex ? p : null;
      }
      const tex = p?.tex ?? new THREE.CanvasTexture(r.canvas);
      tex.image = r.canvas;
      tex.colorSpace = raw.colorSpace;
      tex.userData.toonSticker = true;
      tex.needsUpdate = true;
      p = { tex, pad: r.pad, w: img.width, h: img.height, ver: raw.version, tried: raw.version };
      stickers.set(raw, p);
      return p;
    }
    function updateHead(s) {
      const m = s.material, map = m.map;
      if (!map) return;
      let st = s.userData.toonHead;
      if (!map.userData.toonSticker) {
        // the game put a new picture on (setFace): remember its size and centre, then cover it
        st = s.userData.toonHead = { raw: map, base: [s.scale.x, s.scale.y, s.center.x, s.center.y], ver: -1 };
      }
      if (!st || st.ver === st.raw.version) return;
      const p = stickerOf(st.raw);
      if (!p) return;
      st.ver = st.raw.version;
      const [sx, sy, cx, cy] = st.base;
      const W = p.w + 2 * p.pad, H = p.h + 2 * p.pad;
      m.map = p.tex;
      s.scale.set((sx * W) / p.w, (sy * H) / p.h, 1);
      s.center.set((cx * p.w + p.pad) / W, (cy * p.h + p.pad) / H);
    }
    // the light at a head: the pooled lamps (as the shaders see them) and the sky, in three steps
    const pool = [];
    let hemi = null;
    scene.traverse((o) => {
      if (o.isPointLight && o.userData.pooled) pool.push(o);
      if (o.isHemisphereLight) hemi = o;
    });
    const hp = new THREE.Vector3(), lp = new THREE.Vector3();
    function lightAt(p) {
      let e = hemi ? hemi.intensity * 0.5 : 0.15;
      for (const l of pool) {
        if (!(l.intensity > 0)) continue;
        l.getWorldPosition(lp);
        const d = Math.max(0.05, lp.distanceTo(p));
        let f = 1 / Math.max(Math.pow(d, l.decay), 0.01);
        if (l.distance > 0) f *= Math.max(0, 1 - Math.pow(d / l.distance, 4)) ** 2;
        e += (l.intensity * f * (0.3 * l.color.r + 0.59 * l.color.g + 0.11 * l.color.b)) / Math.PI;
      }
      return e;
    }

    // ---------- particles: cartoon puffs, inked vomit ----------
    const puffTex = new THREE.CanvasTexture(puffCanvas());
    puffTex.colorSpace = THREE.SRGBColorSpace;
    const lastChildren = (n) => (particles && scene.children.slice(-n)) || [];
    const origPuff = particles.puff, origDrops = particles.drops;
    particles.puff = function (...a) {
      const r = origPuff.apply(this, a);
      const s = lastChildren(1)[0];
      if (s?.isSprite && s.material?.map && s.material.map !== puffTex) {
        s.material.map = puffTex;
        s.userData.toonOwn = true;
      }
      return r;
    };
    particles.drops = function (pos, dir, opts = {}) {
      const r = origDrops.call(this, pos, dir, opts);
      for (const d of lastChildren(opts.n ?? 6)) {
        if (!d.isMesh || d.userData.toonDrop) continue;
        d.userData.toonDrop = true;
        d.material = toToon(d.material);
        makeHull(d, hullGeometry(d.geometry), inkMat);
        d.userData.toonOwn = true; // handled
      }
      return r;
    };

    ctx.each(handle);

    // ---------- the shell: one batch of fat lines per group that can be hidden ----------
    function buildShell() {
      const buckets = new Map();
      const holders = [roots.ceiling, roots.apt, roots.out].filter(Boolean);
      const holder = (o) => {
        for (let p = o.parent; p; p = p.parent) if (holders.includes(p)) return p;
        return scene;
      };
      for (const o of shellMeshes) {
        const t = o.geometry?.type;
        if (t === 'SphereGeometry' || t === 'CircleGeometry' || t === 'CapsuleGeometry' || t === 'TorusGeometry') continue;
        const h = holder(o);
        if (!buckets.has(h)) buckets.set(h, []);
        buckets.get(h).push(o);
      }
      let n = 0;
      const t0 = performance.now();
      for (const [h, list] of buckets) {
        const segs = shellSegments(list);
        if (!segs.length) continue;
        n += segs.length;
        // into the holder's frame (all at identity today)
        h.updateWorldMatrix(true, false);
        const inv = h.matrixWorld.clone().invert();
        const v = new THREE.Vector3();
        for (const s of segs) {
          v.set(s[0], s[1], s[2]).applyMatrix4(inv); s[0] = v.x; s[1] = v.y; s[2] = v.z;
          v.set(s[3], s[4], s[5]).applyMatrix4(inv); s[3] = v.x; s[4] = v.y; s[5] = v.z;
        }
        h.add(lineMesh(segs, shellMat));
      }
      console.info(`toon: ${n} shell lines from ${shellMeshes.length} meshes in ${(performance.now() - t0).toFixed(0)} ms`);
    }
    buildShell();

    // ---------- aiming: the thing in the crosshair gets a thick yellow outline ----------
    const ray = new THREE.Raycaster();
    ray.far = 2.4;
    const pickRoots = [roots.apt, roots.furn, roots.out, roots.dyn].filter(Boolean);
    const visibleChain = (o) => {
      for (; o; o = o.parent) if (!o.visible) return false;
      return true;
    };
    let hiRoot = null, hiList = [], aimIn = 0;
    function aimed() {
      if (!game) return null;
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      ray.camera = camera;
      for (const hit of ray.intersectObjects(pickRoots, true)) {
        const o = hit.object;
        if (o.userData.toonOwn || !visibleChain(o)) continue;
        if (o.isSprite && !o.parent?.userData.target) continue;
        let t = null;
        for (let p = o; p; p = p.parent) if (p.userData.target) { t = p; break; }
        if (!t) return null;
        // the whole thing: up while the parent carries the same target
        while (t.parent?.userData.target && t.parent.userData.target === t.userData.target) t = t.parent;
        return t;
      }
      return null;
    }
    function setHighlight(root) {
      if (root === hiRoot) return;
      for (const h of hiList) h.parent?.remove(h);
      hiList = [];
      hiRoot = root;
      if (!root) return;
      root.traverse((o) => {
        if (!o.isMesh || o.userData.toonOwn || !hulls.get(o)) return;
        const h = new THREE.Mesh(hulls.get(o).geometry, hiMat);
        h.userData.toonOwn = true;
        h.matrixAutoUpdate = false;
        h.raycast = () => {};
        h.renderOrder = o.renderOrder - 0.4;
        o.add(h);
        hiList.push(h);
      });
      // things without a hull of their own (the TV and PC screens, a puddle): the root's own outline
      if (!hiList.length && root.isMesh) {
        const g = hullGeometry(root.geometry);
        if (g) {
          const h = new THREE.Mesh(g, hiMat);
          h.userData.toonOwn = true;
          h.matrixAutoUpdate = false;
          h.raycast = () => {};
          root.add(h);
          hiList.push(h);
        }
      }
    }

    // ---------- every frame ----------
    const camPos = new THREE.Vector3();
    let headScan = 0;
    return {
      update(dt) {
        renderer.getDrawingBufferSize(RES.value);
        // fog and sky: navy night outdoors only
        camera.getWorldPosition(camPos);
        const room = apt ? roomAt(camPos.x, camPos.z) : null;
        const outdoors = !!apt && (!room || room.outdoor) && room?.id !== 'balcony';
        fog.density += ((outdoors ? 0.025 : 0) - fog.density) * Math.min(1, dt * 4);
        if (roomBg && scene.background?.isColor) scene.background.copy(outdoors ? nightBg : roomBg);
        // skins whose sheet arrived after the material was made
        for (const job of derived) if (job.src.version !== job.ver) redraw(job);
        // heads
        if ((headScan -= dt) <= 0) {
          headScan = 2;
          for (const s of heads) {
            let inScene = false;
            for (let p = s; p; p = p.parent) if (p === scene) inScene = true;
            if (!inScene) heads.delete(s);
          }
        }
        for (const s of heads) {
          updateHead(s);
          if (!s.visible) continue;
          s.getWorldPosition(hp);
          hp.y += 0.2;
          const e = lightAt(hp);
          const want = e > 0.55 ? 1 : e > 0.18 ? 0.8 : 0.6;
          s.userData.toonLit += (want - s.userData.toonLit) * Math.min(1, dt * 5);
          s.material.userData.uLit.value = s.userData.toonLit;
        }
        // puddles fade together with their ring and highlight
        for (const p of puddles) {
          if (!p.parent) { puddles.delete(p); continue; }
          for (const c of p.children) if (c.userData.toonOwn) c.material.opacity = Math.min(1, p.material.opacity / 0.85);
        }
        // aim
        if ((aimIn -= dt) <= 0) {
          aimIn = 0.1;
          setHighlight(aimed());
        }
      },
    };
  },
};
