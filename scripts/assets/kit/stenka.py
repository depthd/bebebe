# One section of a polished стенка: plinth, two doors and two drawers below (gold-anodised handles),
# an open shelf with a collected-works set (cloth spines with gold bands), a cabinet with framed glass
# doors, a mirror back and a glass shelf holding crystal (a cut vase, a bowl, wine glasses and рюмки), антресоль
# doors on top. Dark veneer. 1.00 w x 0.45 d x 2.10 h.
from common import *
import random

W, D, H = 1.00, 0.45, 2.10
T = 0.02                      # board thickness
YF = -D / 2                   # front of the carcass
FT = 0.018                    # front (door/drawer) thickness, they overlay the carcass
GAPS = 0.0025
XI = W / 2 - T                # inner face of the sides

Z_PLINTH = 0.08
Z_DOORS = (0.082, 0.618)
Z_DRAWERS = (0.621, 0.806)
Z_OPEN = (0.828, 1.12)        # open shelf (books)
Z_GLASS = (1.122, 1.818)      # glass doors
Z_SHELF = 1.465               # glass shelf
Z_TOP = (1.821, 2.078)        # антресоль doors


def board(name, xs, ys, zs, r=0.0, parts=None):
    o = box(name, xs, ys, zs, r=r, seg=1, role='wood_polished')
    if parts is not None:
        parts.append(o)
    return o


def bar_handle(name, x, z, length, vertical, parts, y0):
    """A gold bar handle on two posts, standing off a front whose face is at y0."""
    off, th = 0.016, 0.011
    if vertical:
        parts.append(box(name, (x - th / 2, x + th / 2), (y0 - off - 0.009, y0 - off), (z - length / 2, z + length / 2),
                         r=0.0045, seg=1, role='metal_painted'))
        ends = [(x, z - length / 2 + 0.015), (x, z + length / 2 - 0.015)]
    else:
        parts.append(box(name, (x - length / 2, x + length / 2), (y0 - off - 0.009, y0 - off), (z - th / 2, z + th / 2),
                         r=0.0045, seg=1, role='metal_painted'))
        ends = [(x - length / 2 + 0.015, z), (x + length / 2 - 0.015, z)]
    for (px, pz) in ends:
        parts.append(cylinder(name + '_post', 0.0042, 0, off + 0.002, seg=8, role='metal_painted',
                              loc=(px, y0 + 0.001, pz), rot=(90, 0, 0)))


def wine_glass(name, h, rb, foot, seg=12):
    zs = h * 0.42  # top of the stem
    prof = [(0, 0), (foot, 0), (foot, 0.003), (0.009, 0.007), (0.0035, 0.016), (0.0035, zs - 0.006),
            (0.008, zs), (rb * 0.75, zs + (h - zs) * 0.25), (rb, zs + (h - zs) * 0.6), (rb * 0.93, h),
            (rb * 0.93 - 0.0016, h), (rb - 0.0016, zs + (h - zs) * 0.6), (rb * 0.75 - 0.0016, zs + (h - zs) * 0.27),
            (0, zs + 0.006)]
    return lathe(name, prof, seg, 'crystal', sharp=60)


