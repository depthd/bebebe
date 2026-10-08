// Measures the guys' physical bodies in lab.html: `npm run robot -- [scenario...] [--video name]`.
// Scenarios run at a fixed 1/30 s frame (the speed of a weak laptop): stand, push, walk, drunk...
// Prints falls, steps, how much of his weight the feet carry, time with both feet in the air, physics ms.
// --video <name> also renders every frame and writes shots/robot/<name>.mp4 (needs ffmpeg).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const vi = args.indexOf('--video');
const video = vi >= 0 ? args.splice(vi, 2)[1] : null;
const seed = Number(process.env.SEED ?? 7);
const DT = 1 / 30;

// each scenario: a list of [seconds, what to do first]; `do` runs in the page with the lab
const SCEN = {
  stand: { drunk: 0, steps: [[6]] },
  // one guy per strength (0.6, 1.0, 1.4, 1.8 m/s): forward, sideways, backward
  fwd: { drunk: 0, steps: [[1], [5, 'pushEach(0)']] },
  side: { drunk: 0, steps: [[1], [5, 'pushEach(Math.PI / 2)']] },
  back: { drunk: 0, steps: [[1], [5, 'pushEach(Math.PI)']] },
  push1: { drunk: 0, steps: [[1], [3, 'pushAll(0, 1.6)']] },
  push: { drunk: 0, steps: [[3], ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => [3, `pushAll(${(k * Math.PI) / 4}, 1.6)`])] },
  shove: { drunk: 0, steps: [[3], ...[0, 2, 4, 6].map((k) => [5, `pushAll(${(k * Math.PI) / 4}, 3.2)`])] },
  walk: { drunk: 0, steps: [[2], [8, 'goals(0, -2.2)'], [8, 'goals(0, 2.2)']] },
  turn: { drunk: 0, steps: [[2], [4, 'yaws(Math.PI/2)'], [4, 'yaws(Math.PI)']] },
  // like a path through the flat: short legs with turns between them
  zigzag: { drunk: 0, steps: [[0.5], [2.5, 'goalsRel(0.8, 1.2)'], [2.5, 'goalsRel(0, 2.4)'], [2.5, 'goalsRel(-0.8, 1.2)'], [2.5, 'goalsRel(0, 0)'], [2.5, 'goalsRel(1.2, -0.5)'], [3, 'goalsRel(0, 0)']] },
  corner: { drunk: 0, steps: [[0.5], [3.5, 'goals(0, 2.5)'], [4, 'goalsRel(2.5, 2.5)'], [4, 'goalsRel(2.5, 0)']] },
  walk1: { drunk: 0, steps: [[0.5], [6, 'goals(0, 4)']] },
  turn1: { drunk: 0, steps: [[0.5], [2.5, 'yaws(Math.PI/2)']] },
  drunk50: { drunk: 0.5, steps: [[10], [8, 'goals(0, -2.2)'], [8, 'goals(0, 2.2)']] },
  drunk100: { drunk: 1, steps: [[10], [8, 'goals(0, -2.2)']] },
  getup: { drunk: 0.3, steps: [[2], [12, 'pushAll(0, 5)']] },
};
// robust: random pushes at 0.6 .. 1.8 m/s, 16 each, every 3.5 s on whoever is standing: how often he goes down
SCEN.dirs = { drunk: 0, steps: [[1], [4, 'pushDirs(0.6)']] };
SCEN.robust1 = { drunk: 0, steps: [[1], [3.5, 'pushRandom(0.6)'], [3.5, 'pushRandom(0.6)']] };
SCEN.robust = { drunk: Number(process.env.DRUNK ?? 0), steps: [[1], ...[0.6, 1.0, 1.4, 1.8].flatMap((s) => [0, 1, 2, 3].map((k) => [3.5, `pushRandom(${s})`]))] };
const names = args.length ? args : Object.keys(SCEN).filter((n) => !n.startsWith('robust'));

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = {};
try {
  for (const name of names) {
    const sc = SCEN[name];
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((seed) => {
      let s = seed >>> 0;
      Math.random = () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, seed);
    if (process.env.TUNE) await page.addInitScript((t) => (window.TUNEX = JSON.parse(t)), process.env.TUNE);
    await page.goto(`${url}lab.html?manual&capture${process.env.CAM ? '&cam=' + process.env.CAM : ''}${process.env.DBG ? '&dbg' : ''}${process.env.FI ? '&fi=' + process.env.FI : ''}${process.env.ITERS ? '&iters=' + process.env.ITERS : ''}${process.env.Q ? '&' + process.env.Q : ''}${process.env.STEPS ? '&steps=' + process.env.STEPS + '&hz=' + (process.env.HZ ?? 180) : ''}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__lab, null, { timeout: 120000 });
    await page.evaluate((d) => {
      const L = window.__lab;
      if (window.TUNEX) Object.assign(L.R, window.TUNEX);
      L.setDrunk(d);
      L.pushAll = (dir, s) => L.guys.forEach((g) => g.rb.push(dir, s));
      L.pushEach = (dir) => L.guys.forEach((g, i) => g.rb.push(dir, 0.6 + 0.4 * i));
      L.tally = {};
      L.pushDirs = (s) => L.guys.forEach((g, i) => g.rb.push((i * Math.PI) / 2, s));
      L.pushRandom = (s) => {
        // the previous round: who fell
        if (L.last) for (const [i, g] of L.guys.entries()) if (L.last.who.includes(i)) (L.tally[L.last.s] ??= [0, 0])[g.rb.stats.falls > L.last.falls[i] ? 0 : 1]++;
        const who = L.guys.map((g, i) => i).filter((i) => L.guys[i].rb.state === 'up');
        L.last = { s, who, falls: L.guys.map((g) => g.rb.stats.falls) };
        for (const i of who) L.guys[i].rb.push(Math.random() * Math.PI * 2, s);
      };
      L.goals = (x, z) => L.guys.forEach((g, i) => (g.rb.goal = [g.rb.home[0] + x, z]));
      L.goalsRel = (dx, z) => L.guys.forEach((g) => (g.rb.goal = [g.rb.home[0] + dx, z]));
      L.yaws = (y) => L.guys.forEach((g) => (g.rb.yawWant = y));
      L.acc = { frames: 0, physMs: 0, feet: 0, air: 0, slide: 0, n: 0 };
      L.oleg.position.set(0, 0, 8); // out of the way
      const cam = new URLSearchParams(location.search).get('cam');
      if (cam === 'follow') {
        L.follow = true;
        L.followI = Number(new URLSearchParams(location.search).get('fi') ?? 0);
      } else if (cam === 'close') {
        L.camera.position.set(-2.2, 1.5, 2.2);
        L.controls.target.set(-3.3, 0.7, 0);
      } else if (cam === 'side') {
        L.camera.position.set(-5.8, 1.1, 1.0);
        L.controls.target.set(-3.3, 0.75, 0.9);
      } else {
        L.camera.position.set(0.3, 3.4, 7.8);
        L.controls.target.set(0, 0.6, -0.4);
      }
      L.controls.update();
    }, sc.drunk);
    if (video) rmSync(`shots/robot/${video}-${name}`, { recursive: true, force: true }), mkdirSync(`shots/robot/${video}-${name}`, { recursive: true });
    let frame = 0;
    for (const [secs, cmd] of sc.steps) {
      if (cmd) await page.evaluate(`window.__lab.${cmd}`);
      const n = Math.round(secs / DT);
      for (let i = 0; i < n; i += video ? 1 : 30) {
        const k = video ? 1 : Math.min(30, n - i);
        const shot = await page.evaluate(([k, dt, video]) => {
          const L = window.__lab;
          for (let j = 0; j < k; j++) {
            const t0 = performance.now();
            L.advance(dt);
            L.acc.physMs += performance.now() - t0;
            L.acc.frames++;
            for (const g of L.guys) {
              if (g.rb.state !== 'up') continue;
              L.acc.feet += g.rb.stats.feetN / (68 * 9.8);
              L.acc.air += g.rb.feet[0].down || g.rb.feet[1].down ? 0 : 1;
              L.acc.n++;
            }
          }
          if (!video) return null;
          if (L.follow) {
            const c = L.guys[L.followI ?? 0].rb.c;
            L.camera.position.set(c.x - 2.6, 1.6, c.z + 0.6);
            L.controls.target.set(c.x, 0.7, c.z);
          }
          L.controls.update();
          L.render();
          return document.querySelector('canvas').toDataURL('image/jpeg', 0.85);
        }, [k, DT, !!video]);
        if (shot) writeFileSync(`shots/robot/${video}-${name}/${String(frame++).padStart(4, '0')}.jpg`, Buffer.from(shot.split(',')[1], 'base64'));
      }
    }
    const r = await page.evaluate(() => {
      const L = window.__lab, a = L.acc;
      return {
        falls: L.guys.map((g) => g.rb.stats.falls),
        why: L.guys.map((g) => g.rb.stats.why ?? ''),
        steps: L.guys.map((g) => g.rb.stats.steps),
        state: L.guys.map((g) => g.rb.state),
        at: L.guys.map((g) => [+g.rb.c.x.toFixed(2), +g.rb.c.z.toFixed(2)]),
        feetLoad: +(a.feet / Math.max(1, a.n)).toFixed(2),
        bothFeetAir: +(a.air / Math.max(1, a.n)).toFixed(3),
        msPerFrame: +(a.physMs / a.frames).toFixed(2),
        fellOf: L.pushRandom ? (L.pushRandom(0), Object.fromEntries(Object.entries(L.tally).map(([s, [f, ok]]) => [s, `${f}/${f + ok}`]))) : undefined,
      };
    });
    r.errors = errors;
    results[name] = r;
    console.log(name.padEnd(9), JSON.stringify(r));
    if (video) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `shots/robot/${video}-${name}/%04d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', `shots/robot/${video}-${name}.mp4`]);
      console.log(`  -> shots/robot/${video}-${name}.mp4`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
mkdirSync('shots/robot', { recursive: true });
writeFileSync(`shots/robot/last.json`, JSON.stringify(results, null, 1));
