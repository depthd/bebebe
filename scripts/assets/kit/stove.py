# Газовая плита (Брест / Гефест): white enamel, four burners (aluminium rings with black caps) under
# two black cast grates, a row of black knobs over the oven, a black oven door with a framed window and a
# chrome handle, a storage drawer and a dark plinth, the hinged enamel lid standing up at the back (its
# own object, origin on the hinge axis). 0.50 x 0.60 x 0.85, the lid adds 0.52 on top.
from common import *

W, D, H = 0.50, 0.60, 0.85
YF = -D / 2 + 0.02          # front of the body (the cooktop overhangs it a little)
ZT = H                      # cooktop surface
BURNERS = [(-0.115, -0.13, 0.044), (0.115, -0.13, 0.036), (-0.115, 0.14, 0.036), (0.115, 0.14, 0.029)]


def build():
    palette(metal_painted=dict(color=(0.018, 0.018, 0.02), rough=0.28))
    r = root('stove')

    box('plinth', (-W / 2 + 0.015, W / 2 - 0.015), (YF + 0.03, D / 2 - 0.02), (0, 0.05), role='metal_painted',
        parent=r)
    box('body', (-W / 2, W / 2), (YF, D / 2), (0.045, ZT - 0.016), seg=2, radii={'x': 0.012, 'y': 0.012, 'z': 0},
        role='enamel', parent=r)
    box('cooktop', (-W / 2, W / 2), (-D / 2, D / 2), (ZT - 0.018, ZT), seg=2,
        radii={'x': 0.014, 'y': 0.014, '+z': 0.006, '-z': 0}, role='enamel', parent=r)

    # knobs: chrome rings behind black knobs with a grip fin
    knobs, rings = [], []
    zk = 0.775
    for i in range(5):
        x = -0.18 + 0.09 * i
        rings.append(cylinder('knob_ring', 0.024, 0, 0.003, seg=20, role='metal_chrome', loc=(x, YF, zk),
                              rot=(90, 0, 0), bevel=0.001))
        knobs.append(lathe('knob', [(0, 0), (0.0205, 0), (0.0205, 0.004), (0.019, 0.016), (0.017, 0.019), (0, 0.019)],
                           20, 'plastic_black', loc=(x, YF - 0.003, zk), rot=(90, 0, 0), sharp=40))
        knobs.append(box('knob_fin', (x - 0.004, x + 0.004), (YF - 0.036, YF - 0.018), (zk - 0.017, zk + 0.017),
                         r=0.0035, seg=1, role='plastic_black'))
    join(knobs, 'knobs').parent = r
    join(rings, 'knob_rings').parent = r

    # oven door with a framed window and a chrome handle; the storage drawer under it
    yd = YF - 0.02
    box('oven_door', (-W / 2 + 0.01, W / 2 - 0.01), (yd, YF), (0.205, 0.715), r=0.006, seg=2, role='metal_painted',
        parent=r)
    ww, wh, wz = 0.30, 0.22, 0.425
    box('oven_window', (-ww / 2, ww / 2), (yd - 0.003, yd + 0.002), (wz - wh / 2, wz + wh / 2), seg=2,
        radii={'x': 0.02, 'z': 0.02, 'y': 0.0}, role='glass', parent=r)
    prof = [(0.018, 0), (0.026, 0), (0.026, 0.002), (0.023, 0.0045), (0.019, 0.0045), (0.018, 0.003)]
    frame('oven_window_frame', ww, wh, 0.02, prof, 'metal_chrome', loc=(0, yd, wz), seg=4, parent=r)
    text('brand', 'БРЕСТ', 0.026, 0.0015, 'metal_chrome', loc=(0, yd, 0.59), parent=r)
    zh, xh, so = 0.675, 0.19, 0.032
    pts = [(-xh, yd + 0.002, zh), (-xh, yd - so + 0.012, zh), (-xh + 0.006, yd - so + 0.003, zh),
           (-xh + 0.018, yd - so, zh), (xh - 0.018, yd - so, zh), (xh - 0.006, yd - so + 0.003, zh),
           (xh, yd - so + 0.012, zh), (xh, yd + 0.002, zh)]
    tube('oven_handle', pts, 0.0075, seg=12, role='metal_chrome', parent=r)
    box('drawer', (-W / 2 + 0.01, W / 2 - 0.01), (YF - 0.016, YF), (0.055, 0.195), r=0.004, seg=1, role='enamel',
        parent=r)
    pts = [(-0.06, YF - 0.014, 0.17), (-0.06, YF - 0.03, 0.17), (0.06, YF - 0.03, 0.17), (0.06, YF - 0.014, 0.17)]
    tube('drawer_handle', pts, 0.005, seg=10, role='metal_chrome', parent=r)

    # burners: aluminium spreader rings with black caps
    rings, caps = [], []
    for (x, y, rr) in BURNERS:
        rings.append(lathe('burner', [(0, 0), (rr + 0.008, 0), (rr + 0.008, 0.004), (rr + 0.002, 0.011), (rr, 0.017),
                                      (0, 0.017)], 24, 'metal_chrome', loc=(x, y, ZT), sharp=40))
        caps.append(lathe('burner_cap', [(0, 0.016), (rr * 0.86, 0.016), (rr * 0.86, 0.021), (rr * 0.6, 0.026),
                                         (0, 0.027)], 24, 'plastic_black', loc=(x, y, ZT), sharp=40))
    join(rings, 'burners').parent = r
    join(caps, 'burner_caps').parent = r

    # two cast grates: a frame, a middle bar and four raised fingers around each burner
    bars = []
    bw, zf, zr = 0.012, ZT + 0.014, ZT + 0.024
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.006, sx * (W / 2 - 0.008)))
        y0, y1 = -D / 2 + 0.012, D / 2 - 0.012
        bars += [box('grate', (x0, x0 + bw), (y0, y1), (ZT, zf), role='metal_painted'),
                 box('grate', (x1 - bw, x1), (y0, y1), (ZT, zf), role='metal_painted'),
                 box('grate', (x0, x1), (y0, y0 + bw), (ZT, zf), role='metal_painted'),
                 box('grate', (x0, x1), (y1 - bw, y1), (ZT, zf), role='metal_painted'),
                 box('grate', (x0, x1), (-bw / 2 + 0.005, bw / 2 + 0.005), (ZT, zf), role='metal_painted')]
        for (bx, by, rr) in BURNERS:
            if (bx > 0) != (sx > 0):
                continue
            g = rr + 0.012
            yin0 = y0 if by < 0 else 0.005 + bw / 2
            yin1 = -bw / 2 + 0.005 if by < 0 else y1
            bars += [box('finger', (x0 + bw / 2, bx - g), (by - 0.004, by + 0.004), (ZT + 0.004, zr), role='metal_painted'),
                     box('finger', (bx + g, x1 - bw / 2), (by - 0.004, by + 0.004), (ZT + 0.004, zr), role='metal_painted'),
                     box('finger', (bx - 0.004, bx + 0.004), (yin0 + bw / 2, by - g), (ZT + 0.004, zr), role='metal_painted'),
                     box('finger', (bx - 0.004, bx + 0.004), (by + g, yin1 - bw / 2), (ZT + 0.004, zr), role='metal_painted')]
    join(bars, 'grates').parent = r

    # the lid, hinged at the back edge and standing up, leaning back a little
    zl = zr + 0.002
    hinge = (0, D / 2 - 0.004, zl)
    lid = box('lid', (-W / 2, W / 2), (-0.52, 0), (0, 0.012), seg=2, radii={'x': 0.014, 'y': 0.014, 'z': 0.004},
              role='enamel')
    lid.location = Vector(lid.location) + Vector(hinge)
    bpy.context.view_layer.update()
    # move the lid's origin onto the hinge, then swing it up
    me = lid.data
    me.transform(Matrix.Translation(Vector(lid.location) - Vector(hinge)))
    lid.location = hinge
    lid.rotation_euler = (radians(-94), 0, 0)
    lid.parent = r
    hinges = [cylinder('lid_hinge', 0.007, -0.025, 0.025, seg=12, role='metal_chrome', loc=(sx * 0.19, hinge[1], zl),
                       rot=(0, 90, 0)) for sx in (-1, 1)]
    join(hinges, 'lid_hinges').parent = r
    return r
