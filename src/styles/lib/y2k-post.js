// "Тёплые нулевые": the post passes. Bloom on the linear HDR picture (lamps, signs, screens, coals), and a
// grade on display colours: a bit less saturation, a bit more contrast, the blacks lifted toward olive and
// the highlights warmed, the mid-2000s "Source / Сталкер" film. fx's grain and vignette stay as they are.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export const GRADE = {
  saturation: 0.9, // -10 %
  contrast: 1.08, // +8 %
  lift: 0.03, // shadows lifted 3 % ...
  olive: '#2a2e22', // ... toward olive
  warm: [1.035, 1.0, 0.93], // highlights
};

export function makeGrade() {
  const olive = new THREE.Color(GRADE.olive); // sRGB in, linear inside three: use the display triplet
  const o = olive.clone().convertLinearToSRGB();
  const m = Math.max(o.r, o.g, o.b);
  return new ShaderPass({
    name: 'Y2kGrade',
    uniforms: {
      tDiffuse: { value: null },
      uSat: { value: GRADE.saturation },
      uCon: { value: GRADE.contrast },
      uLift: { value: new THREE.Vector3(o.r / m, o.g / m, o.b / m).multiplyScalar(GRADE.lift) },
      uWarm: { value: new THREE.Vector3(...GRADE.warm) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uSat, uCon;
      uniform vec3 uLift, uWarm;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(tDiffuse, vUv);
        vec3 c = t.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = (c - 0.5) * uCon + 0.5;
        c += uLift * (1.0 - smoothstep(0.0, 0.5, l));
        c *= mix(vec3(1.0), uWarm, smoothstep(0.45, 1.0, l));
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), t.a);
      }`,
  });
}

// half resolution is built in: UnrealBloomPass starts its mip chain at half the composer size.
// knee: the high pass fades in over [threshold, threshold + knee] instead of a hard cut, so a glint
// that just crosses the line doesn't pop
// cap: what enters the blur is scaled down to this luminance at most. The inside of a lamp shade 10 cm from the
// bulb is 50+ in linear light; uncapped, it hazes the whole shade and the ceiling around it
export function makeBloom(renderer, { strength = 0.35, radius = 0.4, threshold = 0.85, knee = 0.01, cap = 1e4 } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const pass = new UnrealBloomPass(size, strength, radius, threshold);
  pass.highPassUniforms.smoothWidth.value = knee;
  pass.highPassUniforms.uCap = { value: cap };
  const hp = pass.materialHighPassFilter;
  hp.fragmentShader = /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold, smoothWidth, uCap;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      float v = luminance( texel.rgb );
      float a = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );
      gl_FragColor = vec4( texel.rgb * a * min( 1.0, uCap / max( v, 1e-4 ) ), 0.0 );
    }`;
  hp.needsUpdate = true;
  return pass;
}
