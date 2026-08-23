#!/usr/bin/env python3
"""Trace the crowd models by colour region.

The skill's connected-component route assumes ink seals every shape. These two
models are flat-colour art where several parts share one sealed region (the
trousers run into the jacket behind the black outline in places), so the more
reliable split here is by FILL COLOUR: quantise, take each colour's connected
components, dilate by half the ink weight to recover the drawn shape, contour,
Douglas-Peucker. Same principle — measured, not eyeballed.
"""
import argparse, json
import numpy as np, cv2
from PIL import Image

PALETTE = {
    'ink':   (26, 26, 26),
    'red':   (228, 48, 40),
    'blue':  (32, 96, 200),
    'skin':  (255, 240, 226),
    'white': (255, 255, 255),
    'green': (0, 150, 70),
    'yellow': (250, 200, 30),
}


def classify(rgb, tol=86):
    """nearest-palette-colour label per pixel"""
    names = list(PALETTE)
    ref = np.array([PALETTE[n] for n in names], float)
    d = np.linalg.norm(rgb[:, :, None, :].astype(float) - ref[None, None], axis=3)
    idx = d.argmin(2)
    best = d.min(2)
    idx[best > tol * 1.8] = names.index('white')
    return idx, names


def parts(mask, grow, eps, min_area):
    out = []
    n, lab, stats, cents = cv2.connectedComponentsWithStats(
        mask.astype(np.uint8), 8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < min_area:
            continue
        m = (lab == i).astype(np.uint8)
        if grow:
            m = cv2.dilate(m, cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (grow, grow)))
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(cs, key=cv2.contourArea)
        ap = cv2.approxPolyDP(c, eps * cv2.arcLength(c, True), True)
        out.append(dict(area=int(stats[i, cv2.CC_STAT_AREA]),
                        bbox=[int(v) for v in stats[i, :4]],
                        pts=[[int(x), int(y)] for x, y in ap.reshape(-1, 2)]))
    out.sort(key=lambda r: -r['area'])
    return out


if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('image')
    a.add_argument('--grow', type=int, default=9)
    a.add_argument('--eps', type=float, default=0.014)
    a.add_argument('--min-area', type=int, default=900)
    a.add_argument('--crop', help='x0,y0,x1,y1')
    a.add_argument('-o', '--out')
    a = a.parse_args()

    im = Image.open(a.image).convert('RGB')
    if a.crop:
        im = im.crop(tuple(int(v) for v in a.crop.split(',')))
    rgb = np.array(im)
    idx, names = classify(rgb)

    res = {}
    for j, nm in enumerate(names):
        ps = parts(idx == j, a.grow, a.eps, a.min_area)
        if ps:
            res[nm] = ps
            print(f'--- {nm}')
            for p in ps:
                x, y, w, h = p['bbox']
                print(f'   area={p["area"]:7d} bbox={x},{y} {w}x{h} '
                      f'verts={len(p["pts"])}')
    if a.out:
        json.dump(res, open(a.out, 'w'))
        # a colour-coded proof
        vis = np.array(im).copy()
        for nm, ps in res.items():
            col = PALETTE[nm]
            for p in ps:
                cv2.polylines(vis, [np.array(p['pts'])], True,
                              (255, 0, 255), 3)
        Image.fromarray(vis).save(a.out.replace('.json', '_proof.png'))
