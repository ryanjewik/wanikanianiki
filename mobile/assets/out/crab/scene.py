#!/usr/bin/env python3
"""Banner scene — landscape + crowd, drawn in the reference's vocabulary.

The two references share a grammar: bold black contour, flat value, and a
screen (dots or hatch) doing the shading; the crowd is tiny, geometric, and
reads only by silhouette and two flat colours; red squiggles carry the impact.
Everything below follows those rules, so the crabigator sits in it rather than
on it.

World is 2400 x 800; banners crop and scale that.
"""
import math, random
import crabigator6 as C
import people_parts as PP
from ink import wob, wobo

BK = C.BK
W, H = 2400, 800
HORIZON = 430

SKY = "#FFF6EE"
FAR = "#DFE9E7"
NEAR = "#BCD6D2"
SNOW = "#F4F8F8"
WATER = "#8ED4CA"
WATER_D = "#63BDB2"
SHORE = "#F1E5D6"
RED = "#F5372B"
BLUE = "#2C5BB5"
SKIN = "#FFE3C9"
HAIR = "#1A1A1A"

OUT_BG = 7          # background contour weight — lighter than the creature's
_defs = []


def tone(rad=1.9, gap=13, op=.30):
    """halftone screen, same device the creature uses"""
    did = f"sc{int(rad*10)}_{gap}_{int(op*100)}"
    if not any(f'id="{did}"' in d for d in _defs):
        _defs.append(
            f'<pattern id="{did}" width="{gap}" height="{gap}" '
            f'patternUnits="userSpaceOnUse">'
            f'<circle cx="{gap*.25:.1f}" cy="{gap*.25:.1f}" r="{rad}" '
            f'fill="{BK}" opacity="{op}"/>'
            f'<circle cx="{gap*.75:.1f}" cy="{gap*.75:.1f}" r="{rad}" '
            f'fill="{BK}" opacity="{op}"/></pattern>')
    return did


def P(pts):
    return "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z"


def PL(pts):
    return "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts)


def shape(d, fill, out=OUT_BG, screen=None, amp=3.0):
    w = wob(d, amp, 60)
    o = f'<path d="{w}" fill="{fill}" stroke="{BK}" stroke-width="{out}" ' \
        f'stroke-linejoin="round"/>'
    if screen:
        o += f'<path d="{w}" fill="url(#{screen})"/>'
    return o


def line(d, wt=6, col=BK, amp=2.5):
    return (f'<path d="{wobo(d, amp, 70)}" fill="none" stroke="{col}" '
            f'stroke-width="{wt}" stroke-linecap="round" '
            f'stroke-linejoin="round"/>')


# ------------------------------------------------------------------ terrain
def ridge(seed, y0, amp, n, fill, screen, base=HORIZON + 6):
    """a jagged mountain band across the whole width"""
    r = random.Random(seed)
    pts = [(-40, base)]
    for i in range(n + 1):
        x = -40 + (W + 80) * i / n
        y = y0 + r.uniform(-amp, amp) - (amp * 0.7 if i % 2 else 0)
        pts.append((x, y))
    pts.append((W + 40, base))
    return shape(P(pts), fill, screen=screen)


def fuji(cx, base, w, h):
    """the cone, with a jagged snow line — the one landmark in the reference"""
    body = P([(cx - w, base), (cx - w * .34, base - h * .74),
              (cx - w * .13, base - h), (cx + w * .13, base - h),
              (cx + w * .34, base - h * .74), (cx + w, base)])
    cap = P([(cx - w * .30, base - h * .70), (cx - w * .19, base - h * .80),
             (cx - w * .13, base - h), (cx + w * .13, base - h),
             (cx + w * .21, base - h * .78), (cx + w * .31, base - h * .69),
             (cx + w * .17, base - h * .72), (cx + w * .06, base - h * .82),
             (cx - w * .05, base - h * .71), (cx - w * .17, base - h * .80)])
    return shape(body, NEAR, screen=tone(2.1, 14, .26)) + shape(cap, SNOW)


