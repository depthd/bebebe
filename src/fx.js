// Post-processing: drunk vision (double image, wobble), a light night grade (cool shadows, warm lamps),
// film grain, vignette, blackout. Rendered with MSAA, since the composer's targets bypass the canvas antialiasing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DrunkShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDrunk: { value: 0 }, uBlack: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uDrunk, uBlack;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv + uDrunk * 0.006 * vec2(sin(vUv.y * 12.0 + uTime * 1.7), cos(vUv.x * 10.0 + uTime * 1.3));
      vec2 off = uDrunk * 0.02 * vec2(sin(uTime * 0.9), cos(uTime * 0.7));
      vec4 a = texture2D(tDiffuse, uv);
      vec4 b = texture2D(tDiffuse, uv + off);
      vec4 c = texture2D(tDiffuse, uv - off * 0.6);
      vec4 col = mix(a, (a + b + c) / 3.0, clamp(uDrunk * 1.3, 0.0, 1.0));
      float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb *= mix(vec3(0.9, 0.95, 1.1), vec3(1.04, 1.0, 0.94), smoothstep(0.02, 0.5, lum));
      float n = fract(sin(dot(vUv * 731.0 + fract(uTime * 7.13), vec2(12.9898, 78.233))) * 43758.5453);
      col.rgb *= 1.0 + (n - 0.5) * 0.06;
      float d = distance(vUv, vec2(0.5));
      col.rgb *= 1.0 - smoothstep(0.3, 0.85, d) * (0.3 + uDrunk * 0.6);
      col.rgb *= 1.0 - uBlack;
      gl_FragColor = col;
    }`,
};

export function makeFX(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: renderer.getPixelRatio() < 1.5 ? 4 : 2 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const drunk = new ShaderPass(DrunkShader);
  composer.addPass(drunk);
  composer.addPass(new OutputPass());
  const css = renderer.getSize(new THREE.Vector2());
  composer.setSize(css.x, css.y); // a target passed in is taken as CSS size otherwise
  return {
    composer,
    set(time, drunkAmount, black) {
      drunk.uniforms.uTime.value = time;
      drunk.uniforms.uDrunk.value = drunkAmount;
      drunk.uniforms.uBlack.value = black;
    },
    setSize(w, h) {
      composer.setSize(w, h);
    },
    render() {
      composer.render();
    },
  };
}
