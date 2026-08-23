#!/usr/bin/env python3
"""Extra camera angles built from the same traced parts.

front()  a symmetric front-on composition. The silhouettes are not redrawn by
         hand: each mass is rasterised, its right half mirrored onto the left,
         and the union re-contoured, so the front view is literally made of the
         same traced outlines. The claws and legs are instanced with mirror
         transforms, and the head is the traced head, centred.

bust()   the standard 3/4 build with a tight viewBox on the head and shoulders.
"""
import io, math
import numpy as np, cv2, cairosvg
from PIL import Image
import crabigator6 as C
from ink import wob

S = 1024
AXIS = 500.0


def _raster(paths):
    body = "".join(f'<path d="{d}" fill="#000"/>' for d in paths)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
           f'width="{S}" height="{S}"><rect width="1024" height="1024" '
           f'fill="#fff"/>{body}</svg>')
    g = np.array(Image.open(io.BytesIO(
        cairosvg.svg2png(bytestring=svg.encode()))).convert("L"))
    return (g < 128).astype(np.uint8)


def _mirror_union(paths, close=41, eps=0.006, axis=None, side="right"):
    """one half of the mass, mirrored across to the other, re-contoured, then
    recentred on AXIS"""
    m = _raster(paths)
    if axis is None:
        xs = np.nonzero(m.any(0))[0]
        axis = AXIS if side == "right" else (xs.min() + xs.max()) / 2
    a = int(round(axis))
    sym = np.zeros_like(m)
    if side == "right":
        half = m[:, a:]
        w = min(half.shape[1], a)
        sym[:, a:] = half
        sym[:, a - w:a] = half[:, :w][:, ::-1]
    else:
        half = m[:, :a]
        w = min(half.shape[1], m.shape[1] - a)
        sym[:, :a] = half
        sym[:, a:a + w] = half[:, -w:][:, ::-1]
    sym = cv2.morphologyEx(sym, cv2.MORPH_CLOSE,
                           cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                                     (close, close)))
    cs, _ = cv2.findContours(sym, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cs, key=cv2.contourArea)
    ap = cv2.approxPolyDP(c, eps * cv2.arcLength(c, True), True).reshape(-1, 2)
    dx = AXIS - (ap[:, 0].min() + ap[:, 0].max()) / 2
    return C.P([(float(x) + dx, float(y)) for x, y in ap])




def _mir(x0):
    return f"translate({2*x0} 0) scale(-1 1)"


# ---------------------------------------------------------------- front view
# Drawn from scratch for this angle rather than assembled from the 3/4 parts.
# Everything is authored as a RIGHT HALF and reflected about the axis, in the
# same vocabulary as the traced work: few vertices, hard corners, one closed
# polygon per facet so the black division lines fall out of the overlaps.
import math


def sym(half):
    """right-half points, top to bottom -> closed symmetric polygon"""
    return C.P(half + [(2 * AXIS - x, y) for x, y in reversed(half)][1:-1])


A = AXIS

# --- head: wider and flatter than the 3/4 head, brow lobes either side of a
# centre notch, jaw tapering to a rounded chin
F_HEAD = sym([(A, 210), (A + 34, 158), (A + 92, 142), (A + 144, 178),
              (A + 170, 264), (A + 174, 360), (A + 146, 448),
              (A + 90, 498), (A + 30, 516), (A, 518)])
F_EYE = [C.P([(A + 54, 274), (A + 84, 258), (A + 112, 280), (A + 116, 326),
              (A + 90, 352), (A + 58, 334)]),
         C.P([(A - 54, 274), (A - 84, 258), (A - 112, 280), (A - 116, 326),
              (A - 90, 352), (A - 58, 334)])]
F_NOSE = C.PL([(A - 76, 442), (A - 42, 424), (A - 20, 432), (A, 422),
               (A + 20, 432), (A + 42, 424), (A + 76, 442)])
F_NOSTRIL = [(A - 28, 460, 7.4), (A + 28, 460, 7.4)]

# --- carapace: broad dome with two rim spines a side
F_DOME = sym([(A, 418), (A + 150, 414), (A + 268, 448), (A + 344, 508),
              (A + 414, 522), (A + 366, 570), (A + 430, 600),
              (A + 358, 634), (A + 388, 682), (A + 300, 680),
              (A + 232, 708), (A + 116, 722), (A, 726)])
# the rim points are part of the dome outline now — separate spine shapes
# collided with the raised pincers
F_SPINE = []
F_DOME_RIM = [C.PL([(A + 58, 688), (A + 176, 674), (A + 282, 638),
                    (A + 336, 578)]),
              C.PL([(A - 58, 688), (A - 176, 674), (A - 282, 638),
                    (A - 336, 578)])]

# --- chest: a plated shield, widest at the shoulders, tapering to the base
# lifted ~95px so the plastron sits ON the chest, overlapping the dome, rather
# than hanging below it like a separate belly
_PROFILE = [(604, 98), (656, 172), (706, 202), (754, 188), (792, 144),
            (820, 56)]


def _hw(y):
    for (y0, w0), (y1, w1) in zip(_PROFILE, _PROFILE[1:]):
        if y0 <= y <= y1:
            return w0 + (y - y0) / (y1 - y0) * (w1 - w0)
    return _PROFILE[0][1] if y < _PROFILE[0][0] else _PROFILE[-1][1]


