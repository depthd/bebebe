# Blender side of `npm run assets`: one glTF in, one game-ready .glb out.
#   blender -b --factory-startup --python blender_build.py -- <in.gltf> <out.glb> <max tris> <max texture px> <anchor>
# Joins the asset into a single mesh (one draw call per material), bakes its transforms, decimates it to
# the triangle budget, shrinks its textures, and puts the origin where the game holds it:
# 'bottom' (centre of the base, for things standing on something) or 'top' (centre of the top, for things hanging).
# Prints one JSON line with the stats.
import bpy, sys, json, os
from mathutils import Matrix, Vector

src, out, max_tris, max_tex, anchor = sys.argv[sys.argv.index('--') + 1:][:5]
max_tris, max_tex = int(max_tris), int(max_tex)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
for o in list(bpy.context.scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)

def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)

before = tris(obj)
if before > max_tris:
    m = obj.modifiers.new('decimate', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = max_tris / before
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=m.name)
after = tris(obj)

# origin: horizontal centre of the bounding box, at its bottom or top (Blender is Z-up here)
vs = [v.co for v in obj.data.vertices]
lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
pivot = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z if anchor == 'top' else lo.z))
obj.data.transform(Matrix.Translation(-pivot))

for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > max_tex:
        k = max_tex / max(w, h)
        img.scale(max(1, round(w * k)), max(1, round(h * k)))

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_image_format='WEBP', export_image_quality=80,
    export_yup=True, export_apply=True, export_animations=False, export_tangents=False,
)
size = hi - lo
print('STATS ' + json.dumps({
    'tris_before': before, 'tris': after, 'materials': len(obj.data.materials),
    'size_m': [round(size.x, 3), round(size.z, 3), round(size.y, 3)],  # x, height, depth (game axes)
    'bytes': os.path.getsize(out),
}))
