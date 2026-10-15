# Builds the base kit: one GLB per item from scripts/assets/kit/<id>.py.
#   blender -b --factory-startup --python scripts/assets/kit/build.py -- <id|all> [outdir]
# outdir defaults to .cache/kit/base. Prints one line per item:
#   STATS {"id", "tris", "materials": [names], "size_m": [x, height, depth]}
import bpy
import sys
import os
import json
import importlib
from math import radians
from mathutils import Vector, Matrix

sys.dont_write_bytecode = True  # no __pycache__ next to the item scripts
KIT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(KIT, '..', '..', '..'))
sys.path.insert(0, KIT)
import common  # noqa: E402

ITEMS = ['armchair', 'tv', 'fridge', 'stenka', 'stove', 'stool']


def meshes_under(rootob):
    return [o for o in rootob.children_recursive if o.type == 'MESH']


def world_bounds(obs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in obs:
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def finalize(rootob):
    bpy.context.view_layer.update()
    obs = meshes_under(rootob)
    lo, hi = world_bounds(obs)
    off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for o in rootob.children:
        o.matrix_world = Matrix.Translation(-off) @ o.matrix_world
    bpy.context.view_layer.update()
    for o in obs:
        if o.data.users > 1:
            o.data = o.data.copy()
        o.data.name = o.name
        # no scale in the hierarchy: bake it into the mesh (rotation/location stay: hinges keep pivots)
        if any(abs(s - 1) > 1e-6 for s in o.scale):
            sc = Matrix.Diagonal((*o.scale, 1))
            o.data.transform(sc)
            o.scale = (1, 1, 1)
    # UVs: one Smart UV Project over all parts together (an atlas for baking), except parts that
    # came with their own UVs (the TV screen is mapped 0..1 across its picture)
    need = [o for o in obs if not o.get('keep_uv')]
    for o in obs:
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
    if need:
        bpy.ops.object.select_all(action='DESELECT')
        for o in need:
            o.select_set(True)
        bpy.context.view_layer.objects.active = need[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=0.02, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in obs:
        if 'keep_uv' in o:
            del o['keep_uv']
    bpy.context.view_layer.update()
    lo, hi = world_bounds(obs)
    tris = 0
    mats = []
    for o in obs:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        for m in o.data.materials:
            if m and m.name not in mats:
                mats.append(m.name)
    size = hi - lo
    return {'tris': tris, 'materials': mats, 'size_m': [round(size.x, 3), round(size.z, 3), round(size.y, 3)]}


def export(rootob, path):
    bpy.ops.object.select_all(action='DESELECT')
    rootob.select_set(True)
    for o in rootob.children_recursive:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_animations=False, export_extras=False, export_cameras=False, export_lights=False,
        export_texcoords=True, export_normals=True, export_tangents=False,
    )


def build_one(item_id, outdir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    common.reset()
    mod = importlib.import_module(item_id)
    importlib.reload(mod)
    rootob = mod.build()
    rootob.name = item_id
    stats = finalize(rootob)
    path = os.path.join(outdir, item_id + '.glb')
    export(rootob, path)
    stats = {'id': item_id, **stats, 'bytes': os.path.getsize(path)}
    print('STATS ' + json.dumps(stats), flush=True)
    return stats


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    which = argv[0] if argv else 'all'
    outdir = argv[1] if len(argv) > 1 else os.path.join(REPO, '.cache', 'kit', 'base')
    os.makedirs(outdir, exist_ok=True)
    ids = ITEMS if which == 'all' else which.split(',')
    for i in ids:
        build_one(i, outdir)


main()
