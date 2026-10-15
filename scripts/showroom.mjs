// Screenshots of the style showroom (showroom.html): `npm run showroom -- <outName> [style] [kit]`
// saves shots/style/<outName>/showroom-1.png, -2, -3 (1280x720), one per fixed view. style '' / '-' / 'none'
// means no style (e.g. `npm run showroom -- base-kit - base`); kit defaults to 'base' (.cache/kit/base/).
// Starts Vite (no HMR, no file watching: a reload in the middle would kill the run), opens each view in
// headless Chromium one after another in one browser, waits for window.__ready, then a few more frames.
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const [outName = 'now', styleArg = '', kit = ''] = process.argv.slice(2);
const style = ['', '-', 'none'].includes(styleArg) ? '' : styleArg;
const W = 1280, H = 720;
const out = `shots/style/${outName}`;
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
let view = 0;
const errors = [];
page.on('pageerror', (e) => errors.push(`view ${view}: ${e.message}`));
page.on('console', (m) => {
  const text = m.text();
  // 404s are the missing kit files the page probes for (it says which in a warning) and the favicon
  if (m.type() === 'error' && !/404|favicon/.test(text)) errors.push(`view ${view}: ${text}`);
  if (view === 1 && /^showroom:/.test(text) && ['warning', 'info'].includes(m.type())) console.log(`  ${text}`);
});

const frames = (n) => page.evaluate((n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
let failed = false;
try {
  for (view = 1; view <= 3; view++) {
    const q = new URLSearchParams({ view });
    if (style) q.set('style', style);
    if (kit) q.set('kit', kit);
    const t0 = Date.now();
    await page.goto(`${url}showroom.html?${q}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 180000, polling: 500 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error(`showroom failed: ${err}`);
    await frames(3);
    const file = `${out}/showroom-${view}.png`;
    await page.screenshot({ path: file });
    console.log(`${file}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  if (errors.length) console.log(`page errors:\n  ${[...new Set(errors)].join('\n  ')}`);
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
