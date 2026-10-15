# Кресло of the 70s: upholstered side panels with polished wooden armrests on top, a loose seat
# cushion, a reclined back cushion, a thin wooden base on four tapered splayed legs. Rust velour.
# 0.72 w x 0.80 d x 0.85 h.
from common import *

W = 0.72
SIDE = 0.085          # side panel thickness
XI = W / 2 - SIDE     # inner face of the side panels
Y0, Y1 = -0.36, 0.33  # body front/back
ZB = 0.205            # top of the wooden base (bottom of the upholstery)
ZA = 0.575            # top of the side panels (armrests sit on them)


def build():
    palette(fabric=(0.20, 0.048, 0.016))
    r = root('armchair')

    # wooden base board and legs
    box('base', (-W / 2 + 0.01, W / 2 - 0.01), (Y0 + 0.01, Y1 - 0.01), (ZB - 0.022, ZB), r=0.006, seg=1,
        role='wood_polished', parent=r)
    legs = []
    for sx in (-1, 1):
        for (y, sy) in ((Y0 + 0.07, -1), (Y1 - 0.07, 1)):
            legs += leg('leg', (sx * (W / 2 - 0.07), y, ZB - 0.02), ZB - 0.02, 0.021, 0.012,
                        splay=(sx * 0.2, sy * 0.2), seg=16, role='wood_polished')
    join(legs, 'legs').parent = r

    # upholstered side panels with armrests on top
    for sx, nm in ((-1, 'L'), (1, 'R')):
        xc = sx * (W / 2 - SIDE / 2)
        pillow(f'side_{nm}', (SIDE, Y1 - Y0, ZA - ZB), r=0.022, bulge=0.006, seg=2, cuts=(1, 4, 3),
               faces='+x-x', loc=(xc, (Y0 + Y1) / 2, (ZA + ZB) / 2), parent=r)
        xa = sx * (W / 2 - 0.045)
        box(f'armrest_{nm}', (xa - 0.045, xa + 0.045), (Y0 - 0.04, Y1 + 0.005), (ZA, ZA + 0.028), seg=2,
            radii={'x': 0.022, 'y': 0.03, 'z': 0.01}, role='wood_polished', parent=r)

    # seat: a firm base and a loose cushion on it
    box('seat_base', (-XI, XI), (Y0 + 0.005, Y1 - 0.02), (ZB, 0.33), r=0.02, seg=2, role='fabric', parent=r)
    pillow('seat_cushion', (2 * XI - 0.004, 0.62, 0.11), r=0.042, bulge=0.016, seg=3, cuts=(4, 4, 2),
           faces='+z-y', loc=(0, -0.075, 0.385), parent=r)
    # back cushion, reclined 13 degrees around its bottom edge
    tilt = radians(13)
    th, hh = 0.14, 0.52
    pivot = Vector((0, 0.205, 0.33))
    centre = pivot + Vector((0, th / 2 * cos(tilt) + hh / 2 * sin(tilt), -th / 2 * sin(tilt) + hh / 2 * cos(tilt)))
    pillow('back_cushion', (2 * XI - 0.004, th, hh), r=0.05, bulge=0.022, seg=3, cuts=(4, 2, 5),
           faces='-y+z', loc=centre, rot=(-13, 0, 0), parent=r)
    # the back of the frame under the back cushion
    box('back_frame', (-XI, XI), (0.24, Y1), (ZB, 0.45), r=0.015, seg=2, role='fabric', parent=r)
    return r
