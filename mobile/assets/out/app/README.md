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
