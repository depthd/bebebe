# Cycles previews of kit items: a three-quarter front view on a neutral mid-grey cyclorama with a
# key/fill/rim light, plus a 3x2 contact sheet.
#   blender -b --factory-startup --python scripts/assets/kit/preview.py -- <id|all|id,id> [glbdir] [outdir] [samples]
# Env: THREADS (Cycles threads, default 2), AZ / EL (camera degrees, e.g. AZ=200 for the back), RES (pixels).
# glbdir defaults to .cache/kit/base, outdir to shots/style/kit -> <outdir>/<id>.png and <outdir>/sheet.png.
# Works on any GLB with the kit's conventions (front toward glTF +Z), so style passes can reuse it.
import bpy
import sys
import os
import math
from math import radians, sin, cos, tan, atan
from mathutils import Vector, Matrix

KIT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(KIT, '..', '..', '..'))
ITEMS = ['armchair', 'tv', 'fridge', 'stenka', 'stove', 'stool']
RES = int(os.environ.get('RES', 600))
AZIMUTH = float(os.environ.get('AZ', 33))     # degrees from the front toward the item's right
ELEVATION = float(os.environ.get('EL', 20))   # degrees above the item's middle
LENS = 50


def setup_render(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 4
    sc.cycles.transmission_bounces = 8
    sc.cycles.transparent_max_bounces = 24
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = int(os.environ.get('THREADS', '2'))
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Base Contrast'
    w = bpy.data.worlds.new('studio')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.03, 0.03, 0.03, 1)
    bg.inputs['Strength'].default_value = 1.0
    sc.world = w


def bounds(obs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in obs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def grey(name, value, rough=0.75):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (value, value, value, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def cyclorama(size, angle):
    """Floor that curves up into a wall behind the item, turned to face the camera."""
    S = size
    prof = []
    for k in range(9):
        prof.append((-6 * S + k * 0.75 * S, 0.0))
    R = 1.2 * S
    y0 = 1.3 * S
    for k in range(1, 13):
        a = radians(90 * k / 12)
        prof.append((y0 + R * sin(a), R * (1 - cos(a))))
    for k in range(1, 5):
        prof.append((y0 + R, R + k * 1.5 * S))
    verts, faces = [], []
    xs = [-6 * S + i * S for i in range(13)]
    for x in xs:
        for (y, z) in prof:
            verts.append((x, y, z))
    n = len(prof)
    for i in range(len(xs) - 1):
        for j in range(n - 1):
            a = i * n + j
            faces.append((a, a + 1, a + n + 1, a + n))
    me = bpy.data.meshes.new('cyc')
    me.from_pydata(verts, [], faces)
    me.shade_smooth()
    me.materials.append(grey('backdrop', 0.18))
    ob = bpy.data.objects.new('cyc', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (0, 0, angle)
    # faces must point up/toward the camera
    me.flip_normals() if me.polygons[0].normal.z < 0 else None
    return ob


def area_light(name, loc, target, power, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.size = size
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def fit_camera(cam, lo, hi, direction, margin=0.08):
    centre = (lo + hi) / 2
    corners = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    half = atan(18 / LENS)  # 36 mm sensor, square frame
    lim = tan(half) * (1 - margin)
    fwd = -direction.normalized()
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd)

    def fits(d):
        eye = centre + direction.normalized() * d
        for c in corners:
            v = c - eye
            z = v.dot(fwd)
            if z <= 0.01 or abs(v.dot(right) / z) > lim or abs(v.dot(up) / z) > lim:
                return False
        return True

    a, b = 0.1, 50.0
    for _ in range(40):
        m = (a + b) / 2
        if fits(m):
            b = m
        else:
            a = m
    eye = centre + direction.normalized() * b
    cam.location = eye
    cam.rotation_euler = (centre - eye).to_track_quat('-Z', 'Y').to_euler()
    return eye, centre


def label(cam, body, dist):
    cu = bpy.data.curves.new('label', 'FONT')
    cu.body = body
    half = tan(atan(18 / LENS)) * dist
    cu.size = half * 0.055
    ob = bpy.data.objects.new('label', cu)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new('label')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.02, 0.02, 0.02, 1)
    em.inputs['Strength'].default_value = 1.0
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs[0])
    cu.materials.append(m)
    ob.parent = cam
    ob.location = (-half * 0.94, -half * 0.94, -dist)
    for attr in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter',
                 'visible_shadow'):
        setattr(ob, attr, False)
    return ob


