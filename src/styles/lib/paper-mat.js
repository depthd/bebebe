// Materials of the "paper" style: everything matte (MeshLambertMaterial, flat shaded) with shader chunks
//   grain  paper fibre, triplanar in world space (or object space for things that move), ±6%
//   fold   a marker line and a white cut edge along every face border (box/plane/cylinder faces whose
//          'puv' coordinates run 0..1 per face), so every box reads as a folded card box
//   seams  wallpaper glued in 0.53 m rolls: a seam line, each strip a little lighter or darker, a lifted
//          top edge under the ceiling
//   ao     contact shadow from a blurred top view of the flat (floors, and walls near the floor)
//   glass  cellophane: see-through, but its fold lines stay opaque
// Conversions are cached per source material and flag set, so shared materials stay shared.
import * as THREE from 'three';

export const F = { FOLD: 1, WIDE: 2, SEAMS: 4, AO: 8, LOCAL: 16, GLASS: 32 };

const lin = (hex) => new THREE.Color(hex); // hex strings are converted to the linear working space

// ---------- 'puv': 0..1 per face, whatever the game did to the real uv (worldUV, vSlice) ----------
function gridUV(out, gx, gy) {
  for (let iy = 0; iy <= gy; iy++) for (let ix = 0; ix <= gx; ix++) out.push(ix / gx, 1 - iy / gy);
}
const puvDone = new WeakMap();
export function ensurePuv(geo) {
  if (puvDone.has(geo)) return puvDone.get(geo);
  let arr = null;
  const p = geo.parameters ?? {}, n = geo.attributes.position?.count ?? 0, uv = geo.attributes.uv;
  if (geo.type === 'BoxGeometry') {
    const [ws, hs, ds] = [p.widthSegments ?? 1, p.heightSegments ?? 1, p.depthSegments ?? 1].map((s) => Math.max(1, Math.floor(s)));
    const out = [];
    for (const [gx, gy] of [[ds, hs], [ds, hs], [ws, ds], [ws, ds], [ws, hs], [ws, hs]]) gridUV(out, gx, gy);
    if (out.length / 2 === n) arr = out;
  } else if (geo.type === 'PlaneGeometry') {
    const out = [];
    gridUV(out, Math.max(1, Math.floor(p.widthSegments ?? 1)), Math.max(1, Math.floor(p.heightSegments ?? 1)));
    if (out.length / 2 === n) arr = out;
  } else if (geo.type === 'CylinderGeometry' && uv) {
    arr = Array.from(uv.array);
  } else if (geo.type === 'BufferGeometry' && uv && n >= 24) {
    // merged boxes (the kiosk goods, goods.js batches): every uv is exactly 0 or 1
    const a = uv.array;
    let ok = true;
    for (let i = 0; i < a.length && ok; i++) ok = Math.abs(a[i]) < 1e-5 || Math.abs(a[i] - 1) < 1e-5;
    if (ok) arr = Array.from(a);
  }
  const has = !!arr;
  if (has) geo.setAttribute('puv', new THREE.Float32BufferAttribute(arr, 2));
  puvDone.set(geo, has);
  return has;
}

