// Ink for the toon style (src/styles/toon.js), all of it in materials so the door camera and the
// bathroom mirror draw it too:
//   hulls  - an inverted copy of a mesh, pushed out along its normals by a constant number of pixels
//            in the vertex shader and drawn back faces only: the outline round every object
//   shell  - the flat's (and the stairwell's) creases as screen-space fat lines in one draw call:
//            room corners, floor and ceiling lines, door and window reveals. Found once from the
//            geometry; seams between wall pieces and wallpaper strips are dropped.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// shared by every ink material: drawing-buffer size in px (set each frame by the style)
export const RES = { value: new THREE.Vector2(1280, 720) };

const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

// ---------- hulls ----------

// open: for open DoubleSide shells (the bucket, the pot): pushed back in depth, so where the hull lies
// on the shell's own inner side the shell wins and only the silhouette and the rim stay ink
export function hullMaterial(color, px, { open = false } = {}) {
  return new THREE.ShaderMaterial({
    polygonOffset: open,
    polygonOffsetFactor: open ? 2 : 0,
    polygonOffsetUnits: open ? 8 : 0,
    name: 'toon-ink',
    uniforms: { ...fogUniforms(), uColor: { value: new THREE.Color(color) }, uPx: { value: px }, uRes: RES },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform vec2 uRes;
      uniform float uPx;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec4 c = projectionMatrix * mvPosition;
        vec3 n = normalize(normalMatrix * normal);
        vec2 d = (projectionMatrix * vec4(n, 0.0)).xy * uRes;
        float L = length(d);
        if (L > 1e-5) c.xy += d / L * uPx * 2.0 / uRes * c.w;
        gl_Position = c;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    side: THREE.BackSide,
    fog: true,
    toneMapped: false,
  });
}

// smooth-normal copy of a geometry (positions only, welded), cached; null when the mesh is open
// (planes, open cylinders): a back-face hull of an open surface would show through the opening.
// open = true takes open ones too (for DoubleSide shells, drawn with an open hull material).
const hullGeos = new WeakMap(), openGeos = new WeakMap();
export function hullGeometry(src, { open = false } = {}) {
  if (hullGeos.has(src)) return hullGeos.get(src) ?? (open ? openGeos.get(src) ?? null : null);
  let out = null;
  const pos = src.attributes.position;
  if (pos && pos.count >= 4 && !src.morphAttributes?.position) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos.clone());
    if (src.index) g.setIndex(src.index.clone());
    const w = mergeVertices(g, 1e-4);
    g.dispose();
    w.computeVertexNormals();
    w.computeBoundingSphere();
    if (closed(w)) out = w;
    else if (w.index) openGeos.set(src, w);
    else w.dispose();
  }
  hullGeos.set(src, out);
  return out ?? (open ? openGeos.get(src) ?? null : null);
}

// every edge shared by two triangles (after welding)
function closed(g) {
  const idx = g.index;
  if (!idx) return false;
  const count = new Map();
  const n = g.attributes.position.count;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const k = p < q ? p * n + q : q * n + p;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  for (const v of count.values()) if (v < 2) return false;
  return count.size > 0;
}

export function makeHull(mesh, geo, material) {
  const h = new THREE.Mesh(geo, material);
  h.name = 'toon-hull';
  h.userData.toonOwn = true;
  h.matrixAutoUpdate = false;
  h.raycast = () => {};
  h.renderOrder = mesh.renderOrder - 0.5;
  mesh.add(h);
  return h;
}

// ---------- shell lines ----------

