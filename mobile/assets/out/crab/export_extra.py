#!/usr/bin/env python3
"""Angles, banners and the app-icon set — all composed from the same build."""
import io, os, re, json
import cairosvg
from PIL import Image, ImageDraw
import anim, views, scene, crabigator6 as C

OUT = 'app'
for d in ('assets/views', 'assets/banners', 'assets/icon'):
    os.makedirs(f'{OUT}/{d}', exist_ok=True)

BG_DEEP = '#0F3B40'      # deep teal, from the coral-reef family
BG_CREAM = '#FFF3EC'


def parts(svg):
    defs = re.search(r'<defs>.*?</defs>', svg, re.S)
    defs = defs.group(0) if defs else '<defs></defs>'
    inner = svg.split('</defs>', 1)[1].rsplit('</svg>', 1)[0]
    return defs, inner


def wrap(svg, W, H, tx, ty, k, bg=None, src=(0, 0, 1024, 1024)):
    """re-frame a built SVG inside a W x H canvas at scale k"""
    defs, inner = parts(svg)
    rect = f'<rect width="{W}" height="{H}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
            f'width="{W}" height="{H}">{defs}{rect}'
            f'<g transform="translate({tx} {ty}) scale({k}) '
            f'translate({-src[0]} {-src[1]})">{inner}</g></svg>')


def png(svg, w, h, bg=None):
    return Image.open(io.BytesIO(cairosvg.svg2png(
        bytestring=svg.encode(), output_width=w, output_height=h,
        background_color=bg))).convert('RGBA')


# ============================================================ extra angles
FRONT = views.front()
BUST = C.build()

open(f'{OUT}/assets/views/front.svg', 'w').write(FRONT)
for tag, s in (('', 256), ('@2x', 512), ('@3x', 768)):
    png(FRONT, s, s).save(f'{OUT}/assets/views/front{tag}.png')

open(f'{OUT}/assets/views/bust.svg', 'w').write(views.bust(BUST))
for tag, s in (('', 256), ('@2x', 512), ('@3x', 768)):
    png(views.bust(BUST), s, s).save(f'{OUT}/assets/views/bust{tag}.png')

def icon_svg(size=1024, bg=BG_DEEP, inset=0.155, art=None):
    art = art or views.bust(BUST)
    v = views.BUST_VB
    k = size * (1 - 2 * inset) / v[2]
    off = size * inset
    defs, inner = parts(art)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
            f'width="{size}" height="{size}">{defs}'
            f'<rect width="{size}" height="{size}" fill="{bg}"/>'
            f'<g transform="translate({off*1.28:.1f} {off*0.78:.1f}) scale({k:.5f}) '
            f'translate({-v[0]} {-v[1]})">{inner}</g></svg>')



# circular avatar — the bust on a filled disc
for s in (128, 256, 512):
    a = png(icon_svg(s, bg='none', inset=0.10), s, s)
    disc = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(disc)
    d.ellipse([0, 0, s - 1, s - 1], fill=BG_CREAM)
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, s - 1, s - 1], fill=255)
    out = Image.alpha_composite(disc, a)
    out.putalpha(mask)
    out.save(f'{OUT}/assets/views/avatar-{s}.png')

# ============================================================ banners
IDLE = anim.frame('idle', 0.25)
CHEER = anim.frame('correct', 0.34)

# --- transparent creature-only strips, to lay over your own background
BANNERS = {
    # name: (W, H, source svg, scale, x, y, bg)
    'strip-header-1200x400':    (1200, 400, IDLE,  0.40,  40, -16, None),
    'strip-celebrate-1200x240': (1200, 240, CHEER, 0.255, 24, -18, None),
}
for name, (W, H, svg, k, x, y, bg) in BANNERS.items():
    s = wrap(svg, W, H, x, y, k, bg)
    open(f'{OUT}/assets/banners/{name}.svg', 'w').write(s)
    png(s, W, H).save(f'{OUT}/assets/banners/{name}.png')
    png(s, W * 2, H * 2).save(f'{OUT}/assets/banners/{name}@2x.png')

# --- the full illustrated scene: lake, ridges, the cone, a cheering crowd
SCENES = {
    'scene-hero':      ('hero',   IDLE,  2400, 800, {}),
    'scene-header':    ('header', IDLE,  1200, 400, {}),
    'scene-celebrate': ('header', CHEER, 1200, 400, {}),
    # the 5:1 strip needs its own layout — the creature and the crowd move up
    # and shrink so nothing important falls outside a 480-tall slice
    'scene-wide':      ('wide',   IDLE,  1200, 240,
                        dict(cscale=0.44, cground=712, crowd_dy=-40)),
}
for name, (crop, src, W, H, kw) in SCENES.items():
    s = scene.framed(scene.scene(src, **kw), crop)
    open(f'{OUT}/assets/banners/{name}-{W}x{H}.svg', 'w').write(s)
    png(s, W, H).save(f'{OUT}/assets/banners/{name}-{W}x{H}.png')
    if W <= 1200:
        png(s, W * 2, H * 2).save(f'{OUT}/assets/banners/{name}-{W}x{H}@2x.png')

# ============================================================ app icon
# bust artwork, generous safe area, deep-teal ground
ico = png(icon_svg(), 1024, 1024)
ico.convert('RGB').save(f'{OUT}/assets/icon/icon-1024.png')
for s in (32, 64, 196, 512):
    ico.resize((s, s), Image.LANCZOS).convert('RGB').save(
        f'{OUT}/assets/icon/favicon-{s}.png')

# android adaptive: art on transparent at 66% safe zone, flat colour behind
png(icon_svg(1024, bg='none', inset=0.245), 1024, 1024).save(
    f'{OUT}/assets/icon/adaptive-foreground-1024.png')
Image.new('RGB', (1024, 1024), BG_DEEP).save(
    f'{OUT}/assets/icon/adaptive-background-1024.png')

# splashes — full creature, centred, cream ground
for w, h, tag in ((1242, 2436, '1242x2436'), (2048, 2732, '2048x2732')):
    sp = Image.new('RGB', (w, h), BG_CREAM)
    c = png(IDLE.replace('viewBox="0 0 1024 1024" width="1024" height="1024"',
                         'viewBox="56 60 912 912"'), int(w * 0.62), int(w * 0.62))
    sp.paste(c, ((w - c.width) // 2, (h - c.height) // 2), c)
    sp.save(f'{OUT}/assets/icon/splash-{tag}.png')

print('extra assets done')
