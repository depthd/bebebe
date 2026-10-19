// The doom style's world material: every lit material becomes a MeshBasicMaterial whose colour is
// multiplied by the sector light (doom-sector.js) at the point it faces, dimmed with distance from the
// camera in Doom-like bands (32 light levels), with Doom's fake contrast on walls, a fullbright floor for
// things that must stay visible, and the emissive colour added unlit. No per-pixel lights at all.
// Optional `wobble` (the PS1 flavour): vertex snapping and affine texture mapping.
import * as THREE from 'three';

const VERT_HEAD = /* glsl */ `
varying vec3 vDoomWP;
varying vec3 vDoomWN;
#ifdef DOOM_WOBBLE
varying vec2 vDoomAffUv;
varying float vDoomAffW;
#endif
`;
const VERT_BODY = /* glsl */ `
#include <fog_vertex>
{
  vec4 dwp = vec4(transformed, 1.0);
  vec3 dn = normal;
  #ifdef USE_INSTANCING
    dwp = instanceMatrix * dwp;
    dn = mat3(instanceMatrix) * dn;
  #endif
  dwp = modelMatrix * dwp;
  vDoomWP = dwp.xyz;
  vDoomWN = mat3(modelMatrix) * dn;
  #ifdef DOOM_WOBBLE
    vec2 grid = vec2(160.0, 100.0);
    gl_Position.xy = floor(gl_Position.xy / gl_Position.w * grid + 0.5) / grid * gl_Position.w;
    #ifdef USE_MAP
      vDoomAffUv = vMapUv * gl_Position.w;
    #endif
    vDoomAffW = gl_Position.w;
  #endif
}
`;

export const LIGHT_GLSL = /* glsl */ `
uniform sampler2D uDoomSector;
uniform vec4 uDoomRect;   // x0, z0, 1/span, split y
uniform vec2 uDoomBand;   // distance where the dimming starts and where it is full
uniform float uDoomFloor; // fullbright floor (display space)
varying vec3 vDoomWP;
varying vec3 vDoomWN;
vec3 doomLight() {
  vec3 n = normalize(vDoomWN);
  if (!gl_FrontFacing) n = -n;
  // each face takes the light of the room it faces: sample a little in front of it
  vec2 st = clamp((vDoomWP.xz + n.xz * 0.1 - uDoomRect.xy) * uDoomRect.z, 0.0005, 0.9995);
  st.y = st.y * 0.5 + (vDoomWP.y < uDoomRect.w ? 0.0 : 0.5);
  vec4 sec = texture2D(uDoomSector, st);
  float d = distance(cameraPosition, vDoomWP);
  float band = 1.0 - smoothstep(uDoomBand.x, uDoomBand.y, d) * (1.0 - 0.7 * sec.a);
  vec3 L = sec.rgb * band;
  L *= 1.0 - 0.12 * abs(n.x); // Doom's fake contrast: walls one way a shade darker
  if (abs(n.y) > 0.5) L *= 0.9; // floors and ceilings
  L = floor(L * 31.99) / 31.0; // 32 light levels: darkness comes in bands
  L = max(L, vec3(uDoomFloor));
  return pow(L, vec3(2.2)); // display-space light -> linear
}
`;

const FRAG_HEAD = /* glsl */ `
${LIGHT_GLSL}
#ifdef DOOM_EMISSIVE
uniform vec3 uDoomEm;
uniform float uDoomEmI;
#endif
#ifdef DOOM_WOBBLE
varying vec2 vDoomAffUv;
varying float vDoomAffW;
#endif
`;
const FRAG_LIGHT = /* glsl */ `
outgoingLight *= doomLight();
#ifdef DOOM_EMISSIVE
  #ifdef DOOM_EMAP
    outgoingLight += diffuseColor.rgb * uDoomEm * uDoomEmI;
  #else
    outgoingLight += uDoomEm * uDoomEmI;
  #endif
#endif
#include <opaque_fragment>
`;
const FRAG_AFFINE_MAP = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vDoomAffUv / vDoomAffW);
  diffuseColor *= sampledDiffuseColor;
#endif
`;

// per-material uniforms (not in userData: Material.copy() JSON-clones that)
const UNIFORMS = new WeakMap();

// one shared function, so every converted material shares its programs
function onBeforeCompile(shader) {
  const m = this;
  Object.assign(shader.uniforms, UNIFORMS.get(m));
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERT_HEAD}`).replace('#include <fog_vertex>', VERT_BODY);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_HEAD}`).replace('#include <opaque_fragment>', FRAG_LIGHT);
  if (m.defines?.DOOM_WOBBLE !== undefined) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', FRAG_AFFINE_MAP);
}

const COPY = ['name', 'transparent', 'opacity', 'alphaTest', 'side', 'vertexColors', 'depthTest', 'depthWrite', 'blending', 'premultipliedAlpha', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'visible', 'colorWrite', 'alphaToCoverage', 'wireframe', 'fog', 'alphaMap', 'toneMapped', 'dithering'];

// shared: { sector uniforms, band: Vector2 }; snap(Color) -> palette Color; map(tex, mesh) -> processed texture
export function createWorldMaterials({ shared, snap, map, wobble = false }) {
  const cache = new Map(); // source material -> Map(floor -> converted)
  const converted = new WeakSet();
  return {
    isConverted: (m) => converted.has(m),
    convert(src, floor, mesh) {
      if (converted.has(src)) return src;
      let byFloor = cache.get(src);
      if (!byFloor) cache.set(src, (byFloor = new Map()));
      let m = byFloor.get(floor);
      if (m) return m;
      m = new THREE.MeshBasicMaterial();
      for (const k of COPY) if (src[k] !== undefined) m[k] = src[k];
      m.color.copy(snap(src.color ?? new THREE.Color(1, 1, 1)));
      if (src.map) m.map = map(src.map, mesh, src);
      // emissive stays live: the game changes emissiveIntensity on the mesh's material (the coals).
      // (not called `emissive`: three would then look for an emissive uniform a basic material hasn't got)
      m.doomEmissive = (src.emissive ?? new THREE.Color(0)).clone();
      m.emissiveIntensity = src.emissiveIntensity ?? 0;
      const lit = m.doomEmissive.r + m.doomEmissive.g + m.doomEmissive.b > 0.001;
      m.defines = {};
      if (lit) m.defines.DOOM_EMISSIVE = '';
      if (lit && src.emissiveMap) m.defines.DOOM_EMAP = '';
      if (wobble) m.defines.DOOM_WOBBLE = '';
      UNIFORMS.set(m, {
        ...shared.uniforms,
        uDoomBand: { value: shared.band },
        uDoomFloor: { value: floor },
        uDoomEm: { value: m.doomEmissive },
        uDoomEmI: { get value() { return m.emissiveIntensity; } },
      });
      m.onBeforeCompile = onBeforeCompile;
      converted.add(m);
      byFloor.set(floor, m);
      return m;
    },
  };
}
