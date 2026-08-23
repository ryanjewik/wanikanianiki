#!/usr/bin/env python3
"""Rig + poses for the traced crabigator.

Every part is already its own named <g>, so animating is just a matter of
handing build() a dict of {group id: transform}. Pivots below are the point
each part actually hinges around in the traced geometry.
"""
import math
import crabigator6 as C

# hinge points read off the traced parts
PIV = {
    'head':     (360, 500),      # base of the skull where it meets the shell
    'claw':     (620, 520),      # wrist, inside the body
    'boulder':  (230, 700),      # centre of the resting rock
    'plate':    (155, 570),
    'leg1':     (490, 660),      # each leg hinges at its top edge
    'leg2':     (620, 650),
    'leg3':     (525, 685),
    'body':     (500, 620),
}
BODY_PARTS = ['body', 'carapace', 'shoulder', 'tab',
              'band1', 'band2', 'band3', 'band4', 'band5']


def rot(gid, deg, dx=0.0, dy=0.0):
    x, y = PIV[gid]
    return f'translate({dx:.2f} {dy:.2f}) rotate({deg:.3f} {x} {y})'


def tr(dx, dy):
    return f'translate({dx:.2f} {dy:.2f})'


def idle(t):
    """gentle breathing loop, t in [0,1)"""
    a = 2 * math.pi * t
    bob = -5 * math.sin(a)
    r = {p: tr(0, bob) for p in BODY_PARTS}
    r['head'] = rot('head', 1.2 * math.sin(a - 0.5), 0, bob * 1.5 - 2)
    r['claw'] = rot('claw', 2.4 * math.sin(a - 0.9), 0, bob * 0.8)
    r['boulder'] = tr(0, bob * 0.25)
    r['plate'] = tr(0, bob * 0.25)
    for i, ph in enumerate((0.0, 0.35, 0.7)):
        r[f'leg{i+1}'] = tr(0, bob * (0.35 + 0.2 * i))
    return r, 1.0


def wave(t):
    """pincer salute — the claw swings, the body counter-leans"""
    a = 2 * math.pi * t
    sw = math.sin(a)
    bob = -4 * math.sin(2 * a)
    r = {p: tr(1.5 * sw, bob) for p in BODY_PARTS}
    r['head'] = rot('head', -3.5 * sw, 0, bob * 1.4 - 2)
    r['claw'] = rot('claw', 15 * sw - 4, 0, bob)
    r['boulder'] = tr(0, bob * 0.2)
    r['plate'] = tr(0, bob * 0.2)
    for i in range(3):
        r[f'leg{i+1}'] = tr(0, bob * 0.4)
    return r, 1.0


def walk(t):
    """side shuffle — legs alternate, shell rocks"""
    a = 2 * math.pi * t
    bob = -7 * abs(math.sin(a))
    lean = 1.8 * math.sin(a)
    r = {p: rot('body', lean, 0, bob) for p in BODY_PARTS}
    r['head'] = rot('head', lean * 1.6 - 1, 0, bob * 1.3 - 3)
    r['claw'] = rot('claw', -lean * 2.2, 0, bob)
    r['boulder'] = tr(0, bob * 0.3)
    r['plate'] = tr(0, bob * 0.3)
    for i, ph in enumerate((0.0, 0.33, 0.66)):
        s = math.sin(a + 2 * math.pi * ph)
        r[f'leg{i+1}'] = rot(f'leg{i+1}', 7 * s, 4 * s, -6 * max(s, 0))
    return r, 1.0


def blink(t):
    """eyes close and open once per loop"""
    r, _ = idle(t)
    k = math.cos(2 * math.pi * t)
    e = 1.0 if k > -0.55 else 0.12
    return r, e


POSES = {'idle': idle, 'wave': wave, 'walk': walk, 'blink': blink}


def frame(pose, t, mono=False):
    rig, eye = POSES[pose](t)
    return C.build(mono=mono, rig=rig, eye=eye)