def cloud(cx, cy, s, seed):
    r = random.Random(seed)
    pts, n = [], 9
    for i in range(n):
        a = math.pi * (1 - i / (n - 1))
        rr = s * (0.62 + 0.38 * math.sin(i * 1.7 + seed) ** 2)
        pts.append((cx + math.cos(a) * s * 1.5, cy - abs(math.sin(a)) * rr))
    pts.append((cx + s * 1.5, cy))
    pts.append((cx - s * 1.5, cy))
    return shape(P(pts), SKY, out=6, screen=tone(1.5, 15, .22), amp=2.0)


def bird(x, y, s):
    return (f'<path d="M {x-11*s:.1f} {y:.1f} Q {x-5*s:.1f} {y-7*s:.1f} '
            f'{x:.1f} {y-1*s:.1f} Q {x+5*s:.1f} {y-7*s:.1f} '
            f'{x+11*s:.1f} {y:.1f}" fill="none" stroke="{BK}" '
            f'stroke-width="{3.2*s:.1f}" stroke-linecap="round"/>')


# -------------------------------------------------------------------- crowd
def person(x, y, s, pose="cheer", flip=False, seed=0, top=None, hat=True):
    """The cheering figure, drawn from the TRACED contours in people_parts.py.

    Every polygon came out of the photo — jacket 120x129 units, trousers 89x69,
    face 40x43, fists 29 across, back leg 24x48 — via colour-region labelling,
    a morphological close across the interior strokes that split each fill,
    dilation by half the ink weight, and Douglas-Peucker.

    Two poses off one traced model:
      'cheer'  the model as photographed — kneeling, both fists up
      'stand'  the same traced torso straightened (the model leans ~7 degrees)
               over two copies of the traced back leg, which is the one limb in
               the photo seen straight on. Nothing is redrawn; the standing
               figure is the kneeling one re-assembled.
    """
    top = top or RED
    f = -1 if flip else 1
    ow = 6.0 * s
    FILL = {'LEG_BACK': BLUE, 'STAND_LEG': BLUE, 'TROUSERS': BLUE, 'SHIRT': BK, 'JACKET': top,
            'LAPEL': '#FFE0DC', 'FACE': SKIN, 'HAT': HAIR, 'BAND': '#F2C230',
            'FIST_L': SKIN, 'FIST_R': SKIN}
    LEAN, PIVOT = 7.0, (-11.0, -46.0)      # the model's lean, and the hip
    UPPER = ('SHIRT', 'JACKET', 'LAPEL', 'HAT', 'FACE', 'BAND',
             'FIST_L', 'FIST_R')

    def place(pts, straighten=False, dx=0.0, dy=0.0):
        out = []
        for a, b in pts:
            if straighten:
                ca = math.cos(math.radians(LEAN))
                sa = math.sin(math.radians(LEAN))
                a0, b0 = a - PIVOT[0], b - PIVOT[1]
                a, b = (PIVOT[0] + a0 * ca - b0 * sa,
                        PIVOT[1] + a0 * sa + b0 * ca)
            out.append((x + (a + dx) * f * s, y + (b + dy) * s))
        return out

    if pose == 'stand':
        # NO SOURCE FOR THIS ONE. The model is kneeling, and its visible back
        # leg is a folded calf with the foot pointing away — rotating it upright
        # reads as a wedge, not a leg. So the standing leg is drawn by hand, but
        # to the traced numbers: 22 wide (the traced calf measures 24) and 54
        # long, with the boot taken from that calf's lower taper.
        seq = [('STAND_LEG', dict(dx=-21)), ('STAND_LEG', dict(dx=7))]
        # lift the torso a touch so more of the leg shows below the hem
        seq += [(nm, dict(straighten=True, dy=-9)) for nm in UPPER]
    else:
        seq = [(nm, {}) for nm in PP.ORDER]

    # the leg runs up to -82, well past the jacket's lowest hem point (-64.6
    # over the leg positions, measured after the straighten), so the hip is
    # buried under the coat instead of floating below it
    STAND_LEG = [(-11, -82), (11, -82), (11, -18), (14, -16), (17, -4),
                 (16, 0), (-13, 0), (-14, -16), (-11, -18)]

    g = []
    for nm, kw in seq:
        if nm in ('HAT', 'BAND') and not hat:
            continue
        src = STAND_LEG if nm == 'STAND_LEG' else getattr(PP, nm)
        pts = place(src, **kw)
        w = ow * (0.6 if nm in ('BAND', 'LAPEL') else 1.0)
        g.append(f'<path d="{P(pts)}" fill="{FILL[nm]}" stroke="{BK}" '
                 f'stroke-width="{w:.1f}" stroke-linejoin="round"/>')
        if nm == 'FACE':                       # traced eye dots and mouth
            eyes = place([(a, b) for a, b, r in PP.EYES], **kw)
            for (cx, cy), (_, _, r) in zip(eyes, PP.EYES):
                g.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" '
                         f'r="{r * 1.8 * s:.1f}" fill="{BK}"/>')
            m = place(PP.MOUTH, **kw)
            g.append(f'<path d="{PL(m)}" stroke="{BK}" '
                     f'stroke-width="{PP.MOUTH_W * s:.1f}" '
                     f'stroke-linecap="round" fill="none"/>')
        if nm.startswith('FIST'):              # the three finger lines
            src = getattr(PP, nm)
            bx = sum(a for a, b in src) / len(src)
            byy = sum(b for a, b in src) / len(src)
            for kk in (-6, 0, 6):
                seg = place([(bx + kk, byy - 7), (bx + kk, byy + 4)], **kw)
                g.append(f'<path d="{PL(seg)}" stroke="{BK}" '
                         f'stroke-width="{2.4 * s:.1f}" '
                         f'stroke-linecap="round" fill="none"/>')
    return "".join(g)


