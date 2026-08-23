#!/usr/bin/env python3
"""Crabigator — crab anatomy with jointed legs.

This pass:
  - plastron transposed ONTO the body: the bands ride up over the carapace's
    front face and only the last two hang past the rim, so they read as
    plating on the creature rather than a stack sitting under the shell
  - near-side value separation: boulder arm keeps the light tone, the fist
    takes a dark cast band from it, legs stay mid — three depths, three values
  - head settles into the body: shifted down-right so it overlaps the shell,
    with a shoulder plate breaking the seam at the jaw
Head shape unchanged.
"""
import math

BK = "#1A1A1A"
RED, RED_D, RED_L = "#EE3B2B", "#C0281C", "#FB8B7B"
GRN = "#8CC63E"
GY_L, GY_M, GY_D = "#EDEDED", "#C6C6C6", "#9E9E9E"

OUT = 11
OFF = (3.5, 4.5)

def block(paths, fill):
    tf = f' transform="translate({OFF[0]} {OFF[1]})"'
    o = [f'<path d="{d}"{tf} fill="{BK}" stroke="{BK}" stroke-width="{2*OUT}"/>'
         for d in paths]
    o += [f'<path d="{d}" fill="{fill}"/>' for d in paths]
    return "".join(o)

def facet(d, fill):
    return f'<path d="{d}" fill="{fill}"/>'

def edge(d, w=9):
    return (f'<path d="{d}" fill="none" stroke="{BK}" stroke-width="{w}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')

def G(gid, body):
    return (f'<g id="{gid}" stroke-linejoin="round" stroke-linecap="round">'
            + body + '</g>')

# ---------------------------------------------------------------- limbs
def _n(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy) or 1
    return (-dy / L, dx / L)

def limb(p0, p1, p2, w0, w1, w2=8):
    """thigh + shin, knee bend at p1, tapering to a point at p2"""
    n1 = _n(p0, p1); n2 = _n(p1, p2)
    nk = (n1[0] + n2[0], n1[1] + n2[1])
    L = math.hypot(*nk) or 1
    nk = (nk[0] / L, nk[1] / L)
    A = (p0[0] + n1[0]*w0, p0[1] + n1[1]*w0); B = (p0[0] - n1[0]*w0, p0[1] - n1[1]*w0)
    C = (p1[0] + nk[0]*w1, p1[1] + nk[1]*w1); D = (p1[0] - nk[0]*w1, p1[1] - nk[1]*w1)
    E = (p2[0] + n2[0]*w2, p2[1] + n2[1]*w2); F = (p2[0] - n2[0]*w2, p2[1] - n2[1]*w2)
    P = lambda *pts: "M " + " L ".join(f"{p[0]:.0f} {p[1]:.0f}" for p in pts) + " Z"
    return P(A, C, D, B), P(C, E, F, D), P(C, E, F, ((C[0]+D[0])/2, (C[1]+D[1])/2))

NEAR_SPEC = [((442, 458), (318, 448), (192, 516), 42, 32),
             ((436, 548), (298, 584), (156, 684), 44, 33),
             ((444, 614), (322, 686), (198, 798), 36, 26)]
FAR_SPEC = [((830, 420), (932, 440), (1006, 484), 32, 25),
            ((840, 498), (938, 550), (1002, 636), 34, 26),
            ((824, 570), (896, 644), (944, 744), 28, 21)]

LEGS_NEAR, LEGS_NEAR_SHD = [], []
for _s in NEAR_SPEC:
    _t, _sh, _d = limb(*_s)
    LEGS_NEAR += [_t, _sh]; LEGS_NEAR_SHD.append(_d)
LEGS_FAR, LEGS_FAR_SHD = [], []
for _s in FAR_SPEC:
    _t, _sh, _d = limb(*_s)
    LEGS_FAR += [_t, _sh]; LEGS_FAR_SHD.append(_d)

# ================================================================ geometry
SHELL = ("M 424 566 L 418 452 L 456 382 L 526 336 L 620 312 L 726 322 "
         "L 800 364 L 842 428 L 856 500 L 840 572 L 782 622 L 682 650 "
         "L 566 646 L 464 616 Z")
SHELL_TOP = ("M 456 382 L 526 336 L 620 312 L 726 322 L 800 364 L 842 428 "
             "L 706 458 L 552 452 L 458 424 Z")
SHELL_SHD = "M 842 428 L 856 500 L 840 572 L 782 622 L 682 650 L 716 550 L 750 458 Z"
SHELL_EDGES = ["M 458 424 L 552 452 L 706 458 L 842 428",
               "M 716 550 L 750 458 L 842 428",
               "M 460 428 L 444 512 L 452 610"]

