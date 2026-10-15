# Кухонная табуретка: a square seat with a hand slot, four slightly splayed square legs, an apron
# (царги) under the seat and stretchers (проножки) low down. Light lacquered wood. 0.32 x 0.32 x 0.45.
from common import *

W = 0.32          # seat side
H = 0.45          # height to the top of the seat
T = 0.028         # seat thickness
LEG = 0.038       # leg section at the top
LEG_BOT = 0.031
AT = 0.12         # leg centre from the middle, at the top
SPLAY = 0.07      # outward per metre of drop


def leg_at(z):
    return AT + (H - T - z) * SPLAY


def build():
    palette(wood=(0.42, 0.24, 0.10))
    root_ = root('stool')
    zs = H - T
    seat = box('seat', (-W / 2, W / 2), (-W / 2, W / 2), (zs, H), seg=2,
               radii={'x': 0.022, 'y': 0.022, 'z': 0.007}, role='wood', parent=root_)
    slot = soft_box('slot_cutter', (0.11, 0.032, 0.1), seg=3, radii={'x': 0.016, 'y': 0.016, 'z': 0},
                    loc=(0, 0, zs + T / 2))
    subtract(seat, slot)

    legs = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            legs += leg(f'leg', (sx * AT, sy * AT, zs + 0.001), zs + 0.001, LEG / 2 * 2 ** 0.5,
                        LEG_BOT / 2 * 2 ** 0.5, splay=(sx * SPLAY, sy * SPLAY), seg=4, start=radians(45),
                        role='wood')
    legs = join(legs, 'legs')
    legs.parent = root_

    parts = []
    # apron boards just under the seat, set back a little from the legs' outer faces
    za = (zs - 0.06, zs)
    off = AT + LEG / 2 - 0.006 - 0.009
    for s in (-1, 1):
        parts.append(box('apron', (-AT, AT), (s * off - 0.009, s * off + 0.009), za, r=0.003, seg=1, role='wood'))
        parts.append(box('apron', (s * off - 0.009, s * off + 0.009), (-AT, AT), za, r=0.003, seg=1, role='wood'))
    apron = join(parts, 'apron')
    apron.parent = root_

    parts = []
    for s in (-1, 1):
        z0 = 0.11
        o = leg_at(z0 + 0.014)
        parts.append(box('stretcher', (-o, o), (s * o - 0.009, s * o + 0.009), (z0, z0 + 0.028), r=0.004, seg=1,
                         role='wood'))
        z1 = 0.16
        o = leg_at(z1 + 0.014)
        parts.append(box('stretcher', (s * o - 0.009, s * o + 0.009), (-o, o), (z1, z1 + 0.028), r=0.004, seg=1,
                         role='wood'))
    st = join(parts, 'stretchers')
    st.parent = root_
    return root_