// ---------- shader chunks ----------
const VERT_DECL = /* glsl */ `
varying vec3 vPw;
#ifdef PAPER_FOLD
attribute vec2 puv;
varying vec2 vPuv;
#endif
`;
const VERT_MAIN = /* glsl */ `
{
  vec4 pw = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
  pw = instanceMatrix * pw;
  #endif
  #ifdef PAPER_LOCAL
  vPw = pw.xyz;
  #else
  vPw = ( modelMatrix * pw ).xyz;
  #endif
  #ifdef PAPER_FOLD
  vPuv = puv;
  #endif
}
`;
const FRAG_DECL = /* glsl */ `
varying vec3 vPw;
uniform sampler2D uPaperGrain;
uniform float uPaperGrainAmt;
#ifdef PAPER_FOLD
varying vec2 vPuv;
uniform vec3 uPaperInk;
uniform vec3 uPaperWhite;
uniform vec3 uPaperLine; // ink width, cut-edge width (drawing-buffer px), how wide gameplay things get
#endif
#ifdef PAPER_AO
uniform sampler2D uPaperAO;
uniform vec4 uPaperAOBox;
#endif
#ifdef PAPER_SEAMS
uniform float uPaperCeil;
#endif
`;
const FRAG_MAIN = /* glsl */ `
{
  vec3 pN = normalize( cross( dFdx( vPw ), dFdy( vPw ) ) ); // the face, turned towards the viewer
  vec3 an = abs( pN );
  an /= max( an.x + an.y + an.z, 1e-4 );
  float grn = texture2D( uPaperGrain, vPw.zy * 3.0 ).r * an.x + texture2D( uPaperGrain, vPw.xz * 3.0 ).r * an.y + texture2D( uPaperGrain, vPw.xy * 3.0 ).r * an.z;
  diffuseColor.rgb *= 1.0 + ( grn - 0.965 ) * uPaperGrainAmt;
  #ifdef PAPER_AO
  {
    float vert = 1.0 - smoothstep( 0.25, 0.45, abs( pN.y ) );
    vec2 nxz = pN.xz / max( length( pN.xz ), 1e-4 );
    vec2 q = vPw.xz + nxz * ( 0.15 * vert );
    float ao = texture2D( uPaperAO, ( q - uPaperAOBox.xy ) * uPaperAOBox.zw ).r;
    float kFloor = smoothstep( 0.6, 0.8, pN.y ) * ( 1.0 - smoothstep( 0.025, 0.06, abs( vPw.y ) ) );
    float kWall = vert * ( 1.0 - smoothstep( 0.0, 0.45, vPw.y ) ) * step( -0.02, vPw.y );
    diffuseColor.rgb *= mix( 1.0, mix( 0.38, 1.0, ao ), max( kFloor, kWall ) );
  }
  #endif
  #ifdef PAPER_SEAMS
  {
    float vert = 1.0 - smoothstep( 0.25, 0.45, abs( pN.y ) );
    vec2 t = normalize( vec2( -pN.z, pN.x ) + 1e-5 );
    float s = dot( vPw.xz, t ) / 0.53;
    float fs = fract( s );
    float d = min( fs, 1.0 - fs ) / max( fwidth( s ), 1e-5 );
    float seam = 1.0 - smoothstep( 0.4, 1.4, d );
    float hsh = fract( sin( floor( s ) * 12.9898 + 78.233 ) * 43758.5453 );
    float lift = smoothstep( uPaperCeil - 0.032, uPaperCeil - 0.024, vPw.y );
    diffuseColor.rgb *= mix( 1.0, ( 1.0 + ( hsh - 0.5 ) * 0.07 ) * ( 1.0 - 0.25 * seam ) * ( 1.0 - 0.12 * lift ), vert );
  }
  #endif
  #ifdef PAPER_FOLD
  {
    vec2 fw = max( fwidth( vPuv ), vec2( 1e-6 ) );
    vec2 dq = min( vPuv, 1.0 - vPuv );
    vec2 epx = dq / fw;
    float e = min( epx.x, epx.y );
    // never more than a part of a small or far face: tiny things don't turn all ink
    float lim = 1.0 - smoothstep( 0.05, 0.11, min( dq.x, dq.y ) );
    #ifdef PAPER_WIDE
    float cutW = uPaperLine.y * uPaperLine.z;
    #else
    float cutW = uPaperLine.y;
    #endif
    float ink = ( 1.0 - smoothstep( uPaperLine.x - 0.5, uPaperLine.x + 0.5, e ) ) * lim;
    float cut = ( 1.0 - smoothstep( cutW - 0.5, cutW + 0.5, e ) ) * lim;
    diffuseColor.rgb = mix( diffuseColor.rgb, uPaperWhite, cut * 0.92 );
    diffuseColor.rgb = mix( diffuseColor.rgb, uPaperInk, ink * 0.85 );
    #ifdef PAPER_GLASS
    diffuseColor.a = max( diffuseColor.a, max( cut * 0.8, ink * 0.9 ) );
    #endif
  }
  #endif
}
`;

