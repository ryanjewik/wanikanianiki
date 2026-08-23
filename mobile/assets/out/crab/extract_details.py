"""Isolate the line details that live INSIDE shapes (not the outlines that
separate one region from another) and vectorise them."""
import numpy as np, cv2, json
from PIL import Image
from scipy import ndimage
from skimage.morphology import skeletonize

rgb = np.array(Image.open('preview/ref_aligned.png').convert('RGB')).astype(int)
g = rgb.mean(axis=2)
# true ink only: near-neutral AND dark (keeps the red speed lines out)
sat = rgb.max(axis=2) - rgb.min(axis=2)
INK = (g < 120) & (sat < 60)

lab, n = ndimage.label(~(g < 120))
print("regions:", n)

# how many distinct regions sit within half-a-line-width of each pixel
R = 13
se = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (R, R))
count = np.zeros(g.shape, np.uint8)
for i in range(1, n + 1):
    m = (lab == i).astype(np.uint8)
    if m.sum() < 400:
        continue
    count += cv2.dilate(m, se)

BOUNDARY = count >= 2            # ink that separates two regions = an outline
interior = (INK & ~BOUNDARY).astype(np.uint8)

# drop the bird, the crowd and anything outside the creature
mask = np.zeros_like(interior)
mask[110:830, 90:900] = 1
mask[560:840, 655:930] = 0       # bird
interior *= mask

interior = cv2.morphologyEx(interior, cv2.MORPH_OPEN,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
il, m = ndimage.label(interior)
print("interior blobs:", m)

def longest_path(pix):
    """pix: set of (y,x). Return the longest simple path through the skeleton."""
    S = set(map(tuple, pix))
    nb = lambda p: [(p[0]+dy, p[1]+dx) for dy in (-1,0,1) for dx in (-1,0,1)
                    if (dy or dx) and (p[0]+dy, p[1]+dx) in S]
    def bfs(src):
        prev, seen, q = {src: None}, {src}, [src]
        last = src
        while q:
            nq = []
            for p in q:
                for c in nb(p):
                    if c not in seen:
                        seen.add(c); prev[c] = p; nq.append(c); last = c
            q = nq
        return last, prev
    a, _ = bfs(next(iter(S)))
    b, prev = bfs(a)
    path, cur = [], b
    while cur is not None:
        path.append(cur); cur = prev[cur]
    return path

out = []
for i, sl in enumerate(ndimage.find_objects(il), start=1):
    comp = (il == i)
    area = int(comp.sum())
    if area < 260:
        continue
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    # stroke width from the distance transform; fat blobs are the eyes
    dt = cv2.distanceTransform(comp.astype(np.uint8), cv2.DIST_L2, 5)
    wid = 2 * float(dt.max())
    sk = skeletonize(comp)
    pix = np.argwhere(sk)
    if len(pix) < 12:
        kind = 'dot'
        cy, cx = ndimage.center_of_mass(comp)
        out.append(dict(kind=kind, w=round(wid, 1), pts=[[int(cx), int(cy)]],
                        bbox=[int(xs.start), int(xs.stop), int(ys.start), int(ys.stop)]))
        continue
    path = longest_path(pix)
    length = len(path)
    if wid > 34 and length < wid * 2.2:
        kind = 'blob'      # eye
    else:
        kind = 'stroke'
    arr = np.array([[p[1], p[0]] for p in path], np.int32).reshape(-1, 1, 2)
    eps = 0.012 * cv2.arcLength(arr, False)
    ap = cv2.approxPolyDP(arr, max(eps, 4), False).reshape(-1, 2)
    out.append(dict(kind=kind, w=round(wid, 1), len=length,
                    pts=[[int(a), int(b)] for a, b in ap],
                    bbox=[int(xs.start), int(xs.stop), int(ys.start), int(ys.stop)]))

out.sort(key=lambda d: -(d.get('len', 0)))
for d in out:
    print(f"{d['kind']:6s} w={d['w']:5.1f} len={d.get('len',0):4d} "
          f"bbox={d['bbox']} pts={d['pts']}")
json.dump(out, open('details.json', 'w'))
