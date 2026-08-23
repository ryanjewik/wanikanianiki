#!/usr/bin/env python3
"""Colour + texture treatments layered on the traced crabigator.

Every treatment is paint-server only: the same traced path is drawn a second
time filled with a <pattern> or <linearGradient>. Nothing changes geometry, so
the per-part groups and the transform-only animation rig still work, and
everything used here (Pattern, LinearGradient, ClipPath-free) is supported by
react-native-svg.
"""
import random
import crabigator6 as C

_orig_block = C.block
BASE = dict(RED=C.RED, RED_L=C.RED_L, GRN=C.GRN,
            GY_L=C.GY_L, GY_M=C.GY_M)


def _speck_tile(seed, n, size, dark, lightc):
    r = random.Random(seed)
    o = []
    for _ in range(n):
        x, y = r.uniform(0, size), r.uniform(0, size)
        rad = r.uniform(0.7, 2.3)
        if r.random() < 0.55:
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rad:.1f}" '
                     f'fill="{dark}" opacity="{r.uniform(.10,.26):.2f}"/>')
        else:
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rad:.1f}" '
                     f'fill="{lightc}" opacity="{r.uniform(.10,.30):.2f}"/>')
    return "".join(o)


DOTS = ('<pattern id="tx" width="15" height="15" patternUnits="userSpaceOnUse">'
        '<circle cx="3.6" cy="3.6" r="2.6" fill="#1A1A1A" opacity=".15"/>'
        '<circle cx="11.1" cy="11.1" r="2.6" fill="#1A1A1A" opacity=".15"/>'
        '<circle cx="3.6" cy="11.1" r="1.1" fill="#fff" opacity=".22"/>'
        '<circle cx="11.1" cy="3.6" r="1.1" fill="#fff" opacity=".22"/></pattern>')

GRAIN = ('<pattern id="tx" width="70" height="70" patternUnits="userSpaceOnUse">'
         + _speck_tile(7, 300, 70, "#1A1A1A", "#ffffff") + '</pattern>')

HATCH = ('<pattern id="tx" width="13" height="13" patternUnits="userSpaceOnUse" '
         'patternTransform="rotate(-38)">'
         '<rect width="13" height="13" fill="none"/>'
         '<rect x="0" y="0" width="2.6" height="13" fill="#1A1A1A" opacity=".13"/>'
         '<rect x="6.5" y="0" width="1.1" height="13" fill="#ffffff" opacity=".18"/>'
         '</pattern>')

SHEEN = ('<linearGradient id="tx" x1="0.12" y1="0" x2="0.55" y2="1">'
         '<stop offset="0" stop-color="#fff" stop-opacity=".42"/>'
         '<stop offset=".34" stop-color="#fff" stop-opacity=".10"/>'
         '<stop offset=".62" stop-color="#000" stop-opacity="0"/>'
         '<stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>')

RISO = (SHEEN.replace('id="tx"', 'id="tx2"')
        + '<pattern id="tx" width="70" height="70" patternUnits="userSpaceOnUse">'
        + _speck_tile(3, 240, 70, "#2B1A6A", "#FFE24B") + '</pattern>')


def _tex_overlay(d, extra=""):
    return f'<path d="{d}" fill="url(#tx)"{extra}/>'


STYLES = {}


def style(name, **kw):
    STYLES[name] = kw
    return kw


style("flat", label="1 · as-is", pal=BASE, defs="", tex=None)

POP = dict(RED="#F5372B", RED_L="#FFA694", GRN="#9BDC33",
           GY_L="#F4F4F4", GY_M="#C9C9C9")
style("pop", label="2 · punched-up flat", pal=POP, defs="", tex=None)
style("halftone", label="3 · halftone dots", pal=POP, defs=DOTS, tex="tx")
style("grain", label="4 · stone grain", pal=POP, defs=GRAIN, tex="tx")
style("hatch", label="5 · cross-hatch", pal=POP, defs=HATCH, tex="tx")
style("sheen", label="6 · gradient volume", pal=POP, defs=SHEEN, tex="tx")
style("riso", label="7 · riso (grain + sheen)",
      pal=dict(RED="#FF4B33", RED_L="#FFB39F", GRN="#A8E13B",
               GY_L="#F4F4F4", GY_M="#C9C9C9"),
      defs=RISO, tex="tx", tex2="tx2")


# ---- facet tinting: each traced part gets its own slight shift of the base
# hue, so the shell reads as cut rock rather than one flat fill
def _shift(hexc, dl, ds=0.0):
    import colorsys
    r, g, b = (int(hexc[i:i+2], 16) / 255 for i in (1, 3, 5))
    h, l, sat = colorsys.rgb_to_hls(r, g, b)
    l = max(0.0, min(1.0, l + dl)); sat = max(0.0, min(1.0, sat + ds))
    r, g, b = colorsys.hls_to_rgb(h, l, sat)
    return "#%02X%02X%02X" % (round(r*255), round(g*255), round(b*255))


_JIT = [0.0, .045, -.035, .02, -.055, .06, -.02, .035, -.045, .015,
        .05, -.03, .025, -.06, .04, -.015, .055]

style("facet", label="8 \u00b7 faceted rock", pal=POP, defs=GRAIN, tex="tx",
      jitter=True)
style("sunset", label="9 \u00b7 sunset palette",
      pal=dict(RED="#E8402F", RED_L="#FFC08A", GRN="#C8E23A",
               GY_L="#F4F4F4", GY_M="#C9C9C9"),
      defs=SHEEN, tex="tx")


def build(name, mono=False, rig=None, eye=1.0):
    s = STYLES[name]
    for k, v in s["pal"].items():
        setattr(C, k, v)

    ctr = [0]

    def patched(paths, fill, amp=None):
        if s.get("jitter"):
            fill = _shift(fill, _JIT[ctr[0] % len(_JIT)])
            ctr[0] += 1
        out = _orig_block(paths, fill, amp)
        if s.get("tex"):
            ws = [C.wob(d) if amp is None else C.wob(d, amp) for d in paths]
            if s.get("tex2"):
                out += "".join(f'<path d="{d}" fill="url(#{s["tex2"]})"/>' for d in ws)
            out += "".join(f'<path d="{d}" fill="url(#{s["tex"]})"/>' for d in ws)
        return out

    C.block = patched
    try:
        svg = C.build(mono=mono, rig=rig, eye=eye)
    finally:
        C.block = _orig_block
        for k, v in BASE.items():
            setattr(C, k, v)
    return svg.replace("<defs>", "<defs>" + s["defs"], 1)