def build():
    palette(metal_painted=dict(color=(0.80, 0.56, 0.22), metal=1.0, rough=0.32),  # gold-anodised aluminium
            fabric=(0.16, 0.025, 0.02),                                           # maroon cloth spines
            metal_chrome=dict(color=(0.28, 0.28, 0.28), metal=1.0, rough=0.04))   # the old, dark mirror
    rnd = random.Random(7)
    r = root('stenka')

    # carcass
    car = []
    for sx in (-1, 1):
        board('side', (sx * W / 2 - (T if sx > 0 else 0), sx * W / 2 + (T if sx < 0 else 0)), (YF, D / 2), (0, 2.08),
              r=0.003, parts=car)
    board('top', (-W / 2 - 0.006, W / 2 + 0.006), (YF - FT - 0.008, D / 2), (2.08, H), r=0.004, parts=car)
    board('plinth', (-XI, XI), (YF + 0.04, D / 2 - 0.02), (0, Z_PLINTH), parts=car)
    board('bottom', (-XI, XI), (YF, D / 2 - 0.015), (Z_PLINTH, Z_PLINTH + T), parts=car)
    for z in (0.61, 0.806, 1.12, 1.80):
        board('divider', (-XI, XI), (YF, D / 2 - 0.015), (z, z + T), r=0.002, parts=car)
    board('back', (-XI, XI), (D / 2 - 0.015, D / 2), (Z_PLINTH + T, 2.08), parts=car)
    join(car, 'carcass').parent = r

    # fronts: doors, drawers, антресоль; the glass doors are framed
    fronts, handles = [], []
    yfr = (YF - FT, YF)
    for sx in (-1, 1):
        xs = tuple(sorted((sx * GAPS / 2, sx * (W / 2 - 0.003))))
        board('door', xs, yfr, Z_DOORS, r=0.003, parts=fronts)
        board('drawer', xs, yfr, Z_DRAWERS, r=0.003, parts=fronts)
        board('top_door', xs, yfr, Z_TOP, r=0.003, parts=fronts)
        bar_handle('door_handle', sx * 0.045, Z_DOORS[1] - 0.12, 0.13, True, handles, YF - FT)
        bar_handle('drawer_handle', sx * W / 4, sum(Z_DRAWERS) / 2, 0.13, False, handles, YF - FT)
        bar_handle('top_handle', sx * 0.045, Z_TOP[0] + 0.07, 0.08, True, handles, YF - FT)
        bar_handle('glass_handle', sx * 0.027, Z_SHELF, 0.08, True, handles, YF - FT)
        # glass door: a frame of four bars and a pane
        fw = 0.05
        x0, x1 = xs
        z0, z1 = Z_GLASS
        board('glass_door', (x0, x0 + fw), yfr, (z0, z1), r=0.003, parts=fronts)
        board('glass_door', (x1 - fw, x1), yfr, (z0, z1), r=0.003, parts=fronts)
        board('glass_door', (x0 + fw, x1 - fw), yfr, (z0, z0 + fw), r=0.003, parts=fronts)
        board('glass_door', (x0 + fw, x1 - fw), yfr, (z1 - fw, z1), r=0.003, parts=fronts)
        box('glass_pane_' + ('L' if sx < 0 else 'R'), (x0 + fw - 0.006, x1 - fw + 0.006), (YF - FT / 2 - 0.002, YF - FT / 2 + 0.002),
            (z0 + fw - 0.006, z1 - fw + 0.006), role='glass', parent=r)
    join(fronts, 'fronts').parent = r
    join(handles, 'handles').parent = r
    # the mirror at the back of the glass cabinet, as in every сервант
    box('mirror_back', (-XI, XI), (D / 2 - 0.019, D / 2 - 0.015), (1.14, 1.80), role='metal_chrome', parent=r)
    box('glass_shelf', (-XI + 0.004, XI - 0.004), (YF + 0.03, D / 2 - 0.02), (Z_SHELF, Z_SHELF + 0.006), r=0.001,
        seg=1, role='glass', parent=r)

    # books: a collected-works set and a few odd volumes, a lying stack on the right
    books, bands = [], []
    x = -XI + 0.008
    z0 = Z_OPEN[0]
    yspine = YF + 0.03
    for i in range(17):
        odd = i >= 13
        w = rnd.uniform(0.026, 0.034) if not odd else rnd.uniform(0.02, 0.045)
        h = 0.205 if not odd else rnd.uniform(0.215, 0.25)
        d = 0.14 if not odd else rnd.uniform(0.15, 0.17)
        ys = yspine + rnd.uniform(-0.004, 0.006)
        books.append(box('book', (x, x + w), (ys, ys + d), (z0, z0 + h), seg=1,
                         radii={'x': 0.0025, '-y': 0.0025, '+y': 0, 'z': 0}, role='fabric'))
        if not odd or i % 2:
            for zb in (z0 + h - 0.035, z0 + h - 0.05) if not odd else (z0 + h - 0.04,):
                bands.append(box('book_band', (x + 0.003, x + w - 0.003), (ys - 0.0012, ys + 0.002),
                                 (zb, zb + 0.005), role='metal_painted'))
        x += w + 0.0015
    zz = z0
    for k, (w, d, t) in enumerate(((0.23, 0.16, 0.035), (0.21, 0.15, 0.03), (0.2, 0.14, 0.04))):
        xc = XI - 0.14 + rnd.uniform(-0.006, 0.006)
        books.append(box('book', (xc - w / 2, xc + w / 2), (yspine + 0.005, yspine + 0.005 + d), (zz, zz + t),
                         role='fabric'))
        zz += t
    join(books, 'books').parent = r
    join(bands, 'book_bands').parent = r

    # crystal: a cut vase, a bowl and two wine glasses below; wine glasses and рюмки on the glass shelf
    zc = 1.14  # top of the divider under the glass doors
    vase = [(0, 0), (0.042, 0), (0.042, 0.012), (0.03, 0.03), (0.06, 0.1), (0.066, 0.15), (0.048, 0.23),
            (0.058, 0.27), (0.052, 0.27), (0.042, 0.23), (0.06, 0.15), (0.054, 0.1), (0.024, 0.04), (0, 0.04)]
    lathe('crystal_vase', vase, 10, 'crystal', loc=(-0.3, 0.0, zc), flat=True, start=radians(18), parent=r)
    bowl = [(0, 0), (0.045, 0), (0.045, 0.012), (0.03, 0.02), (0.09, 0.07), (0.11, 0.09), (0.105, 0.09),
            (0.085, 0.07), (0.028, 0.03), (0, 0.03)]
    lathe('crystal_bowl', bowl, 12, 'crystal', loc=(0.02, 0.01, zc), flat=True, parent=r)
    glasses = []
    for (x, y) in ((0.24, -0.05), (0.34, 0.03)):
        g = wine_glass('wine_glass', 0.19, 0.04, 0.034)
        g.location = (x, y, zc)
        glasses.append(g)
    zs = Z_SHELF + 0.006
    for i, x in enumerate((-0.33, -0.18, -0.03, 0.12, 0.27)):
        tall = i % 2 == 0
        g = wine_glass('glass', 0.17 if tall else 0.11, 0.036 if tall else 0.026, 0.03 if tall else 0.024)
        g.location = (x, 0.04 if tall else -0.06, zs)
        glasses.append(g)
    join(glasses, 'crystal_glasses').parent = r
    return r
