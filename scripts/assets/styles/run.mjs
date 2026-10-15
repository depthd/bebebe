// `npm run style-kit -- <style> [names...]`: runs one art style's Blender finishing pass
// (scripts/assets/styles/<style>.py) over the shared base kit and the game's props, for the showroom:
//   .cache/kit/base/<id>.glb     -> .cache/kit/<style>/<id>.glb
//   src/assets/models/<id>.glb   -> .cache/kit/<style>/props/<id>.glb
// Each call is: blender -b --factory-startup --python <style>.py -- <in.glb> <out.glb> <kit|prop>
// A line the pass prints as `STATS {...}` is shown next to the file name.
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../../../', import.meta.url).pathname;
const [style, ...only] = process.argv.slice(2);
if (!style) throw new Error('usage: npm run style-kit -- <style> [names...]');
const script = `${root}scripts/assets/styles/${style}.py`;
if (!existsSync(script)) throw new Error(`no ${script}`);
const blender = process.env.BLENDER || 'blender';
const jobs = [];
const add = (dir, kind, outDir) => {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
    if (only.length && !only.includes(f.replace('.glb', ''))) continue;
    jobs.push({ src: `${dir}/${f}`, out: `${outDir}/${f}`, kind });
  }
};
add(`${root}.cache/kit/base`, 'kit', `${root}.cache/kit/${style}`);
add(`${root}src/assets/models`, 'prop', `${root}.cache/kit/${style}/props`);
for (const j of jobs) {
  mkdirSync(j.out.replace(/\/[^/]+$/, ''), { recursive: true });
  const t = Date.now();
  let log;
  try {
    log = execFileSync(blender, ['-b', '--factory-startup', '--python', script, '--', j.src, j.out, j.kind], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.log(`FAILED ${j.src}\n${(e.stdout ?? '').split('\n').slice(-15).join('\n')}\n${e.stderr ?? ''}`);
    process.exitCode = 1;
    continue;
  }
  const stats = log.split('\n').find((l) => l.startsWith('STATS '))?.slice(6) ?? '';
  console.log(`${j.kind} ${j.out.split('/').slice(-1)[0]}  ${((Date.now() - t) / 1000).toFixed(1)} s  ${stats}`);
}