def render_item(item, glbdir, outdir, samples):
    path = os.path.join(glbdir, item + '.glb')
    if not os.path.exists(path):
        print(f'SKIP {item}: no {path}', flush=True)
        return None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_render(samples)
    bpy.ops.import_scene.gltf(filepath=path)
    obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.context.view_layer.update()
    lo, hi = bounds(obs)
    size = hi - lo
    S = max(size.x, size.y, size.z)
    tris = 0
    for o in obs:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    az, el = radians(AZIMUTH), radians(ELEVATION)
    direction = Vector((sin(az) * cos(el), -cos(az) * cos(el), sin(el)))
    cyclorama(S, az)
    cd = bpy.data.cameras.new('cam')
    cd.lens = LENS
    cd.sensor_width = 36
    cd.clip_end = 200
    cam = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    eye, centre = fit_camera(cam, lo, hi, direction)
    D = (eye - centre).length
    k = S * S
    # key from the front left and above, fill from the camera side, rim from behind on the right
    area_light('key', centre + Vector((-1.4, -1.6, 1.5)) * S, centre, 100 * k, 1.2 * S, (1.0, 0.96, 0.9))
    area_light('fill', centre + Vector((1.8, -1.2, 0.4)) * S, centre, 28 * k, 2.0 * S, (0.9, 0.95, 1.0))
    area_light('rim', centre + Vector((1.0, 1.6, 1.4)) * S, centre, 130 * k, 0.8 * S)
    lab = f'{item}   {tris:,} tris   {size.x:.2f} x {size.z:.2f} x {size.y:.2f} m'
    label(cam, lab, 0.2)
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, item + '.png')
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print(f'PREVIEW {out}', flush=True)
    return out


def sheet(outdir, items):
    import numpy as np
    tiles = []
    for it in items:
        p = os.path.join(outdir, it + '.png')
        if os.path.exists(p):
            tiles.append(p)
    if not tiles:
        return
    cols, rows = 3, max(1, (len(tiles) + 2) // 3)
    W, H = cols * RES, rows * RES
    buf = np.full((H, W, 4), 0.12, dtype=np.float32)
    buf[..., 3] = 1
    for k, p in enumerate(tiles):
        img = bpy.data.images.load(p)
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)[:RES, :RES]
        c, r = k % cols, k // cols
        y0 = (rows - 1 - r) * RES  # pixel rows run bottom-up
        buf[y0:y0 + px.shape[0], c * RES:c * RES + px.shape[1]] = px
        bpy.data.images.remove(img)
    out = bpy.data.images.new('sheet', W, H, alpha=False)
    out.pixels.foreach_set(buf.ravel())
    out.filepath_raw = os.path.join(outdir, 'sheet.png')
    out.file_format = 'PNG'
    out.save()
    print(f'SHEET {out.filepath_raw}', flush=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    which = argv[0] if argv else 'all'
    glbdir = argv[1] if len(argv) > 1 else os.path.join(REPO, '.cache', 'kit', 'base')
    outdir = argv[2] if len(argv) > 2 else os.path.join(REPO, 'shots', 'style', 'kit')
    samples = int(argv[3]) if len(argv) > 3 else 48
    if which == 'sheet':
        ids = []
    elif which == 'all':
        ids = [f[:-4] for f in sorted(os.listdir(glbdir)) if f.endswith('.glb')]
        ids = [i for i in ITEMS if i in ids] + [i for i in ids if i not in ITEMS]
    else:
        ids = which.split(',')
    for i in ids:
        render_item(i, glbdir, outdir, samples)
    order = [i for i in ITEMS if os.path.exists(os.path.join(outdir, i + '.png'))]
    sheet(outdir, order)


main()
