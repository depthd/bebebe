// "Oleg's eyes": full-screen looks to try on the whole game, the kind devs use to hide (or own) simple
// graphics. One shader, the look picked by a uniform, so switching never recompiles. It runs after the
// output pass, on display colours, so palettes and dithering behave like the real thing.
// V cycles them in the game; the menu has a button; the choice is remembered in the browser.
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const FILTERS = [
  { id: 'none', name: 'Без фильтра' },
  { id: 'pixel', name: 'Пиксели' },
  { id: 'ps1', name: 'PS1' },
  { id: 'vhs', name: 'VHS-кассета' },
  { id: 'bodycam', name: 'Бодикам' },
  { id: 'crt', name: 'Кинескоп' },
  { id: 'noir', name: 'Нуар' },
  { id: 'gameboy', name: 'Game Boy' },
  { id: 'soft', name: 'Мыло' },
  { id: 'sharp', name: 'Резкость' },
  { id: 'toon', name: 'Мультик' },
  { id: 'film', name: 'Плёнка' },
  { id: 'night', name: 'Ночное видение' },
];

const Shader = {
  uniforms: { tDiffuse: { value: null }, uRes: { value: [1, 1] }, uTime: { value: 0 }, uMode: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime;
    uniform int uMode;
    varying vec2 vUv;

    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float b2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
    float bayer4(vec2 a) { return b2(0.5 * a) * 0.25 + b2(a); }
    vec3 tex(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }
    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec2 grid(float lines) { return vec2(lines * uRes.x / uRes.y, lines); }
    vec2 pix(vec2 uv, float lines) { vec2 n = grid(lines); return (floor(uv * n) + 0.5) / n; }
    vec2 barrel(vec2 uv, float k) { vec2 c = uv - 0.5; return 0.5 + c * (1.0 + k * dot(c, c)); }
    bool outside(vec2 uv) { return uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0; }
    vec3 blur(vec2 uv, float r) {
      vec2 p = r / uRes;
      vec3 s = tex(uv) * 0.25;
      s += (tex(uv + vec2(p.x, 0.0)) + tex(uv - vec2(p.x, 0.0)) + tex(uv + vec2(0.0, p.y)) + tex(uv - vec2(0.0, p.y))) * 0.125;
      s += (tex(uv + p) + tex(uv - p) + tex(uv + vec2(p.x, -p.y)) + tex(uv + vec2(-p.x, p.y))) * 0.0625;
      return s;
    }

    void main() {
      vec2 uv = vUv;
      float vig = distance(uv, vec2(0.5));
      vec3 c;
      if (uMode == 1) { // chunky pixels, 128 lines
        c = tex(pix(uv, 128.0));
      } else if (uMode == 2) { // PS1: 224 lines, 15-bit colour with ordered dithering
        vec2 q = pix(uv, 224.0);
        c = tex(q) + (bayer4(floor(q * grid(224.0))) - 0.5) / 24.0;
        c = floor(c * 31.0 + 0.5) / 31.0;
      } else if (uMode == 3) { // VHS: wobbling lines, a tracking band, colour bleeding, noise
        float line = floor(uv.y * 240.0);
        float band = smoothstep(0.0, 0.03, abs(fract(uv.y * 0.6 - uTime * 0.07) - 0.5) - 0.46);
        vec2 u2 = uv + vec2((rnd(vec2(line, floor(uTime * 24.0))) - 0.5) * 0.0025 + sin(uv.y * 25.0 + uTime * 2.0) * 0.0008 + (1.0 - band) * 0.012, 0.0);
        c = vec3(blur(u2 + vec2(0.004, 0.0), 1.6).r, blur(u2, 1.6).g, blur(u2 - vec2(0.004, 0.0), 1.6).b);
        c = mix(vec3(lum(c)), c, 0.8) * vec3(1.02, 0.98, 1.04);
        c *= 0.93 + 0.07 * sin(uv.y * uRes.y * 1.6);
        c += (rnd(uv * uRes + uTime) - 0.5) * 0.07 + (1.0 - band) * 0.2 * rnd(vec2(uv.x * 80.0, uTime));
        c *= 1.0 - smoothstep(0.45, 0.85, vig) * 0.5;
      } else if (uMode == 4) { // bodycam: fisheye, oversharpened, grainy, heavy vignette
        vec2 u2 = 0.5 + (barrel(uv, 0.6) - 0.5) * 0.84;
        float ca = 0.012 * vig;
        c = vec3(tex(u2 + (u2 - 0.5) * ca).r, tex(u2).g, tex(u2 - (u2 - 0.5) * ca).b);
        c += (c - blur(u2, 1.0)) * 1.4;
        c = mix(vec3(lum(c)), c, 0.6);
        c = (c - 0.5) * 1.18 + 0.52;
        c *= vec3(0.96, 1.0, 1.06);
        c += (rnd(uv * uRes + fract(uTime)) - 0.5) * 0.1;
        c *= 1.0 - smoothstep(0.32, 0.78, vig) * 0.9;
        if (outside(u2)) c = vec3(0.0);
      } else if (uMode == 5) { // CRT: curved glass, scanlines, an RGB shadow mask
        vec2 u2 = barrel(uv, 0.22);
        c = tex(u2) * (0.72 + 0.28 * sin(u2.y * uRes.y * 1.1));
        float m = mod(gl_FragCoord.x, 3.0);
        c *= (m < 1.0 ? vec3(1.15, 0.85, 0.85) : m < 2.0 ? vec3(0.85, 1.15, 0.85) : vec3(0.85, 0.85, 1.15)) * 1.2;
        c *= 1.0 - smoothstep(0.38, 0.75, vig) * 0.6;
        if (outside(u2)) c = vec3(0.0);
      } else if (uMode == 6) { // noir
        c = vec3(smoothstep(0.04, 0.8, lum(tex(uv))));
        c += (rnd(uv * uRes + uTime) - 0.5) * 0.07;
        c *= 1.0 - smoothstep(0.3, 0.8, vig) * 0.75;
      } else if (uMode == 7) { // Game Boy: 144 lines, four greens, dithered
        vec2 q = pix(uv, 144.0);
        float l = clamp(lum(tex(q)) * 1.35 + (bayer4(floor(q * grid(144.0))) - 0.5) * 0.28, 0.0, 0.999);
        int i = int(l * 4.0);
        c = i == 0 ? vec3(0.06, 0.22, 0.06) : i == 1 ? vec3(0.19, 0.38, 0.19) : i == 2 ? vec3(0.55, 0.67, 0.06) : vec3(0.61, 0.74, 0.06);
      } else if (uMode == 8) { // soap: soft focus and glow
        vec3 b = (blur(uv, 3.0) + blur(uv, 7.0)) * 0.5;
        c = mix(tex(uv), b, 0.65) + max(b - 0.45, 0.0) * 0.7;
      } else if (uMode == 9) { // sharpen
        vec3 a = tex(uv);
        c = a + (a - blur(uv, 1.0)) * 2.2;
        c = (c - 0.5) * 1.06 + 0.5;
      } else if (uMode == 10) { // cartoon: flat colour bands and black outlines (edges of the blurred picture, so wallpaper patterns don't count)
        vec2 p = 2.0 / uRes;
        float tl = lum(blur(uv + vec2(-p.x, p.y), 1.5)), tr = lum(blur(uv + p, 1.5));
        float bl = lum(blur(uv - p, 1.5)), br = lum(blur(uv + vec2(p.x, -p.y), 1.5));
        float e = abs(tl - br) + abs(tr - bl);
        c = floor(blur(uv, 1.2) * 6.0 + 0.5) / 6.0;
        c = mix(c, vec3(0.04), smoothstep(0.18, 0.32, e));
      } else if (uMode == 11) { // film: warm, red halation round the lights, grain, cinema bars
        c = tex(uv);
        c += max(blur(uv, 5.0) - 0.55, 0.0) * vec3(1.0, 0.4, 0.22);
        c = mix(vec3(lum(c)), c * vec3(1.07, 1.0, 0.88), 0.85);
        c = smoothstep(-0.02, 1.05, c);
        c += (rnd(floor(uv * uRes / 2.0) + fract(uTime * 24.0)) - 0.5) * 0.09;
        c *= 1.0 - smoothstep(0.35, 0.85, vig) * 0.6;
        if (abs(uv.y - 0.5) > 0.5 * min(1.0, (uRes.x / uRes.y) / 2.39)) c = vec3(0.0);
      } else if (uMode == 12) { // night vision
        float l = lum(blur(uv, 1.0)) * 2.4 + 0.04 + (rnd(uv * uRes + uTime) - 0.5) * 0.2;
        c = vec3(0.18, 1.0, 0.3) * l * (0.85 + 0.15 * sin(uv.y * uRes.y * 1.3));
        c *= 1.0 - smoothstep(0.3, 0.56, vig);
      } else {
        c = tex(uv);
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// little screen texts some looks come with (the bodycam's timestamp, the tape's PLAY)
const OVERLAYS = {
  bodycam: (clock) => `<div class="ov-tl"><b class="rec">●</b> REC&nbsp;&nbsp;AXON BODY 4&nbsp;&nbsp;X81034927</div><div class="ov-br">2025-09-30&nbsp;&nbsp;T${clock}:${String(Math.floor(Date.now() / 1000) % 60).padStart(2, '0')}&nbsp;&nbsp;MSK</div>`,
  vhs: (clock) => `<div class="ov-tl vhs">▶ PLAY</div><div class="ov-bl vhs">SP&nbsp;&nbsp;${clock}<br>СЕН. 30 2025</div>`,
  night: () => `<div class="ov-tl night">NV-1&nbsp;&nbsp;GAIN ×4</div>`,
};

export function createFilters(composer, el) {
  const pass = new ShaderPass(Shader);
  composer.addPass(pass);
  let i = 0;
  try {
    i = Math.max(0, FILTERS.findIndex((f) => f.id === localStorage.getItem('oleg.filter')));
  } catch {
    /* storage can be blocked: start without a filter */
  }
  const apply = () => {
    pass.uniforms.uMode.value = i;
    pass.enabled = i !== 0;
    try {
      localStorage.setItem('oleg.filter', FILTERS[i].id);
    } catch {
      /* not remembered, fine */
    }
  };
  apply();
  let lastOv = '';
  return {
    get current() {
      return FILTERS[i];
    },
    next(step = 1) {
      i = (i + step + FILTERS.length) % FILTERS.length;
      apply();
      return FILTERS[i];
    },
    setSize(w, h, ratio) {
      pass.uniforms.uRes.value = [w * ratio, h * ratio];
    },
    update(time, clock) {
      pass.uniforms.uTime.value = time;
      const ov = OVERLAYS[FILTERS[i].id]?.(clock) ?? '';
      if (ov !== lastOv) el.innerHTML = lastOv = ov;
      el.hidden = !ov;
    },
  };
}
