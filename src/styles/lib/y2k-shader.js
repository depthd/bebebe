// "Тёплые нулевые": one patch for every MeshStandardMaterial in the game (onBeforeCompile), so the whole
// world shares one family of programs. Per material only uniform values differ:
//   uY2kA = (contact AO on/off, wall corner darkening on/off, detail multiply amount, detail normal scale)
//   uY2kB = (roughness wobble, detail normal frequency per metre, -, -)
// What it does:
//   - plan AO (y2k-tex planAO): floors and rugs multiply by mix(0.5, 1, ao); vertical faces sample it 15 cm
//     out from themselves and fade it out by 0.5 m up; the ceiling darkens along the walls
//   - corner darkening on walls by height: the skirting line and under the ceiling
//   - a ±8 % fBm multiply and a ±0.05 roughness wobble, projected along the face's main axis in the
//     object's own space (static geometry is built in world space, the guys' boxes keep their noise as they move)
//   - a detail normal from the same noise (the Sobel map), applied along the same axis
//   - the env's diffuse irradiance scaled by uY2kIbl: the env is there for glints; as full image-based fill it
//     flattened every room into the zal's average light and erased the pools of light under the lamps
// Only within the flat's box (the AO texture's bounds and the flat's floor-to-ceiling): the stairwell and
// the yard keep the detail but get no plan AO.
import * as THREE from 'three';

export const shared = {
  uY2kAOMap: { value: null },
  uY2kAOBox: { value: new THREE.Vector4(0, 0, 1, 1) }, // x0, z0, 1/width, 1/depth
  uY2kNoise: { value: null },
  uY2kNrm: { value: null },
  uY2kH: { value: 2.7 },
  uY2kIbl: { value: 1 }, // how much of the env's diffuse irradiance is kept (its reflections are untouched)
};

const VERT_DECL = /* glsl */ `
varying vec3 vY2kW;
varying vec3 vY2kWN;
varying vec2 vY2kUV;
varying vec3 vY2kT;
varying vec3 vY2kB;
`;

const VERT_MAIN = /* glsl */ `
{
  vec4 y2kL = vec4( transformed, 1.0 );
  vec3 y2kLN = objectNormal;
  #ifdef USE_INSTANCING
    y2kL = instanceMatrix * y2kL;
    y2kLN = mat3( instanceMatrix ) * y2kLN;
  #endif
  vY2kW = ( modelMatrix * y2kL ).xyz;
  vY2kWN = normalize( mat3( modelMatrix ) * y2kLN );
  vec3 y2kA = abs( y2kLN );
  vec3 y2kTa, y2kBa;
  if ( y2kA.y >= y2kA.x && y2kA.y >= y2kA.z ) { vY2kUV = y2kL.xz; y2kTa = vec3( 1.0, 0.0, 0.0 ); y2kBa = vec3( 0.0, 0.0, 1.0 ); }
  else if ( y2kA.x >= y2kA.z ) { vY2kUV = y2kL.zy; y2kTa = vec3( 0.0, 0.0, 1.0 ); y2kBa = vec3( 0.0, 1.0, 0.0 ); }
  else { vY2kUV = y2kL.xy; y2kTa = vec3( 1.0, 0.0, 0.0 ); y2kBa = vec3( 0.0, 1.0, 0.0 ); }
  #ifdef USE_INSTANCING
    y2kTa = mat3( instanceMatrix ) * y2kTa;
    y2kBa = mat3( instanceMatrix ) * y2kBa;
  #endif
  vY2kT = normalMatrix * y2kTa;
  vY2kB = normalMatrix * y2kBa;
}
`;

const FRAG_DECL = /* glsl */ `
varying vec3 vY2kW;
varying vec3 vY2kWN;
varying vec2 vY2kUV;
varying vec3 vY2kT;
varying vec3 vY2kB;
uniform sampler2D uY2kAOMap;
uniform vec4 uY2kAOBox;
uniform sampler2D uY2kNoise;
uniform sampler2D uY2kNrm;
uniform float uY2kH;
uniform float uY2kIbl;
uniform vec4 uY2kA;
uniform vec4 uY2kB;
`;

