#!/usr/bin/env python3
"""Crabigator — every part machine-traced from the reference.

Pipeline, applied to each body part in turn (the one that finally worked for
the legs):

  1. scale the photo so its head lands on this canvas (preview/ref_aligned.png)
  2. threshold into ink / not-ink; the heavy black outlines seal every part
     into its own region, so connected-component labelling separates them
  3. dilate each region by half the ink weight to recover the drawn shape
     rather than its interior
  4. Douglas-Peucker the contour down to a handful of vertices

Nothing below was estimated by eye. Vertex counts and sizes fell out of the
trace: head 13, pincer 16, front leg 9 (193x167), boulder 14, plate 4.

Because every part is drawn as its own outlined polygon in the same fill, the
black lines *between* parts come for free — that is how the reference builds
its internal structure.
"""
from ink import wob, wobo

BK = "#1A1A1A"
RED, RED_D, RED_L = "#EE3B2B", "#C0281C", "#FB8B7B"
GRN = "#8CC63E"
GY_L, GY_M, GY_D = "#F4F4F4", "#C9C9C9", "#ADADAD"

OUT = 15
OFF = (4.5, 5.5)


def block(paths, fill, amp=None):
    w = [wob(d) if amp is None else wob(d, amp) for d in paths]
    tf = f' transform="translate({OFF[0]} {OFF[1]})"'
    o = [f'<path d="{d}"{tf} fill="{BK}" stroke="{BK}" stroke-width="{2*OUT}"/>'
         for d in w]
    o += [f'<path d="{d}" fill="{fill}"/>' for d in w]
    return "".join(o)


def facet(d, fill):
    return f'<path d="{wob(d)}" fill="{fill}"/>'


def edge(d, w=17):
    return (f'<path d="{wobo(d)}" fill="none" stroke="{BK}" stroke-width="{w}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')


RIG = {}          # group id -> extra transform, set per animation frame


def G(gid, body):
    tf = RIG.get(gid)
    tf = f' transform="{tf}"' if tf else ''
    return (f'<g id="{gid}"{tf} stroke-linejoin="round" stroke-linecap="round">'
            + body + '</g>')


def P(pts):
    return "M " + " L ".join(f"{x:.0f} {y:.0f}" for x, y in pts) + " Z"


def PL(pts):
    return "M " + " L ".join(f"{x:.0f} {y:.0f}" for x, y in pts)


# ===================================================== body (union of parts)
# Outer contour of every mid-tone region unioned together. Only the stretch
# that runs behind the head, and the stretch hidden behind the bird on the
# right, are drawn in by hand — the photo gives no outline there.
BODY = P([(151, 493), (150, 544), (273, 641), (289, 686), (355, 742),
          (345, 808), (361, 819), (488, 815), (516, 764), (559, 808),
          (687, 809), (760, 806), (778, 764), (796, 706), (800, 640),
          (790, 585), (770, 500), (720, 452), (650, 420),
          (580, 398), (543, 373), (500, 351), (430, 380), (350, 402),
          (270, 432), (198, 462)])
# Two hand-drawn mistakes lived on this right-rear stretch and are now fixed:
#   * a BODY_SHD dark facet — the reference is two values plus ink, no third
#     tone anywhere, so it is deleted rather than restyled
#   * the rear itself bulged to x=862 while the rearmost leg ends at x=791,
#     leaving a bare 71px lobe sticking out beside the legs. The traced body
#     union only ever reached x=790, so the rear now follows just behind the
#     far leg instead of being invented past it.

# ---- facets of the shell, each its own traced region
CARAPACE = P([(400, 502), (396, 582), (461, 673), (502, 638), (562, 662),
              (605, 634), (736, 624), (784, 584), (748, 521), (613, 529),
              (588, 577), (521, 583), (502, 560), (537, 374), (500, 357)])
SHOULDER = P([(218, 458), (157, 495), (155, 540), (184, 543), (242, 622),
              (274, 511)])
TAB = P([(522, 503), (502, 569), (541, 595), (591, 577), (612, 530)])

# ---- legs: the front one is the shape traced from the circled leg; the two
# behind are their own traced regions, so the perspective is the photo's.
LEG_FRONT = [(469, 665), (465, 752), (537, 760), (564, 803), (658, 798),
             (649, 750), (603, 731), (574, 665), (501, 636)]
LEG_MID = [(590, 638), (567, 663), (602, 733), (645, 750), (659, 798),
           (684, 804), (700, 753), (662, 723), (663, 654)]
# third leg: the front shape again, squashed in x the way the photo's rear
# legs are, and stepped up and right
LEGS = [P([(x * 0.60 + 396, y * 0.94 + 42) for x, y in LEG_FRONT]),
        P(LEG_MID),
        P(LEG_FRONT)]

# ---- belly bands
BANDS = [P([(406, 503), (319, 522), (275, 510), (251, 555), (353, 570),
            (402, 546)]),
         P([(401, 554), (256, 557), (245, 617), (293, 642), (350, 637),
            (409, 603)]),
         P([(447, 652), (408, 601), (289, 642), (295, 684), (336, 713),
            (398, 704)]),
         P([(463, 672), (443, 658), (396, 700), (341, 719), (367, 741),
            (421, 738), (459, 709)]),
         P([(418, 737), (364, 740), (354, 811), (394, 811), (431, 762)])]

