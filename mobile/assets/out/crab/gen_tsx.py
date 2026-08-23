#!/usr/bin/env python3
"""Turn the rest-pose SVG into react-native-svg JSX, one <G> per rigged part."""
import re, json
import anim, crabigator6 as C

VB = (56, 60, 912, 912)
svg = C.build(mono=False, rig={}, eye=1.0)
defs = re.search(r'<defs>(.*?)</defs>', svg, re.S).group(1)
shadow = re.search(r'(<ellipse cx="500".*?/>)', svg).group(1)
inner = svg.split('<g id="crabigator">', 1)[1].rsplit('</g></svg>', 1)[0]


def split_groups(s):
    out, i = [], 0
    while i < len(s):
        j = s.find('<g', i)
        if j < 0:
            break
        depth, k = 0, j
        while k < len(s):
            if s.startswith('<g', k):
                depth += 1; k = s.index('>', k) + 1
            elif s.startswith('</g>', k):
                depth -= 1; k += 4
                if depth == 0:
                    break
            else:
                k += 1
        chunk = s[j:k]
        m = re.match(r'<g id="([A-Za-z0-9]+)"', chunk)
        out.append((m.group(1) if m else None, chunk))
        i = k
    return out


def jsx(s):
    return (s.replace('<path', '<Path').replace('<ellipse', '<Ellipse')
             .replace('<g ', '<G ').replace('<g>', '<G>').replace('</g>', '</G>')
             .replace('stroke-width=', 'strokeWidth=')
             .replace('stroke-linecap=', 'strokeLinecap=')
             .replace('stroke-linejoin=', 'strokeLinejoin=')
             .replace('clip-path=', 'clipPath=')
             .replace('<clipPath', '<ClipPath').replace('</clipPath>', '</ClipPath>')
             .replace('<pattern', '<Pattern').replace('</pattern>', '</Pattern>')
             .replace('<circle', '<Circle')
             .replace('patternUnits=', 'patternUnits=')
             .replace('stop-color=', 'stopColor=')
             .replace('stop-opacity=', 'stopOpacity='))


def body_of(chunk):
    return jsx(chunk[chunk.index('>') + 1:-4])


parts, order = {}, []
for gid, chunk in split_groups(inner):
    if gid is None:                       # the claw's translate wrapper
        for gid2, c2 in split_groups(chunk[chunk.index('>') + 1:-4]):
            parts[gid2] = body_of(c2); order.append(gid2)
        continue
    parts[gid] = body_of(chunk); order.append(gid)

head = parts['head']
EYES = ['eyes', 'eyesHappy', 'eyesFlat']
for key in EYES:                       # each eye state is its own component
    m = re.search(r'<G id="%s"[^>]*>(.*?)</G>' % key, head, re.S)
    parts[key] = m.group(1)
    head = head.replace(m.group(0), '{%s}' % key)
parts['head'] = head
TF = {'claw': C.CLAW_TF, 'clawL': C.CLAW_L_TF,
      'boulderR': C.ROCK_R_TF, 'plateR': C.ROCK_R_TF}
json.dump({'order': order, 'eyeStates': EYES, 'tf': TF,
           'parts': parts, 'viewBox': VB, 'clawTF': C.CLAW_TF,
           'piv': anim.PIV, 'bodyParts': anim.BODY_PARTS,
           'defs': jsx(defs), 'shadow': jsx(shadow)},
          open('app/src/_parts.json', 'w'))
print(order)
