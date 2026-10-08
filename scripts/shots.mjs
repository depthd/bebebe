// Eye-level screenshots of the whole game: `npm run shots -- <name> [view numbers]` (default name "now").
// Starts the dev server, opens the game in headless Chromium, stands Oleg at fixed points
// (every room, the landing, the yard, the shop) at eye height, and saves each view plus
// contact sheets of four (shots/<name>/sheet-N.png). Same points every run, so two runs
// (`npm run shots -- before`, then `-- after`) compare directly.
// The party runs for a while first, then the simulation is frozen so every view sees the same moment.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { planToWorld } from '../src/world/layout.js';

// [name, stand at (plan x, z), look at (plan x, z), pitch in degrees]
const VIEWS = [
  ['Зал: от двери к окну', [4.0, 5.2], [4.0, 0.0], -8],
  ['Зал: от окна к стенке и прихожей', [2.9, 0.5], [5.2, 3.6], -10],
  ['Зал: с дивана на телик', [2.75, 2.3], [5.3, 2.4], -6],
  ['Спальня: от двери', [2.0, 4.2], [0.8, 0.4], -10],
  ['Спальня: от окна к компу', [1.4, 0.5], [1.0, 5.2], -8],
  ['Кухня: к плите и раковине', [6.1, 0.95], [7.95, 1.0], -14],
  ['Кухня: к холодильнику', [7.3, 0.35], [5.8, 1.6], -10],
  ['Санузел: к зеркалу', [6.25, 3.85], [7.9, 3.05], -8],
  ['Прихожая: к входной двери', [5.9, 4.9], [8.4, 4.9], -6],
  ['Прихожая: к залу', [7.8, 4.8], [4.5, 4.0], -6],
  ['Прихожая: шкаф', [7.1, 4.35], [7.1, 5.5], 12],
  ['Балкон: к мангалу', [2.8, -0.8], [5.3, -0.95], -10],
  ['Подъезд: к лестнице', [9.6, 6.0], [9.6, 3.4], -12],
  ['Двор: к ларьку', [5.0, -3.0], [8.75, -8.5], -2],
  ['Ларёк: внутри', [8.8, -7.0], [8.75, -10.2], -6],
];
const W = 1280, H = 720;

const name = process.argv[2] || 'now';
// optional: only some views, by number (`npm run shots -- after 1,3`)
const pick = process.argv[3]?.split(',').map(Number);
const out = `shots/${name}`;
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));

const frames = (n) => page.evaluate((n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
try {
  await page.goto(`${url}?play&t=20`, { waitUntil: 'load', timeout: 120000 });
  await page.addStyleTag({ content: '#hud, .perf { display: none !important; }' });
  await frames(3);
  // freeze the party: same moment in every view
  await page.evaluate(() => { window.__game.update = () => {}; });
  const shots = [];
  for (const [i, [label, from, to, pitch]] of VIEWS.entries()) {
    if (pick && !pick.includes(i + 1)) continue;
    const [x, z] = planToWorld.pt(...from), [tx, tz] = planToWorld.pt(...to);
    const yaw = Math.atan2(-(tx - x), -(tz - z));
    await page.evaluate(([x, z, yaw, pitch]) => {
      window.__player.place(x, z, yaw);
      window.__player.pitch = pitch;
    }, [x, z, yaw, (pitch * Math.PI) / 180]);
    await frames(3); // the light pool fades lamps in over a few frames
    const file = `${String(i + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    shots.push({ file, label });
    console.log(`${file}  ${label}`);
  }
  // contact sheets, 2x2
  const sheet = await browser.newPage({ viewport: { width: W, height: H + 40 } });
  for (let s = 0; s * 4 < shots.length; s++) {
    const group = shots.slice(s * 4, s * 4 + 4);
    const cells = group.map((g) => {
      const b64 = readFileSync(`${out}/${g.file}`).toString('base64');
      return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${g.file.replace('.png', '')} · ${g.label}</figcaption></figure>`;
    });
    await sheet.setContent(`<style>body{margin:0;background:#111;display:grid;grid-template-columns:1fr 1fr;gap:4px;font:15px sans-serif;color:#eee}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:6px;top:6px;padding:2px 6px;background:rgba(0,0,0,.7);border-radius:4px}</style>${cells.join('')}`);
    await sheet.screenshot({ path: `${out}/${pick ? 'pick' : 'sheet'}-${s + 1}.png`, fullPage: true }); // a partial run keeps the full sheets
  }
  writeFileSync(`${out}/views.json`, JSON.stringify(VIEWS, null, 1));
  if (errors.length) console.log(`page errors:\n${errors.join('\n')}`);
  console.log(`saved to ${out}/`);
} finally {
  await browser.close();
  await server.close();
}