# ===================================================== boulder
BOULDER = P([(101, 608), (81, 633), (81, 727), (128, 806), (172, 836),
             (232, 844), (312, 836), (364, 790), (362, 737),
             (290, 684), (292, 644), (243, 626), (217, 582)])
BOULDER_EDGE = PL([(170, 647), (191, 688), (296, 685), (337, 712)])   # w 15.6
PLATE = P([(206, 572), (188, 541), (109, 562), (104, 597)])

# ===================================================== pincer
CLAW = P([(845, 286), (813, 250), (770, 260), (774, 328), (682, 354),
          (645, 400), (634, 361), (662, 325), (652, 274), (573, 291),
          (558, 360), (515, 410), (532, 503), (617, 531), (751, 519),
          (865, 391)])
CLAW_EDGE = PL([(776, 432), (745, 440), (706, 476), (654, 473)])      # w 12.0
CLAW_TF = "translate(44 -8)"          # clear of the head, drawn in front

# ===================================================== head
HEAD = P([(282, 127), (229, 176), (191, 412), (254, 502), (326, 524),
          (421, 495), (473, 428), (532, 233), (495, 171), (442, 142),
          (388, 156), (360, 218), (334, 156)])
EYE_L = P([(282, 209), (246, 231), (248, 285), (274, 303), (302, 273),
           (302, 238)])
EYE_R = P([(426, 218), (385, 245), (376, 283), (395, 317), (430, 312),
           (450, 265)])
NOSE = PL([(250, 404), (278, 387), (291, 388), (312, 402), (352, 391),
           (390, 414)])                                               # w 12.0
NOSTRILS = [(284, 423, 6.7), (355, 427, 7.0)]        # centre + measured radius

# ---- interior detail lines: ink that sits INSIDE a shape rather than
# separating two of them. Found by counting how many labelled regions fall
# within half a line-width of each ink pixel — one region means an interior
# stroke — then skeletonising and simplifying. Widths are the measured
# stroke thickness from the distance transform.
SHOULDER_Z = PL([(206, 551), (218, 539), (206, 508), (218, 492)])     # w 10.0
CARAPACE_CREASE = PL([(416, 617), (443, 589), (448, 553), (474, 530)])  # w 11.2
CARAPACE_DOT = (491, 507, 6.1)

# traced run is x 393-652; extended left and right along the same slope so it
# carries the whole figure the way the photo's ground line does
GROUND = PL([(120, 810), (260, 806), (393, 801), (423, 814), (553, 802),
             (629, 807), (760, 800), (900, 804)])                     # w 22.8

DEFS = f'<defs><clipPath id="bodyclip"><path d="{wob(BODY)}"/></clipPath></defs>'


def build(mono=False, rig=None, eye=1.0):
    global RIG
    RIG = rig or {}
    if mono:
        light, mid, hbase = GY_L, GY_M, GY_L
    else:
        light, mid, hbase = RED_L, RED, GRN

    b = []
    b.append(G("ground", edge(GROUND, 22)))
    b.append(G("body", block([BODY], mid)))
    b.append(G("carapace", block([CARAPACE], mid) + edge(CARAPACE_CREASE, 11)
               + f'<ellipse cx="{CARAPACE_DOT[0]}" cy="{CARAPACE_DOT[1]}" '
                 f'rx="{CARAPACE_DOT[2]}" ry="{CARAPACE_DOT[2]}" fill="{BK}"/>'))
    b.append(G("shoulder", block([SHOULDER], mid) + edge(SHOULDER_Z, 10)))
    b.append("".join(G(f"leg{i+1}", block([d], mid, 3.0))
                     for i, d in enumerate(LEGS)))
    b.append("".join(G(f"band{i+1}", block([d], mid))
                     for i, d in enumerate(BANDS)))
    b.append(G("tab", block([TAB], light)))
    b.append(G("boulder", block([BOULDER], light) + edge(BOULDER_EDGE, 16)))
    b.append(G("plate", block([PLATE], light)))

    ec = f'translate(0 {(1 - eye) * 262:.1f}) scale(1 {eye})' if eye != 1.0 else ''
    ec = f' transform="{ec}"' if ec else ''
    face = (f'<g id="eyes"{ec}><path d="{wob(EYE_L, 2.5, 34)}" fill="{BK}"/>'
            f'<path d="{wob(EYE_R, 2.5, 34)}" fill="{BK}"/></g>' + edge(NOSE, 12)
            + "".join(f'<ellipse cx="{x}" cy="{y}" rx="{r}" ry="{r}" '
                      f'fill="{BK}"/>' for x, y, r in NOSTRILS))
    b.append(G("head", block([HEAD], hbase, 4.0) + face))
    b.append(f'<g transform="{CLAW_TF}">'
             + G("claw", block([CLAW], light) + edge(CLAW_EDGE, 12)) + '</g>')

    shadow = f'<ellipse cx="500" cy="862" rx="400" ry="30" fill="{BK}" opacity=".1"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024">{DEFS}{shadow}'
            f'<g id="crabigator">' + "".join(b) + '</g></svg>')


if __name__ == "__main__":
    open("svg/crabigator6-color.svg", "w").write(build(False))
    open("svg/crabigator6-mono.svg", "w").write(build(True))
    print("ok")
