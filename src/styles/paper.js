// «Поделка: хата из картона» — the flat as a cardboard model the guys glued together for Oleg's birthday.
// Spec: the art-direction panel's "paper" style (engine_plan + people_plan). What it does to the game:
//   - every lit material becomes matte paper (Lambert, flat shaded) with a paper grain; box, plane and
//     cylinder faces get a marker line and a white cut edge along their borders (folded card boxes)
//   - wallpapers are glued rolls (seams every 0.53 m), floors and wall feet darken next to furniture
//     (a blurred top view of the flat, no shadow maps); the guys and the cat stand on soft blob shadows
//   - liquids (puddles, water, vomit) are the only glossy thing: cellophane; puddles get a cut edge and a
//     painted white highlight (there's no environment to reflect); glass is cellophane too
//   - the photo heads become stickers (white scissor-cut border, drop shadow) and take the room's light
//   - the black cat gets a white paper rim (a constant ~3 px on screen); smoke and vape are cotton wool
//   - skin prints are posterized; their cut edges and marker lines come from the fold-line shader
//   - outside: a blue card sky, fog, a cut-out moon; blacks lifted to warm brown so night never goes black
//   - knob &shadows=1: one shadow-casting spot under the current room's lamp (shadow theatre)
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { F, createPaperMaterials, ensurePuv, cellophane, litSprite } from './lib/paper-mat.js';
import { PAPER, grainTexture, planAOTexture, drawCotton, moonTexture, stickerCanvas, posterize, canvas } from './lib/paper-tex.js';
import { ROOMS, WALLS, DIAG_WALLS, FURNITURE, BOUNDS, H, roomAt } from '../world/layout.js';
import * as T from '../world/textures.js';
import { particles } from '../world/particles.js';

const params = new URLSearchParams(location.search);
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// how dark a piece of furniture's footprint is in the plan AO (tables are open underneath)
const AO_K = { partyTable: 0.5, kitchenTable: 0.45, sisterDesk: 0.5, ficus: 0.55, grill: 0.4, loftBed: 0.75, sofa: 0.9, olegBed: 0.9 };

function buildPlanAO() {
  const rects = [], segs = [];
  for (const f of FURNITURE) if (!f.onTop) rects.push({ ...f, k: AO_K[f.id] ?? 0.95 });
  // walls without their floor-level openings (doors), so doorways stay light
  for (const w of WALLS) {
    const ax = w.x1 - w.x0 >= w.z1 - w.z0;
    const [s0, s1] = ax ? [w.x0, w.x1] : [w.z0, w.z1];
    let cur = s0;
    for (const o of [...w.openings].filter((o) => o.bottom <= 0.01).sort((a, b) => a.at[0] - b.at[0])) {
      if (o.at[0] > cur) rects.push(ax ? { x0: cur, x1: o.at[0], z0: w.z0, z1: w.z1 } : { x0: w.x0, x1: w.x1, z0: cur, z1: o.at[0] });
      cur = Math.max(cur, o.at[1]);
    }
    if (cur < s1) rects.push(ax ? { x0: cur, x1: s1, z0: w.z0, z1: w.z1 } : { x0: w.x0, x1: w.x1, z0: cur, z1: s1 });
  }
  for (const d of DIAG_WALLS) {
    const [ax, az] = d.a, [bx, bz] = d.b, len = Math.hypot(bx - ax, bz - az);
    const P = (s) => [ax + ((bx - ax) * s) / len, az + ((bz - az) * s) / len];
    if (d.door.at[0] > 0.02) segs.push({ a: P(0), b: P(d.door.at[0]), w: d.t });
    if (d.door.at[1] < len - 0.02) segs.push({ a: P(d.door.at[1]), b: P(len), w: d.t });
  }
  const tex = planAOTexture(BOUNDS, rects, segs);
  const box = new THREE.Vector4(BOUNDS.x0, BOUNDS.z0, 1 / (BOUNDS.x1 - BOUNDS.x0), 1 / (BOUNDS.z1 - BOUNDS.z0));
  return { tex, box };
}

