// "Тёплые нулевые" (?style=y2k): today's flat, finished the way a 2004-2007 engine would have finished it
// (Half-Life 2, Сталкер, Garry's Mod). Spec: the art-direction panel's final.styles[id=y2k].
//   - materials stay MeshStandard + ACES; lacquer, enamel, chrome and bottle glass get their gloss
//   - one PMREM env captured from the zal at load: glints on the стенка, the bottles, the chrome
//   - contact shading without shadow maps: a blurred plan AO under furniture and along walls,
//     darker skirting and ceiling lines (lib/y2k-shader.js)
//   - one shadow-casting spot under the lamp of the room you are in (the room's own lamp drops to 60 %)
//   - fBm detail multiply, a Sobel detail normal, per-plank parquet roughness
//   - bloom on the bright bits (bulbs, signs, tubes, screens, coals), a warm "film" grade
//   - outside at night: fog, almost no fill light, the env turned down
//   - the photo heads take the light at the head (no more glowing in the dark), soft blobs under everyone
// Knob: &shadows=0 drops the spot's shadow map (weak laptops).
import * as THREE from 'three';
import { ROOMS, WALLS, DIAG_WALLS, FURNITURE, BALCONY, BOUNDS, H, roomAt } from '../world/layout.js';
import * as T from '../world/textures.js';
import { shared, patchStandard, patchLitSprite } from './lib/y2k-shader.js';
import * as YT from './lib/y2k-tex.js';
import { makeGrade, makeBloom } from './lib/y2k-post.js';

const params = new URLSearchParams(location.search);
const SHADOWS = params.get('shadows') !== '0';

export const LOOK = {
  env: { inside: 0.35, outside: 0.2, size: 128, height: 1.4 },
  spot: { share: 0.5, lampKeep: 0.6, angle: 1.25, penumbra: 0.7, map: 1024, bias: -0.0004, normalBias: 0.02, far: 6.5, distance: 7, radius: 3, fade: 6 },
  bloom: { strength: 0.35, radius: 0.4, threshold: 0.85 },
  fog: { color: '#0e1218', density: 0.045 },
  night: { hemiIn: 0.8, hemiOut: 0.3, moonOut: 0.35 },
  heads: { min: 0.5, max: 1.15, gamma: 0.5, refDist: 1.4 },
};

// the game's materials, recognised by their colours (furniture.js M, apartment.js, goods.js, outside.js)
const ROLES = {
  // veneer and lacquered wood: the стенка glints
  '6b4428': { roughness: 0.35 }, // M.wood
  '3b2416': { roughness: 0.3 }, // M.darkWood (стенка, frames)
  'b08a5a': { roughness: 0.4 }, // M.lightWood (loft bed, sister's desk)
  '5b3a22': { roughness: 0.35 }, // the showroom's skirting
  '7a5a3a': { roughness: 0.4 }, // the kiosk counter
  // enamel and gloss paint
  'fbfbf7': { roughness: 0.2, color: '#ece6d8' }, // M.enamel: fridge, stove, tub, toilet (warm, as old enamel is)
  'f1efe9': { roughness: 0.25 }, // M.white
  'e6dccb': { roughness: 0.35 }, // the bathroom door
  'e8e4da': { roughness: 0.35 }, // window frames
  'f0ede6': { roughness: 0.3 }, // sills
  'e9e4d6': { roughness: 0.35 }, // radiators
  'eeeae2': { roughness: 0.35 }, 'f2efe8': { roughness: 0.35 }, // balcony frames
  'e7ddc7': { roughness: 0.4 }, 'd8ccb2': { roughness: 0.4 }, // kitchen cabinets and drawer fronts
  'dcdad4': { roughness: 0.3 }, // microwave
  'c9463d': { roughness: 0.3 }, // oilcloth
  '5a2d1c': { roughness: 0.45 }, // the dermantin entrance door
  // chrome and brass
  '9aa0a6': { roughness: 0.15, metalness: 1 }, // M.metal
  'c9dde6': { roughness: 0.05, metalness: 1 }, // the wardrobe mirror door
  'c9a44a': { roughness: 0.25, metalness: 1 }, // door knobs
  'b08a3a': { roughness: 0.3, metalness: 0.9 }, // upholstery buttons
  '8b9298': { roughness: 0.2, metalness: 0.9 }, // shower hose
  // crystal and bottle glass
  'dfe8ee': { roughness: 0.08 }, 'a7c4c9': { roughness: 0.08 },
  'c6dbe2': { roughness: 0.08 }, '5a2c0e': { roughness: 0.08 }, '2a5f2e': { roughness: 0.08 }, '8a4512': { roughness: 0.08 },
  // fabric: no gloss, a weave in the normal
  '7a3b2e': { fabric: true }, '3d5a80': { fabric: true }, '46607a': { fabric: true }, 'd67fa0': { fabric: true },
  'efe9dc': { fabric: true }, 'f4f0e6': { fabric: true }, 'c7b24a': { fabric: true },
};
const WALL_COLORS = new Set(['d9d2c3', '3f6b5a', 'c9c6b8']); // flat paint, the stairwell's green and white
const CEILING = 'efece6';

