// Performance check. A live meter (?perf, or the Ё/` key) shows FPS and where a frame goes:
// game logic and physics on the CPU, sending the draw calls, and the GPU time when the browser
// exposes a GPU timer (Chrome does, Firefox doesn't). ?bench runs a one-minute test from a fixed
// view of the party: it switches the heavy parts off one by one (resolution, MSAA, post-processing,
// lamps, PBR materials, the bathroom mirror, ragdoll physics, rendering itself), measures each, and
// says what the machine runs out of. The first measurement is repeated at the end: a laptop that heats
// up and drops its clocks halfway would otherwise make every later step look worse. The results card has a copy button, so a player can send the numbers back.
import * as THREE from 'three';

const WARM = 2; // s before each measurement (shader compiles, render targets)
const MEASURE = 4; // s
const STEPS = [
  { id: 'base', name: 'Как есть', cfg: {} },
  { id: 'res75', name: 'Разрешение 75%', cfg: { scale: 0.75 } },
  { id: 'res50', name: 'Разрешение 50%', cfg: { scale: 0.5 } },
  { id: 'nomsaa', name: 'Без сглаживания', cfg: { msaa: 0 } },
  { id: 'nopost', name: 'Без постобработки', cfg: { post: false } },
  { id: 'nolamps', name: 'Без 6 ламп', cfg: { lamps: false } },
  { id: 'simple', name: 'Простые материалы', cfg: { simple: true } },
  { id: 'nomirror', name: 'Без зеркала', cfg: { mirror: false } },
  { id: 'nophys', name: 'Без физики тел', cfg: { physics: false } },
  { id: 'min', name: 'Всё на минимум', cfg: { scale: 0.5, msaa: 0, post: false, lamps: false, simple: true, mirror: false, physics: false } },
  { id: 'norender', name: 'Без отрисовки', cfg: { render: false } },
  { id: 'base2', name: 'Как есть (повтор)', cfg: {} },
];
const DEFAULTS = { scale: 1, msaa: null, post: true, lamps: true, simple: false, mirror: true, physics: true, render: true };

const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const fps = (ms) => (Number.isFinite(ms) ? (ms > 100 ? (1000 / ms).toFixed(1) : Math.round(1000 / ms)) : '—');

// GPU time of the commands between begin() and end(), read back a few frames later
function gpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const pending = []; // [query, tag]
  let active = null;
  return {
    // tag: which measurement the frame belongs to (results arrive a few frames later)
    begin(tag) {
      if (active || pending.length > 5) return;
      active = [gl.createQuery(), tag];
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active[0]);
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll() {
      const out = [];
      while (pending.length && gl.getQueryParameter(pending[0][0], gl.QUERY_RESULT_AVAILABLE)) {
        const [q, tag] = pending.shift();
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out.push({ ms: ns / 1e6, tag });
        gl.deleteQuery(q);
      }
      return out;
    },
  };
}

function gpuName(gl) {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER));
}

// MeshStandardMaterial -> MeshLambertMaterial with the same look-defining fields
function toLambert(m) {
  const l = new THREE.MeshLambertMaterial();
  for (const k of ['color', 'map', 'emissive', 'emissiveMap', 'emissiveIntensity', 'transparent', 'opacity', 'side', 'alphaTest', 'vertexColors', 'depthWrite', 'depthTest', 'fog', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'visible', 'toneMapped']) {
    const v = m[k];
    if (v === undefined) continue;
    if (v?.isColor) l[k].copy(v);
    else l[k] = v;
  }
  return l;
}

