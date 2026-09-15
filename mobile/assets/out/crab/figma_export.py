#!/usr/bin/env python3
"""Compact the artwork for Figma import.

Two things make the working SVGs too heavy to hand to the Figma plugin API
(50k per call):

  * every shape is drawn twice — a black underlay offset by (4.5, 5.5) and
    stroked at 30, then the colour fill on top. That offset outline is a print
    trick; in Figma a single path with a centred stroke is the editable
    equivalent, and halves the path count.
  * the wobble emits one decimal per coordinate. Rounding to whole units is
    invisible at any sane zoom and saves about a fifth.

Everything else — the traced geometry, the halftone patterns, the clip groups,
the layer names — is passed through unchanged.
"""
import re


def compact(svg: str, stroke: int = 15) -> str:
    # pair each underlay with the fill that repeats its `d`, drop the underlay
    # and give the fill the stroke instead
    under = re.compile(
        r'<path d="([^"]+)" transform="translate\([\d.]+ [\d.]+\)" '
        r'fill="#1A1A1A" stroke="#1A1A1A" stroke-width="[\d.]+"/>')
    ds = set()
    for m in under.finditer(svg):
        ds.add(m.group(1))
    svg = under.sub('', svg)

    def add_stroke(m):
        d, rest = m.group(1), m.group(2)
        if d in ds and 'stroke' not in rest:
            return (f'<path d="{d}"{rest} stroke="#1A1A1A" '
                    f'stroke-width="{stroke}" stroke-linejoin="round"/>')
        return m.group(0)

    svg = re.sub(r'<path d="([^"]+)"([^/>]*)/>', add_stroke, svg)
    # whole-unit coordinates — inside path data ONLY. Rounding the whole
    # document also hit opacity="0.42" -> opacity="0", which silently deleted
    # every halftone dot.
    svg = re.sub(r'd="([^"]+)"',
                 lambda m: 'd="' + re.sub(r'(\d)\.\d+', r'\1', m.group(1))
                 + '"', svg)
    return re.sub(r'\s{2,}', ' ', svg)


if __name__ == '__main__':
    import os, sys
    os.makedirs('figma', exist_ok=True)
    for src in sys.argv[1:]:
        out = 'figma/' + os.path.basename(src)
        s = compact(open(src).read())
        open(out, 'w').write(s)
        print(f'{os.path.basename(src):34s} {len(open(src).read()):7d} -> {len(s):7d}')


def flatten(svg: str) -> str:
    """Drop the halftone screens.

    Figma's SVG import does not support <pattern> fills — the imported front
    view came back with the dots gone and the clip groups left behind as empty
    clipping frames. So strip them at the source: the Figma file gets clean
    flat vectors, and the halftone stays in the SVG/PNG exports.
    """
    svg = re.sub(r'<g clip-path="url\(#cp\d+\)">.*?</g>', '', svg, flags=re.S)
    svg = re.sub(r'<pattern id="[^"]+".*?</pattern>', '', svg, flags=re.S)
    svg = re.sub(r'<clipPath id="cp\d+">.*?</clipPath>', '', svg, flags=re.S)
    svg = re.sub(r'<path d="[^"]*" fill="url\(#[^)]+\)"/>', '', svg)
    svg = re.sub(r'<defs>\s*</defs>', '', svg)
    return re.sub(r'\s{2,}', ' ', svg)
