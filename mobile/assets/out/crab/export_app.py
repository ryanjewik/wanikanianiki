#!/usr/bin/env python3
"""Render the mobile-app asset set from the traced crabigator."""
import io, json, os, re, shutil, math
import cairosvg
from PIL import Image
import anim, crabigator6 as C

VB = (56, 60, 912, 912)          # square crop that holds every pose
OUT = 'app'
for d in ['assets/poses', 'assets/anim', 'assets/icon', 'src']:
    os.makedirs(f'{OUT}/{d}', exist_ok=True)


def framed(svg):
    return svg.replace('viewBox="0 0 1024 1024" width="1024" height="1024"',
                       f'viewBox="{VB[0]} {VB[1]} {VB[2]} {VB[3]}"')


# Which screen the app-facing rasters use. The halftone is a 13-unit dot
# pitch on a 1024 canvas, so it only resolves above roughly 315px of output;
# below that it lands near the pixel pitch and, once the art starts moving,
# aliases into a crawling shimmer. Poses and animation frames therefore ship
# the flat-tone equivalent (identical average value, measured 0.2% mean delta
# at app sizes); the 1024 masters and the banners keep the real dots.
C.SCREEN = 'tone'


def png(svg, size, bg=None):
    return Image.open(io.BytesIO(cairosvg.svg2png(
        bytestring=framed(svg).encode(), output_width=size, output_height=size,
        background_color=bg))).convert('RGBA')


POSES = ['idle', 'wave', 'walk', 'blink', 'correct', 'wrong']
# sample each still at the moment the pose actually reads
STILL_T = {'idle': 0.25, 'wave': 0.25, 'walk': 0.25, 'blink': 0.5,
           'correct': 0.34, 'wrong': 0.18}
# the two feedback poses are one-shots, not loops, so they get more frames
NF = 24
AFRAME = 256          # animation frame size
NFRAMES = {p: 30 for p in ('correct', 'wrong')}
LOOP = {p: 0 for p in POSES}
LOOP.update(correct=1, wrong=1)

# ---------------------------------------------------------------- still poses
sheet_rows = []
for p in POSES:
    svg = anim.frame(p, STILL_T[p])
    open(f'{OUT}/assets/poses/crabgator-{p}.svg', 'w').write(framed(svg))
    for tag, s in (('', 256), ('@2x', 512), ('@3x', 768)):
        png(svg, s).save(f'{OUT}/assets/poses/crabgator-{p}{tag}.png')
    sheet_rows.append(png(svg, 256))

sheet = Image.new('RGBA', (256 * len(POSES), 256), (0, 0, 0, 0))
for i, im in enumerate(sheet_rows):
    sheet.paste(im, (256 * i, 0))
sheet.save(f'{OUT}/assets/poses/poses-sheet.png')

# ---------------------------------------------------------------- animations
manifest = {}
for p in POSES:
    n = NFRAMES.get(p, NF)
    frames = [png(anim.frame(p, i / n), AFRAME) for i in range(n)]
    # sprite strip, alpha preserved
    strip = Image.new('RGBA', (AFRAME * n, AFRAME), (0, 0, 0, 0))
    for i, im in enumerate(frames):
        strip.paste(im, (AFRAME * i, 0))
    strip.save(f'{OUT}/assets/anim/{p}-sprite.png')
    # gif on white — GIF has no partial alpha.
    # ONE palette for the whole loop. Quantising each frame on its own with
    # ADAPTIVE re-derives the 64 colours every frame, and because the halftone
    # dithers each flat fill into a spread of near-identical shades the cut
    # points land differently each time: a fixed pixel on the shell drifted
    # 207,58,49 -> 241,69,58 and the claw walked through seven teals in one
    # loop. That is the hue jumping. Stack every frame, quantise once, then
    # map all of them onto that palette with no dithering.
    comp = [Image.alpha_composite(Image.new('RGBA', f.size, 'white'), f)
            .convert('RGB') for f in frames]
    stack = Image.new('RGB', (comp[0].width, comp[0].height * len(comp)))
    for i, c in enumerate(comp):
        stack.paste(c, (0, i * c.height))
    pal = stack.quantize(colors=200, method=Image.MEDIANCUT)
    flat = [c.quantize(palette=pal, dither=Image.Dither.NONE) for c in comp]
    flat[0].save(f'{OUT}/assets/anim/{p}.gif', save_all=True,
                 append_images=flat[1:], duration=1000 // n, loop=LOOP[p],
                 disposal=2, optimize=False)
    manifest[p] = dict(frames=n, size=AFRAME, fps=n, loop=bool(1 - LOOP[p]),
                       oneShot=p in NFRAMES,
                       sprite=f'assets/anim/{p}-sprite.png',
                       gif=f'assets/anim/{p}.gif')
json.dump(manifest, open(f'{OUT}/assets/anim/manifest.json', 'w'), indent=2)

# app icons, extra angles and banners live in export_extra.py
print('assets done')
