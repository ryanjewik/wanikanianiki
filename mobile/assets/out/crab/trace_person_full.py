#!/usr/bin/env python3
"""Extract EVERY part of the cheering model and bake the real polygons.

The previous pass measured the model and then hand-drew rectangles to those
measurements — which is exactly the failure the skill warns about. This one
keeps the contours.

Two masks are needed because the model mixes flat colour with solid black:
  * colour parts  -> nearest-palette classification, per-colour components
  * black parts   -> ink mask ERODED to kill the outline strokes (they are
                     thin) leaving only solid black fills (hat, inner shirt,
                     hair), then dilated back to the drawn size
Everything is emitted in one normalised frame: feet on the origin, figure
200 units tall, x centred on the trousers.
"""
import json
import numpy as np, cv2
from PIL import Image

SRC = 'ref/people/cheer_big.png'
CROP = (190, 80, 830, 1000)

PALETTE = {'ink': (26, 26, 26), 'red': (228, 48, 40), 'blue': (32, 96, 200),
           'skin': (255, 240, 226), 'white': (255, 255, 255),
           'gold': (250, 200, 30), 'grey': (150, 150, 150)}


def classify(rgb):
    names = list(PALETTE)
    ref = np.array([PALETTE[n] for n in names], float)
    d = np.linalg.norm(rgb[:, :, None, :].astype(float) - ref[None, None], axis=3)
    return d.argmin(2), names


def contour(mask, grow=0, eps=0.008):
    m = mask.astype(np.uint8)
    if grow:
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                                    (grow, grow)))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)
    return cv2.approxPolyDP(c, eps * cv2.arcLength(c, True), True).reshape(-1, 2)


im = Image.open(SRC).convert('RGB').crop(CROP)
rgb = np.array(im)
idx, names = classify(rgb)
g = rgb.mean(2)
sat = rgb.max(2).astype(int) - rgb.min(2).astype(int)
ink = ((g < 110) & (sat < 70)).astype(np.uint8)

# solid black fills: strokes are ~14px, fills are much fatter than that
K = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (23, 23))
solid = cv2.dilate(cv2.erode(ink, K), K)

parts = []


def take(mask, name, colour, grow=0, eps=0.008, pick=0, min_area=600):
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    order = sorted(range(1, n), key=lambda i: -st[i, 4])
    order = [i for i in order if st[i, 4] >= min_area]
    if pick >= len(order):
        return None
    i = order[pick]
    p = contour(lab == i, grow, eps)
    parts.append(dict(name=name, colour=colour, area=int(st[i, 4]),
                      bbox=[int(v) for v in st[i, :4]],
                      pts=[[int(x), int(y)] for x, y in p]))
    return parts[-1]


def drop_border(mask):
    """the model sits on white, so the background is its own huge component —
    remove anything touching the frame before looking for parts"""
    m = mask.astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    H, W = m.shape
    keep = np.zeros_like(m)
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if x <= 1 or y <= 1 or x + w >= W - 1 or y + h >= H - 1:
            continue
        keep |= (lab == i).astype(np.uint8)
    return keep


def close(mask, k):
    """bridge a fill that an interior stroke has cut in two"""
    e = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    return cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, e)


# the jacket is cut in two by its white lapel stripe; close across it
take(close(idx == names.index('red'), 55), 'jacket', 'top', grow=9, eps=0.008)
take(close(idx == names.index('blue'), 25), 'trousers', 'blue', grow=9,
     eps=0.009)
# the back leg reads as mid-grey, which also matches every antialiased edge in
# the picture — restrict the search to the lower left before looking for it
grey = drop_border(idx == names.index('grey')).astype(np.uint8)
box = np.zeros_like(grey)
box[600:, :270] = 1
take(close(grey * box, 21), 'leg_back', 'grey', grow=9, eps=0.013,
     min_area=3000)

take(idx == names.index('gold'), 'hatband', 'gold', grow=11, eps=0.014)

# faces and fists: white, and the fists are cut into slivers by their finger
# lines. Label, then merge any components whose boxes overlap once grown by the
# stroke width — that reassembles a fist without merging it into the face.
white = close(drop_border((idx == names.index('white'))
                          | (idx == names.index('skin'))), 15)
n, lab, st, _ = cv2.connectedComponentsWithStats(white, 8)
cand = [i for i in range(1, n) if st[i, 4] > 900]
PAD = 12


def boxes_touch(a, b):
    ax, ay, aw, ah = st[a, :4]
    bx, by, bw, bh = st[b, :4]
    return not (ax + aw + PAD < bx or bx + bw + PAD < ax
                or ay + ah + PAD < by or by + bh + PAD < ay)


groups = []
for i in cand:
    for gp in groups:
        if any(boxes_touch(i, j) for j in gp):
            gp.append(i)
            break
    else:
        groups.append([i])
merged = True
while merged:                       # settle transitive overlaps
    merged = False
    for a in range(len(groups)):
        for b in range(a + 1, len(groups)):
            if any(boxes_touch(i, j) for i in groups[a] for j in groups[b]):
                groups[a] += groups.pop(b)
                merged = True
                break
        if merged:
            break

blobs = []
for gp in groups:
    m = np.isin(lab, gp)
    ys_, xs_ = np.nonzero(m)
    blobs.append((int(m.sum()), m, int(xs_.min()), int(ys_.min()),
                  int(xs_.max() - xs_.min()), int(ys_.max() - ys_.min())))
blobs.sort(key=lambda t: -t[0])
for k, (area, m, x, y, w, h) in enumerate(blobs[:4]):
    if w > 130 and h > 130:
        nm, eps = 'face', 0.006          # keep the jaw round
    elif w > 90 and h < 90:
        nm, eps = 'lapel', 0.020         # the pale stripe down the jacket
    else:
        nm = f'fist{len([p for p in parts if p["name"].startswith("fist")]) + 1}'
        eps = 0.008
    pp = contour(m, 11, eps)
    parts.append(dict(name=nm, colour='skin', area=area, bbox=[x, y, w, h],
                      pts=[[int(a), int(b)] for a, b in pp]))

# solid blacks, biggest first: the hat/hair mass and the inner shirt
n, lab, st, _ = cv2.connectedComponentsWithStats(solid, 8)
blk = sorted([i for i in range(1, n) if st[i, 4] > 2500], key=lambda i: -st[i, 4])
for k, i in enumerate(blk[:3]):
    p = contour(lab == i, 5, 0.006)
    parts.append(dict(name=f'black{k+1}', colour='ink', area=int(st[i, 4]),
                      bbox=[int(v) for v in st[i, :4]],
                      pts=[[int(x), int(y)] for x, y in p]))

for p in parts:
    x, y, w, h = p['bbox']
    print(f'{p["name"]:9s} {p["colour"]:5s} bbox={x},{y} {w}x{h} '
          f'area={p["area"]:6d} verts={len(p["pts"])}')

json.dump(parts, open('ref/people/cheer_parts.json', 'w'))

vis = np.array(im).copy()
for p in parts:
    cv2.polylines(vis, [np.array(p['pts'])], True, (255, 0, 255), 3)
    x, y, w, h = p['bbox']
    cv2.putText(vis, p['name'], (x, max(14, y - 4)),
                cv2.FONT_HERSHEY_SIMPLEX, .5, (255, 0, 255), 2)
Image.fromarray(vis).save('preview/cheer_parts_proof.png')