export function createPaperMaterials({ grain, ao = null, aoBox = null, ceil = 2.7 }) {
  const U = {
    uPaperGrain: { value: grain },
    uPaperGrainAmt: { value: 1.7 },
    uPaperInk: { value: lin('#2b1d14') },
    uPaperWhite: { value: lin('#f3ecdc') },
    uPaperLine: { value: new THREE.Vector3(1.7, 3.4, 1.5) },
    uPaperAO: { value: ao },
    uPaperAOBox: { value: aoBox ?? new THREE.Vector4() },
    uPaperCeil: { value: ceil },
  };
  const cache = new Map(); // source material -> Map(flags -> converted)
  const all = new Set();

  function patch(m, flags) {
    const defs = [];
    if (flags & F.FOLD) defs.push('PAPER_FOLD');
    if (flags & F.WIDE) defs.push('PAPER_WIDE');
    if (flags & F.SEAMS) defs.push('PAPER_SEAMS');
    if (flags & F.AO && ao) defs.push('PAPER_AO');
    if (flags & F.LOCAL) defs.push('PAPER_LOCAL');
    if (flags & F.GLASS) defs.push('PAPER_GLASS');
    const head = defs.map((d) => `#define ${d}\n`).join('');
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = head + sh.vertexShader.replace('#include <common>', `#include <common>\n${VERT_DECL}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
      sh.fragmentShader = head + sh.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_DECL}`).replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_MAIN}`);
    };
    const key = `paper:${defs.join(',')}`;
    m.customProgramCacheKey = () => key;
    m.userData.paperFlags = flags;
  }

  // a MeshStandardMaterial (or Physical) -> matte paper
  function convert(src, flags) {
    let per = cache.get(src);
    if (!per) cache.set(src, (per = new Map()));
    if (per.has(flags)) return per.get(flags);
    const m = new THREE.MeshLambertMaterial();
    THREE.Material.prototype.copy.call(m, src); // side, transparency, depth, polygon offset, name, userData...
    for (const k of ['map', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap']) m[k] = src[k] ?? null;
    m.color.copy(src.color);
    if (src.emissive) m.emissive.copy(src.emissive);
    m.emissiveIntensity = src.emissiveIntensity ?? 1;
    m.aoMapIntensity = src.aoMapIntensity ?? 1;
    m.fog = src.fog ?? true;
    m.flatShading = true;
    if (flags & F.GLASS) {
      m.transparent = true;
      m.opacity = 0.35;
      m.color.lerp(lin('#d6e8f2'), 0.5); // faint blue cellophane
    }
    for (const t of [m.map, m.emissiveMap]) {
      if (t && t.anisotropy < 4) {
        t.anisotropy = 4;
        if (t.image && t.image.complete !== false && t.version > 0) t.needsUpdate = true;
      }
    }
    patch(m, flags);
    per.set(flags, m);
    all.add(m);
    return m;
  }

  return { U, convert, all };
}

// Liquids are the only glossy thing in the world: cellophane. Changed in place (they keep MeshStandard);
// circles (puddles) also get a white cut edge with a marker line, so a mess on the floor reads at once.
export function cellophane(m, { rim = false } = {}) {
  if (m.userData.paperCello) return;
  m.userData.paperCello = true;
  m.roughness = 0.08;
  m.metalness = 0;
  if (rim) {
    m.defines = { ...(m.defines ?? {}), USE_UV: '' };
    const ink = lin('#2b1d14'), white = lin('#f3ecdc');
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uPaperInk = { value: ink };
      sh.uniforms.uPaperWhite = { value: white };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uPaperInk;\nuniform vec3 uPaperWhite;').replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float rr = length( vUv - 0.5 ) * 2.0;
          float e = ( 1.0 - rr ) / max( fwidth( rr ), 1e-5 );
          float ink = 1.0 - smoothstep( 0.9, 1.9, e );
          float cut = 1.0 - smoothstep( 3.0, 4.2, e );
          // no environment to reflect: the gloss is painted, a white highlight stroke and a dot
          vec2 q = vUv - 0.5;
          float ang = atan( q.y, q.x );
          float band = 1.0 - smoothstep( 0.025, 0.045, abs( rr - 0.66 ) );
          float arc = band * smoothstep( 1.75, 1.95, ang ) * ( 1.0 - smoothstep( 2.55, 2.75, ang ) );
          float spot = 1.0 - smoothstep( 0.03, 0.045, length( q - vec2( -0.08, 0.3 ) ) );
          float gloss = max( arc, spot ) * ( 1.0 - cut );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), gloss * 0.8 );
          diffuseColor.rgb = mix( diffuseColor.rgb, uPaperWhite, cut );
          diffuseColor.rgb = mix( diffuseColor.rgb, uPaperInk, ink * 0.85 );
          diffuseColor.a = max( diffuseColor.a, max( cut * 0.95, gloss * 0.9 ) );
        }`,
      );
    };
    m.customProgramCacheKey = () => 'paperPuddle';
  }
  m.needsUpdate = true;
}

// The photo heads take the light of the room: outgoingLight *= uLit (never touches .color, the sick tint)
export function litSprite(m) {
  if (m.userData.paperLit) return m.userData.paperLit;
  const u = (m.userData.paperLit = { value: 1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = u;
    sh.fragmentShader = sh.fragmentShader.replace('uniform float opacity;', 'uniform float opacity;\nuniform float uLit;').replace('outgoingLight = diffuseColor.rgb;', 'outgoingLight = diffuseColor.rgb * uLit;');
  };
  m.customProgramCacheKey = () => 'litHead';
  m.needsUpdate = true;
  return u;
}

// a paper rim round a dark thing (the black cat): its own back faces pushed out along the normals,
// drawn in paper white. color is set from outside (dimmed with the light).
export function rimHull(mesh, color, width = 0.009) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize( normal ) * ${width.toFixed(4)};`);
  };
  m.customProgramCacheKey = () => `paperRim${width}`;
  const hull = new THREE.Mesh(mesh.geometry, m);
  hull.userData.paperSkip = true;
  hull.raycast = () => {};
  mesh.add(hull);
  return hull;
}
