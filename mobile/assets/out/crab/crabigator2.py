#!/usr/bin/env python3
"""Crabigator — crab-anatomy pass.

  - legs split between the two flanks like a real crab: three radiating out
    left (near side, larger, lower) and three out right (far side, smaller,
    higher), not a row along the bottom
  - plastron segments wrap under the body: each band curves, and their widths
    and heights vary as they turn away in perspective
Head unchanged.
"""
BK = "#1A1A1A"
RED, RED_D, RED_L = "#EE3B2B", "#C0281C", "#FB8B7B"
GRN = "#8CC63E"
GY_L, GY_M, GY_D = "#EDEDED", "#C6C6C6", "#9E9E9E"

OUT = 11
OFF = (3.5, 4.5)

def block(paths, fill):
    tf = f' transform="translate({OFF[0]} {OFF[1]})"'
    o = [f'<path d="{d}"{tf} fill="{BK}" stroke="{BK}" stroke-width="{2*OUT}"/>'
         for d in paths]
    o += [f'<path d="{d}" fill="{fill}"/>' for d in paths]
    return "".join(o)

def facet(d, fill):
    return f'<path d="{d}" fill="{fill}"/>'

def edge(d, w=9):
    return (f'<path d="{d}" fill="none" stroke="{BK}" stroke-width="{w}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')

def G(gid, body):
    return (f'<g id="{gid}" stroke-linejoin="round" stroke-linecap="round">'
            + body + '</g>')

# ================================================================ geometry
# --- carapace --------------------------------------------------------------
SHELL = ("M 436 596 L 428 466 L 462 372 L 528 314 L 622 288 L 722 300 "
         "L 792 350 L 826 428 L 830 522 L 806 604 L 744 660 L 646 690 "
         "L 540 682 L 468 650 Z")
SHELL_TOP = ("M 462 372 L 528 314 L 622 288 L 722 300 L 792 350 L 826 428 "
             "L 700 452 L 552 448 L 468 420 Z")
SHELL_SHD = "M 826 428 L 830 522 L 806 604 L 744 660 L 646 690 L 690 570 L 736 452 Z"
SHELL_EDGES = ["M 468 420 L 552 448 L 700 452 L 826 428",
               "M 690 570 L 736 452 L 826 428"]

# --- plastron: wraps under, each band a different width and height ---------
PLATES = [
    "M 480 656 L 546 692 L 640 698 L 726 670 L 734 700 L 646 730 L 548 724 L 476 688 Z",
    "M 476 688 L 548 724 L 646 730 L 734 700 L 744 736 L 652 768 L 550 760 L 470 722 Z",
    "M 470 722 L 550 760 L 652 768 L 744 736 L 750 766 L 656 798 L 552 790 L 466 752 Z",
    "M 466 752 L 552 790 L 656 798 L 750 766 L 752 790 L 658 820 L 554 812 L 462 776 Z",
]
PLATES_EDGES = [
    "M 476 688 L 548 724 L 646 730 L 734 700",
    "M 470 722 L 550 760 L 652 768 L 744 736",
    "M 466 752 L 552 790 L 656 798 L 750 766",
]
PLATES_SHD = [
    "M 640 698 L 726 670 L 734 700 L 646 730 Z",
    "M 646 730 L 734 700 L 744 736 L 652 768 Z",
    "M 652 768 L 744 736 L 750 766 L 656 798 Z",
    "M 656 798 L 750 766 L 752 790 L 658 820 Z",
]

# --- legs: three out the near flank, three out the far flank ---------------
LEGS_NEAR = [
    "M 452 442 L 456 500 L 344 528 L 232 560 L 160 542 L 184 500 L 300 462 Z",
    "M 446 528 L 456 588 L 336 636 L 216 692 L 146 668 L 176 624 L 300 566 Z",
    "M 452 606 L 470 664 L 356 728 L 246 796 L 180 770 L 216 724 L 336 646 Z",
]
LEGS_NEAR_SHD = [
    "M 456 500 L 344 528 L 232 560 L 236 540 L 348 508 L 454 480 Z",
    "M 456 588 L 336 636 L 216 692 L 220 670 L 340 616 L 452 568 Z",
    "M 470 664 L 356 728 L 246 796 L 250 772 L 362 708 L 464 644 Z",
]
LEGS_FAR = [
    "M 812 396 L 812 450 L 890 476 L 954 506 L 976 476 L 940 448 L 870 412 Z",
    "M 822 480 L 828 534 L 898 578 L 954 622 L 976 592 L 940 558 L 880 512 Z",
    "M 810 560 L 808 614 L 866 668 L 916 720 L 940 694 L 908 656 L 856 596 Z",
]
LEGS_FAR_SHD = [
    "M 812 450 L 890 476 L 954 506 L 954 486 L 888 458 L 812 432 Z",
    "M 828 534 L 898 578 L 954 622 L 956 600 L 894 558 L 826 516 Z",
    "M 808 614 L 866 668 L 916 720 L 920 700 L 868 648 L 808 596 Z",
]

# --- left limb: boulder arm forward, fist on the ground --------------------
ARM_L = ("M 442 484 L 386 452 L 316 486 L 288 560 L 314 630 L 386 646 "
         "L 434 588 L 448 520 Z")
