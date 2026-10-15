# Shared helpers for the base kit: Soviet furniture modelled by bpy scripts (Blender 4.5).
# Every item script (<id>.py) has build() -> root; build.py resets the scene, calls it, finishes the
# item here (UVs, origin, stats) and exports one GLB. Conventions (README.md):
#   metres, Z up, origin at the bottom centre, FRONT toward -Y (glTF +Z after export),
#   one material per role (ROLES), named by the role, plain PBR factors, no textures;
#   every part is a closed solid with outward normals; soft edges are real geometry with exact
#   normals (flat panels stay flat, roundings are smooth).
import bpy
import bmesh
import math
from math import radians, sin, cos, tan, pi
from mathutils import Vector, Matrix, Quaternion

# ------------------------------------------------------------------ materials

# Base colours are linear (as glTF stores them). Items override a role's colour with palette().
ROLES = {
    'wood_polished': dict(color=(0.055, 0.019, 0.008), rough=0.30),     # dark polished veneer
    'wood': dict(color=(0.58, 0.40, 0.22), rough=0.62),                 # light raw / lacquered birch
    'fabric': dict(color=(0.30, 0.075, 0.025), rough=0.95),             # rust velour
    'metal_chrome': dict(color=(0.90, 0.90, 0.90), rough=0.10, metal=1.0),
    'metal_painted': dict(color=(0.035, 0.035, 0.035), rough=0.45),     # painted / anodised metal
    'enamel': dict(color=(0.85, 0.85, 0.82), rough=0.16),               # white stove/fridge enamel
    'plastic_black': dict(color=(0.012, 0.012, 0.012), rough=0.32),
    'glass': dict(color=(0.12, 0.14, 0.14), rough=0.02, alpha=0.20),    # alpha-blended, mostly reflection
    'crystal': dict(color=(0.62, 0.68, 0.74), rough=0.0, alpha=0.2),
    'screen': dict(color=(0.022, 0.028, 0.026), rough=0.10),           # the game draws its picture here
    'rubber': dict(color=(0.018, 0.018, 0.018), rough=0.90),
}
_overrides = {}


def palette(**roles):
    """Per-item role tweaks: palette(fabric=(r, g, b)) or palette(metal_painted=dict(color=..., metal=1))."""
    for k, v in roles.items():
        if k not in ROLES:
            raise KeyError(f'unknown material role {k}')
        _overrides[k] = v if isinstance(v, dict) else {'color': v}


def reset():
    """Forget the previous item's palette and soft-box normals (build.py calls this per item)."""
    _overrides.clear()
    _NFN.clear()


def mat(role):
    m = bpy.data.materials.get(role)
    if m:
        return m
    spec = {**ROLES[role], **_overrides.get(role, {})}
    m = bpy.data.materials.new(role)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*spec['color'], 1.0)
    b.inputs['Roughness'].default_value = spec['rough']
    b.inputs['Metallic'].default_value = spec.get('metal', 0.0)
    alpha = spec.get('alpha', 1.0)
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
        m.use_backface_culling = False   # see-through: both sides show (glTF doubleSided)
    else:
        m.use_backface_culling = True    # closed solids: single-sided
    m.diffuse_color = (*spec['color'], alpha)
    m.roughness = spec['rough']
    return m


# ------------------------------------------------------------------ objects


def link(ob, parent=None):
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def root(name):
    """The item's root empty (everything else is parented under it)."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.3
    return link(ob)


def place(ob, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    ob.location = loc
    ob.rotation_euler = [radians(a) for a in rot]
    if parent is not None:
        ob.parent = parent
    return ob


def _loop_normals(me, flat_faces, nfn, max_dev=50):
    """Custom split normals: nfn(position) where it is close to the face's own normal, else flat."""
    cos_max = cos(radians(max_dev))
    out = []
    for p in me.polygons:
        fn = p.normal
        for li in p.loop_indices:
            n = None
            if nfn is not None and p.index not in flat_faces:
                n = nfn(me.vertices[me.loops[li].vertex_index].co)
                if n is not None and n.dot(fn) < cos_max:
                    n = None
            out.append(tuple(n) if n is not None else tuple(fn))
    me.shade_smooth()
    me.normals_split_custom_set(out)