const LiftShader = {
  uniforms: { tDiffuse: { value: null }, uLift: { value: new THREE.Vector3(0x18 / 255, 0x14 / 255, 0x0f / 255) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 uLift; varying vec2 vUv;
    void main() { vec4 c = texture2D(tDiffuse, vUv); c.rgb = c.rgb * (1.0 - uLift) + uLift; gl_FragColor = c; }`,
};

function blobTexture() {
  const c = canvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 63);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.8, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default {
  name: 'Поделка',
  apply(ctx) {
    const { scene, renderer, camera, apt, furn, outside, game } = ctx;
    const shadows = params.get('shadows') === '1';

    // ---------- renderer: paper white stays white; MSAA as the game has it
    const toneMapping = THREE.NeutralToneMapping, exposure = 1.0;
    renderer.toneMapping = toneMapping;
    renderer.toneMappingExposure = exposure;

    // ---------- light: the lamp pool stays; the sky light is brighter, so paper never goes black
    const hemis = [];
    scene.traverse((o) => o.isHemisphereLight && hemis.push(o));
    for (const h of hemis) h.intensity *= 1.8; // 0.25 -> 0.45 in the flat
    scene.background = new THREE.Color(PAPER.sky); // a blue card behind everything
    const fog = new THREE.FogExp2(PAPER.fog, 0); // always there (no recompiles), thick only outside
    scene.fog = fog;
    ctx.displayPass(new ShaderPass(LiftShader));

    // ---------- materials
    const grain = grainTexture();
    const ao = apt ? buildPlanAO() : null;
    const P = createPaperMaterials({ grain, ao: ao?.tex, aoBox: ao?.box, ceil: H });
    const seamMaps = apt ? new Set(['bedroom', 'living', 'kitchen', 'hall'].map((k) => T.wallpapers[k]())) : new Set();
    const rugMap = furn ? T.floorRug() : null;
    const GLASS_HEX = new Set([0xa7c4c9, 0xc6dbe2, 0x1d2a33, 0xdfe8ee]);
    const isGlass = (m) => (m.transparent && m.opacity < 0.7 && m.roughness <= 0.2) || GLASS_HEX.has(m.color.getHex()) || m.transmission > 0;

    // skin prints (skins.js part canvases, 64x128): posterized copies, redrawn when the sheet arrives
    const skins = [];
    const skinMap = (src) => {
      const s = skins.find((k) => k.src === src);
      if (s) return s.dst;
      const c = canvas(src.image.width, src.image.height);
      const dst = new THREE.CanvasTexture(c);
      dst.colorSpace = src.colorSpace;
      dst.anisotropy = 4;
      skins.push({ src, dst, ver: -1 });
      return dst;
    };
    const isSkinPrint = (t) => t?.isCanvasTexture && t.image?.width === 64 && t.image?.height === 128;

    // the cat's paper rim (one material, dimmed with the light at the cat)
    const RIM = new THREE.Color('#e8e0d0');
    const rimMat = new THREE.MeshBasicMaterial({ color: RIM.clone(), side: THREE.BackSide });
    rimMat.onBeforeCompile = (sh) => {
      // grown in view space by a share of the distance: the rim stays ~3 px wide near and far
      sh.vertexShader = sh.vertexShader.replace(
        '#include <project_vertex>',
        `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        vec3 rimN = normalize( normalMatrix * normal );
        mvPosition.xyz += rimN * max( 0.006, 0.0065 * -mvPosition.z );
        gl_Position = projectionMatrix * mvPosition;`,
      );
    };
    rimMat.customProgramCacheKey = () => 'paperRim';
    const hulls = [];

    // ---------- the heads: stickers that take the light
    const heads = new Map(); // sprite -> { lit, raw, e, base }
    const stickers = new WeakMap(); // raw map -> { tex, pad, w, h, ver }
    const stickerTex = new WeakSet();
    let seed = 1;
    // the cat's photo is a whole frame of fur: cut an oval out of it first, like with scissors
    const ovalCut = (img) => {
      const c = canvas(img.width, img.height), g = c.getContext('2d'), R = Math.min(img.width, img.height);
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2, k = 1 + Math.sin(i * 2.7) * 0.012;
        const x = img.width / 2 + Math.cos(a) * (img.width / 2 - R * 0.06) * k, y = img.height / 2 + Math.sin(a) * (img.height / 2 - R * 0.06) * k;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.clip();
      g.drawImage(img, 0, 0);
      return c;
    };
    const sticker = (raw, oval = false) => {
      let e = stickers.get(raw);
      if (!e) stickers.set(raw, (e = { tex: null, pad: 0, w: 0, h: 0, ver: -1, seed: seed++, oval }));
      if (e.ver !== raw.version) {
        const img = raw.image;
        if (img && img.width && img.height) {
          const r = stickerCanvas(e.oval ? ovalCut(img) : img, e.seed);
          if (r) {
            if (!e.tex) {
              e.tex = new THREE.CanvasTexture(r.canvas);
              e.tex.colorSpace = raw.colorSpace;
              e.tex.anisotropy = 4;
              stickerTex.add(e.tex);
            } else {
              e.tex.image = r.canvas;
              e.tex.needsUpdate = true;
            }
            Object.assign(e, { pad: r.pad, w: img.width, h: img.height });
          }
          e.ver = raw.version;
        }
      }
      return e.tex ? e : null;
    };
    const isHead = (s) => {
      const m = s.material;
      return m?.isSpriteMaterial && m.sizeAttenuation !== false && m.alphaTest > 0 && m.blending === THREE.NormalBlending && !s.userData.paperSkip;
    };

    // ---------- each mesh, once: what it is decides what paper it becomes
    const done = new WeakSet();
    const roots = { apt: apt?.group, furn: furn?.group, out: outside?.group, dyn: game?.dynamic };
    function where(o) {
      const w = { apt: false, furn: false, out: false, dyn: false, cam: false, target: false };
      for (let p = o; p; p = p.parent) {
        if (p.userData.target) w.target = true;
        if (p === roots.apt) w.apt = true;
        else if (p === roots.furn) w.furn = true;
        else if (p === roots.out) w.out = true;
        else if (p === roots.dyn) w.dyn = true;
        else if (p === camera) w.cam = true;
      }
      return w;
    }
    function liquid(o, m) {
      const hex = m.color?.getHex();
      if (o.geometry?.type === 'CircleGeometry' && m.transparent && (game?.puddles?.includes(o) || hex === 0x9aa53a)) return 'puddle';
      if (o.parent?.userData.water === o || hex === 0x9cc9d6) return 'water'; // bucket, bath
      const gp = o.geometry?.parameters;
      if (o.parent === scene && o.geometry?.type === 'SphereGeometry' && gp?.radius === 1 && gp.widthSegments === 6) return 'drop'; // particles
      if (hex === 0xf08a1c) return 'eye'; // the cat's eyes
      return null;
    }
    function handle(o) {
      if (done.has(o) || o.userData.paperSkip) return;
      done.add(o);
      if (o.isSprite) {
        if (isHead(o)) heads.set(o, { lit: litSprite(o.material), raw: null, e: null, base: null });
        return;
      }
      if (!o.isMesh || !o.material) return;
      const w = where(o);
      const one = (m) => {
        if (!m?.isMeshStandardMaterial) return m;
        const liq = liquid(o, m);
        if (liq) {
          cellophane(m, { rim: liq === 'puddle' });
          return m;
        }
        let flags = 0;
        const fur = m.color.getHex() === 0x1f1916; // the black cat is black paper with a rim, no cut edges
        if (!fur && ensurePuv(o.geometry)) flags |= F.FOLD;
        if (w.target || w.dyn) flags |= F.WIDE;
        if (w.dyn || w.cam) flags |= F.LOCAL;
        if (w.apt && seamMaps.has(m.map)) flags |= F.SEAMS;
        if (ao && (w.apt || (w.furn && m.map === rugMap))) flags |= F.AO;
        if (isGlass(m)) flags |= F.GLASS;
        const p = P.convert(m, flags);
        if (isSkinPrint(m.map) && !p.userData.paperSkin) {
          p.userData.paperSkin = true;
          p.map = skinMap(m.map);
        }
        return p;
      };
      const before = o.material;
      o.material = Array.isArray(before) ? before.map(one) : one(before);
      // the black cat: a white paper rim round its fur (not the one in Oleg's hands)
      const fur = Array.isArray(before) ? null : before;
      if (fur?.color?.getHex() === 0x1f1916 && !w.cam && o.geometry?.attributes.normal) {
        const hull = new THREE.Mesh(o.geometry, rimMat);
        hull.userData.paperSkip = true;
        hull.raycast = () => {};
        o.add(hull);
        hulls.push(hull);
      }
      if (shadows) {
        if (w.furn || w.dyn || w.out) o.castShadow = true;
        if (w.apt || w.furn || w.out) o.receiveShadow = true;
      }
    }

    // ---------- outside: a cut-out moon in front of the panel block, the block printed on card
    if (apt) {
      const facade = T.cityFacade();
      const fc = facade.image, fg = fc.getContext('2d');
      fg.globalCompositeOperation = 'multiply';
      fg.fillStyle = fg.createPattern(grain.image, 'repeat');
      fg.fillRect(0, 0, fc.width, fc.height);
      fg.globalCompositeOperation = 'source-over';
      fg.strokeStyle = 'rgba(43,29,20,0.85)';
      fg.lineWidth = 2;
      const cw = fc.width / 20, rh = fc.height / 10;
      for (let i = 0; i < 20; i++) for (let j = 0; j < 10; j++) fg.strokeRect(i * cw + cw * 0.25, j * rh + rh * 0.3, cw * 0.5, rh * 0.45);
      facade.needsUpdate = true;
      apt.group.traverse((o) => o.isMesh && o.material?.map === facade && (o.material.fog = false)); // the backdrop stays crisp
      const moon = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, alphaTest: 0.05, fog: false }));
      moon.position.set(-9, 13, -29);
      moon.rotation.y = 0.25;
      moon.userData.paperSkip = true;
      scene.add(moon);
    }

    // ---------- smoke and vape: cotton wool (the particles share one soft texture: redraw it)
    if (game) {
      const had = new Set(scene.children);
      particles.puff(new THREE.Vector3(0, -50, 0), new THREE.Vector3(), { life: 0.001, opacity: 0 });
      const s = scene.children.find((o) => !had.has(o) && o.isSprite);
      const t = s?.material.map;
      if (t?.image) {
        const c = canvas(128, 128);
        drawCotton(c);
        t.image = c;
        t.needsUpdate = true;
      }
    }

    // ---------- knob: one lamp, long shadows (&shadows=1)
    let spot = null;
    const srcLamps = apt ? ROOMS.filter((r) => r.lamp).map((r, i) => ({ room: r, light: apt.lights[i], base: apt.lights[i]?.intensity })) : [];
    if (shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      spot = new THREE.SpotLight('#ffd7a0', 0, 0, 1.15, 0.6, 1.6);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0005;
      spot.shadow.camera.near = 0.2;
      spot.shadow.camera.far = 7;
      spot.shadow.radius = 3;
      spot.userData.paperSkip = true;
      scene.add(spot, spot.target);
    }

    // ---------- blob shadows under the guys and the cat: one instanced draw
    const BLOBS = 32;
    const blobMat = new THREE.MeshBasicMaterial({ color: PAPER.ink, map: blobTexture(), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMat, BLOBS);
    blobs.frustumCulled = false;
    blobs.count = 0;
    blobs.userData.paperSkip = true;
    blobs.raycast = () => {};
    scene.add(blobs);

    ctx.each(handle);

    // ---------- light at a point, as the lamps give it (for the heads and the cat's rim)
    let pool = null, hemi = hemis[0] ?? null;
    const hemiLum = () => (hemi ? hemi.intensity * lum(new THREE.Color().copy(hemi.color).lerp(hemi.groundColor, 0.5)) : 0);
    const att = (I, d, decay, cut) => {
      let a = 1 / Math.max(Math.pow(d, decay), 0.01);
      if (cut > 0) a *= Math.pow(Math.max(0, Math.min(1, 1 - Math.pow(d / cut, 4))), 2);
      return I * a;
    };
    // a head under the living-room chandelier is 1.0
    const living = ROOMS.find((r) => r.chandelier);
    const refL = () => att(9 * (living?.lampPower ?? 1.6), Math.hypot(1.2, 0.5), 1.6, 0) * lum(new THREE.Color(living?.lampColor ?? '#ffd7a0')) + hemiLum();
    let REF = 0;
    const lightAt = (p) => {
      if (!pool) {
        pool = scene.children.filter((o) => o.isPointLight && o.userData.pooled);
        if (!pool.length) scene.traverse((o) => o.isPointLight && o.visible && pool.push(o)); // the showroom has no pool
        REF = refL();
      }
      let L = hemiLum();
      for (const l of pool) if (l.visible && l.intensity > 0) L += att(l.intensity, l.position.distanceTo(p), l.decay, l.distance) * lum(l.color);
      if (spot && spot.intensity > 0) L += att(spot.intensity, spot.position.distanceTo(p), spot.decay, 0) * lum(spot.color) * 0.6;
      return L / Math.max(REF, 1e-3);
    };

    const V = new THREE.Vector3();
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
    const seenRoots = new WeakSet();
    const inScene = (o) => {
      for (; o; o = o.parent) if (o === scene) return true;
      return false;
    };
    const shown = (o) => {
      for (; o; o = o.parent) if (!o.visible) return false;
      return true;
    };
    const visitNew = (parent) => {
      if (!parent) return;
      for (const c of parent.children) {
        if (seenRoots.has(c)) continue;
        seenRoots.add(c);
        c.traverse((o) => (o.isMesh || o.isSprite) && handle(o));
      }
    };
    let fogK = 0;
    // fold lines are measured in drawing-buffer pixels: keep them as thick on a hi-dpi screen
    const LINE = P.U.uPaperLine.value.clone();
    let linePr = -1;

    return {
      update(dt) {
        if (renderer.toneMapping !== toneMapping) renderer.toneMapping = toneMapping;
        renderer.toneMappingExposure = exposure;
        const pr = renderer.getPixelRatio();
        if (pr !== linePr) {
          linePr = pr;
          P.U.uPaperLine.value.set(LINE.x * pr, LINE.y * pr, LINE.z);
        }
        // new things (a visitor, a puddle, drops) are styled before their first frame, not half a second later
        visitNew(scene);
        visitNew(game?.dynamic);

        // skin prints whose sheet has loaded since
        for (const s of skins) {
          if (s.ver === s.src.version || !s.src.image?.width) continue;
          s.ver = s.src.version;
          posterize(s.src.image, s.dst.image);
          s.dst.needsUpdate = true;
        }

        // heads: sticker map in, sprite grown by the border, light of the room
        const people = new Map(); // body to put a blob under -> size
        let catLit = null;
        for (const [s, st] of heads) {
          if (!inScene(s)) {
            heads.delete(s);
            continue;
          }
          const map = s.material.map;
          if (map && !stickerTex.has(map)) {
            const e = sticker(map, !!s.userData.catFace);
            if (e) {
              st.raw = map;
              st.e = e;
              const c0 = (s.userData.paperC0 ??= s.center.clone()); // the game's own anchor: the centre we set is already padded
              st.base = { sx: s.scale.x, sy: s.scale.y, cx: c0.x, cy: c0.y };
              s.material.map = e.tex;
              const { w, h, pad } = e;
              s.scale.set((st.base.sx * (w + 2 * pad)) / w, (st.base.sy * (h + 2 * pad)) / h, 1);
              s.center.set((st.base.cx * w + pad) / (w + 2 * pad), (st.base.cy * h + pad) / (h + 2 * pad));
            }
          } else if (st.raw && st.e && st.e.ver !== st.raw.version) sticker(st.raw); // the photo arrived
          if (!shown(s)) continue;
          s.getWorldPosition(V);
          V.y += 0.22;
          const k = Math.min(1.1, Math.max(0.6, lightAt(V)));
          st.lit.value = k;
          // the body under the head: neck -> spine -> pelvis (a guy), head -> body (the cat)
          const cat = !!s.userData.catFace;
          const body = cat ? s.parent?.parent : s.parent?.parent?.parent;
          if (body && !people.has(body)) people.set(body, cat ? 0.5 : 0.8);
          if (cat) catLit = k;
        }
        if (catLit !== null) rimMat.color.copy(RIM).multiplyScalar(catLit * 0.9);

        // blob shadows
        let n = 0;
        for (const [body, size] of people) {
          if (n >= BLOBS || !shown(body)) continue;
          body.getWorldPosition(V);
          const floor = outside?.heightAt ? outside.heightAt(V.x, V.z, V.y - 0.9) : 0;
          const lift = Math.max(0, V.y - floor - (size < 0.6 ? 0.25 : 0.95)); // jumping, or up on the sofa
          const k = size * (1 - Math.min(0.5, lift * 0.6));
          M4.compose(S.set(V.x, floor + 0.016, V.z), Q, V.set(k, 1, k));
          blobs.setMatrixAt(n++, M4);
        }
        blobs.count = n;
        blobs.instanceMatrix.needsUpdate = true;

        // fog and the moon only outside the flat
        camera.getWorldPosition(V);
        const room = apt ? roomAt(V.x, V.z) : { outdoor: false };
        const outdoors = !room || room.outdoor || V.y < -0.5;
        fogK += ((outdoors ? 1 : 0) - fogK) * Math.min(1, dt * 3);
        fog.density = 0.03 * fogK;

        // the shadow lamp follows Oleg from room to room
        if (spot) {
          const lamp = srcLamps.find((l) => l.room.id === room?.id && !l.room.outdoor);
          for (const l of srcLamps) if (l.light) l.light.intensity = l === lamp ? l.base * 0.45 : l.base;
          if (lamp) {
            const [x, z] = lamp.room.lamp;
            spot.position.set(x, H - 0.5, z);
            spot.target.position.set(x, 0, z);
            spot.target.updateMatrixWorld();
            spot.color.set(lamp.room.lampColor ?? '#ffd7a0');
            spot.intensity = lamp.base * 0.9;
          } else spot.intensity = 0;
        }
      },
    };
  },
};
