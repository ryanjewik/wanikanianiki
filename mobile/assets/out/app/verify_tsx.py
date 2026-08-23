"""Round-trip check: turn the generated JSX back into SVG and render it, so we
know the component contains the whole creature and nothing was dropped."""
import json, re, io
import cairosvg
from PIL import Image, ImageChops
d = json.load(open('app/src/_parts.json'))
src = open('app/src/CrabGatorParts.tsx').read()
def un(s):
    return (s.replace('<Path', '<path').replace('<Ellipse', '<ellipse')
             .replace('<G ', '<g ').replace('<G>', '<g>').replace('</G>', '</g>')
             .replace('strokeWidth=', 'stroke-width=')
             .replace('strokeLinecap=', 'stroke-linecap=')
             .replace('strokeLinejoin=', 'stroke-linejoin=')
             .replace('clipPath=', 'clip-path='))
order = d['order']
body = ''
for k in order:
    frag = re.search(r'export const %s = \(.*?\) => \(<>(.*?)</>\);' % k.capitalize(),
                     src, re.S).group(1)
    if k == 'head':
        eyes = re.search(r'export const Eyes = \(\) => \(<>(.*?)</>\);', src, re.S).group(1)
        frag = frag.replace('{eyes}', eyes)
    if k == 'claw':
        frag = f'<g transform="{d["clawTF"]}">{frag}</g>'
    body += f'<g id="{k}">{frag}</g>'
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{d["viewBox"][0]} '
       f'{d["viewBox"][1]} {d["viewBox"][2]} {d["viewBox"][3]}">'
       f'<defs>{un(d["defs"])}</defs>{un(d["shadow"])}{un(body)}</svg>')
a = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(),
              output_width=400, output_height=400, background_color='white'))).convert('RGB')
a.save('preview/tsx_roundtrip.png')
import crabigator6 as C
ref = C.build(False, rig={}, eye=1.0).replace(
    'viewBox="0 0 1024 1024" width="1024" height="1024"',
    f'viewBox="{d["viewBox"][0]} {d["viewBox"][1]} {d["viewBox"][2]} {d["viewBox"][3]}"')
b = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=ref.encode(),
              output_width=400, output_height=400, background_color='white'))).convert('RGB')
diff = ImageChops.difference(a, b)
print('max pixel diff:', max(diff.getextrema(), key=lambda e: e[1]))
Image.new('RGB',(812,400),'white').save('preview/_t.png')
c = Image.open('preview/_t.png'); c.paste(b,(0,0)); c.paste(a,(412,0)); c.save('preview/tsx_roundtrip.png')
