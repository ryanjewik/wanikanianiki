#!/usr/bin/env python3
"""Crabigator — traced directly off the reference in aligned coordinates.

The reference photo was scaled so its head lands exactly on this canvas's head
(x 188-533, y 124-498) and saved as preview/ref_aligned.png. Every coordinate
below was then read straight off that image, so there is no chain of scale
maths to get wrong.

The structural thing the earlier versions kept missing: the reference is ONE
big mid-grey silhouette. The belly bands and the three leg blobs are not
separate objects sitting beside it — they are drawn ON it, same fill, so only
their outlines show, and they only break the silhouette where they stick out.
The light pieces (head, pincer, boulder, shoulder plate) sit on top, flat, with
no shading at all.
"""
from ink import wob, wobo

BK = "#1A1A1A"
RED, RED_D, RED_L = "#EE3B2B", "#C0281C", "#FB8B7B"
GRN = "#8CC63E"
GY_L, GY_M, GY_D = "#F4F4F4", "#C9C9C9", "#ADADAD"

OUT = 15
OFF = (4.5, 5.5)


def block(paths, fill, amp=None):
    w = [wob(d) if amp is None else wob(d, amp) for d in paths]
    tf = f' transform="translate({OFF[0]} {OFF[1]})"'
    o = [f'<path d="{d}"{tf} fill="{BK}" stroke="{BK}" stroke-width="{2*OUT}"/>'
         for d in w]
    o += [f'<path d="{d}" fill="{fill}"/>' for d in w]
    return "".join(o)


def facet(d, fill):
    return f'<path d="{wob(d)}" fill="{fill}"/>'


def edge(d, w=17):
    return (f'<path d="{wobo(d)}" fill="none" stroke="{BK}" stroke-width="{w}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')


def G(gid, body):
    return (f'<g id="{gid}" stroke-linejoin="round" stroke-linecap="round">'
            + body + '</g>')


def P(pts):
    return "M " + " L ".join(f"{x:.0f} {y:.0f}" for x, y in pts) + " Z"


def PL(pts):
    return "M " + " L ".join(f"{x:.0f} {y:.0f}" for x, y in pts)


# ============================================================ body silhouette
# A crab shell, not a lobster: the top is a broad DOME that peaks between the
# head and the pincer, and the head sits part way UP it rather than perching on
# a flat back. Underside is lifted so the legs carry the body.
BODY = P([(154, 546), (180, 480), (228, 436), (302, 412), (378, 402),
          (442, 384), (492, 340), (548, 316), (614, 324), (682, 356),
          (748, 410), (806, 480), (850, 558), (874, 640), (876, 716),
          (858, 772), (806, 800), (748, 772), (690, 736), (628, 700),
          (560, 672), (492, 660), (430, 662), (378, 684), (330, 716),
          (286, 742), (240, 720), (196, 668), (166, 608)])
BODY_SHD = P([(806, 480), (850, 558), (874, 640), (876, 716), (858, 772),
              (806, 800), (748, 772), (776, 690), (796, 584)])
BODY_EDGES = [
    PL([(796, 584), (776, 690), (748, 772)]),        # far plane break
    PL([(492, 340), (508, 424), (500, 504)]),        # socket beside the jaw
    PL([(442, 384), (452, 452), (440, 522)]),
    PL([(200, 496), (218, 520), (202, 540), (220, 562)]),   # shoulder zig-zag
    PL([(614, 324), (606, 400), (628, 470)]),
    PL([(748, 410), (726, 480), (742, 552)]),
    PL([(560, 696), (566, 630), (546, 566)]),
]

# ---- legs. Not eyeballed this time: I isolated the circled leg in the
# aligned reference as a connected component, dilated by half the ink weight
# and ran Douglas-Peucker on its contour. It falls out at exactly NINE
# vertices, 193 x 167, and the defining feature is the step up at the bottom
# left — that step is what opens the white wedge under the front leg.
# Instanced three times; the ones behind are squashed in x, not uniformly
# scaled, because in the photo the rear legs are seen more edge-on.
_LEG_T = [(4, 29), (0, 116), (72, 124), (99, 167), (193, 162), (184, 114),
          (138, 95), (109, 29), (36, 0)]


def refleg(x, y, sx, sy):
    return P([(x + px * sx, y + py * sy) for px, py in _LEG_T])


LEGS = [refleg(662, 624, 0.58, 0.96),   # far   -> 112 x 160
        refleg(567, 630, 0.72, 1.02),   # middle-> 139 x 170
        refleg(465, 636, 1.00, 1.00)]   # near  -> 193 x 167, drawn last
GROUND = PL([(300, 824), (450, 816), (610, 820), (760, 814), (890, 818)])

# ---- belly bands, also drawn ON the body: right ends ride higher
def _bound(xl, xr, y, sag=10, rise=34):
    return [(xl, y), ((xl + xr) / 2, y + sag), (xr, y - rise)]


_ROWS = [_bound(*r) for r in [(246, 458, 486), (250, 456, 528), (258, 452, 570),
                              (270, 448, 612), (288, 444, 652), (310, 440, 692)]]