def sparkle(x, y, s, col="#FFC61A"):
    """the four-point star from the character sheet"""
    a, b = 34 * s, 9 * s
    d = P([(x, y - a), (x + b, y - b), (x + a, y), (x + b, y + b),
           (x, y + a), (x - b, y + b), (x - a, y), (x - b, y - b)])
    return (f'<path d="{d}" fill="{col}" stroke="{BK}" '
            f'stroke-width="{3.4 * s:.1f}" stroke-linejoin="round"/>')


def squiggle(x, y, s, flip=False, seed=1):
    """the reference's impact mark: a smooth vertical wave, not a lightning
    bolt — three lobes, tapering"""
    a = 19 * s * (-1 if flip else 1)
    h = 26 * s
    d = [f"M {x:.1f} {y:.1f}"]
    for i in range(2):
        y0 = y - i * 2 * h
        d.append(f"C {x + a:.1f} {y0 - h * .55:.1f} {x + a:.1f} "
                 f"{y0 - h * 1.45:.1f} {x:.1f} {y0 - 2 * h:.1f}")
        a = -a
    return (f'<path d="{" ".join(d)}" fill="none" stroke="{RED}" '
            f'stroke-width="{11 * s:.1f}" stroke-linecap="round"/>')


# ------------------------------------------------------------------- scene
def scene(creature_svg, cscale=0.80, ccx=1200, cground=724, crowd=True,
          crowd_dy=0):
    _defs.clear()
    b = []
    b.append(f'<rect x="-4" y="-4" width="{W+8}" height="{H+8}" fill="{SKY}"/>')

    b.append(cloud(300, 150, 52, 3) + cloud(760, 108, 40, 7)
             + cloud(1660, 122, 46, 11) + cloud(2110, 172, 36, 5))

    for bx, by, bs in ((470, 196, 1.5), (516, 176, 1.1), (556, 206, 0.9),
                       (1810, 232, 1.3), (1856, 210, 1.0),
                       (980, 92, 1.2), (1024, 110, 0.9)):
        b.append(bird(bx, by, bs))

    b.append(ridge(21, 300, 46, 13, FAR, tone(1.6, 15, .22)))
    b.append(fuji(1980, HORIZON + 4, 300, 250))
    b.append(ridge(9, 372, 30, 19, NEAR, tone(2.1, 13, .28)))

    # water, then the far shoreline reading as a light strip
    b.append(shape(P([(-40, HORIZON), (W + 40, HORIZON),
                      (W + 40, 596), (-40, 596)]), WATER,
                   screen=tone(1.8, 13, .20), amp=1.2))
    for yy, x0, x1 in ((470, 180, 700), (500, 1420, 2020), (536, 300, 980),
                       (556, 1560, 2260), (462, 900, 1240)):
        b.append(line(PL([(x0, yy), ((x0 + x1) / 2, yy - 5), (x1, yy)]), 5,
                      WATER_D))

    # shoreline: a wavy edge, not a ruled one
    edge = [(-40, 596)]
    rr = random.Random(4)
    for i in range(17):
        edge.append((-40 + (W + 80) * i / 16, 592 + rr.uniform(-14, 16)))
    b.append(shape(P(edge + [(W + 40, H + 40), (-40, H + 40)]), SHORE,
                   screen=tone(1.5, 16, .18), amp=1.4))
    for xx, yy, rw in ((150, 690, 40), (2300, 720, 46), (560, 664, 26),
                       (1900, 672, 30), (330, 772, 34)):
        b.append(shape(P([(xx - rw, yy), (xx - rw * .62, yy - rw * .72),
                          (xx - rw * .1, yy - rw * .86),
                          (xx + rw * .55, yy - rw * .64), (xx + rw, yy)]),
                       NEAR, out=6, screen=tone(1.7, 14, .26)))

    # yellow sparkles and red impact squiggles flank the creature
    for sx, sy, ss in ((ccx - 352, 300, 1.5), (ccx + 372, 268, 1.8),
                       (ccx + 300, 372, 1.0), (ccx - 452, 236, 1.1)):
        b.append(sparkle(sx, sy, ss))

    # impact squiggles flank the creature
    for i, (sx, sy, sc, fl) in enumerate((
            (ccx - 396, 430, 1.5, True), (ccx - 512, 372, 1.1, True),
            (ccx + 430, 420, 1.5, False), (ccx + 544, 360, 1.1, False))):
        b.append(squiggle(sx, sy, sc, fl, i))

    # the creature, dropped in from the traced build
    import re
    inner = creature_svg.split('</defs>', 1)[1].rsplit('</svg>', 1)[0]
    cdefs = re.search(r'<defs>(.*?)</defs>', creature_svg, re.S).group(1)
    ty = cground - 838 * cscale
    b.append(f'<g transform="translate({ccx - 512 * cscale:.1f} {ty:.1f}) '
             f'scale({cscale})">{inner}</g>')

    if crowd:
        # near figures are bigger and lower; the two closest overlap the
        # creature's base so the crowd reads as being in front of it
        # near figures are bigger and lower; the two closest overlap the
        # creature's base so the crowd reads as being in front of it
        T = "#2E8F8A"
        # all standing: the traced kneeling pose reads as one blue blob at
        # crowd scale, because the model's folded legs are a single fill
        for cx, cy, s, pose, fl, sd, top, hat in (
                (196, 700, 0.52, "stand", False, 1, RED, True),
                (372, 744, 0.66, "stand", False, 2, T, False),
                (486, 706, 0.50, "stand", True, 11, RED, True),
                (626, 726, 0.58, "stand", True, 3, RED, False),
                (776, 778, 0.86, "stand", False, 4, RED, True),
                (1016, 796, 0.96, "stand", True, 9, T, False),
                (1432, 798, 0.94, "stand", False, 10, RED, True),
                (1688, 770, 0.84, "stand", True, 5, RED, False),
                (1852, 712, 0.54, "stand", False, 6, RED, True),
                (2064, 752, 0.70, "stand", True, 7, T, False),
                (2200, 706, 0.50, "stand", False, 12, RED, True),
                (2312, 730, 0.58, "stand", False, 8, RED, False),
        ):
            b.append(person(cx, cy + crowd_dy, s, pose, fl, sd, top, hat))

    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
            f'width="{W}" height="{H}">'
            f'<defs>{cdefs}{"".join(_defs)}</defs>' + "".join(b) + '</svg>')


CROPS = {
    'hero':      (0, 0, 2400, 800),
    'header':    (0, 0, 2400, 800),
    'wide':      (0, 290, 2400, 480),
    'tall':      (300, 0, 1800, 800),
}


def framed(svg, crop):
    x, y, w, h = CROPS[crop]
    return svg.replace(f'viewBox="0 0 {W} {H}" width="{W}" height="{H}"',
                       f'viewBox="{x} {y} {w} {h}"')
