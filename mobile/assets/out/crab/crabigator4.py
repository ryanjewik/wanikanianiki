#!/usr/bin/env python3
"""Crabigator — laid out by measuring the stone-monster reference.

Every landmark below was taken off ref/ref_full.jpg and mapped onto a 1024
canvas using the head as the ruler (head = x 150-470, y 90-437):

  head      light, leans left, top notch, wave nose + two nostrils
  shell     one mid-tone lumpy mass, x 210-806 — reaches left into a
            shoulder lump beside the jaw, dark plane on the far right
  column    the strip of body visible between the head's jaw and the
            claw's wrist (ref x 830-960) — held open by creases
  belly     four bands plating the FRONT-LEFT under the snout, not a
            stack across the middle (ref x 400-790, y 1050-1500)
  claw      pincer the same size as the head, notch opening up-left with
            the apex low-right, facet line along the lower prong
  boulder   light tab + big rounded fist at the lower left
  legs      stubby chunks off both flanks

Outlines run through ink.wob(): shared edges get identical jitter, so
nothing cracks.
"""
import math
from ink import wob, wobo

BK = "#1A1A1A"
RED, RED_D, RED_L = "#EE3B2B", "#C0281C", "#FB8B7B"
GRN = "#8CC63E"
GY_L, GY_M, GY_D = "#F4F4F4", "#C9C9C9", "#ADADAD"

OUT = 16
OFF = (4.5, 5.5)


def block(paths, fill):
    w = [wob(d) for d in paths]
    tf = f' transform="translate({OFF[0]} {OFF[1]})"'
    o = [f'<path d="{d}"{tf} fill="{BK}" stroke="{BK}" stroke-width="{2*OUT}"/>'
         for d in w]
    o += [f'<path d="{d}" fill="{fill}"/>' for d in w]
    return "".join(o)


def facet(d, fill):
    return f'<path d="{wob(d)}" fill="{fill}"/>'


def edge(d, w=9):
    return (f'<path d="{wobo(d)}" fill="none" stroke="{BK}" stroke-width="{w}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')


def G(gid, body):
    return (f'<g id="{gid}" stroke-linejoin="round" stroke-linecap="round">'
            + body + '</g>')


def P(pts):
    return "M " + " L ".join(f"{x:.0f} {y:.0f}" for x, y in pts) + " Z"


def PL(pts):
    return "M " + " L ".join(f"{x:.0f} {y:.0f}" for x, y in pts)


# ------------------------------------------------------------------- legs
# In the reference the legs are NOT separate pebbles: they are one continuous
# mid-grey slab continuing the body, with a flat ground line at the bottom,
# two triangular notches of white cut up between the feet, and straight black
# creases dividing it. No shading on them at all — outlines do all the work.
LOWER = P([(214, 620), (300, 600), (400, 622), (520, 606), (640, 620),
           (760, 604), (856, 622), (906, 674), (916, 748), (892, 806),
           (790, 810), (700, 722), (628, 808),        # white wedge, right
           (516, 806), (438, 720), (364, 808),        # white wedge, left
           (250, 804), (198, 748), (196, 668)])
LOWER_SHD = P([(856, 622), (906, 674), (916, 748), (892, 806), (826, 808),
               (846, 728), (850, 646)])
LOWER_EDGES = [
    PL([(700, 722), (718, 648), (762, 604)]),
    PL([(438, 720), (454, 646), (520, 606)]),
    PL([(300, 600), (288, 664), (258, 726)]),
    PL([(856, 622), (822, 682), (840, 766)]),
]

# ================================================================ shell
# the body sits LOW — in the reference its top edge right of the head is at
# ref y~1080, well under the raised claw, so the pincer's notch shows sky
SHELL = P([(224, 560), (206, 470), (250, 420), (326, 402), (396, 406),
           (426, 364), (468, 324), (508, 322), (530, 406), (576, 452),
           (656, 442), (740, 448), (800, 476), (840, 528), (846, 596),
           (816, 646), (742, 674), (640, 686), (528, 680), (420, 654),
           (292, 616)])
SHELL_SHD = P([(840, 528), (846, 596), (816, 646), (742, 674), (640, 686),
               (684, 592), (742, 494)])
# the reference divides the grey mass with a LOT of black creases — that is
# what keeps it from reading as one shapeless lump
SHELL_EDGES = [
    PL([(742, 494), (684, 592), (640, 686)]),            # far plane break
    PL([(250, 420), (296, 468), (284, 544)]),            # shoulder lump
    PL([(396, 406), (410, 474), (398, 544)]),            # shoulder / chest
    PL([(508, 322), (522, 412), (514, 494)]),            # the column crease
    PL([(576, 452), (588, 518), (556, 566)]),            # centre lump
    PL([(740, 448), (700, 518), (674, 598)]),            # rear facet
    PL([(530, 470), (602, 488), (672, 478)]),            # cross break
    PL([(420, 654), (494, 606), (590, 596), (672, 614), (742, 674)]),
]

# ================================================================ belly
def _bound(xl, xr, y, sag=12, rise=20):
    return [(xl, y), ((xl + xr) / 2, y + sag), (xr, y - rise)]


_ROWS = [_bound(*r) for r in [(246, 466, 450), (250, 464, 504), (256, 460, 558),
                              (262, 456, 610), (270, 450, 666)]]