// MeshBasic things that should bloom: how much brighter (the linear picture goes above the threshold)
const GLOW = {
  'fff2d0': 3, // bulbs
  'ffd59a': 3, // street lamp heads
  'f4fbff': 2.2, // kiosk tubes
  '4cff7a': 2, // microwave LED
  'ffcf5a': 2.5, // cake candle flames
};

export default {
  name: 'Нулевые',
  async apply(ctx) {
    const { scene, renderer, camera, apt, furn, outside } = ctx;
    const inGame = !!apt;

    // ---------- shared textures
    shared.uY2kNoise.value = YT.noise();
    shared.uY2kNrm.value = YT.noiseNormal();
    shared.uY2kH.value = H;
    if (inGame) {
      // the flat, the balcony and the landing, padded: walls and furniture footprints in black
      const box = {
        x0: Math.min(BOUNDS.x0, ...WALLS.map((w) => w.x0)) - 0.4,
        x1: Math.max(BOUNDS.x1, ...WALLS.map((w) => w.x1)) + 0.4,
        z0: Math.min(BOUNDS.z0, BALCONY.z0) - 0.4,
        z1: Math.max(BOUNDS.z1, ...WALLS.map((w) => w.z1)) + 0.4,
      };
      const t = BALCONY.rail;
      const rects = [
        ...WALLS,
        ...FURNITURE.filter((f) => !f.onTop),
        { x0: BALCONY.x0, x1: BALCONY.x1, z0: BALCONY.z0, z1: BALCONY.z0 + t },
        { x0: BALCONY.x0, x1: BALCONY.x0 + t, z0: BALCONY.z0, z1: BALCONY.z1 },
        { x0: BALCONY.x1 - t, x1: BALCONY.x1, z0: BALCONY.z0, z1: BALCONY.z1 },
      ];
      shared.uY2kAOMap.value = YT.planAO(box, rects, DIAG_WALLS);
      shared.uY2kAOBox.value.set(box.x0, box.z0, 1 / (box.x1 - box.x0), 1 / (box.z1 - box.z0));
    } else {
      // the showroom has no plan: an empty AO texture outside of everything
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 4, 4);
      shared.uY2kAOMap.value = new THREE.CanvasTexture(c);
      shared.uY2kAOBox.value.set(1e5, 1e5, 1e-6, 1e-6);
    }
    const floorMaps = new Map([[T.parquet(), 'parquet'], [T.linoleum(), 'linoleum'], [T.floorTile(), 'tile'], [T.concrete(), 'concrete']]);
    const wallMaps = new Set([...Object.values(T.wallpapers).map((f) => f()), T.wallTile()]);
    const fabricMaps = new Set([T.wallCarpet(), T.floorRug()]);

    // ---------- where a mesh lives
    const place = (o) => {
      for (let p = o.parent; p; p = p.parent) {
        if (p === camera) return 'view';
        if (inGame && p === apt.ceiling) return 'ceiling';
        if (inGame && p === outside.group) return 'outside';
        if (inGame && p === apt.group) return 'apt';
        if (inGame && p === furn.group) return 'furn';
      }
      return inGame ? 'dynamic' : 'showroom';
    };

    // ---------- materials (each source material once: many meshes share one)
    const done = new WeakSet();
    const styleMaterial = (m, where) => {
      if (done.has(m)) return;
      done.add(m);
      if (m.isMeshStandardMaterial) {
        const hex = m.color.getHexString();
        const role = ROLES[hex];
        if (role?.roughness !== undefined) m.roughness = role.roughness;
        if (role?.metalness !== undefined) m.metalness = role.metalness;
        if (role?.color) m.color.set(role.color);
        const world = where === 'apt' || where === 'furn' || where === 'ceiling' || where === 'outside' || where === 'showroom';
        const flags = { ao: world ? 1 : 0, detail: world ? 0.08 : 0.03, rough: world ? 0.1 : 0.05 };
        const floor = floorMaps.get(m.map);
        if (floor) {
          Object.assign(flags, { normal: floor === 'concrete' ? 0.18 : 0.07, freq: 1.2 });
          if (floor === 'parquet') {
            m.roughnessMap = YT.parquetRough();
            m.roughness = 1;
          }
          if (floor === 'linoleum') m.roughness = 0.45;
          if (floor === 'tile') m.roughness = 0.3;
        } else if (wallMaps.has(m.map) || (WALL_COLORS.has(hex) && !m.map)) {
          Object.assign(flags, { wall: 1, normal: 0.25, freq: 2.2 });
        } else if (hex === CEILING) {
          Object.assign(flags, { detail: 0.05 });
        } else if (role?.fabric || fabricMaps.has(m.map) || (m.roughness >= (world ? 0.9 : 0.7) && m.metalness < 0.3 && !m.transparent)) {
          // velour, blankets, carpets; the guys' clothes and skin sheets
          Object.assign(flags, { normal: 0.2, freq: world ? 6 : 9, rough: 0.04 });
          if (!world) m.roughness = 0.85;
          if (m.map) m.map.anisotropy = 8;
        } else if (m.map) {
          flags.detail = world ? 0.04 : 0.02; // already textured (the Poly Haven props, paintings, packs)
        }
        if (m.transparent && m.opacity < 0.95) Object.assign(flags, { detail: 0, rough: 0 });
        patchStandard(m, flags);
        return;
      }
      if (m.isMeshBasicMaterial) {
        const hex = m.color.getHexString();
        if (GLOW[hex] && !m.map) m.color.multiplyScalar(GLOW[hex]);
        // the "Продукты 24" signs: a canvas 512×96, not tone mapped, two-sided
        const img = m.map?.image;
        if (img && m.toneMapped === false && m.side === THREE.DoubleSide && img.width === 512 && img.height === 96) m.color.multiplyScalar(1.6);
      }
    };

    // ---------- shadows: one spot under the lamp of the room you are in
    renderer.shadowMap.enabled = SHADOWS;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is gone in r186: PCF + radius
    renderer.shadowMap.autoUpdate = false; // once per frame, before the main picture (the mirror and the door camera reuse it)
    const S = LOOK.spot;
    const spot = new THREE.SpotLight('#ffd7a0', 0, S.distance, S.angle, S.penumbra, 1.6);
    spot.castShadow = SHADOWS;
    spot.shadow.mapSize.set(S.map, S.map);
    spot.shadow.bias = S.bias;
    spot.shadow.normalBias = S.normalBias;
    spot.shadow.radius = S.radius;
    spot.shadow.camera.near = 0.1;
    spot.shadow.camera.far = S.far;
    spot.userData.y2k = true;
    scene.add(spot, spot.target);

    // the lamps a spot can sit under: rooms with a lamp (+ their light); the showroom: its brightest lamp
    const lamps = [];
    if (inGame) {
      for (const room of ROOMS) {
        if (!room.lamp) continue;
        const light = apt.lights.find((l) => Math.abs(l.position.x - room.lamp[0]) < 0.01 && Math.abs(l.position.z - room.lamp[1]) < 0.01);
        if (light) lamps.push({ room, light, base: light.intensity });
      }
    } else {
      let best = null;
      scene.traverse((o) => o.isPointLight && (!best || o.intensity > best.intensity) && (best = o));
      if (best) lamps.push({ room: null, light: best, base: best.intensity });
    }
    const lampOf = (room) => lamps.find((l) => l.room === room) ?? null;
    const living = inGame ? lampOf(ROOMS.find((r) => r.chandelier)) : lamps[0];

    // static casters, switched on per room (walls of other rooms don't need to be in the shadow pass)
    const casters = [];
    const box3 = new THREE.Box3();
    const near = (q, b, m = 0.4) => b.max.x > q.x0 - m && b.min.x < q.x1 + m && b.max.z > q.z0 - m && b.min.z < q.z1 + m;
    const castersFor = (lamp) => {
      for (const c of casters) c.mesh.castShadow = !!lamp && SHADOWS && (!lamp.room || lamp.room.rects.some((q) => near(q, c.box)));
    };

    // ---------- people: photo heads take the light, blobs under them
    const heads = []; // { sprite, u, lit }
    const people = new Map(); // root -> { neck, cat }
    const personRoot = (o) => {
      let x = o;
      while (x.parent && x.parent !== scene && x.parent.parent !== scene) x = x.parent;
      return x;
    };
    const styleSprite = (s) => {
      const m = s.material;
      if (m.blending === THREE.AdditiveBlending) return; // the lamp halos: bloom adds to them, leave them be
      if (!(m.alphaTest > 0) || !m.map || !m.sizeAttenuation) return; // name tags, bubbles, particles
      heads.push({ sprite: s, u: patchLitSprite(m), lit: 1 });
      const root = personRoot(s);
      if (!people.has(root)) people.set(root, { neck: s.parent, cat: !!s.userData.catFace || s.scale.y < 0.35 });
    };

    ctx.each((o) => {
      if (o.isSprite) return styleSprite(o);
      if (!o.isMesh) return;
      const where = place(o);
      const ms = [o.material].flat();
      for (const m of ms) styleMaterial(m, where);
      const std = ms.some((m) => m.isMeshStandardMaterial);
      const opaque = ms.some((m) => m.isMeshStandardMaterial && !(m.transparent && m.opacity < 0.9));
      o.receiveShadow = std;
      if (!opaque || where === 'view' || where === 'ceiling' || where === 'outside') {
        o.castShadow = false;
        return;
      }
      if (where === 'apt' || where === 'furn' || where === 'showroom') {
        box3.setFromObject(o);
        if (box3.min.y > 1.9) return void (o.castShadow = false); // the chandelier, boxes on the wardrobe
        casters.push({ mesh: o, box: box3.clone() });
        o.castShadow = false; // until the spot picks a room
        return;
      }
      o.castShadow = SHADOWS; // the guys, the cat, bottles, the bucket
    });

    // ---------- env: one capture of the zal; a black placeholder of the same size until then, so no
    // material compiles twice (the env's size is part of the program)
    const E = LOOK.env;
    const cubeRT = new THREE.WebGLCubeRenderTarget(E.size, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(0.05, 40, cubeRT);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const black = new THREE.Scene();
    black.background = new THREE.Color(0);
    cubeCam.update(renderer, black);
    const envRT = pmrem.fromCubemap(cubeRT.texture);
    scene.environment = envRT.texture;
    scene.environmentIntensity = E.inside;
    let captured = false;
    const capture = () => {
      const at = living?.light.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 0, 0);
      cubeCam.position.set(at.x, E.height, at.z);
      const hidden = [];
      scene.traverse((o) => o.isSprite && o.visible && (hidden.push(o), (o.visible = false)));
      const fog = scene.fog;
      scene.fog = null;
      cubeCam.update(renderer, scene);
      scene.fog = fog;
      for (const o of hidden) o.visible = true;
      pmrem.fromCubemap(cubeRT.texture, envRT);
      pmrem.dispose();
      cubeRT.dispose();
    };

    // ---------- night outside
    let hemi = null, moon = null;
    if (inGame) {
      apt.group.traverse((o) => {
        if (o.isHemisphereLight) hemi = { l: o, base: o.intensity };
        if (o.isDirectionalLight) moon = { l: o, base: o.intensity };
      });
      scene.fog = new THREE.FogExp2(LOOK.fog.color, 0); // always there (density 0 inside): no recompiles at the door
      // the panel block across the yard stays a backdrop of lit windows through the fog
      apt.group.traverse((o) => o.isMesh && o.material?.map === T.cityFacade() && (o.material.fog = false));
    }

    // ---------- post
    const bloom = makeBloom(renderer, LOOK.bloom);
    ctx.linearPass(bloom); // after the drunk pass, before tone mapping
    ctx.displayPass(makeGrade());

    // ---------- contact blobs: one instanced mesh, a soft dark disc under everyone
    const MAXB = 24;
    const blobs = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: YT.blob(), transparent: true, depthWrite: false, color: '#000', opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      MAXB,
    );
    blobs.frustumCulled = false;
    blobs.renderOrder = 1;
    blobs.userData.y2k = true;
    scene.add(blobs);

    // ---------- the light at a point, for the heads: what three's shader would give a surface facing sideways
    const H3 = LOOK.heads;
    let pointLights = [], scanIn = 0;
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const falloff = (d, cut, decay) => {
      let f = 1 / Math.max(Math.pow(d, decay), 0.01);
      if (cut > 0) f *= Math.pow(Math.max(0, Math.min(1, 1 - Math.pow(d / cut, 4))), 2);
      return f;
    };
    const P = new THREE.Vector3(), Q = new THREE.Vector3(), D = new THREE.Vector3();
    const lightAt = (p) => {
      let e = 0;
      for (const l of pointLights) {
        if (l.intensity <= 0) continue;
        l.getWorldPosition(Q);
        e += l.intensity * lum(l.color) * falloff(Q.distanceTo(p), l.distance, l.decay) * 0.6;
      }
      if (hemi) e += hemi.l.intensity * lum(hemi.l.color.clone().lerp(hemi.l.groundColor, 0.5));
      if (spot.intensity > 0) {
        spot.getWorldPosition(Q);
        D.subVectors(p, Q);
        const d = D.length(), cos = -D.y / Math.max(d, 1e-3);
        const outer = Math.cos(spot.angle), inner = Math.cos(spot.angle * (1 - spot.penumbra));
        const cone = THREE.MathUtils.smoothstep(cos, outer, inner);
        e += spot.intensity * lum(spot.color) * falloff(d, spot.distance, spot.decay) * cone * 0.6;
      }
      return e;
    };
    const refLight = () => {
      const l = living?.light;
      if (!l) return 1;
      return (living.base * lum(l.color) * falloff(H3.refDist, l.distance, l.decay) * 0.6) + (hemi ? hemi.base * LOOK.night.hemiIn * 0.3 : 0);
    };
    const REF = refLight();

    // ---------- per frame
    let cur = null, w = 0, fogD = 0, envK = E.inside, outK = 0;
    const cam = new THREE.Vector3();
    const M4 = new THREE.Matrix4(), QT = new THREE.Quaternion(), SC = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    let frame = 0;

    window.__y2k = { LOOK, spot, bloom, blobs, heads, people, shared }; // tuning from the console

    return {
      update(dt) {
        frame++;
        if (!captured && frame >= 2) {
          captured = true;
          capture();
        }
        camera.getWorldPosition(cam);
        const room = inGame && cam.y > -0.8 ? roomAt(cam.x, cam.z) : null;
        const outsideNow = inGame && (!room || room.id === 'landing');

        // the spot follows the room: fade out, move, fade in
        let want = inGame ? (room?.lamp ? lampOf(room) : room?.id === 'balcony' ? living : null) : lamps[0] ?? null;
        if (want !== cur) {
          w = Math.max(0, w - dt * S.fade);
          if (w === 0) {
            if (cur) cur.light.intensity = cur.base;
            cur = want;
            if (cur) {
              cur.light.getWorldPosition(P);
              spot.position.set(P.x, P.y - 0.02, P.z);
              spot.target.position.set(P.x, P.y - 3, P.z);
              spot.target.updateMatrixWorld();
              spot.color.copy(cur.light.color);
            }
            castersFor(cur);
          }
        } else w = Math.min(1, w + dt * S.fade);
        if (cur) {
          cur.light.intensity = cur.base * (1 - (1 - S.lampKeep) * w);
          spot.intensity = cur.base * S.share * w;
        } else spot.intensity = 0;
        // the map has to exist from the first frame on (a spot shadow sampler with no map drops the draws)
        renderer.shadowMap.needsUpdate = SHADOWS && (spot.intensity > 0 || frame < 3);

        // outside at night: fog in, fill light and env down
        outK += ((outsideNow ? 1 : 0) - outK) * Math.min(1, dt * 3);
        fogD = LOOK.fog.density * outK;
        if (scene.fog?.isFogExp2) scene.fog.density = fogD;
        envK = E.inside + (E.outside - E.inside) * outK;
        scene.environmentIntensity = envK;
        if (hemi) hemi.l.intensity = hemi.base * (LOOK.night.hemiIn + (LOOK.night.hemiOut - LOOK.night.hemiIn) * outK);
        if (moon) moon.l.intensity = moon.base * (1 + (LOOK.night.moonOut - 1) * outK);

        // heads: lit by what is around them
        if ((scanIn -= dt) <= 0) {
          scanIn = 1;
          pointLights = [];
          scene.traverse((o) => o.isPointLight && o.visible && pointLights.push(o));
        }
        const k = Math.min(1, dt * 5);
        for (const h of heads) {
          if (!h.sprite.parent) continue;
          h.sprite.getWorldPosition(P);
          P.y += 0.25;
          const t = THREE.MathUtils.clamp(Math.pow(lightAt(P) / REF, H3.gamma), H3.min, H3.max);
          h.lit += (t - h.lit) * (frame < 3 ? 1 : k);
          h.u.value = h.lit;
        }

        // blobs: between the feet and the head, stretched when he lies on the floor
        let n = 0;
        for (const [root, p] of people) {
          if (n >= MAXB) break;
          let vis = !!root.parent;
          for (let o = root; o && vis; o = o.parent) if (!o.visible) vis = false;
          if (!vis || !p.neck.parent) continue;
          root.getWorldPosition(P);
          p.neck.getWorldPosition(Q);
          const dx = Q.x - P.x, dz = Q.z - P.z, d = Math.hypot(dx, dz);
          const wide = p.cat ? 0.42 : 0.8;
          SC.set(wide, 1, wide + d * 1.1);
          QT.setFromAxisAngle(UP, Math.atan2(dx, dz));
          D.set((P.x + Q.x) / 2, P.y + 0.016, (P.z + Q.z) / 2);
          blobs.setMatrixAt(n++, M4.compose(D, QT, SC));
        }
        blobs.count = n;
        blobs.instanceMatrix.needsUpdate = true;
      },
    };
  },
};