// screen-space fat lines: each segment is a quad (4 vertices) widened in the vertex shader, pulled
// 1 cm towards the eye so a line still shows on a wallpaper strip 4 mm in front of its wall
export function lineMaterial(color, px) {
  return new THREE.ShaderMaterial({
    name: 'toon-shell',
    uniforms: { ...fogUniforms(), uColor: { value: new THREE.Color(color) }, uPx: { value: px }, uRes: RES, uNear: { value: 0.05 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec3 aOther;
      attribute vec2 aCorner; // x: 0 at this end, 1 at the other end's vertex; y: side -1 / +1
      uniform vec2 uRes;
      uniform float uPx, uNear;
      vec4 pull(vec4 p) {
        float l = length(p.xyz);
        p.xyz *= max(0.0, 1.0 - 0.01 / max(l, 0.02));
        return p;
      }
      void main() {
        vec4 a = pull(modelViewMatrix * vec4(position, 1.0));
        vec4 b = pull(modelViewMatrix * vec4(aOther, 1.0));
        float nz = -uNear - 0.001;
        if (a.z > nz && b.z > nz) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        if (a.z > nz) a = mix(a, b, (a.z - nz) / (a.z - b.z));
        if (b.z > nz) b = mix(b, a, (b.z - nz) / (b.z - a.z));
        vec4 ca = projectionMatrix * a, cb = projectionMatrix * b;
        vec2 sa = ca.xy / ca.w * uRes, sb = cb.xy / cb.w * uRes;
        vec2 raw = sb - sa; // this end -> the other end
        float L = length(raw);
        raw = L > 1e-4 ? raw / L : vec2(1.0, 0.0);
        vec2 ab = aCorner.x > 0.5 ? -raw : raw; // the same direction at both ends, so the sides agree
        vec2 nrm = vec2(-ab.y, ab.x);
        // uRes-scaled units are half-pixels: uPx wide in all, and half a width past each end (no gaps at corners)
        vec2 off = (nrm * aCorner.y - raw) * uPx;
        ca.xy += off / uRes * ca.w;
        gl_Position = ca;
        vec4 mvPosition = a;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

// segments [[ax,ay,az,bx,by,bz], ...] -> one mesh
export function lineMesh(segs, material) {
  const n = segs.length;
  const pos = new Float32Array(n * 12), oth = new Float32Array(n * 12), cor = new Float32Array(n * 8);
  const idx = new Uint32Array(n * 6);
  segs.forEach((s, i) => {
    const A = s.slice(0, 3), B = s.slice(3, 6);
    const v = [[A, B, 0, -1], [A, B, 0, 1], [B, A, 1, -1], [B, A, 1, 1]];
    v.forEach(([p, o, t, side], k) => {
      pos.set(p, (i * 4 + k) * 3);
      oth.set(o, (i * 4 + k) * 3);
      cor.set([t, side], (i * 4 + k) * 2);
    });
    idx.set([0, 1, 2, 2, 1, 3].map((q) => q + i * 4), i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aOther', new THREE.BufferAttribute(oth, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.Mesh(g, material);
  m.name = 'toon-shell';
  m.userData.toonOwn = true;
  m.frustumCulled = false;
  m.raycast = () => {};
  m.onBeforeRender = (r, s, cam) => (material.uniforms.uNear.value = cam.near ?? 0.05);
  return m;
}

// Creases of static geometry, in world space. meshes: the shell's meshes (walls, wallpaper strips,
// floors, frames...). A crease (faces at more than 30 degrees, or the border of an open surface) is
// sampled every few cm and kept where it is really seen:
//  - not buried inside one of the closed boxes (wall pieces overlap at corners);
//  - a box face that goes on flush into another box of the same material (wall pieces around a window)
//    is a seam, not a line;
//  - an open surface (wallpaper strip, floor) that goes on into a coplanar surface of the same
//    material is a seam too; one that stops at a wall, a reveal or a different finish is a line.
export function shellSegments(meshes, { step = 0.04, eps = 0.01, crease = 30 } = {}) {
  const cosCrease = Math.cos((crease * Math.PI) / 180);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const solids = [], surfs = [];
  const items = [];
  const tmp = new THREE.Vector3();
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos) continue;
    mesh.updateWorldMatrix(true, false);
    const M = mesh.matrixWorld;
    const P = [];
    for (let i = 0; i < pos.count; i++) P.push(tmp.fromBufferAttribute(pos, i).applyMatrix4(M).clone());
    const tris = [];
    const index = geo.index;
    const nTri = (index ? index.count : pos.count) / 3;
    const matOf = (t) => {
      if (!Array.isArray(mesh.material)) return mesh.material;
      const g = geo.groups.find((q) => t * 3 >= q.start && t * 3 < q.start + q.count);
      return mesh.material[g?.materialIndex ?? 0];
    };
    for (let t = 0; t < nTri; t++) {
      const ia = index ? index.getX(t * 3) : t * 3, ib = index ? index.getX(t * 3 + 1) : t * 3 + 1, ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const a = P[ia], b = P[ib], c = P[ic];
      const n = V().subVectors(b, a).cross(V().subVectors(c, a));
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      tris.push({ a, b, c, n, m: matOf(t) });
    }
    const isBox = geo.type === 'BoxGeometry';
    const item = { mesh, tris, isBox };
    items.push(item);
    if (isBox) {
      // convex: its distinct face planes
      const planes = [];
      for (const t of tris) {
        const d = t.n.dot(t.a);
        if (!planes.some((p) => p.n.dot(t.n) > 0.999 && Math.abs(p.d - d) < 1e-4)) planes.push({ n: t.n, d });
      }
      const box = new THREE.Box3().setFromPoints(P);
      solids.push({ planes, box, mat: Array.isArray(mesh.material) ? mesh.material : mesh.material });
      item.solid = solids[solids.length - 1];
    } else {
      for (const t of tris) {
        const box = new THREE.Box3().setFromPoints([t.a, t.b, t.c]);
        surfs.push({ ...t, box, d: t.n.dot(t.a) });
      }
    }
  }
  // spatial hash, 0.5 m cells
  const C = 0.5;
  const hash = (ix, iy, iz) => (ix + 1024) * 4194304 + (iy + 1024) * 2048 + (iz + 1024);
  const grid = (list) => {
    const map = new Map();
    for (const o of list) {
      const a = o.box.min, b = o.box.max;
      const x0 = Math.floor(a.x / C), x1 = Math.floor(b.x / C), y0 = Math.floor(a.y / C), y1 = Math.floor(b.y / C), z0 = Math.floor(a.z / C), z1 = Math.floor(b.z / C);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 20000) continue; // huge background pieces
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const k = hash(x, y, z);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(o);
      }
    }
    return map;
  };
  const gS = grid(solids), gF = grid(surfs);
  const near = (map, p) => map.get(hash(Math.floor(p.x / C), Math.floor(p.y / C), Math.floor(p.z / C))) ?? [];
  const solidAt = (p, tol = 1e-3) => {
    for (const s of near(gS, p)) {
      if (!s.box.containsPoint(p)) continue;
      if (s.planes.every((q) => q.n.dot(p) - q.d < -tol)) return s;
    }
    return null;
  };
  const onSurface = (p, n, m) => {
    for (const s of near(gF, p)) {
      if (s.m !== m || s.n.dot(n) < 0.999 || Math.abs(s.n.dot(p) - s.d) > 0.003) continue;
      if (inTri(p, s)) return true;
    }
    return false;
  };
  const segs = [];
  const q = V(), A = V(), B = V(), dir = V();
  for (const item of items) {
    // weld this mesh's vertices (1 mm) and collect its edges with their faces
    const key = (v) => `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
    const edges = new Map();
    for (const t of item.tris) {
      for (const [p0, p1, p2] of [[t.a, t.b, t.c], [t.b, t.c, t.a], [t.c, t.a, t.b]]) {
        const k0 = key(p0), k1 = key(p1);
        if (k0 === k1) continue;
        const k = k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`;
        let e = edges.get(k);
        if (!e) edges.set(k, (e = { a: p0, b: p1, faces: [] }));
        e.faces.push({ t, opp: p2 });
      }
    }
    for (const e of edges.values()) {
      if (e.faces.length === 2 && e.faces[0].t.n.dot(e.faces[1].t.n) > cosCrease) continue;
      const len = e.a.distanceTo(e.b);
      if (len < 0.005) continue;
      dir.subVectors(e.b, e.a).divideScalar(len);
      // for each face: its normal and the in-plane direction away from it, past the edge
      const faces = e.faces.map(({ t, opp }) => {
        const out = V().crossVectors(dir, t.n).normalize();
        if (out.dot(V().subVectors(opp, e.a)) > 0) out.negate();
        return { n: t.n, out, m: t.m };
      });
      const N = Math.max(1, Math.ceil(len / step));
      let run = -1;
      const flush = (j) => {
        if (run >= 0) {
          A.lerpVectors(e.a, e.b, run / N);
          B.lerpVectors(e.a, e.b, j / N);
          segs.push([A.x, A.y, A.z, B.x, B.y, B.z]);
        }
        run = -1;
      };
      for (let j = 0; j < N; j++) {
        const p = V().lerpVectors(e.a, e.b, (j + 0.5) / N);
        let keep = !solidAt(p, 0.002);
        for (const f of faces) {
          if (!keep) break;
          if (item.isBox) {
            // flush into another box of the same finish: a seam
            const s = solidAt(q.copy(p).addScaledVector(f.out, eps).addScaledVector(f.n, -eps));
            if (s && s !== item.solid && s.mat === item.solid.mat && !solidAt(q.copy(p).addScaledVector(f.out, eps).addScaledVector(f.n, eps))) keep = false;
          } else if (onSurface(q.copy(p).addScaledVector(f.out, eps), f.n, f.m)) keep = false;
        }
        if (keep) {
          if (run < 0) run = j;
        } else flush(j);
      }
      flush(N);
    }
  }
  return segs;
}

const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
function inTri(p, t) {
  _v0.subVectors(t.c, t.a);
  _v1.subVectors(t.b, t.a);
  _v2.subVectors(p, t.a);
  const d00 = _v0.dot(_v0), d01 = _v0.dot(_v1), d02 = _v0.dot(_v2), d11 = _v1.dot(_v1), d12 = _v1.dot(_v2);
  const den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-12) return false;
  const u = (d11 * d02 - d01 * d12) / den, v = (d00 * d12 - d01 * d02) / den;
  const tol = 1e-3;
  return u >= -tol && v >= -tol && u + v <= 1 + tol;
}