BANDS = [P(_ROWS[i] + list(reversed(_ROWS[i + 1]))) for i in range(4)]
BANDS_SHD = [P([((_ROWS[i][1][0] + _ROWS[i][2][0]) / 2,
                 (_ROWS[i][1][1] + _ROWS[i][2][1]) / 2), _ROWS[i][2],
                _ROWS[i + 1][2],
                ((_ROWS[i + 1][1][0] + _ROWS[i + 1][2][0]) / 2,
                 (_ROWS[i + 1][1][1] + _ROWS[i + 1][2][1]) / 2)])
             for i in range(4)]
BANDS_EDGES = [PL(_ROWS[i]) for i in range(1, 4)]
BELLY_CREASE = PL([r[2] for r in _ROWS])

# ================================================================ near limb
ARM_L = P([(206, 468), (200, 426), (146, 416), (102, 438), (94, 488),
           (118, 528), (170, 534), (206, 510)])
ARM_L_MID = P([(94, 488), (118, 528), (170, 534), (136, 508), (108, 486)])
ARM_L_SHD = P([(170, 534), (206, 510), (206, 468), (174, 480), (166, 512)])
FIST_L = P([(140, 562), (232, 540), (302, 588), (322, 682), (300, 764),
            (228, 818), (140, 812), (78, 764), (62, 670), (92, 600)])
FIST_L_CAST = P([(140, 562), (232, 540), (302, 588), (252, 626), (156, 616),
                 (92, 600)])
FIST_L_SHD = P([(300, 764), (322, 682), (302, 588), (252, 626), (246, 736)])
FIST_L_EDGE = PL([(84, 686), (156, 662), (234, 682), (280, 662)])

# ================================================================ pincer
# notch opens up-left, apex low-right; lower prong is the heavy mass
CLAW = P([(200, 160), (260, 125), (398, 118),
          (382, 240), (346, 268), (352, 332), (392, 398),   # hook + step
          (452, 318), (560, 292), (648, 276), (672, 238),   # flat notch floor
          (664, 150), (660, 110), (700, 88), (782, 84), (826, 120),
          (876, 232), (886, 340), (860, 438), (800, 540), (722, 640),
          (696, 704),                                       # arm into the body
          (600, 694), (420, 678), (250, 664), (150, 646),
          (100, 590), (94, 500), (118, 440), (146, 320), (172, 224)])
CLAW_SHD = P([(886, 340), (860, 438), (800, 540), (722, 640), (696, 704),
              (636, 668), (750, 542), (828, 430), (852, 336)])
CLAW_EDGES = [PL([(400, 576), (548, 560), (604, 512), (682, 470)])]
CLAW_TF = "translate(478 150) scale(0.47)"

# ================================================================ head
HS, HDX, HDY = 1.24, -212.0, -40.0
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

DEFS = f'''<defs>
<pattern id="dots" width="17" height="17" patternUnits="userSpaceOnUse">
  <circle cx="4" cy="4" r="3.8" fill="{BK}"/><circle cx="12.5" cy="12.5" r="3.8" fill="{BK}"/>
</pattern>
<clipPath id="shellshd"><path d="{wob(SHELL_SHD)}"/></clipPath>
<clipPath id="shellclip"><path d="{wob(SHELL)}"/></clipPath>
</defs>'''


def build(mono=False):
    if mono:
        light, mid, dark, hbase = GY_L, GY_M, GY_D, GY_L
    else:
        light, mid, dark, hbase = RED_L, RED, RED_D, GRN

    b = []
    b.append(G("legs", block([LOWER], mid) + facet(LOWER_SHD, dark)))
    b.append(G("shell", block([SHELL], mid) + facet(SHELL_SHD, dark)
               + "".join(edge(d) for d in SHELL_EDGES)))
    b.append(G("leg-creases", "".join(edge(d) for d in LOWER_EDGES)))
    b.append(G("belly", block(BANDS, mid)
               + "".join(facet(d, dark) for d in BANDS_SHD)
               + "".join(edge(d) for d in BANDS_EDGES)
               + edge(BELLY_CREASE, 10)))
    b.append(f'<g transform="{CLAW_TF}">'
             + G("claw", block([CLAW], light) + facet(CLAW_SHD, dark)
                 + "".join(edge(d) for d in CLAW_EDGES)) + '</g>')
    b.append(G("armL", block([ARM_L], light) + facet(ARM_L_MID, mid)
               + facet(ARM_L_SHD, dark)))
    b.append(G("fistL", block([FIST_L], light) + facet(FIST_L_CAST, dark)
               + facet(FIST_L_SHD, dark) + edge(FIST_L_EDGE)))
    b.append('<g clip-path="url(#shellclip)">'
             + G("neck", facet(NECK_SHD, dark) + edge(NECK_EDGE, 7)) + '</g>')

    face = (f'<path d="{wob(EYE_L, 2.5, 34)}" fill="{BK}"/>'
            f'<path d="{wob(EYE_R, 2.5, 34)}" fill="{BK}"/>' + edge(NOSE, 11)
            + "".join(f'<ellipse cx="{x}" cy="{y}" rx="8" ry="7" fill="{BK}"/>'
                      for x, y in NOSTRILS))
    b.append(f'<g transform="{HEAD_TF}">' + G("head", block([HEAD], hbase) + face)
             + '</g>')

    shadow = f'<ellipse cx="548" cy="874" rx="410" ry="30" fill="{BK}" opacity=".1"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024">{DEFS}{shadow}'
            f'<g id="crabigator" transform="translate(38 40)">'
            + "".join(b) + '</g></svg>')


if __name__ == "__main__":
    open("svg/crabigator4-color.svg", "w").write(build(False))
    open("svg/crabigator4-mono.svg", "w").write(build(True))
    print("ok")
