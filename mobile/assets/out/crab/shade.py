#!/usr/bin/env python3
"""Engraved shading + palette study for the traced crabigator.

The reference etching does three things my flat fills did not:

  * shading lives in a ZONE, not over the whole shape — a terminator runs
    across each form and only the far side is worked
  * the hatching FOLLOWS the form: lines run along each limb's own axis
  * density stacks — a light pass over the whole shadow, a second denser pass
    in the core

So for every traced part I take its polygon, find its principal axis by PCA,
project the vertices onto the light direction to place two terminators, and
clip the texture to the shadow side. Geometry is untouched: everything is a
clip + a paint server, so the animation rig still works.
"""
import math, random
import crabigator6 as C
from ink import wob, pts_of

BK = "#1A1A1A"
LIGHT = (-0.60, -0.80)          # light comes from upper-left
_uid = [0]
_defs = []
_seen = set()


def _add(did, svg):
    if did not in _seen:
        _seen.add(did)
        _defs.append(svg)
    return did


# ---------------------------------------------------------------- geometry
def pca_angle(pts):
    n = len(pts)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - cx) ** 2 for p in pts)
    syy = sum((p[1] - cy) ** 2 for p in pts)
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    return (cx, cy), math.degrees(ang)


def halfplane(pts, f, far=True):
    """polygon covering the part of the plane past a terminator at fraction f
    along the light direction (far=True -> the shadow side)"""
    lx, ly = LIGHT
    d = (-lx, -ly) if far else (lx, ly)         # outward normal of the region
    ts = [p[0] * d[0] + p[1] * d[1] for p in pts]
    lo, hi = min(ts), max(ts)
    t = lo + f * (hi - lo)
    px, py = -d[1], d[0]
    mx, my = d[0] * t, d[1] * t
    R = 4000
    q = [(mx + px * R, my + py * R), (mx + px * R + d[0] * R, my + py * R + d[1] * R),
         (mx - px * R + d[0] * R, my - py * R + d[1] * R), (mx - px * R, my - py * R)]
    return "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in q) + " Z"


# ---------------------------------------------------------------- textures
def hatch(angle, gap, w, col=BK, op=.30):
    a = int(round(angle / 15.0) * 15) % 180
    did = f"h{a}_{int(gap)}_{int(w*10)}_{col[1:]}_{int(op*100)}"
    return _add(did, f'<pattern id="{did}" width="{gap}" height="{gap}" '
                     f'patternUnits="userSpaceOnUse" patternTransform="rotate({a})">'
                     f'<rect x="0" y="0" width="{gap}" height="{w}" fill="{col}" '
                     f'opacity="{op}"/></pattern>')


def stipple(seed, n, size=60, col=BK, op=.42, rmin=.9, rmax=2.0):
    did = f"s{seed}_{n}_{size}_{col[1:]}_{int(op*100)}"
    if did in _seen:
        return did
    r = random.Random(seed)
    o = "".join(f'<circle cx="{r.uniform(0,size):.1f}" cy="{r.uniform(0,size):.1f}" '
                f'r="{r.uniform(rmin,rmax):.1f}" fill="{col}" opacity="{op}"/>'
                for _ in range(n))
    return _add(did, f'<pattern id="{did}" width="{size}" height="{size}" '
                     f'patternUnits="userSpaceOnUse">{o}</pattern>')


def halft(rad, gap=13, col=BK, op=.55):
    did = f"t{int(rad*10)}_{gap}_{int(op*100)}"
    return _add(did, f'<pattern id="{did}" width="{gap}" height="{gap}" '
                     f'patternUnits="userSpaceOnUse">'
                     f'<circle cx="{gap*0.25:.1f}" cy="{gap*0.25:.1f}" r="{rad}" '
                     f'fill="{col}" opacity="{op}"/>'
                     f'<circle cx="{gap*0.75:.1f}" cy="{gap*0.75:.1f}" r="{rad}" '
                     f'fill="{col}" opacity="{op}"/></pattern>')


# ------------------------------------------------------------------- modes
# each layer: (terminator fraction, far side?, paint) where paint is either a
# colour shift (float) or a callable(angle) -> pattern id
MODES = {
 "cel":     dict(label="cel — flat two-tone",
                 layers=[(.20, False, +.085), (.44, True, -.085), (.72, True, -.085)]),
 "engrave": dict(label="engrave — hatch along the form",
                 layers=[(.40, True, lambda a: hatch(a, 11, 2.4, op=.26)),
                         (.68, True, lambda a: hatch(a, 11, 2.4, op=.26))]),
 "cross":   dict(label="cross-hatch — second pass in the core",
                 layers=[(.38, True, lambda a: hatch(a, 12, 2.2, op=.24)),
                         (.66, True, lambda a: hatch(a + 78, 12, 2.2, op=.26))]),
 "stipple": dict(label="stipple — dot density",
                 layers=[(.34, True, lambda a: stipple(11, 55, op=.34)),
                         (.62, True, lambda a: stipple(12, 150, op=.34))]),
 "halftone":dict(label="halftone — dots grow in the core",
                 layers=[(.34, True, lambda a: halft(1.9, op=.42)),
                         (.62, True, lambda a: halft(3.1, op=.42))]),
 "celgrain":dict(label="cel + speckle",
                 layers=[(.20, False, +.085), (.44, True, -.075), (.72, True, -.075),
                         (.00, True, lambda a: stipple(21, 210, 70, op=.20, rmin=.7, rmax=2.2))]),
}