def finish(name, bm, role=None, nfn=None, flat_faces=(), shading='custom', sharp=35, parent=None):
    """bmesh -> linked object. shading: 'custom' (exact normals from nfn, flat faces flat),
    'smooth' (smooth with sharp edges over `sharp` degrees), 'flat', 'weighted' (face-area weighted)."""
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), parent)
    if role:
        me.materials.append(mat(role))
    if shading == 'custom':
        _loop_normals(me, set(flat_faces), nfn)
    elif shading == 'smooth':
        me.shade_smooth()
        me.set_sharp_from_angle(angle=radians(sharp))
    elif shading == 'flat':
        me.shade_flat()
    elif shading == 'weighted':
        me.shade_smooth()
        me.set_sharp_from_angle(angle=radians(sharp))
        weighted_normals(ob)
    return ob


def weighted_normals(ob, weight=100):
    m = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    m.mode = 'FACE_AREA'
    m.weight = weight
    m.keep_sharp = True
    apply_modifiers(ob)


def apply_modifiers(ob):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        for m in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)


# ------------------------------------------------------------------ soft boxes


def _axis_coords(h, rn, rp, seg, cuts):
    cs = []
    if rn > 0:
        cs += [-h + rn - rn * tan(radians(45) * (1 - k / seg)) for k in range(seg + 1)]
    else:
        cs.append(-h)
    lo, hi = -h + rn, h - rp
    cs += [lo + (hi - lo) * k / (cuts + 1) for k in range(1, cuts + 1)]
    if rp > 0:
        cs += [h - rp + rp * tan(radians(45) * k / seg) for k in range(seg + 1)]
    else:
        cs.append(h)
    out = []
    for c in sorted(cs):
        if not out or c - out[-1] > 1e-7:
            out.append(c)
    return out


def soft_box_bm(size, r=0.0, seg=2, radii=None, cuts=(0, 0, 0)):
    """A box centred on the origin whose edges are rounded with real geometry.
    r: radius for every side; radii: per side '+x' '-x' '+y' '-y' '+z' '-z' or per axis 'x' 'y' 'z'.
    An edge between two sides is a (possibly elliptical) quarter arc with those two radii, so a side
    with radius 0 meets its neighbours at a sharp edge (and is a flat cap). seg: steps per 45 degrees.
    Returns (bm, normal_fn); flat caps are tagged in the face layer 'flat' (finish_soft reads it)."""
    h = [s / 2 for s in size]
    radii = radii or {}
    R = {}
    for i, ax in enumerate('xyz'):
        for sgn, ch in ((-1, '-'), (1, '+')):
            v = radii.get(ch + ax, radii.get(ax, r))
            R[i, sgn] = max(0.0, min(v, h[i]))
    coords = [_axis_coords(h[i], R[i, -1], R[i, 1], seg, cuts[i]) for i in range(3)]

    def split(p):
        cs, d, rr = [0, 0, 0], [0, 0, 0], [0, 0, 0]
        for i in range(3):
            lo, hi = -h[i] + R[i, -1], h[i] - R[i, 1]
            c = min(max(p[i], lo), hi)
            diff = p[i] - c
            r_ = R[i, 1 if diff > 0 else -1]
            cs[i], rr[i] = c, r_
            d[i] = diff / r_ if (r_ > 0 and abs(diff) > 1e-9) else 0.0
        return cs, d, rr

    def place_q(q):
        cs, d, rr = split(q)
        L = math.sqrt(sum(x * x for x in d))
        if L == 0:
            return Vector(cs)
        return Vector([cs[i] + rr[i] * d[i] / L for i in range(3)])

    def nfn(p):
        cs, d, rr = split(p)
        n = Vector([d[i] / rr[i] if rr[i] > 0 else 0.0 for i in range(3)])
        return n.normalized() if n.length > 1e-9 else None

    bm = bmesh.new()
    cache = {}

    def vert(p):
        key = (round(p[0], 6), round(p[1], 6), round(p[2], 6))
        v = cache.get(key)
        if v is None:
            v = cache[key] = bm.verts.new(p)
        return v

    tag = bm.faces.layers.int.new('flat')  # (adding a layer invalidates face references: do it first)
    for a in range(3):
        b, c = (a + 1) % 3, (a + 2) % 3
        cb, cc = coords[b], coords[c]
        for s in (-1, 1):
            def at(ii, jj):
                q = [0, 0, 0]
                q[a], q[b], q[c] = s * h[a], cb[ii], cc[jj]
                return vert(place_q(q))
            if R[a, s] == 0:
                # a flat cap: the perimeter of this side's grid, counter-clockwise seen from outside
                nb, nc = len(cb) - 1, len(cc) - 1
                ring = [at(i, 0) for i in range(nb)] + [at(nb, j) for j in range(nc)] + \
                       [at(i, nc) for i in range(nb, 0, -1)] + [at(0, j) for j in range(nc, 0, -1)]
                if s < 0:
                    ring.reverse()
                poly = []
                for v in ring:
                    if v not in poly:
                        poly.append(v)
                f = bm.faces.new(poly)
                tris = bmesh.ops.triangulate(bm, faces=[f], quad_method='BEAUTY', ngon_method='BEAUTY')['faces']
                for t in tris:
                    t[tag] = 1
                continue
            for i in range(len(cb) - 1):
                for j in range(len(cc) - 1):
                    quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
                    if s < 0:
                        quad.reverse()
                    uniq = []
                    for v in quad:
                        if v not in uniq:
                            uniq.append(v)
                    if len(uniq) >= 3:
                        bm.faces.new(uniq)
    return bm, nfn


