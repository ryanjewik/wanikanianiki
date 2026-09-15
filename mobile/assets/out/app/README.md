# Crabgator — mobile app asset pack

Everything here is generated from `crabigator6.py`, whose geometry was
machine-traced from the reference photo. Nothing is a screenshot of a drawing;
the vectors are the source of truth, so every raster below can be re-rendered
at any size by re-running the exporters.

```
app/
├── src/                       React Native components (TypeScript)
│   ├── CrabGator.tsx          animated — Reanimated + react-native-svg
│   ├── CrabGatorStatic.tsx    no-animation version, svg only
│   ├── CrabGatorParts.tsx     AUTO-GENERATED geometry, one export per part
│   └── index.ts
└── assets/
    ├── poses/                 6 poses · svg + png @1x/@2x/@3x + contact sheet
    ├── anim/                  gif + transparent sprite strip per pose
    ├── views/                 front-on, head bust, circular avatars
    ├── banners/               in-app header strips, transparent
    └── icon/                  app icon, Android adaptive pair, favicons, splash
```

## Using the component

```bash
npm i react-native-svg react-native-reanimated
```

```tsx
import { CrabGator } from './src';

<CrabGator size={220} pose="wave" speed={2.4} blinkEvery={4.5} />
```

| prop | type | default | notes |
|---|---|---|---|
| `size` | number | 240 | square, in dp |
| `pose` | `'idle' \| 'wave' \| 'walk' \| 'correct' \| 'wrong'` | `'idle'` | |
| `speed` | number | 2.4 | seconds per loop, looping poses only |
| `reactionMs` | number | 1000 | how long a `correct` / `wrong` reaction runs |
| `blinkEvery` | number | 4.5 | seconds between blinks; `0` disables |
| `onReactionEnd` | `() => void` | — | fires when a reaction finishes |

### Answer feedback

`correct` and `wrong` are one-shots, not loops. Set the pose when the answer
lands and return to `idle` from `onReactionEnd`:

```tsx
const [pose, setPose] = useState<Pose>('idle');

const onAnswer = (ok: boolean) => setPose(ok ? 'correct' : 'wrong');

<CrabGator
  pose={pose}
  onReactionEnd={() => setPose('idle')}
/>
```

`correct` squats, jumps with both claws thrown up, pops a burst of accent
shapes from behind the silhouette and lands with a squash; the eyes switch to
a happy squint. `wrong` recoils, shakes three times with a decaying envelope,
slumps, and kicks up rubble at the base; the eyes go flat. The timing helpers
in `CrabGator.tsx` are the same `bump`/`win` curves used by the Python rig, so
the vector component and the exported sprite frames stay in step.

`CrabGatorStatic` takes `size` and `face` (`'open' | 'happy' | 'flat'`) and
pulls in no animation dependency.

## Regenerating

```bash
python3 crabigator6.py     # svg masters
python3 export_app.py      # poses, sprite strips, gifs
python3 export_extra.py    # angles, banners, icon set
python3 gen_tsx.py         # scrape the rest pose into _parts.json
python3 write_tsx.py       # emit the components
python3 verify_tsx.py      # round-trip the JSX back to SVG and diff
```

## Rendering notes (read this before you touch the pipeline)

Three things in the original pack made the mascot flicker under
`react-native-svg` + Reanimated. All three are fixed; here is what to avoid
re-introducing.

### 1. Shading is now clipped in Python, not by `<clipPath>`

Each part's shadow used to be a giant half-plane rectangle (spanning
−3043 … +6541 on a 1024 canvas) cut down to the part by a nested `<clipPath>`.
That renders fine in a browser. Inside `react-native-svg` a clip path nested
under an *animated* transform is unreliable on Android — when it drops, you get
a 9,500-unit slab of 42 % black sweeping across the mascot as the part moves.
That was the "black shadow jumping across" you saw.

`_shade()` in `crabigator6.py` now runs Sutherland–Hodgman against the part's
own flattened outline and emits a closed polygon that is already the right
shape. Current audit of `CrabGatorParts.tsx`:

```
paths outside the canvas : 0     (was 74)
ClipPath                 : 0     (was 37)
```

### 2. `SCREEN = 'dots' | 'tone'`

The halftone is a real SVG `<pattern>`. `patternUnits="userSpaceOnUse"` is
resolved against the *root* in `react-native-svg`, not against the ancestor
transform — so inside an animated group the dot field stays pinned to the
screen while the part slides over it, and the texture appears to crawl. That
was the "hues jumping".

`crabigator6.SCREEN` switches the shading paint:

| value | paint | used by |
|---|---|---|
| `'dots'` | `<pattern>` halftone | 1024 masters, banners, Figma export |
| `'tone'` | flat black at the dot screen's average coverage | poses, anim frames, the RN component |

`_tone(r)` computes that average — `2πr²/gap² × opacity` → `0.056` and `0.150`
for the two terminators. At the sizes the app actually draws (120–256 dp) the
two are visually the same: mean absolute difference is **0.59/255 at 120 px**,
1.24 at 160, 2.11 at 240. `export_app.py`, `gen_tsx.py` and `verify_tsx.py`
all set `C.SCREEN = 'tone'` before building; `export_extra.py` leaves it on
`'dots'`.

If you add an exporter, pick one deliberately — and if it feeds an animated
group, pick `'tone'`.

### 3. GIFs use one shared palette

Pillow quantises each frame independently by default, so a pixel whose source
colour never changed still got re-indexed frame to frame and shimmered.
`export_app.py` now stacks the whole loop into one tall image, builds a single
200-colour palette from it, and maps every frame through that palette with
dithering off.

Measured over the idle loop, counting pixels whose *source* is identical
between consecutive frames but whose encoded colour moved:

```
per-frame adaptive 64    31655
one shared palette 200       0
```

### 4. Number formatting

`opacity=".1"` is legal SVG but risks being parsed as `1` by the RN bridge.
Everything is emitted with a leading zero; the audit checks for it.

### Verifying a change

`verify_tsx.py` converts the generated JSX back to SVG, renders it, and diffs
against a direct render of the same pose. Current: **380 differing pixels of
160,000**, all antialiasing on the ink edges.
