// Texture treatment for the doom art style: every picture is resampled to a low texel density
// (smoothing on for the downscale, so the patterns survive), quantised to the shared 256-colour palette
// and shown with nearest filtering: 64-128 px per metre, like a Build-engine level.
// One processed texture per source texture. Sources drawn later (photos that load, skin sheets, mood
// faces) are redone when the source's version changes: refresh() checks that every frame.
import * as THREE from 'three';
import { quantise } from './doom-palette.js';

// a picture we can draw: a loaded image, a canvas, an ImageBitmap (not raw data)
const ready = (img) => !!img && (img instanceof HTMLImageElement ? img.complete && img.naturalWidth > 0 : (img.width ?? 0) > 0 && !img.data);
const dims = (img) => (img instanceof HTMLImageElement ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height]);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// downscale in halving steps (each one a good box filter), then the last step to the exact size
function resample(img, w, h) {
  let [cw, ch] = dims(img), cur = img;
  while (cw >= w * 2 || ch >= h * 2) {
    const nw = Math.max(w, Math.ceil(cw / 2)), nh = Math.max(h, Math.ceil(ch / 2));
    const c = canvas(nw, nh), g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = c; cw = nw; ch = nh;
  }
  const out = canvas(w, h), g = out.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, cw, ch, 0, 0, w, h);
  return out;
}

// tiles redrawn pixel-exact instead of resampled: n x n tiles of p px with a 1 px grout line,
// each tile the source's colour at its centre (the grout from the source's corner)
function retile(img, n, p) {
  const [sw, sh] = dims(img);
  const src = canvas(sw, sh), sg = src.getContext('2d', { willReadFrequently: true });
  sg.drawImage(img, 0, 0);
  const px = sg.getImageData(0, 0, sw, sh).data;
  const at = (x, y) => {
    const k = (Math.floor(y) * sw + Math.floor(x)) * 4;
    return `rgb(${px[k]},${px[k + 1]},${px[k + 2]})`;
  };
  const out = canvas(n * p, n * p), g = out.getContext('2d', { willReadFrequently: true });
  g.fillStyle = at(0, 0);
  g.fillRect(0, 0, n * p, n * p);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      g.fillStyle = at(((i + 0.5) * sw) / n, ((j + 0.5) * sh) / n);
      g.fillRect(i * p + 1, j * p + 1, p - 1, p - 1);
    }
  return out;
}

// how many uv units per metre a mesh maps onto (sqrt of uv area over world area, the texture's repeat
// included): times sqrt(texture w * h) that is its texel density in px per metre
export function uvPerMetre(mesh, tex) {
  const geo = mesh.geometry, pos = geo?.attributes.position, uv = geo?.attributes.uv;
  if (!pos || !uv) return null;
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld, idx = geo.index;
  const n = Math.min(idx ? idx.count / 3 : pos.count / 3, 4000);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let A = 0, U = 0;
  const rx = Math.abs(tex.repeat.x) || 1, ry = Math.abs(tex.repeat.y) || 1;
  for (let t = 0; t < n; t++) {
    const [i0, i1, i2] = idx ? [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)] : [t * 3, t * 3 + 1, t * 3 + 2];
    a.fromBufferAttribute(pos, i0).applyMatrix4(m);
    b.fromBufferAttribute(pos, i1).applyMatrix4(m);
    c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    A += b.sub(a).cross(c.sub(a)).length() / 2;
    const u0 = uv.getX(i0) * rx, v0 = uv.getY(i0) * ry;
    const u1 = uv.getX(i1) * rx - u0, v1 = uv.getY(i1) * ry - v0;
    const u2 = uv.getX(i2) * rx - u0, v2 = uv.getY(i2) * ry - v0;
    U += Math.abs(u1 * v2 - u2 * v1) / 2;
  }
  if (A < 1e-6 || U < 1e-9) return null;
  return Math.sqrt(U / A);
}

export function createTextures() {
  const entries = new Map(); // source texture -> entry
  const outs = new WeakSet(); // processed textures (so they're never processed again)
  const live = []; // entries whose source can still change

  function draw(e) {
    const img = e.src.image;
    const [sw, sh] = dims(img);
    let c;
    if (e.opt.tiles) c = retile(img, ...e.opt.tiles);
    else {
      let [w, h] = e.opt.size(sw, sh);
      w = Math.max(1, Math.min(sw, Math.round(w)));
      h = Math.max(1, Math.min(sh, Math.round(h)));
      c = resample(img, w, h);
    }
    const g = c.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(0, 0, c.width, c.height);
    quantise(d, { dither: e.opt.dither ?? 0, alphaCut: e.opt.alphaCut ?? null });
    g.putImageData(d, 0, 0);
    const t = e.out;
    if (t.image && (t.image.width !== c.width || t.image.height !== c.height)) t.dispose(); // a new size needs a new GPU texture
    t.image = c;
    t.needsUpdate = true;
    e.ver = e.src.version;
  }

  return {
    isOut: (t) => outs.has(t),
    // the processed copy of tex. opt: { size(w, h) -> [w, h] | tiles: [n, p], dither, alphaCut }
    get(tex, opt) {
      if (!tex || outs.has(tex)) return tex;
      if (tex.isDataTexture || tex.isCompressedTexture || tex.isVideoTexture || tex.isRenderTargetTexture || tex.isData3DTexture) return tex;
      let e = entries.get(tex);
      if (e) return e.out;
      const out = new THREE.CanvasTexture(canvas(1, 1));
      for (const k of ['flipY', 'wrapS', 'wrapT', 'colorSpace', 'channel', 'premultiplyAlpha', 'rotation', 'matrixAutoUpdate']) out[k] = tex[k];
      out.repeat.copy(tex.repeat);
      out.offset.copy(tex.offset);
      out.center.copy(tex.center);
      out.matrix.copy(tex.matrix);
      out.magFilter = THREE.NearestFilter;
      out.minFilter = THREE.NearestMipmapNearestFilter;
      out.generateMipmaps = true;
      out.anisotropy = 1;
      out.name = `${tex.name || 'tex'}·doom`;
      outs.add(out);
      e = { src: tex, out, opt, ver: -1 };
      entries.set(tex, e);
      live.push(e);
      if (ready(tex.image)) draw(e);
      return out;
    },
    // redo the ones whose source changed (a photo loaded, a canvas was redrawn)
    refresh() {
      for (const e of live) if (e.src.version !== e.ver && ready(e.src.image)) draw(e);
    },
  };
}
