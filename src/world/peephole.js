// The front door's peephole: the landing through a fisheye. The scene is rendered wide from the lens (just outside
// the leaf, at eye height) into a square target, then drawn bent round (barrel) into a circle on black, with a dark
// rim, a little colour fringe, a cold stairwell cast and grain. main.js draws this instead of the game view while
// game.peephole.focus is set; the lens itself is placed by apartment.js (doors.entrance.peep).
import * as THREE from 'three';

const FOV = 128; // what the lens takes in; the barrel squeezes the edges back into the circle

const Fisheye = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tMap;
    uniform vec2 uRes;
    uniform float uTime;
    varying vec2 vUv;
    vec2 bend(vec2 p, float k) { return p * (k + (1.0 - k) * dot(p, p)); }
    void main() {
      // the circle fills 92% of the height, in the middle of the screen
      vec2 p = (vUv - 0.5) * uRes / (0.5 * uRes.y * 0.92);
      float r = length(p);
      // barrel: the middle bulges at you; red and blue part a little toward the rim
      vec3 col = vec3(
        texture2D(tMap, bend(p, 0.6) * 0.5 + 0.5).r,
        texture2D(tMap, bend(p * 0.993, 0.6) * 0.5 + 0.5).g,
        texture2D(tMap, bend(p * 0.986, 0.6) * 0.5 + 0.5).b);
      col *= vec3(0.9, 1.0, 0.93); // the stairwell's green-grey light
      col *= mix(0.3, 1.0, smoothstep(1.0, 0.42, r)); // darker toward the rim
      float n = fract(sin(dot(vUv * 913.0 + fract(uTime * 5.3), vec2(12.9898, 78.233))) * 43758.5453);
      col *= 1.0 + (n - 0.5) * 0.09;
      col *= smoothstep(1.0, 0.975, r); // the edge of the lens, soft; black beyond it
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function createPeephole(renderer) {
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.03, 40);
  const mat = new THREE.ShaderMaterial({
    ...Fisheye,
    uniforms: { tMap: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const screen = new THREE.Scene().add(quad);
  const screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();
  let target = null;
  return {
    cam,
    // the lens at view.pos looking at view.look (world vectors), the picture to the screen
    render(scene, view, time) {
      renderer.getDrawingBufferSize(size);
      const S = Math.min(1536, Math.max(512, Math.round(size.y * 1.15)));
      if (target?.width !== S) {
        target?.dispose();
        target = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, samples: 4 });
      }
      cam.position.copy(view.pos);
      cam.lookAt(view.look);
      cam.updateMatrixWorld();
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      mat.uniforms.tMap.value = target.texture;
      mat.uniforms.uRes.value.copy(size);
      mat.uniforms.uTime.value = time;
      renderer.render(screen, screenCam);
    },
  };
}
