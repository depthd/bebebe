# Ламповый телевизор (Рубин / Горизонт): a polished veneer case with a raised front frame, a black
# front panel with the bulging CRT on the left and a silver control strip on the right (channel
# selector, knobs, speaker grille), a tapered back cover over the tube, on a four-legged stand.
# The CRT is its own mesh and material, both "screen", mapped 0..1 across the picture (the game
# draws there). Case 0.70 x 0.53 x 0.52, total height 0.95.
from common import *

ZC0, ZC1 = 0.43, 0.95      # case bottom/top
ZM = (ZC0 + ZC1) / 2
YF = -0.17                 # front of the case body (the frame stands 0.03 proud of it)
SCR_X, SCR_W, SCR_H, SCR_R = -0.072, 0.44, 0.335, 0.05


def screen(parent):
    """The CRT: a rounded rectangle domed toward the viewer, closed at the back, planar UVs."""
    loop = rrect_loop(SCR_W, SCR_H, SCR_R, seg=5)
    K, bulge, a0 = 7, 0.022, 0.006
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    pts2 = [(c[0] + d[0] * SCR_R, c[1] + d[1] * SCR_R) for c, d in loop]
    rings = []
    for k in range(1, K + 1):
        s = k / K
        a = a0 + bulge * (1 - s * s)
        rings.append([bm.verts.new((s * u, -a, s * v)) for u, v in pts2])
    centre = bm.verts.new((0, -(a0 + bulge), 0))
    back = [bm.verts.new((u, 0.0, v)) for u, v in pts2]
    n = len(pts2)
    faces = []
    for j in range(n):
        faces.append(bm.faces.new((centre, rings[0][(j + 1) % n], rings[0][j])))
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            j1 = (j + 1) % n
            faces.append(bm.faces.new((a[j], a[j1], b[j1], b[j])))
    side = []
    for j in range(n):
        j1 = (j + 1) % n
        side.append(bm.faces.new((rings[-1][j], rings[-1][j1], back[j1], back[j])))
    cap = bm.faces.new(list(reversed(back)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        for lp in f.loops:
            lp[uv].uv = (lp.vert.co.x / SCR_W + 0.5, lp.vert.co.z / SCR_H + 0.5)
    ob = finish('screen', bm, 'screen', shading='smooth', sharp=30)
    ob['keep_uv'] = True
    return place(ob, (SCR_X, YF - 0.005, ZM + 0.012), parent=parent)


def knob(name, r, depth, cap_r, loc, parent, seg=20):
    """A round knob on the front: black body with a skirt and a chrome face."""
    body = lathe(name, [(0, 0), (r * 1.12, 0), (r * 1.12, depth * 0.22), (r, depth * 0.3), (r * 0.94, depth),
                        (0, depth)], seg, 'plastic_black', loc=loc, rot=(90, 0, 0), sharp=40, parent=parent)
    lathe(name + '_cap', [(0, depth - 0.002), (cap_r, depth - 0.002), (cap_r, depth + 0.0015), (0, depth + 0.0015)],
          seg, 'metal_chrome', loc=loc, rot=(90, 0, 0), sharp=40, parent=parent)
    # a pointer ridge
    box(name + '_mark', (-0.0015, 0.0015), (-depth - 0.002, -depth * 0.35), (r * 0.25, r * 0.95), role='plastic_black',
        parent=parent).location += Vector(loc)
    return body


def build():
    palette(metal_painted=dict(color=(0.50, 0.50, 0.48), metal=1.0, rough=0.38))
    r = root('tv')

    # stand: a board on four splayed legs with chrome ferrules
    box('stand_top', (-0.30, 0.30), (-0.165, 0.175), (ZC0 - 0.026, ZC0), r=0.006, seg=1, role='wood_polished',
        parent=r)
    legs = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            legs += leg('stand_leg', (sx * 0.25, 0.005 + sy * 0.125, ZC0 - 0.02), ZC0 - 0.02, 0.017, 0.010,
                        splay=(sx * 0.13, sy * 0.13), seg=14, foot=(0.035, 0.0118, 'metal_chrome'))
    feet = [o for o in legs if o.name.startswith('stand_leg_foot')]
    join([o for o in legs if o not in feet], 'stand_legs').parent = r
    join(feet, 'stand_feet').parent = r

    # the case: body, raised front frame, black front panel, tapered back cover
    box('case', (-0.35, 0.35), (YF, 0.20), (ZC0, ZC1), seg=2, radii={'x': 0.03, 'z': 0.03, '+y': 0.012, '-y': 0},
        role='wood_polished', parent=r)
    prof = [(0.002, 0), (0.03, 0), (0.03, 0.022), (0.0285, 0.0275), (0.025, 0.03), (0.0065, 0.03),
            (0.0035, 0.0285), (0.002, 0.025)]
    frame('case_frame', 0.70, 0.52, 0.03, prof, 'wood_polished', loc=(0, YF, ZM), seg=4, sharp=50, parent=r)
    box('front_panel', (-0.323, 0.323), (YF - 0.005, YF), (ZC0 + 0.027, ZC1 - 0.027), role='plastic_black',
        parent=r)
    back = box('back_cover', (-0.30, 0.30), (0.20, 0.33), (ZM - 0.215, ZM + 0.215), r=0.02, seg=2,
               role='plastic_black', parent=r)
    taper(back, 'y', 1.0, 0.62, 'xz')

    # CRT and its silver bezel
    screen(r)
    bez = [(SCR_R - 0.004, 0), (SCR_R + 0.02, 0), (SCR_R + 0.02, 0.006), (SCR_R + 0.016, 0.0115),
           (SCR_R + 0.002, 0.0115), (SCR_R - 0.004, 0.007)]
    frame('screen_bezel', SCR_W, SCR_H, SCR_R, bez, 'metal_painted', loc=(SCR_X, YF - 0.005, ZM + 0.012), seg=5,
          sharp=50, parent=r)
    text('nameplate', 'РУБИН', 0.024, 0.002, 'metal_chrome', loc=(SCR_X, YF - 0.005, ZC0 + 0.05), parent=r)

    # control strip: channel selector, four knobs, speaker grille
    x0, x1 = 0.188, 0.312
    xm = (x0 + x1) / 2
    yS = YF - 0.011
    box('control_strip', (x0, x1), (yS, YF - 0.005), (ZC0 + 0.04, ZC1 - 0.04), r=0.003, seg=1,
        role='metal_painted', parent=r)
    knob('channel_knob', 0.03, 0.032, 0.017, (xm, yS, ZC1 - 0.11), r, seg=24)
    for i, z in enumerate((ZC1 - 0.205, ZC1 - 0.265)):
        for j, x in enumerate((xm - 0.031, xm + 0.031)):
            knob(f'knob', 0.0145, 0.02, 0.0085, (x, yS, z), r, seg=16)
    kids = [o for o in r.children if o.name.startswith(('channel_knob', 'knob'))]
    caps = [o for o in kids if '_cap' in o.name]
    bodies = [o for o in kids if o not in caps]
    join(bodies, 'knobs').parent = r
    join(caps, 'knob_caps').parent = r
    gz0, gz1 = ZC0 + 0.06, ZC0 + 0.215
    box('grille_back', (x0 + 0.01, x1 - 0.01), (yS - 0.002, yS + 0.001), (gz0, gz1), r=0.002, seg=1,
        role='plastic_black', parent=r)
    bars = []
    n = 11
    for i in range(n):
        z = gz0 + 0.008 + (gz1 - gz0 - 0.016) * i / (n - 1)
        bars.append(box('grille_bar', (x0 + 0.012, x1 - 0.012), (yS - 0.005, yS - 0.002), (z - 0.0035, z + 0.0035),
                        r=0.0015, seg=1, role='metal_painted'))
    join(bars, 'grille_bars').parent = r
    return r