def flat_faces_of(me):
    a = me.attributes.get('flat')
    if not a:
        return set()
    out = {i for i, d in enumerate(a.data) if d.value}
    me.attributes.remove(a)
    return out


def finish_soft(name, bm, nfn, role=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), parent)
    if role:
        me.materials.append(mat(role))
    _loop_normals(me, flat_faces_of(me), nfn)
    return ob


_NFN = {}


def soft_box(name, size, r=0.0, seg=2, role=None, loc=(0, 0, 0), rot=(0, 0, 0), radii=None, parent=None):
    """A rounded box of `size`, centred at `loc` (object origin at its centre)."""
    bm, nfn = soft_box_bm(size, r, seg, radii)
    ob = finish_soft(name, bm, nfn, role)
    _NFN[ob.name] = nfn
    return place(ob, loc, rot, parent)


def subtract(ob, cutter):
    """Boolean-cut `cutter` out of `ob` (both placed in the world), then redo ob's normals: exact where
    ob is a soft_box, face-area weighted otherwise. The cutter is deleted."""
    m = ob.modifiers.new('cut', 'BOOLEAN')
    m.operation = 'DIFFERENCE'
    m.solver = 'EXACT'
    m.object = cutter
    bpy.context.view_layer.update()
    apply_modifiers(ob)
    bpy.data.objects.remove(cutter, do_unlink=True)
    nfn = _NFN.get(ob.name)
    if nfn:
        _loop_normals(ob.data, set(), nfn)
    else:
        weighted_normals(ob)
    return ob


def box(name, xs, ys, zs, r=0.0, seg=2, role=None, radii=None, parent=None):
    """soft_box given by its spans: xs=(x0, x1), ys=(y0, y1), zs=(z0, z1)."""
    size = (xs[1] - xs[0], ys[1] - ys[0], zs[1] - zs[0])
    loc = ((xs[0] + xs[1]) / 2, (ys[0] + ys[1]) / 2, (zs[0] + zs[1]) / 2)
    return soft_box(name, size, r, seg, role, loc, (0, 0, 0), radii, parent)


def pillow(name, size, r, bulge, seg=3, cuts=(4, 4, 2), role='fabric', loc=(0, 0, 0), rot=(0, 0, 0),
           faces='+z', radii=None, parent=None):
    """A soft cushion: a rounded box whose given side(s) bulge out by `bulge` in the middle.
    faces: any of '+x-x+y-y+z-z'. Smooth shaded (it is curved everywhere)."""
    bm, _ = soft_box_bm(size, r, seg, radii, cuts)
    h = [s / 2 for s in size]
    sides = [(faces[i + 1], 1 if faces[i] == '+' else -1) for i in range(0, len(faces), 2)]
    for v in bm.verts:
        p = v.co.copy()
        for ax, sgn in sides:
            a = 'xyz'.index(ax)
            o = [k for k in range(3) if k != a]
            t = 1.0
            for k in o:
                t *= max(0.0, 1 - (p[k] / h[k]) ** 2)
            # only the half of the box on that side moves, more the closer to the side
            w = max(0.0, sgn * p[a] / h[a])
            v.co[a] += sgn * bulge * t * w
    a = bm.faces.layers.int.get('flat')
    if a:
        bm.faces.layers.int.remove(a)
    ob = finish(name, bm, role, shading='smooth', sharp=70)
    return place(ob, loc, rot, parent)