BANDS = [P(_ROWS[i] + list(reversed(_ROWS[i + 1]))) for i in range(5)]
BANDS_EDGES = [PL(_ROWS[i]) for i in range(1, 5)]
BELLY_CREASE = PL([r[2] for r in _ROWS])

# ============================================================ pincer
# Short steep left wall, a jog part-way down the finger, then a long shallow
# right wall up to the forearm — the notch apex sits low and left.
CLAW = P([(563, 293), (592, 268), (652, 262), (663, 285),
          (650, 330), (632, 352), (640, 385), (650, 402),      # jog + apex
          (690, 356), (730, 341), (760, 333), (773, 318),      # shallow wall
          (769, 285), (773, 261), (791, 249), (821, 244), (846, 262),
          (863, 300), (869, 350), (858, 391), (830, 441), (791, 491),
          (773, 521),                                          # forearm
          (740, 524), (640, 530), (556, 535), (516, 520),
          (505, 470), (509, 430), (523, 400), (545, 340)])
CLAW_EDGE = PL([(648, 476), (700, 470), (738, 450), (778, 436)])

# ============================================================ boulder
PLATE_L = P([(105, 553), (215, 540), (232, 578), (120, 592)])
FIST_L = P([(120, 592), (95, 620), (80, 662), (85, 722), (112, 772),
            (162, 806), (232, 816), (302, 800), (348, 770), (366, 730),
            (330, 662), (298, 630), (254, 600), (232, 578)])
FIST_L_EDGE = PL([(176, 640), (186, 692), (202, 716), (330, 702), (354, 690)])

# ============================================================ head
HS, HDX, HDY = 1.241, -174.0, 0.0
HEAD_TF = f"translate({HDX} {HDY}) scale({HS})"
HEAD = P([(300, 348), (292, 232), (306, 156), (336, 116), (392, 100),
          (416, 112), (450, 180), (486, 100), (536, 112), (566, 180),
          (570, 300), (548, 358), (500, 392), (400, 402), (336, 384)])
EYE_L = P([(330, 164), (356, 152), (380, 170), (382, 218), (362, 242),
           (334, 238), (322, 208)])
EYE_R = P([(436, 164), (466, 152), (494, 172), (496, 224), (474, 248),
           (444, 244), (430, 210)])
NOSE = PL([(324, 316), (352, 298), (378, 318), (406, 296), (434, 312),
           (458, 340)])
NOSTRILS = [(362, 342), (420, 344)]

_NECK_IN = [(566, 176), (570, 300), (548, 358), (500, 392), (400, 402)]
_NECK_OFF = [(34, 4), (34, 6), (28, 26), (12, 34), (6, 34)]
_inn = [(x * HS + HDX, y * HS + HDY) for x, y in _NECK_IN]
_out = [((x + ox) * HS + HDX, (y + oy) * HS + HDY)
        for (x, y), (ox, oy) in zip(_NECK_IN, _NECK_OFF)]
NECK_SHD = P(_inn + list(reversed(_out)))
NECK_EDGE = PL(list(reversed(_out)))

DEFS = f'<defs><clipPath id="bodyclip"><path d="{wob(BODY)}"/></clipPath></defs>'


def build(mono=False):
    if mono:
        light, mid, dark, hbase = GY_L, GY_M, GY_D, GY_L
    else:
        light, mid, dark, hbase = RED_L, RED, RED_D, GRN

    b = []
    b.append(G("ground", edge(GROUND, 15)))
    b.append(G("body", block([BODY], mid) + facet(BODY_SHD, dark)
               + "".join(edge(d) for d in BODY_EDGES)))
    b.append("".join(G(f"leg{i+1}", block([d], mid, 3.0))
                     for i, d in enumerate(LEGS)))
    b.append(G("belly", block(BANDS, mid)
               + "".join(edge(d) for d in BANDS_EDGES)
               + edge(BELLY_CREASE)))
    b.append(G("fistL", block([FIST_L], light) + edge(FIST_L_EDGE)))
    b.append(G("plateL", block([PLATE_L], light)))
    b.append('<g clip-path="url(#bodyclip)">'
             + G("neck", facet(NECK_SHD, dark) + edge(NECK_EDGE, 9)) + '</g>')

    face = (f'<path d="{wob(EYE_L, 2.5, 34)}" fill="{BK}"/>'
            f'<path d="{wob(EYE_R, 2.5, 34)}" fill="{BK}"/>' + edge(NOSE, 14)
            + "".join(f'<ellipse cx="{x}" cy="{y}" rx="8" ry="7" fill="{BK}"/>'
                      for x, y in NOSTRILS))
    b.append(f'<g transform="{HEAD_TF}">' + G("head", block([HEAD], hbase) + face)
             + '</g>')
    b.append('<g transform="translate(76 -10)">'
             + G("claw", block([CLAW], light) + edge(CLAW_EDGE)) + '</g>')

    shadow = f'<ellipse cx="520" cy="856" rx="380" ry="30" fill="{BK}" opacity=".1"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024">{DEFS}{shadow}'
            f'<g id="crabigator">' + "".join(b) + '</g></svg>')


if __name__ == "__main__":
    open("svg/crabigator5-color.svg", "w").write(build(False))
    open("svg/crabigator5-mono.svg", "w").write(build(True))
    print("ok")