ARM_L_SHD = "M 314 630 L 386 646 L 434 588 L 448 520 L 404 532 L 376 592 L 342 622 Z"
FIST_L = ("M 314 628 L 386 646 L 430 690 L 436 766 L 388 812 L 310 814 "
          "L 262 770 L 268 686 Z")
FIST_L_SHD = "M 388 812 L 436 766 L 430 690 L 384 702 L 378 780 Z"
FIST_L_EDGE = "M 312 730 L 360 716 L 406 730"

# --- right limb: pincer -----------------------------------------------------
ARM_R = "M 742 356 L 758 428 L 806 458 L 860 426 L 868 356 L 810 324 Z"
ARM_R_SHD = "M 806 458 L 860 426 L 868 356 L 838 366 L 830 434 Z"
CLAW = ("M 20 24 L 92 40 L 176 74 L 240 88 L 296 96 L 336 148 L 344 216 "
        "L 320 274 L 268 306 L 202 310 L 128 296 L 48 272 L 14 240 L 34 200 "
        "L 112 216 L 192 206 L 196 180 L 128 128 L 52 96 L 8 68 Z")
CLAW_SHD = "M 296 96 L 336 148 L 344 216 L 320 274 L 268 306 L 256 212 L 272 130 Z"
CLAW_EDGES = ["M 256 212 L 272 130 L 296 96", "M 58 254 L 140 270 L 212 280"]
CLAW_TF = "translate(620 44) scale(0.92) rotate(10 290 200)"

# --- head (unchanged) ------------------------------------------------------
HEAD = ("M 300 348 L 292 232 L 306 156 L 336 116 L 392 100 L 424 118 "
        "L 452 164 L 480 108 L 534 116 L 566 180 L 570 300 L 548 358 "
        "L 500 392 L 400 402 L 336 384 Z")
EYE_L = "M 332 166 L 356 154 L 378 170 L 380 216 L 362 240 L 336 236 L 324 208 Z"
EYE_R = "M 438 166 L 466 154 L 492 172 L 494 222 L 474 246 L 446 242 L 432 210 Z"
NOSE = "M 336 314 L 360 300 L 382 316 L 404 300 L 430 310 L 450 336"
NOSTRILS = [(364, 336), (418, 338)]

DEFS = f'''<defs>
<pattern id="dots" width="17" height="17" patternUnits="userSpaceOnUse">
  <circle cx="4" cy="4" r="3.8" fill="{BK}"/><circle cx="12.5" cy="12.5" r="3.8" fill="{BK}"/>
</pattern>
<clipPath id="shellshd"><path d="{SHELL_SHD}"/></clipPath>
</defs>'''

def build(mono=False):
    if mono:
        light, mid, dark, hbase = GY_L, GY_M, GY_D, GY_L
    else:
        light, mid, dark, hbase = RED_L, RED, RED_D, GRN

    b = []
    b.append(G("legs-far", block(LEGS_FAR, mid)
               + "".join(facet(d, dark) for d in LEGS_FAR_SHD)))
    b.append(G("legs-near", block(LEGS_NEAR, mid)
               + "".join(facet(d, dark) for d in LEGS_NEAR_SHD)))
    b.append(G("armR", block([ARM_R], mid) + facet(ARM_R_SHD, dark)))
    b.append(G("shell", block([SHELL], mid) + facet(SHELL_TOP, light)
               + facet(SHELL_SHD, dark) + "".join(edge(d) for d in SHELL_EDGES)))
    b.append(f'<g id="texture" clip-path="url(#shellshd)"><rect x="700" y="430" '
             f'width="180" height="280" fill="url(#dots)" '
             f'opacity="{".4" if mono else ".16"}"/></g>')
    b.append(G("plastron", block(PLATES, light)
               + "".join(facet(d, dark) for d in PLATES_SHD)
               + "".join(edge(d) for d in PLATES_EDGES)))
    b.append(f'<g transform="{CLAW_TF}">'
             + G("claw", block([CLAW], light) + facet(CLAW_SHD, dark)
                 + "".join(edge(d) for d in CLAW_EDGES)) + '</g>')
    b.append(G("armL", block([ARM_L], light) + facet(ARM_L_SHD, dark)))
    b.append(G("fistL", block([FIST_L], light) + facet(FIST_L_SHD, dark)
               + edge(FIST_L_EDGE)))

    face = (f'<path d="{EYE_L}" fill="{BK}"/><path d="{EYE_R}" fill="{BK}"/>'
            + edge(NOSE, 11)
            + "".join(f'<ellipse cx="{x}" cy="{y}" rx="8" ry="7" fill="{BK}"/>'
                      for x, y in NOSTRILS))
    b.append(G("head", block([HEAD], hbase) + face))

    shadow = f'<ellipse cx="540" cy="846" rx="380" ry="30" fill="{BK}" opacity=".1"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024">{DEFS}{shadow}'
            f'<g id="crabigator">' + "".join(b) + '</g></svg>')

if __name__ == "__main__":
    open("svg/crabigator2-color.svg", "w").write(build(False))
    open("svg/crabigator2-mono.svg", "w").write(build(True))
    print("ok")