def taper(ob, axis='z', k0=1.0, k1=1.0, scale_axes='xy'):
    """Scale an object's mesh across `scale_axes` linearly from k0 at its low end to k1 at its high end
    along `axis` (mesh coordinates). Normals are recomputed face-area weighted."""
    me = ob.data
    a = 'xyz'.index(axis)
    lo = min(v.co[a] for v in me.vertices)
    hi = max(v.co[a] for v in me.vertices)
    for v in me.vertices:
        t = (v.co[a] - lo) / (hi - lo)
        k = k0 + (k1 - k0) * t
        for ax in scale_axes:
            v.co['xyz'.index(ax)] *= k
    me.update()
    weighted_normals(ob)
    return ob


# ------------------------------------------------------------------ lathe and sweeps


def lathe_bm(profile, seg=24, start=0.0):
    """Revolve [(r, z), ...] around Z. Points with r == 0 become poles. Walk the profile from the bottom
    centre outward and up the outside (then down any inside): the faces then point out of the solid."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        if r <= 1e-9:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * cos(start + 2 * pi * j / seg), r * sin(start + 2 * pi * j / seg), z))
                          for j in range(seg)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(seg):
            j1 = (j + 1) % seg
            if len(a) == 1:
                bm.faces.new((a[0], b[j1], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[j], a[j1], b[0]))
            else:
                bm.faces.new((a[j], a[j1], b[j1], b[j]))
    return bm


def lathe(name, profile, seg=24, role=None, loc=(0, 0, 0), rot=(0, 0, 0), sharp=35, flat=False, start=0.0,
          parent=None):
    bm = lathe_bm(profile, seg, start)
    ob = finish(name, bm, role, shading='flat' if flat else 'smooth', sharp=sharp)
    return place(ob, loc, rot, parent)


def cylinder(name, r, z0, z1, seg=24, role=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, parent=None):
    """A cylinder along local Z from z0 to z1, optionally with chamfered rims."""
    if bevel > 0:
        prof = [(0, z0), (r - bevel, z0), (r, z0 + bevel), (r, z1 - bevel), (r - bevel, z1), (0, z1)]
    else:
        prof = [(0, z0), (r, z0), (r, z1), (0, z1)]
    return lathe(name, prof, seg, role, loc, rot, sharp=50 if bevel else 35, parent=parent)


def rrect_loop(w, h, rc, seg=4):
    """A rounded rectangle as (centre, outward direction) pairs in a (u, v) plane: a point at distance o
    out from its centre lies o out from the core rectangle; o == rc is the rounded outline itself."""
    out = []
    cu, cv = w / 2 - rc, h / 2 - rc
    for (su, sv, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(seg + 1):
            a = radians(a0 + 90 * k / seg)
            out.append(((su * cu, sv * cv), (cos(a), sin(a))))
    return out


def sweep_bm(loop, profile, plane='xz'):
    """Sweep a closed cross-section [(o, a), ...] around a closed loop of (centre, direction) pairs.
    plane 'xz': u -> x, v -> z, a -> -y (toward the front); plane 'xy': u -> x, v -> y, a -> +z."""
    def to3(u, v, a):
        return (u, -a, v) if plane == 'xz' else (u, v, a)
    bm = bmesh.new()
    rows = []
    for (c, d) in loop:
        rows.append([bm.verts.new(to3(c[0] + d[0] * o, c[1] + d[1] * o, a)) for (o, a) in profile])
    n, m = len(rows), len(profile)
    for i in range(n):
        r0, r1 = rows[i], rows[(i + 1) % n]
        for j in range(m):
            j1 = (j + 1) % m
            bm.faces.new((r0[j], r1[j], r1[j1], r0[j1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def frame(name, w, h, rc, profile, role=None, loc=(0, 0, 0), rot=(0, 0, 0), seg=4, plane='xz', sharp=40,
          parent=None):
    """A rounded-rectangle ring (bezel, trim) swept with a closed cross-section [(o, a), ...]."""
    bm = sweep_bm(rrect_loop(w, h, rc, seg), profile, plane)
    ob = finish(name, bm, role, shading='smooth', sharp=sharp)
    return place(ob, loc, rot, parent)


def tube_bm(points, radius, seg=8, closed=False):
    """A round bar along a polyline (handles, rods); open ends are capped flat."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    rings = []
    for i, p in enumerate(pts):
        if closed:
            t = (pts[(i + 1) % len(pts)] - pts[i - 1])
        else:
            t = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        t.normalize()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        x = t.cross(up).normalized()
        y = t.cross(x).normalized()
        ring = []
        for j in range(seg):
            ang = 2 * pi * j / seg
            off = x * cos(ang) * radius + y * sin(ang) * radius
            ring.append(bm.verts.new(p + off))
        rings.append(ring)
    n = len(rings)
    for i in range(n if closed else n - 1):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(seg):
            j1 = (j + 1) % seg
            bm.faces.new((a[j], a[j1], b[j1], b[j]))
    if not closed:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def tube(name, points, radius, seg=8, role=None, closed=False, parent=None):
    bm = tube_bm(points, radius, seg, closed)
    return finish(name, bm, role, shading='smooth', sharp=50, parent=parent)


