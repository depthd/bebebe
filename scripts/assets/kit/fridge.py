# Холодильник ЗИЛ-Москва: a white enamel body rounded everywhere (big radius over the top), the door
# cut from the same rounded shape with a rubber seal in the seam, a chrome lever handle, the chrome
# trim strip with the ЗИЛ badge (chrome letters on a white field), a dark recessed plinth.
# 0.60 x 1.50 x 0.60 (+ the handle). The door is its own object hinged on the left edge (origin on
# the hinge axis), so the game can swing it.
from common import *

W, D, H = 0.60, 0.60, 1.50
ZP = 0.075                    # plinth height
YD = -D / 2 + 0.065           # door / body seam
GAP = 0.005
INSET = 0.003               # the door is a little smaller than the body all round


def build():
    palette(metal_painted=(0.03, 0.03, 0.032))
    r = root('fridge')
    box('plinth', (-W / 2 + 0.035, W / 2 - 0.035), (-D / 2 + 0.05, D / 2 - 0.02), (0, ZP + 0.02), r=0.008, seg=1,
        role='metal_painted', parent=r)

    # one rounded shell, split into the body and the door
    size = (W, D, H - ZP)
    radii = {'x': 0.055, 'y': 0.055, '+z': 0.13, '-z': 0.02}
    bm, nfn = soft_box_bm(size, seg=4, radii=radii)
    zc = ZP + size[2] / 2
    ys = YD  # seam in world y; the shell is centred at y = 0
    door_bm = bm.copy()
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, ys, 0), plane_no=(0, 1, 0), clear_inner=True)
    geom = door_bm.verts[:] + door_bm.edges[:] + door_bm.faces[:]
    bmesh.ops.bisect_plane(door_bm, geom=geom, plane_co=(0, ys, 0), plane_no=(0, 1, 0), clear_outer=True)
    for b in (bm, door_bm):
        tag = b.faces.layers.int.get('flat')
        res = bmesh.ops.holes_fill(b, edges=b.edges[:], sides=0)
        for f in res['faces']:
            f[tag] = 1
    body = finish_soft('body', bm, nfn, 'enamel')
    place(body, (0, 0, zc), parent=r)
    # the door: its origin sits on the hinge axis (left front edge), the mesh is moved to match
    hinge = Vector((-W / 2 + 0.015, ys - GAP, zc))
    t = Vector((0, -GAP, zc)) - hinge
    kx, kz = (W - 2 * INSET) / W, (size[2] - 2 * INSET) / size[2]
    for v in door_bm.verts:
        v.co.x *= kx
        v.co.z *= kz
    bmesh.ops.translate(door_bm, verts=door_bm.verts[:], vec=t)

    def door_normal(p):
        q = p - t
        return nfn(Vector((q.x / kx, q.y, q.z / kz)))
    door = finish_soft('door', door_bm, door_normal, 'enamel')
    place(door, hinge, parent=r)

    # rubber seal in the seam, just inside the outline
    prof = [(0.11 - 0.012, 0), (0.11, 0), (0.11, GAP + 0.001), (0.11 - 0.012, GAP + 0.001)]
    frame('door_seal', W - 0.012, H - ZP - 0.012, 0.11, prof, 'rubber', loc=(0, ys, zc), seg=6, parent=r)

    # chrome trim strip across the upper door with the ЗИЛ badge in the middle
    yf = -D / 2 - GAP              # front face of the door
    zt = H - 0.27
    box('trim_strip', (-W / 2 + 0.06, W / 2 - 0.06), (yf - 0.007, yf + 0.002), (zt - 0.011, zt + 0.011), seg=2,
        radii={'x': 0.004, 'z': 0.004, 'y': 0.003}, role='metal_chrome', parent=r)
    box('badge_rim', (-0.09, 0.09), (yf - 0.010, yf + 0.001), (zt - 0.036, zt + 0.036), seg=2,
        radii={'x': 0.02, 'z': 0.02, 'y': 0.004}, role='metal_chrome', parent=r)
    box('badge', (-0.082, 0.082), (yf - 0.013, yf + 0.002), (zt - 0.028, zt + 0.028), seg=2,
        radii={'x': 0.014, 'z': 0.014, 'y': 0.003}, role='enamel', parent=r)
    text('badge_letters', 'ЗИЛ', 0.056, 0.004, 'metal_chrome', loc=(0, yf - 0.013, zt - 0.004), bold=0.05, parent=r)

    # the lever handle on the right: an escutcheon plate and a lever bar standing off the door
    xh, zh = W / 2 - 0.075, 1.0
    box('handle_plate', (xh - 0.026, xh + 0.026), (yf - 0.007, yf + 0.002), (zh - 0.13, zh + 0.13), seg=3,
        radii={'x': 0.024, 'z': 0.024, 'y': 0.004}, role='metal_chrome', parent=r)
    pts = [(xh, yf - 0.006, zh + 0.10), (xh, yf - 0.03, zh + 0.09), (xh, yf - 0.052, zh + 0.05),
           (xh, yf - 0.058, zh - 0.01), (xh, yf - 0.054, zh - 0.08), (xh, yf - 0.04, zh - 0.125),
           (xh, yf - 0.03, zh - 0.15)]
    tube('handle_lever', pts, 0.0135, seg=14, role='metal_chrome', parent=r)

    # the door carries what is mounted on it
    parent_all([o for o in r.children if o.name.startswith(('trim_strip', 'badge', 'handle'))], door)
    return r
