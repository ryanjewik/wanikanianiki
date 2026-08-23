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


# ---------------------------------------------------------- answer feedback
def _ease(x):
    """smoothstep, for anticipation/settle ramps"""
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def _win(t, a, b):
    """0 before a, 1 after b, smooth in between"""
    return _ease((t - a) / (b - a)) if b > a else 0.0


def _bump(t, a, pk, b):
    """rises to 1 at pk then falls back to 0 by b"""
    if t < a or t > b:
        return 0.0
    return _win(t, a, pk) if t <= pk else 1.0 - _win(t, pk, b)


def correct(t):
    """big reaction: squat, jump with both claws thrown up, burst, land"""
    squat = _bump(t, 0.0, 0.14, 0.26) * 16          # anticipation crouch
    air = _bump(t, 0.16, 0.34, 0.62)                 # the jump itself
    land = _bump(t, 0.60, 0.68, 0.86)                # landing squash
    y = squat - 96 * air + 12 * land
    lift = _bump(t, 0.12, 0.36, 0.95)                # claws up and held

    r = {p: tr(0, y) for p in BODY_PARTS}
    r['head'] = rot('head', -6 * lift, 0, y * 1.25 - 4 * lift)
    r['claw'] = rot('claw', -46 * lift, 10 * lift, y - 26 * lift)
    # the left pincer lives inside a mirrored group, so its horizontal motion
    # comes out reversed — it needs its own, gentler swing pushed outward or it
    # converges behind the head
    r['clawL'] = rot('claw', -22 * lift, 76 * lift, y - 40 * lift)
    r['boulder'] = rot('boulder', 16 * lift, -8 * lift, y * 0.9 - 16 * lift)
    r['plate'] = rot('plate', 16 * lift, -8 * lift, y * 0.9 - 16 * lift)
    for i in range(3):
        tuck = 10 * air - 5 * land
        r[f'leg{i+1}'] = rot(f'leg{i+1}', tuck * (1 if i % 2 else -1),
                             0, y + 6 * air)
    return dict(rig=r, eye=1.0, eyes='happy', arms='up',
                burst=_bump(t, 0.20, 0.32, 0.70), puff=0.0)


def wrong(t):
    """big reaction: recoil, three decaying shakes, slump, dust at the base"""
    kick = _bump(t, 0.0, 0.08, 0.22)
    shake = math.sin(2 * math.pi * 3.2 * t) * math.exp(-5.5 * t)
    slump = _win(t, 0.30, 0.62) - _win(t, 0.88, 1.0) * 0.25
    x = 26 * kick + 30 * shake
    y = -10 * kick + 20 * slump

    r = {p: tr(x, y) for p in BODY_PARTS}
    r['head'] = rot('head', 5 * kick + 7 * slump, x * 1.15,
                    y * 1.2 + 10 * slump)
    r['claw'] = rot('claw', 16 * kick - 22 * slump, x * 0.8, y + 14 * slump)
    for g in ('boulder', 'plate', 'boulderR', 'plateR'):
        r[g] = tr(x * 0.5, y * 0.5 + 4 * slump)
    for i in range(3):
        r[f'leg{i+1}'] = tr(x * (0.6 - 0.15 * i), y * 0.7)
    return dict(rig=r, eye=1.0, eyes='flat', arms='down',
                burst=0.0, puff=_bump(t, 0.10, 0.26, 0.92))


POSES = {'idle': idle, 'wave': wave, 'walk': walk, 'blink': blink,
         'correct': correct, 'wrong': wrong}


def frame(pose, t, mono=False):
    out = POSES[pose](t)
    if isinstance(out, tuple):                       # the four looping poses
        rig, eye = out
        out = dict(rig=rig, eye=eye)
    return C.build(mono=mono, rig=out['rig'], eye=out.get('eye', 1.0),
                   eyes=out.get('eyes', 'open'), burst=out.get('burst', 0.0),
                   puff=out.get('puff', 0.0), arms=out.get('arms', 'default'))