# --- plastron: rides up onto the carapace's front face ---------------------
PLATE_TF = "translate(-6 -116)"
PLATES = [
    "M 458 634 L 534 676 L 638 684 L 736 652 L 746 686 L 644 720 L 536 712 L 452 668 Z",
    "M 452 668 L 536 712 L 644 720 L 746 686 L 758 726 L 650 762 L 538 754 L 444 706 Z",
    "M 444 706 L 538 754 L 650 762 L 758 726 L 766 762 L 654 798 L 540 790 L 438 740 Z",
    "M 438 740 L 540 790 L 654 798 L 766 762 L 770 792 L 656 826 L 542 818 L 434 768 Z",
    "M 434 768 L 542 818 L 656 826 L 770 792 L 772 810 L 702 830 L 656 848 L 598 838 L 542 842 L 488 816 L 432 790 Z",
]
PLATES_EDGES = [
    "M 452 668 L 536 712 L 644 720 L 746 686",
    "M 444 706 L 538 754 L 650 762 L 758 726",
    "M 438 740 L 540 790 L 654 798 L 766 762",
    "M 434 768 L 542 818 L 656 826 L 770 792",
]
PLATES_SHD = [
    "M 638 684 L 736 652 L 746 686 L 644 720 Z",
    "M 644 720 L 746 686 L 758 726 L 650 762 Z",
    "M 650 762 L 758 726 L 766 762 L 654 798 Z",
    "M 654 798 L 766 762 L 770 792 L 656 826 Z",
    "M 656 826 L 770 792 L 772 810 L 702 830 L 656 848 Z",
]
# the shell overhangs the top band — a dark lip sells the plates sitting ON it
PLATE_LIP = "M 458 634 L 534 676 L 638 684 L 736 652 L 740 668 L 640 700 L 532 692 L 454 650 Z"

# --- near limb -------------------------------------------------------------
ARM_L = ("M 396 548 L 340 514 L 266 548 L 238 622 L 264 692 L 336 708 "
         "L 386 650 L 402 582 Z")
ARM_L_MID = "M 238 622 L 264 692 L 336 708 L 300 660 L 268 610 Z"
ARM_L_SHD = "M 264 692 L 336 708 L 386 650 L 402 582 L 356 594 L 328 654 L 292 684 Z"
FIST_L = ("M 264 690 L 336 708 L 380 752 L 386 828 L 338 874 L 258 876 "
          "L 210 832 L 216 748 Z")
# cast shadow thrown by the boulder arm across the top of the fist
FIST_L_CAST = "M 264 690 L 336 708 L 380 752 L 332 768 L 254 748 L 216 748 Z"
FIST_L_SHD = "M 338 874 L 386 828 L 380 752 L 332 768 L 328 842 Z"
FIST_L_EDGE = "M 254 798 L 306 784 L 352 798"

ARM_R = "M 742 356 L 758 428 L 812 462 L 878 430 L 886 356 L 816 324 Z"
ARM_R_SHD = "M 812 462 L 878 430 L 886 356 L 852 366 L 842 438 Z"
CLAW = ("M 20 24 L 92 40 L 176 74 L 240 88 L 296 96 L 336 148 L 344 216 "
        "L 320 274 L 268 306 L 202 310 L 128 296 L 48 272 L 14 240 L 34 200 "
        "L 112 216 L 192 206 L 196 180 L 128 128 L 52 96 L 8 68 Z")
CLAW_SHD = "M 296 96 L 336 148 L 344 216 L 320 274 L 268 306 L 256 212 L 272 130 Z"
CLAW_EDGES = ["M 256 212 L 272 130 L 296 96", "M 58 254 L 140 270 L 212 280"]
CLAW_TF = "translate(632 60) scale(1.0) rotate(10 290 200)"

# --- head (shape locked; seated into the body) -----------------------------
HEAD = ("M 300 348 L 292 232 L 306 156 L 336 116 L 392 100 L 424 118 "
        "L 452 164 L 480 108 L 534 116 L 566 180 L 570 300 L 548 358 "
        "L 500 392 L 400 402 L 336 384 Z")
EYE_L = "M 332 166 L 356 154 L 378 170 L 380 216 L 362 240 L 336 236 L 324 208 Z"
EYE_R = "M 438 166 L 466 154 L 492 172 L 494 222 L 474 246 L 446 242 L 432 210 Z"
NOSE = "M 336 314 L 360 300 L 382 316 L 404 300 L 430 310 L 450 336"
NOSTRILS = [(364, 336), (418, 338)]