# ---------------------------------------------------------------- palettes
# Slots: RED = body / shell mid-tone, RED_L = claws, boulder, plate, tab,
# GRN = head. Everything below is built from the teal / green / red family.
PALETTES = {
 "tidepool":  dict(label="tidepool — teal body, aqua claws, lime head",
                   RED="#2E8F8A", RED_L="#BFE8DF", GRN="#9BDC33"),
 "reef":      dict(label="reef — teal body, coral claws, lime head",
                   RED="#2E8F8A", RED_L="#FF8A6E", GRN="#9BDC33"),
 "lagoon":    dict(label="lagoon — deep teal, mint claws, bright lime",
                   RED="#1F6F73", RED_L="#7FD6C4", GRN="#C6E84A"),
 "abyss":     dict(label="abyss — teal on teal, lime head",
                   RED="#14666E", RED_L="#43BDAD", GRN="#A8E13B"),
 "mangrove":  dict(label="mangrove — teal body, lime claws, red head",
                   RED="#2E8F8A", RED_L="#A8E13B", GRN="#E8452F"),
 "seagrass":  dict(label="seagrass — green body, pale claws, red head",
                   RED="#3F9A63", RED_L="#DCF2C6", GRN="#E8452F"),
 "coralreef": dict(label="coral reef — red body, teal claws, lime head",
                   RED="#F5372B", RED_L="#7FD6C4", GRN="#9BDC33"),
 "vermilion": dict(label="vermilion — red body, coral claws, lime head",
                   RED="#F5372B", RED_L="#FFA694", GRN="#9BDC33"),
 "holly":     dict(label="holly — green body, teal claws, red head",
                   RED="#2F8446", RED_L="#8FD8CE", GRN="#E8452F"),
 "sandstone": dict(label="sandstone", RED="#C98A4B", RED_L="#F0DCB4", GRN="#A8B84C"),
 "ember":     dict(label="ember", RED="#8E2C2A", RED_L="#F08A3C", GRN="#B6E23A"),
 "ink":       dict(label="ink (mono)", RED="#C9C9C9", RED_L="#F4F4F4", GRN="#E4E4E4"),
}

_orig_block = C.block
_BASE = dict(RED=C.RED, RED_L=C.RED_L, GRN=C.GRN)


def _overlays(wd, raw, fill, mode):
    pts = pts_of(raw)
    if len(pts) < 3:
        return ""
    _, ang = pca_angle(pts)
    _uid[0] += 1
    cid = f"c{_uid[0]}"
    _defs.append(f'<clipPath id="{cid}"><path d="{wd}"/></clipPath>')
    o = [f'<g clip-path="url(#{cid})">']
    for f, far, paint in MODES[mode]["layers"]:
        d = halfplane(pts, f, far)
        if callable(paint):
            o.append(f'<path d="{d}" fill="url(#{paint(ang)})"/>')
        else:
            o.append(f'<path d="{d}" fill="{C.shift(fill, paint)}" '
                     f'opacity="{0.9 if paint > 0 else 1.0}"/>')
    o.append('</g>')
    return "".join(o)


def build(palette="vermilion", mode="cel", facet=True, mono=False):
    _defs.clear(); _seen.clear(); _uid[0] = 0
    pal = PALETTES[palette]
    for k in ("RED", "RED_L", "GRN"):
        setattr(C, k, pal[k])

    n = [0]

    def patched(paths, fill, amp=None):
        if facet:
            fill = C.shift(fill, C.JITTER[n[0] % len(C.JITTER)] * 0.7)
        n[0] += 1
        w = [wob(d) if amp is None else wob(d, amp) for d in paths]
        tf = f' transform="translate({C.OFF[0]} {C.OFF[1]})"'
        o = [f'<path d="{d}"{tf} fill="{BK}" stroke="{BK}" '
             f'stroke-width="{2*C.OUT}"/>' for d in w]
        o += [f'<path d="{d}" fill="{fill}"/>' for d in w]
        o += [_overlays(d, raw, fill, mode) for d, raw in zip(w, paths)]
        return "".join(o)

    C.block = patched
    try:
        svg = C.build(mono=mono, rig=None, eye=1.0)
    finally:
        C.block = _orig_block
        for k, v in _BASE.items():
            setattr(C, k, v)
    svg = svg.replace('<path d="" fill="url(#tx)"/>', '')
    return svg.replace("<defs>", "<defs>" + "".join(_defs), 1)