def text(name, body, size, depth, role=None, loc=(0, 0, 0), rot=(90, 0, 0), resolution=2, bold=0.03, parent=None):
    """Raised letters (the built-in font has Cyrillic), centred, as a mesh. The default rot stands the
    text up facing -Y (the front). bold thickens the strokes (a fraction of the size)."""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.offset = bold * size
    cu.extrude = depth / 2
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = resolution
    tmp = bpy.data.objects.new(name + '_tmp', cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    me.name = name
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, depth / 2))  # the back sits on z = 0
    ob = finish(name, bm, role, shading='flat')
    return place(ob, loc, rot, parent)


# ------------------------------------------------------------------ assembly


def join(obs, name):
    """Join objects into one (keeps materials, normals, transforms baked into the first's space)."""
    obs = [o for o in obs if o]
    bpy.context.view_layer.update()
    base = obs[0]
    with bpy.context.temp_override(active_object=base, object=base, selected_objects=obs,
                                   selected_editable_objects=obs):
        bpy.ops.object.join()
    base.name = name
    base.data.name = name
    return base


def parent_all(obs, parent):
    """Re-parent keeping the world placement."""
    bpy.context.view_layer.update()  # matrix_world of just-placed objects is stale until this
    for o in obs:
        mw = o.matrix_world.copy()
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
        o.matrix_world = mw
    return obs


def tilt_toward(vec_down):
    """Euler that turns local -Z (a leg hanging from its top) toward vec_down."""
    q = Vector((0, 0, -1)).rotation_difference(Vector(vec_down).normalized())
    return q.to_euler()


def leg(name, top, length, r_top, r_bot, splay=(0.0, 0.0), seg=16, role='wood_polished', start=0.0, flat=False,
        foot=None, parent=None):
    """A turned/tapered leg hanging from `top`, its foot moved outward by splay=(dx, dy) per metre of drop.
    foot=(height, radius, role) adds a ferrule/cap at the bottom (a separate object)."""
    d = Vector((splay[0], splay[1], -1.0))
    c = abs(d.normalized().z)
    L = (length - r_bot * math.sqrt(1 - c * c)) / c  # the lowest rim point of the foot just reaches the floor
    prof = [(0, -L), (r_bot, -L), (r_top, 0), (0, 0)]
    ob = lathe(name, prof, seg, role, flat=flat, start=start, sharp=40)
    ob.location = top
    ob.rotation_euler = tilt_toward(d)
    out = [ob]
    if foot:
        fh, fr, frole = foot
        f = lathe(name + '_foot', [(0, -L), (fr * 0.92, -L), (fr, -L + 0.004), (fr * 1.02, -L + fh), (0, -L + fh)],
                  seg, frole, sharp=40)
        f.location = top
        f.rotation_euler = tilt_toward(d)
        out.append(f)
    if parent is not None:
        for o in out:
            o.parent = parent
    return out

