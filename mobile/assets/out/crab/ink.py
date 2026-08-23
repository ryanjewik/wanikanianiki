#!/usr/bin/env python3
"""Hand-drawn line quality for polygon paths.

Straight `M/L` polygons read as "made of shapes". This resamples each edge and
jitters it perpendicular, then joins the samples with Catmull-Rom curves — but
the ORIGINAL vertices keep zero tangent, so corners stay hard the way they are
in the reference while the runs between them wobble.

The jitter for a segment is seeded from its two endpoint coordinates in a
canonical order, so a shared edge between two polygons gets the *identical*
displacement — no cracks between a silhouette and its facets.
"""
import math, random

AMP = 6.0      # max perpendicular displacement, px
STEP = 44.0    # resample spacing, px


def pts_of(d):
    t = d.replace(",", " ").split()
    out, i = [], 0
    while i < len(t):
        if t[i] in ("M", "L"):
            out.append((float(t[i + 1]), float(t[i + 2]))); i += 3
        else:
            i += 1
    return out


def _seg(a, b, amp, step):
    ka = (round(a[0]), round(a[1])); kb = (round(b[0]), round(b[1]))
    flip = ka > kb
    rng = random.Random(hash((kb, ka) if flip else (ka, kb)) & 0x7FFFFFFF)
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    k = max(1, int(round(L / step)))
    o = [rng.uniform(-amp, amp) for _ in range(k + 1)]
    o[0] = 0.0; o[-1] = 0.0
    if flip:
        o = [-v for v in o[::-1]]
    return k, o


def _curve(P, corner, closed):
    """P = sample points, corner[i] = True where the tangent must be zero"""
    n = len(P)
    if n < 3:
        return "M " + " L ".join(f"{p[0]:.1f} {p[1]:.1f}" for p in P)
    if closed:
        g = lambda i: P[i % n]
        c = lambda i: corner[i % n]
    else:
        g = lambda i: P[max(0, min(n - 1, i))]
        c = lambda i: corner[max(0, min(n - 1, i))]
    out = [f"M {g(0)[0]:.1f} {g(0)[1]:.1f}"]
    for i in range(n if closed else n - 1):
        p0, p1, p2, p3 = g(i - 1), g(i), g(i + 1), g(i + 2)
        t1 = (0.0, 0.0) if c(i) else ((p2[0] - p0[0]) / 6, (p2[1] - p0[1]) / 6)
        t2 = (0.0, 0.0) if c(i + 1) else ((p3[0] - p1[0]) / 6,
                                          (p3[1] - p1[1]) / 6)
        c1 = (p1[0] + t1[0], p1[1] + t1[1])
        c2 = (p2[0] - t2[0], p2[1] - t2[1])
        out.append(f"C {c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} "
                   f"{p2[0]:.1f} {p2[1]:.1f}")
    if closed:
        out.append("Z")
    return " ".join(out)


def _dense(pts, closed, amp, step):
    d, corner, n = [], [], len(pts)
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        a = pts[i]; b = pts[(i + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.5:
            continue
        nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
        k, o = _seg(a, b, amp, step)
        for j in range(k):
            t = j / k
            d.append((a[0] + (b[0] - a[0]) * t + nx * o[j],
                      a[1] + (b[1] - a[1]) * t + ny * o[j]))
            corner.append(j == 0)
    if not closed:
        d.append(pts[-1]); corner.append(True)
    return d, corner


def wob(d, amp=AMP, step=STEP):
    """closed polygon -> wobbly closed curve with hard corners"""
    p = pts_of(d)
    if len(p) < 3:
        return d
    return _curve(*_dense(p, True, amp, step), closed=True)


def wobo(d, amp=AMP, step=STEP):
    """open polyline -> wobbly open curve with hard corners"""
    p = pts_of(d)
    if len(p) < 2:
        return d
    return _curve(*_dense(p, False, amp, step), closed=False)