const FRAG_ALBEDO = /* glsl */ `
float y2kD = texture2D( uY2kNoise, vY2kUV * 0.9 ).r * 0.62 + texture2D( uY2kNoise, vY2kUV * 0.23 + 0.37 ).r * 0.38;
diffuseColor.rgb *= 1.0 + ( y2kD - 0.5 ) * 2.0 * uY2kA.z;
if ( uY2kA.x > 0.0 ) {
  vec3 y2kN = normalize( vY2kWN );
  vec2 y2kUv = ( vY2kW.xz - uY2kAOBox.xy ) * uY2kAOBox.zw;
  bool y2kIn = y2kUv.x > 0.0 && y2kUv.x < 1.0 && y2kUv.y > 0.0 && y2kUv.y < 1.0 && vY2kW.y > -0.3 && vY2kW.y < uY2kH + 0.3;
  float y2kAO = 1.0;
  if ( y2kIn ) {
    if ( y2kN.y > 0.7 ) {
      if ( vY2kW.y < 0.08 ) y2kAO = mix( 0.5, 1.0, texture2D( uY2kAOMap, y2kUv ).r );
    } else if ( y2kN.y < -0.7 ) {
      if ( vY2kW.y > uY2kH - 0.1 ) y2kAO = mix( 0.7, 1.0, texture2D( uY2kAOMap, y2kUv ).r );
    } else {
      float a = texture2D( uY2kAOMap, y2kUv + y2kN.xz * 0.15 * uY2kAOBox.zw ).r;
      y2kAO = mix( mix( 0.5, 1.0, a ), 1.0, smoothstep( 0.0, 0.5, vY2kW.y ) );
      if ( uY2kA.y > 0.0 ) y2kAO *= mix( 0.82, 1.0, smoothstep( 0.0, 0.35, vY2kW.y ) ) * mix( 1.0, 0.9, smoothstep( uY2kH - 0.3, uY2kH, vY2kW.y ) );
    }
  }
  diffuseColor.rgb *= y2kAO;
}
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = clamp( roughnessFactor + ( y2kD - 0.5 ) * uY2kB.x, 0.04, 1.0 );
`;

const FRAG_NORMAL = /* glsl */ `
if ( uY2kA.w > 0.0 ) {
  vec3 y2kTN = texture2D( uY2kNrm, vY2kUV * uY2kB.y ).xyz * 2.0 - 1.0;
  normal = normalize( normal + ( normalize( vY2kT ) * y2kTN.x + normalize( vY2kB ) * y2kTN.y ) * uY2kA.w * faceDirection );
}
`;

const KEY = 'y2k-std-2';

// flags: { ao, wall, detail, normal, rough, freq }
export function patchStandard(m, flags) {
  const f = { ao: 0, wall: 0, detail: 0.06, normal: 0, rough: 0.1, freq: 2, ...flags };
  const own = (m.userData.y2kU ??= { uY2kA: { value: new THREE.Vector4() }, uY2kB: { value: new THREE.Vector4() } });
  own.uY2kA.value.set(f.ao, f.wall, f.detail, f.normal);
  own.uY2kB.value.set(f.rough, f.freq, 0, 0);
  if (m.userData.y2kPatched) return;
  m.userData.y2kPatched = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_ALBEDO}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\niblIrradiance *= uY2kIbl;');
  };
  m.customProgramCacheKey = () => KEY;
  m.needsUpdate = true;
}

// Sprite heads: the photo stops glowing in the dark. outgoingLight × uY2kLit, set every frame from the
// light at the head; material.color (setTint's green when he's sick) stays as the game sets it.
export function patchLitSprite(m) {
  if (m.userData.y2kLit) return m.userData.y2kLit;
  const u = (m.userData.y2kLit = { value: 1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uY2kLit = u;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uY2kLit;')
      .replace('#include <opaque_fragment>', 'outgoingLight *= uY2kLit;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'y2k-lit-1';
  m.needsUpdate = true;
  return u;
}