export function createPerf({ renderer, scene, fx, filters, game, world, params }) {
  const gl = renderer.getContext();
  const timer = gpuTimer(gl);
  const basePR = renderer.getPixelRatio();
  const baseSamples = fx.samples;
  const basePhysics = !!game.noPhysics;
  const cfg = { ...DEFAULTS };

  // per-frame numbers
  let t0 = 0, tRender = 0, prev = 0, phys = 0, steps = 0;
  const live = []; // {dt, logic, render, phys, steps}
  const gpuLive = [];
  let rec = null; // the benchmark's current measurement

  // physics time: the world is stepped inside game.update, so wrap the step
  let wrapped = false;
  function wrapPhysics() {
    if (wrapped) return;
    wrapped = true;
    const orig = world.step.bind(world);
    world.step = (...a) => {
      const t = performance.now();
      orig(...a);
      phys += performance.now() - t;
      steps++;
    };
  }
  let reflector = null;
  function wrapMirror() {
    if (!reflector) scene.traverse((o) => o.isReflector && (reflector = o));
  }

  // ---------- panel ----------
  const el = document.createElement('div');
  el.className = 'perf';
  el.hidden = true;
  document.body.appendChild(el);
  let on = false, shownAt = 0;
  function setOn(v) {
    on = v;
    prev = 0; // no stale interval from while the meter was off
    live.length = gpuLive.length = 0;
    el.hidden = !v && !bench;
    renderer.info.autoReset = !v && !bench; // count all passes of a frame, not just the last one
    if (v || bench) {
      wrapPhysics();
      wrapMirror();
    }
  }

  // ---------- switches ----------
  const swapped = new Map(); // mesh -> [original material(s), the lambert one(s) put there]
  const lambert = new Map(); // original material -> lambert copy
  function setSimple(v) {
    if (v) {
      scene.traverse((o) => {
        if (!o.isMesh || swapped.has(o)) return;
        const one = (m) => (m?.isMeshStandardMaterial ? (lambert.get(m) ?? lambert.set(m, toLambert(m)).get(m)) : m);
        const next = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
        if (next === o.material || (Array.isArray(next) && next.every((m, i) => m === o.material[i]))) return;
        swapped.set(o, [o.material, next]);
        o.material = next;
      });
    } else {
      for (const [o, [orig, put]] of swapped) {
        // the game may have given the mesh a new material meanwhile: keep that one
        if (o.material === put) o.material = orig;
      }
      swapped.clear();
      for (const m of lambert.values()) m.dispose();
      lambert.clear();
    }
  }
  function apply(next) {
    const c = { ...DEFAULTS, ...next };
    if (c.scale !== cfg.scale) {
      renderer.setPixelRatio(basePR * c.scale);
      fx.setPixelRatio(renderer.getPixelRatio());
      filters.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
    }
    const samples = c.msaa ?? baseSamples;
    if (samples !== fx.samples) fx.setSamples(samples);
    if (c.lamps !== cfg.lamps) scene.traverse((o) => o.isPointLight && o.userData.pooled && (o.visible = c.lamps));
    if (c.simple !== cfg.simple) setSimple(c.simple);
    if (reflector) reflector.visible = c.mirror;
    game.noPhysics = c.physics ? basePhysics : true;
    Object.assign(cfg, c);
  }

  // ---------- benchmark ----------
  let bench = null; // { i, phase: 'warm'|'measure', until, rows }
  // a hidden tab stops the frames: whatever step was running is measured again from its warm-up
  document.addEventListener('visibilitychange', () => {
    if (!bench || document.hidden) return;
    prev = 0;
    rec = null;
    if (bench.i >= 0) bench.phase = 'warm';
    bench.until = performance.now() + WARM * 1000;
  });
  function startBench() {
    bench = { i: -1, phase: 'warm', until: performance.now() + 3000, rows: [] }; // 3 s to settle after load
    setOn(on);
    el.classList.add('bench');
  }
  function stepBench(now) {
    if (now < bench.until) return;
    if (bench.phase === 'measure') {
      const s = STEPS[bench.i];
      bench.rows.push({
        id: s.id,
        name: s.name,
        ms: avg(rec.dt),
        p95: pct(rec.dt, 0.95),
        logic: avg(rec.logic),
        phys: avg(rec.phys),
        steps: avg(rec.steps),
        render: avg(rec.render),
        gpu: rec.gpu.length ? avg(rec.gpu) : NaN,
        frames: rec.dt.length,
      });
      rec = null;
    }
    if (bench.phase === 'warm' && bench.i >= 0) {
      rec = { id: bench.i, dt: [], logic: [], phys: [], steps: [], render: [], gpu: [] };
      bench.phase = 'measure';
      bench.until = now + MEASURE * 1000;
      return;
    }
    bench.i++;
    if (bench.i >= STEPS.length) return finishBench();
    apply(STEPS[bench.i].cfg);
    bench.phase = 'warm';
    bench.until = now + WARM * 1000;
  }
  function verdict(rows) {
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    const base = (by.base.ms + by.base2.ms) / 2;
    const out = [];
    if (base < 18.5) return ['Тормозов нет: игра держит около 60 FPS.'];
    const cpuOnly = by.norender.ms;
    const res = base / by.res50.ms;
    if (cpuOnly > base * 0.8) out.push(`Упор в процессор: даже совсем без отрисовки кадр занимает ${f1(cpuOnly)} мс (не больше ${fps(cpuOnly)} FPS), из них логика игры ${f1(by.norender.logic)} мс, физика ${f1(by.norender.phys)} мс.`);
    else if (res >= 1.3) out.push(`Упор в видеокарту: при 50% разрешения FPS ${fps(base)} → ${fps(by.res50.ms)}, а логика игры занимает всего ${f1(by.base.logic)} мс из ${f1(base)} мс кадра.`);
    else out.push(`Ни разрешение, ни логика по отдельности не главное: похоже, упор в отрисовку на стороне процессора (драйвер, число вызовов отрисовки). Без отрисовки ${fps(cpuOnly)} FPS, при 50% разрешения ${fps(by.res50.ms)} FPS.`);
    const drift = by.base2.ms / by.base.ms;
    if (drift > 1.15 || drift < 0.87) out.push(`Внимание: повторный замер «как есть» отличается от первого (${fps(by.base.ms)} → ${fps(by.base2.ms)} FPS), ноутбук мог нагреться или переключить режим питания. Цифры шагов сравнивай осторожно.`);
    const helps = rows
      .filter((r) => !['base', 'base2', 'min', 'norender'].includes(r.id) && r.ms < base * 0.93)
      .sort((a, b) => a.ms - b.ms)
      .slice(0, 3);
    out.push(helps.length ? `Сильнее всего помогает: ${helps.map((r) => `${r.name.toLowerCase()} (${fps(r.ms)} FPS)`).join(', ')}.` : 'По отдельности ни один пункт заметно не помогает.');
    out.push(`Всё на минимум: ${fps(by.min.ms)} FPS (сейчас ${fps(base)}).`);
    return out;
  }
  function report(rows, lines) {
    const head = ['Шаг', 'FPS', 'кадр мс', 'худш. 5%', 'логика мс', 'физика мс', 'отрисовка CPU мс', 'GPU мс'];
    const body = rows.map((r) => [r.name, fps(r.ms), f1(r.ms), f1(r.p95), f1(r.logic), `${f1(r.phys)} (${Math.round(r.steps)} шаг.)`, f1(r.render), f1(r.gpu)]);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    const text = [
      'Проверка производительности · 5 ночей на хате у Олега',
      `Браузер: ${navigator.userAgent}`,
      `Видеокарта: ${gpuName(gl)}`,
      `Окно: ${innerWidth}×${innerHeight}, devicePixelRatio ${devicePixelRatio}, отрисовка ${db.x}×${db.y}, MSAA ${baseSamples}x, потоков CPU: ${navigator.hardwareConcurrency ?? '?'}`,
      `GPU-таймер: ${timer ? 'есть' : 'нет (браузер не даёт)'}`,
      '',
      ...lines,
      '',
      head.join(' | '),
      ...body.map((r) => r.join(' | ')),
    ].join('\n');
    return { text, head, body };
  }
  function finishBench() {
    apply({});
    const rows = bench.rows;
    const lines = verdict(rows);
    const { text, head, body } = report(rows, lines);
    window.__bench = { rows, lines, text };
    bench = null;
    renderer.info.autoReset = !on;
    el.classList.remove('bench');
    el.classList.add('card');
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    el.innerHTML = `
      <h2>Проверка производительности</h2>
      ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      <table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <p class="perf-note">Видеокарта: ${esc(gpuName(gl))} · окно ${innerWidth}×${innerHeight}</p>
      <div class="perf-buttons"><button type="button" class="primary" data-act="copy">Скопировать результаты</button><button type="button" data-act="menu">В меню</button></div>`;
    el.hidden = false;
    el.querySelector('[data-act="copy"]').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(text);
        e.target.textContent = 'Скопировано';
      } catch {
        // no clipboard access: show the text to copy by hand
        const ta = document.createElement('textarea');
        ta.value = text;
        el.appendChild(ta);
        ta.select();
        e.target.textContent = 'Выдели и скопируй текст ниже';
      }
    });
    el.querySelector('[data-act="menu"]').addEventListener('click', () => (location.href = location.pathname));
  }

  // ---------- live text ----------
  function liveText() {
    const n = live.length;
    const s = {
      dt: avg(live.map((x) => x.dt)),
      worst: pct(live.map((x) => x.dt), 0.95),
      logic: avg(live.map((x) => x.logic)),
      phys: avg(live.map((x) => x.phys)),
      steps: avg(live.map((x) => x.steps)),
      render: avg(live.map((x) => x.render)),
      gpu: gpuLive.length ? avg(gpuLive) : null,
    };
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    const cpu = s.logic + s.render;
    let v;
    if (!n) v = '';
    else if (s.dt < 18.5) v = 'держит 60 FPS, всё ок';
    else if (s.gpu != null) v = s.gpu > cpu ? 'упор в видеокарту' : 'упор в процессор';
    else if (s.logic > s.dt * 0.6) v = 'упор в процессор (логика игры)';
    else if (cpu > s.dt * 0.75) v = 'процессор занят почти весь кадр: упор в процессор или драйвер';
    else v = `процессор свободен ${Math.round(100 - (cpu / s.dt) * 100)}% кадра: скорее упор в видеокарту`;
    const lines = [
      `FPS ${fps(s.dt)} · кадр ${f1(s.dt)} мс (худшие ${f1(s.worst)})`,
      `процессор: логика ${f1(s.logic)} мс (физика ${f1(s.phys)}, ${Math.round(s.steps)} шаг.) · отрисовка ${f1(s.render)} мс`,
      `видеокарта: ${timer ? (s.gpu != null ? `${f1(s.gpu)} мс` : '…') : 'нет таймера в этом браузере'}`,
      `${db.x}×${db.y} · MSAA ${fx.samples}x · ${renderer.info.render.calls} вызовов · ${Math.round(renderer.info.render.triangles / 1000)}k треуг.${reflector?.userData.reflected ? ' · зеркало перерисовано' : ''}`,
      `→ ${v}`,
    ];
    if (bench) lines.unshift(`Проверка ${Math.max(1, bench.i + 1)}/${STEPS.length}: ${STEPS[Math.max(0, bench.i)].name}. Не трогай мышь и клавиатуру, это займёт около полутора минут.`);
    else lines.push('полная проверка: открой игру с ?bench в адресе');
    return lines.join('\n');
  }

  if (params.has('perf')) setOn(true);

  return {
    cfg,
    get active() {
      return on || !!bench;
    },
    get benching() {
      return !!bench;
    },
    toggle() {
      if (!el.classList.contains('card')) setOn(!on);
    },
    startBench,
    begin(now) {
      if (!this.active) return;
      t0 = performance.now();
      phys = 0;
      steps = 0;
      if (reflector) reflector.userData.reflected = false;
      renderer.info.reset();
      if (bench) stepBench(now);
    },
    renderStart() {
      if (!this.active) return;
      tRender = performance.now();
      timer?.begin(rec ? rec.id : -1);
    },
    end(now) {
      if (!this.active) return;
      const t = performance.now();
      timer?.end();
      const f = { dt: now - (prev || now), logic: tRender - t0, render: t - tRender, phys, steps };
      prev = now;
      if (f.dt > 0) {
        live.push(f);
        if (live.length > 90) live.shift();
        if (rec) for (const k of ['dt', 'logic', 'phys', 'steps', 'render']) rec[k].push(f[k]);
      }
      if (timer) {
        const g = timer.poll();
        gpuLive.push(...g.map((x) => x.ms));
        while (gpuLive.length > 60) gpuLive.shift();
        if (rec) rec.gpu.push(...g.filter((x) => x.tag === rec.id).map((x) => x.ms));
      }
      if (t - shownAt > 250 && !el.classList.contains('card')) {
        shownAt = t;
        el.textContent = liveText();
      }
    },
  };
}
