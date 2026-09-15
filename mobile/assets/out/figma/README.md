# Figma / Claude Design handoff

Live Figma file: https://www.figma.com/design/ghTmfsSNnEvhWdjb1mLNFW

## To get a .fig

No API — Figma's plugin API, REST API and MCP all included — can write a .fig
file. The format is only produced by the app itself:

    open the file  ->  File  ->  Save local copy   (produces Crabigator Assets.fig)

## What is in this folder

    flat-*.svg    what was pushed into Figma: single path per shape with a
                  centred stroke, no halftone. Figma's SVG importer drops
                  <pattern> fills, so the dot screen cannot survive the trip.
    *.svg         the full-fidelity artwork, halftone included. Drag any of
                  these straight into Figma or Claude Design — same vectors,
                  and the two-pass offset outline the style actually uses.

## Layer structure in the Figma file

Every rigged part is its own named group, so a designer can move a limb without
touching a path:

    crabigator / idle (master)   component. body · carapace · shoulder ·
                                 leg1-3 · band1-5 · tab · boulder · plate ·
                                 head (eyes / eyesHappy / eyesFlat) · claw,
                                 plus fxBurst and fxPuff at 0 opacity
    crabigator / front-on        ground · legR1-3 · legL1-3 · carapace ·
                                 chest1-4 · keel · armR/L · clawR/L · head
    crabigator / bust            the master cropped to the head
    crowd / person               component, traced from the character model
    banner / scene 2400x800      landscape + the master at 0.8 + 12 crowd
                                 instances, positioned from the same numbers
                                 the Python scene uses
