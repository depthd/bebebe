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

for img in list(bpy.data.images):
    w, h = img.size
    if not w:
        continue
    if max(w, h) > max_tex:
        k = max_tex / max(w, h)
        img.scale(max(1, round(w * k)), max(1, round(h * k)))
        w, h = img.size

# The importer wires metalness as Separate(B) x factor through a Math node. The exporter then can't
# reuse the texture and builds a 1-channel roughness image that it can't write as WebP (Blender 4.5).
# Bake the factor into a proper RGB metal/roughness image (G roughness, B metalness) and wire it directly.
for mat in obj.data.materials:
    if not (mat and mat.use_nodes):
        continue
    nt = mat.node_tree
    for bsdf in [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED']:
        r_in, m_in = bsdf.inputs['Roughness'], bsdf.inputs['Metallic']
        if not (r_in.is_linked and m_in.is_linked):
            continue
        sep, math = r_in.links[0].from_node, m_in.links[0].from_node
        if sep.type != 'SEPARATE_COLOR' or math.type != 'MATH' or math.operation != 'MULTIPLY':
            continue
        a, b = math.inputs[0], math.inputs[1]
        factor = b.default_value if a.is_linked else a.default_value
        tex = sep.inputs['Color'].links[0].from_node if sep.inputs['Color'].is_linked else None
        if not (tex and tex.type == 'TEX_IMAGE'):
            continue
        src = tex.image
        w, h = src.size
        n = src.channels
        px = src.pixels[:]
        rgb = bpy.data.images.new(src.name + '_mr', w, h, alpha=False)
        rgb.colorspace_settings.name = 'Non-Color'
        buf = [0.0] * (w * h * 4)
        for i in range(w * h):
            g = px[i * n + (1 if n > 1 else 0)]
            bl = px[i * n + (2 if n > 2 else 0)]
            buf[i * 4:i * 4 + 4] = (1.0, g, bl * factor, 1.0)
        rgb.pixels = buf
        tex.image = rgb
        nt.links.remove(m_in.links[0])
        nt.links.new(sep.outputs['Blue'], m_in)
        nt.nodes.remove(math)

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