# contact shadow hugging the head's silhouette, so it sockets into the shell
_HD = (46, 30)
_NECK_IN = [(566, 176), (570, 300), (548, 358), (500, 392), (400, 402)]
_NECK_OFF = [(34, 4), (34, 6), (28, 26), (12, 34), (6, 34)]
_inn = [(x + _HD[0], y + _HD[1]) for x, y in _NECK_IN]
_out = [(x + _HD[0] + ox, y + _HD[1] + oy)
        for (x, y), (ox, oy) in zip(_NECK_IN, _NECK_OFF)]
_pt = lambda p: f"{p[0]:.0f} {p[1]:.0f}"
NECK_SHD = ("M " + " L ".join(_pt(p) for p in _inn + list(reversed(_out))) + " Z")
NECK_EDGE = "M " + " L ".join(_pt(p) for p in reversed(_out))
HEAD_TF = f"translate({_HD[0]} {_HD[1]})"

DEFS = f'''<defs>
<pattern id="dots" width="17" height="17" patternUnits="userSpaceOnUse">
  <circle cx="4" cy="4" r="3.8" fill="{BK}"/><circle cx="12.5" cy="12.5" r="3.8" fill="{BK}"/>
</pattern>
<clipPath id="shellshd"><path d="{SHELL_SHD}"/></clipPath>
<clipPath id="shellclip"><path d="{SHELL}"/></clipPath>
</defs>'''

def build(mono=False):
    if mono:
        light, mid, dark, hbase = GY_L, GY_M, GY_D, GY_L
    else:
        light, mid, dark, hbase = RED_L, RED, RED_D, GRN

    b = []
    b.append(G("legs-far", block(LEGS_FAR, mid)
               + "".join(facet(d, dark) for d in LEGS_FAR_SHD)))
    b.append(G("legs-near", block(LEGS_NEAR, mid)
               + "".join(facet(d, dark) for d in LEGS_NEAR_SHD)))
    b.append(G("armR", block([ARM_R], mid) + facet(ARM_R_SHD, dark)))
    b.append(G("shell", block([SHELL], mid) + facet(SHELL_TOP, light)
               + facet(SHELL_SHD, dark) + "".join(edge(d) for d in SHELL_EDGES)))
    b.append(f'<g id="texture" clip-path="url(#shellshd)"><rect x="716" y="440" '
             f'width="180" height="280" fill="url(#dots)" '
             f'opacity="{".4" if mono else ".16"}"/></g>')
    b.append(f'<g transform="{PLATE_TF}">'
             + G("plastron", block(PLATES, light)
                 + facet(PLATE_LIP, dark)
                 + "".join(facet(d, dark) for d in PLATES_SHD)
                 + "".join(edge(d) for d in PLATES_EDGES)) + '</g>')
    b.append(f'<g transform="{CLAW_TF}">'
             + G("claw", block([CLAW], light) + facet(CLAW_SHD, dark)
                 + "".join(edge(d) for d in CLAW_EDGES)) + '</g>')
    b.append(G("armL", block([ARM_L], light) + facet(ARM_L_MID, mid)
               + facet(ARM_L_SHD, dark)))
    b.append(G("fistL", block([FIST_L], light) + facet(FIST_L_CAST, dark)
               + facet(FIST_L_SHD, dark) + edge(FIST_L_EDGE)))

    face = (f'<path d="{EYE_L}" fill="{BK}"/><path d="{EYE_R}" fill="{BK}"/>'
            + edge(NOSE, 11)
            + "".join(f'<ellipse cx="{x}" cy="{y}" rx="8" ry="7" fill="{BK}"/>'
                      for x, y in NOSTRILS))
    b.append('<g clip-path="url(#shellclip)">' + G("neck", facet(NECK_SHD, dark) + edge(NECK_EDGE, 7)) + '</g>')
    b.append(f'<g transform="{HEAD_TF}">' + G("head", block([HEAD], hbase) + face)
             + '</g>')

    shadow = f'<ellipse cx="540" cy="880" rx="380" ry="30" fill="{BK}" opacity=".1"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024">{DEFS}{shadow}'
            f'<g id="crabigator">' + "".join(b) + '</g></svg>')

if __name__ == "__main__":
    open("svg/crabigator3-color.svg", "w").write(build(False))
    open("svg/crabigator3-mono.svg", "w").write(build(True))
    print("ok")
