"""Round-trip check: turn the generated JSX back into SVG and render it, so we
know the component contains the whole creature and nothing was dropped."""
import json, re, io
import cairosvg
from PIL import Image, ImageChops
d = json.load(open('app/src/_parts.json'))
src = open('app/src/CrabGatorParts.tsx').read()
EYES = d['eyeStates']


def pas(k):
    return k[0].upper() + k[1:]


def un(s):
    return (s.replace('<Path', '<path').replace('<Ellipse', '<ellipse')
             .replace('<G ', '<g ').replace('<G>', '<g>').replace('</G>', '</g>')
             .replace('strokeWidth=', 'stroke-width=')
             .replace('strokeLinecap=', 'stroke-linecap=')
             .replace('strokeLinejoin=', 'stroke-linejoin=')
             .replace('clipPath=', 'clip-path=')
             .replace('<ClipPath', '<clipPath').replace('</ClipPath>', '</clipPath>')
             .replace('<Pattern', '<pattern').replace('</Pattern>', '</pattern>')
             .replace('<Circle', '<circle')
             .replace('stopColor=', 'stop-color=').replace('stopOpacity=', 'stop-opacity='))


def frag(name):
    m = re.search(r'export const %s = \(.*?\) => \(<>(.*?)</>\);' % name,
                  src, re.S)
    if not m:
        raise SystemExit(f'component {name} missing from CrabGatorParts.tsx')
    return m.group(1)


body = ''
for k in d['order']:
    f = frag(pas(k))
    if k == 'head':                       # only the rest-state eyes are shown
        for e in EYES:
            f = f.replace('{%s}' % e, frag(pas(e)) if e == 'eyes' else '')
    if k in d['tf']:
        f = f'<g transform="{d["tf"][k]}">{f}</g>'
    if k in ('fxBurst', 'fxPuff', 'clawL', 'boulderR', 'plateR'):
        f = f'<g opacity="0">{f}</g>'     # hidden in the rest pose
    body += f'<g id="{k}">{f}</g>'

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{d["viewBox"][0]} '
       f'{d["viewBox"][1]} {d["viewBox"][2]} {d["viewBox"][3]}">'
       f'<defs>{un(d["defs"])}</defs>{un(d["shadow"])}{un(body)}</svg>')
a = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(),
              output_width=400, output_height=400,
              background_color='white'))).convert('RGB')

import crabigator6 as C
ref = C.build(False, rig={}, eye=1.0).replace(
    'viewBox="0 0 1024 1024" width="1024" height="1024"',
    f'viewBox="{d["viewBox"][0]} {d["viewBox"][1]} {d["viewBox"][2]} '
    f'{d["viewBox"][3]}"')
b = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=ref.encode(),
              output_width=400, output_height=400,
              background_color='white'))).convert('RGB')

import numpy as np
diff = np.abs(np.array(a, int) - np.array(b, int)).sum(2)
print(f'differing pixels: {(diff > 30).sum()} of {diff.size}')
c = Image.new('RGB', (812, 400), 'white')
c.paste(b, (0, 0)); c.paste(a, (412, 0))
c.save('preview/tsx_roundtrip.png')