_CUTS = [604, 656, 708, 760, 818]
F_CHEST = [C.P([(A - _hw(a), a), (A, a + 10), (A + _hw(a), a),
                (A + _hw(b), b), (A, b + 10), (A - _hw(b), b)])
           for a, b in zip(_CUTS, _CUTS[1:])]
F_KEEL = C.PL([(A, 620), (A + 7, 680), (A - 5, 734), (A + 4, 792)])

# --- walking legs: two segments each, three a side, fanned outward
_THIGH = [(0, -42), (78, -56), (140, -16), (154, 56), (82, 74), (6, 38)]
_SHIN = [(116, 22), (172, 36), (206, 122), (202, 186), (144, 186),
         (132, 118), (98, 68)]
_LEGS = [(-12, 296, 618, 0.86), (14, 322, 676, 0.98),
         (38, 292, 736, 0.88)]

# --- shoulder: a tapered link from the shell out to each pincer's wrist, so
# the arms read as attached instead of floating beside the body
_SHOULDER = [(-52, -78), (58, -112), (150, -30), (128, 66), (18, 74),
             (-58, 26)]

# --- pincer. My own front-view attempt read as a flat fin, so the pincer here
# is the traced one from the reference — it is the single part of the 3/4 view
# that is already drawn face-on, and redrawing it lost the notch. Its wrist is
# moved to the origin so it can be rotated about the joint.
_CW = (800.0, 515.0)                       # the traced claw's wrist
# flipped in x so the prongs open OUTWARD — pointing them inward buried the
# notch behind the head and the pincers read as mittens
_CLAW = [(_CW[0] - x, y - _CW[1]) for x, y in C.pts_of(C.CLAW)]
_CLAW_EDGE = [(_CW[0] - x, y - _CW[1]) for x, y in C.pts_of(C.CLAW_EDGE)]
_CLAWS = [(-44, 344, 646, 0.80)]

HEAD_DY = 0


def _place(pts, ang, hx, hy, sc, mirror):
    c, s_ = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    out = []
    for x, y in pts:
        x, y = x * sc, y * sc
        x, y = x * c - y * s_, x * s_ + y * c
        px, py = hx + x, hy + y
        out.append((2 * A - px if mirror else px, py))
    return C.P(out)


def _place_open(pts, ang, hx, hy, sc, mirror):
    d = _place(pts, ang, hx, hy, sc, mirror)
    return "M" + d[1:-2]


def front(mono=False):
    C._N[0] = 0
    C._DEFS.clear()
    light, mid, hbase = ((C.GY_L, C.GY_M, C.GY_L) if mono
                         else (C.RED_L, C.RED, C.GRN))
    b = [C.G("ground", C.edge(C.GROUND, 22))]

    # legs go down first, behind the shell and chest
    for mirror in (False, True):
        side = "L" if mirror else "R"
        for k, (ang, hx, hy, sc) in enumerate(_LEGS):
            th = _place(_THIGH, ang, A + hx, hy, sc, mirror)
            sh = _place(_SHIN, ang, A + hx, hy, sc, mirror)
            b.append(C.G(f"leg{side}{k+1}",
                         C.block([th], mid) + C.block([sh], mid)))

    b.append(C.G("carapace", C.block([F_DOME], mid)
                 + "".join(C.edge(d, 12) for d in F_DOME_RIM)))
    b.append(C.G("spines", "".join(C.block([d], mid) for d in F_SPINE)))
    for i, d in enumerate(F_CHEST):
        b.append(C.G(f"chest{i+1}", C.block([d], mid)))
    b.append(C.G("keel", C.edge(F_KEEL, 11)))

    # pincers, one a side, each on a shoulder link back into the shell
    for mirror in (False, True):
        for ang, hx, hy, sc in _CLAWS:
            sh = _place(_SHOULDER, ang, A + hx, hy, sc, mirror)
            d = _place(_CLAW, ang, A + hx, hy, sc, mirror)
            e = _place_open(_CLAW_EDGE, ang, A + hx, hy, sc, mirror)
            b.append(C.G("armL" if mirror else "armR", C.block([sh], light)))
            b.append(C.G("clawL" if mirror else "clawR",
                         C.block([d], light) + C.edge(e, 12)))

    # head last, seated into the dome
    face = ("".join(f'<path d="{wob(d, 2.5, 34)}" fill="{C.BK}"/>'
                    for d in F_EYE)
            + C.edge(F_NOSE, 12)
            + "".join(f'<ellipse cx="{x}" cy="{y}" rx="{r}" ry="{r}" '
                      f'fill="{C.BK}"/>' for x, y, r in F_NOSTRIL))
    b.append(C.G("head", C.block([F_HEAD], hbase, 4.0) + face))

    defs = '<defs>' + "".join(C._DEFS) + '</defs>'
    shadow = (f'<ellipse cx="{A}" cy="{"916"}" rx="430" ry="30" '
              f'fill="{C.BK}" opacity=".1"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024">{defs}{shadow}'
            f'<g id="crabigator">' + "".join(b) + '</g></svg>')


BUST_VB = (126, 74, 496, 496)


def bust(svg=None, mono=False, **kw):
    svg = svg or C.build(mono=mono, **kw)
    v = BUST_VB
    return svg.replace('viewBox="0 0 1024 1024" width="1024" height="1024"',
                       f'viewBox="{v[0]} {v[1]} {v[2]} {v[3]}"')
