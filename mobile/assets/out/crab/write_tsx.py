#!/usr/bin/env python3
"""Emit the react-native-svg components from _parts.json."""
import json
d = json.load(open('app/src/_parts.json'))
P, order, VB, PIV = d['parts'], d['order'], d['viewBox'], d['piv']
EYES = d['eyeStates']


def pas(k):
    return k[0].upper() + k[1:]


# ---------------------------------------------------------------- parts file
lines = ['// AUTO-GENERATED from crabigator6.py — do not hand-edit.',
         '// Every path here was machine-traced from the source artwork.',
         "import * as React from 'react';",
         "import { Path, Ellipse, G, ClipPath, Pattern, Circle } "
         "from 'react-native-svg';", '']
for k in order + EYES:
    body = P[k]
    if k == 'head':
        args = ', '.join(EYES)
        typ = '; '.join(f'{e}?: React.ReactNode' for e in EYES)
        lines.append(f'export const Head = ({{ {args} }}: '
                     f'{{ {typ} }}) => (<>{body}</>);')
    else:
        lines.append(f'export const {pas(k)} = () => (<>{body}</>);')
lines += ['',
          f'export const VIEW_BOX = "{VB[0]} {VB[1]} {VB[2]} {VB[3]}";',
          'export const DEFS = () => (<>' + d['defs'] + '</>);',
          'export const SHADOW = () => (<>' + d['shadow'] + '</>);',
          'export const PIVOTS = ' + json.dumps(PIV) + ' as const;']
open('app/src/CrabGatorParts.tsx', 'w').write('\n'.join(lines) + '\n')

# ---------------------------------------------------------------- animated
tsx = r'''
/**
 * CrabGator — animated mascot.
 *
 * Geometry comes from CrabGatorParts.tsx, generated from the traced artwork.
 * Each rigged part is its own <G>; the animation only ever sets a transform or
 * an opacity on those groups, so the vectors never change and the whole thing
 * stays crisp at any size.
 *
 * Poses split in two:
 *   loops     idle | wave | walk   run forever off a 0..1 phase
 *   one-shots correct | wrong      play once off a 0..1 progress value, for
 *                                  answer feedback. Pass onReactionEnd to be
 *                                  told when the reaction has finished.
 *
 *   npm i react-native-svg react-native-reanimated
 */
import * as React from 'react';
import Svg, { G, Defs } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, useDerivedValue, runOnJS,
  withRepeat, withTiming, withSequence, Easing, cancelAnimation,
} from 'react-native-reanimated';
import * as Parts from './CrabGatorParts';

const AG = Animated.createAnimatedComponent(G);

export type LoopPose = 'idle' | 'wave' | 'walk';
export type ReactionPose = 'correct' | 'wrong';
export type Pose = LoopPose | ReactionPose;

export interface CrabGatorProps {
  size?: number;
  pose?: Pose;
  /** seconds per loop, for the looping poses */
  speed?: number;
  /** ms for a correct/wrong reaction to play through */
  reactionMs?: number;
  /** blink every N seconds; 0 disables */
  blinkEvery?: number;
  /** fired when a correct/wrong reaction finishes */
  onReactionEnd?: () => void;
}

const P = Parts.PIVOTS;
const TAU = Math.PI * 2;
const rot = (deg: number, p: readonly [number, number], dx = 0, dy = 0) =>
  `translate(${dx} ${dy}) rotate(${deg} ${p[0]} ${p[1]})`;
const tr = (dx: number, dy: number) => `translate(${dx} ${dy})`;

// timing helpers, mirrored from the Python rig so the vector poses and the
// exported sprite frames stay in step
function ease(x: number) {
  'worklet';
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}
function win(t: number, a: number, b: number) {
  'worklet';
  return b > a ? ease((t - a) / (b - a)) : 0;
}
function bump(t: number, a: number, pk: number, b: number) {
  'worklet';
  if (t < a || t > b) return 0;
  return t <= pk ? win(t, a, pk) : 1 - win(t, pk, b);
}

export default function CrabGator({
  size = 240, pose = 'idle', speed = 2.4, reactionMs = 1000,
  blinkEvery = 4.5, onReactionEnd,
}: CrabGatorProps) {
  const t = useSharedValue(0);          // 0..1 loop phase
  const k = useSharedValue(0);          // 0..1 one-shot progress
  const blink = useSharedValue(1);      // 1 open, 0.12 shut
  const shot = pose === 'correct' || pose === 'wrong';

  React.useEffect(() => {
    t.value = 0;
    t.value = withRepeat(
      withTiming(1, { duration: speed * 1000, easing: Easing.linear }),
      -1, false);
    return () => cancelAnimation(t);
  }, [speed, pose]);

  React.useEffect(() => {
    k.value = 0;
    if (!shot) return;
    k.value = withTiming(1, { duration: reactionMs, easing: Easing.linear },
      (done) => { if (done && onReactionEnd) runOnJS(onReactionEnd)(); });
    return () => cancelAnimation(k);
  }, [pose, reactionMs]);

  React.useEffect(() => {
    if (!blinkEvery || shot) { blink.value = 1; return; }
    blink.value = withRepeat(
      withSequence(
        withTiming(1, { duration: blinkEvery * 1000 - 160 }),
        withTiming(0.12, { duration: 80 }),
        withTiming(1, { duration: 80 })),
      -1, false);
    return () => cancelAnimation(blink);
  }, [blinkEvery, pose]);

  // ---- shared drivers ---------------------------------------------------
  const bob = useDerivedValue(() => {
    'worklet';
    const a = TAU * t.value;
    if (pose === 'walk') return -7 * Math.abs(Math.sin(a));
    if (pose === 'wave') return -4 * Math.sin(2 * a);
    return -5 * Math.sin(a);
  });
  const lean = useDerivedValue(() => {
    'worklet';
    return pose === 'walk' ? 1.8 * Math.sin(TAU * t.value) : 0;
  });
  /** vertical offset of the whole shell during a reaction */
  const shotY = useDerivedValue(() => {
    'worklet';
    const c = k.value;
    if (pose === 'correct') {
      return bump(c, 0, 0.14, 0.26) * 16 - 96 * bump(c, 0.16, 0.34, 0.62)
        + 12 * bump(c, 0.60, 0.68, 0.86);
    }
    return -10 * bump(c, 0, 0.08, 0.22)
      + 20 * (win(c, 0.30, 0.62) - win(c, 0.88, 1.0) * 0.25);
  });
  /** horizontal offset — the wrong-answer recoil and shake */
  const shotX = useDerivedValue(() => {
    'worklet';
    if (pose !== 'wrong') return 0;
    const c = k.value;
    return 26 * bump(c, 0, 0.08, 0.22)
      + 30 * Math.sin(TAU * 3.2 * c) * Math.exp(-5.5 * c);
  });
  const lift = useDerivedValue(() => {
    'worklet';
    return pose === 'correct' ? bump(k.value, 0.12, 0.36, 0.95) : 0;
  });
  const slump = useDerivedValue(() => {
    'worklet';
    if (pose !== 'wrong') return 0;
    return win(k.value, 0.30, 0.62) - win(k.value, 0.88, 1.0) * 0.25;
  });
  const kick = useDerivedValue(() => {
    'worklet';
    return pose === 'wrong' ? bump(k.value, 0, 0.08, 0.22) : 0;
  });

  // ---- one animated prop per rigged part --------------------------------
  const bodyProps = useAnimatedProps(() => {
    'worklet';
    if (shot) return { transform: tr(shotX.value, shotY.value) };
    return {
      transform: pose === 'walk'
        ? rot(lean.value, P.body, 0, bob.value)
        : tr(pose === 'wave' ? 1.5 * Math.sin(TAU * t.value) : 0, bob.value),
    };
  });

  const headProps = useAnimatedProps(() => {
    'worklet';
    if (pose === 'correct') {
      return { transform: rot(-6 * lift.value, P.head, 0,
        shotY.value * 1.25 - 4 * lift.value) };
    }
    if (pose === 'wrong') {
      return { transform: rot(5 * kick.value + 7 * slump.value, P.head,
        shotX.value * 1.15, shotY.value * 1.2 + 10 * slump.value) };
    }
    const a = TAU * t.value;
    const deg = pose === 'wave' ? -3.5 * Math.sin(a)
      : pose === 'walk' ? lean.value * 1.6 - 1
      : 1.2 * Math.sin(a - 0.5);
    return { transform: rot(deg, P.head, 0, bob.value * 1.4 - 2) };
  });

  const clawProps = useAnimatedProps(() => {
    'worklet';
    // both arms down for a wrong answer, so the raised pincer steps aside
    if (pose === 'wrong') return { opacity: 0, transform: tr(0, 0) };
    if (pose === 'correct') {
      return { opacity: 1, transform: rot(-46 * lift.value, P.claw,
        10 * lift.value, shotY.value - 26 * lift.value) };
    }
    const a = TAU * t.value;
    const deg = pose === 'wave' ? 15 * Math.sin(a) - 4
      : pose === 'walk' ? -lean.value * 2.2
      : 2.4 * Math.sin(a - 0.9);
    return { transform: rot(deg, P.claw, 0, bob.value), opacity: 1 };
  });

  const boulderProps = useAnimatedProps(() => {
    'worklet';
    // both arms up for a correct answer, so the resting fist steps aside
    if (pose === 'correct') return { opacity: 0, transform: tr(0, 0) };
    if (pose === 'wrong') {
      return { opacity: 1, transform: tr(shotX.value * 0.5,
        shotY.value * 0.5 + 4 * slump.value) };
    }
    return { opacity: 1, transform: tr(0, bob.value * 0.25) };
  });

  const plateProps = useAnimatedProps(() => {
    'worklet';
    if (pose === 'correct') return { opacity: 0, transform: tr(0, 0) };
    if (pose === 'wrong') {
      return { opacity: 1, transform: tr(shotX.value * 0.5,
        shotY.value * 0.5 + 4 * slump.value) };
    }
    return { opacity: 1, transform: tr(0, bob.value * 0.25) };
  });

  // the mirrored arms: only visible in the pose that needs them
  const rockRProps = useAnimatedProps(() => {
    'worklet';
    if (pose !== 'wrong') return { opacity: 0, transform: tr(0, 0) };
    return { opacity: 1, transform: tr(shotX.value * 0.5,
      shotY.value * 0.5 + 4 * slump.value) };
  });
  const clawLProps = useAnimatedProps(() => {
    'worklet';
    if (pose !== 'correct') return { opacity: 0, transform: tr(0, 0) };
    // it lives inside a mirrored group, so its horizontal motion comes out
    // reversed — it gets a gentler swing pushed outward instead
    return { opacity: 1, transform: rot(-22 * lift.value, P.claw,
      76 * lift.value, shotY.value - 40 * lift.value) };
  });

  // hooks may not live inside a loop — one per leg, unrolled
__LEGS__
  const eyeProps = useAnimatedProps(() => ({
    transform: `translate(0 ${(1 - blink.value) * 262}) scale(1 ${blink.value})`,
  }));

  const burstProps = useAnimatedProps(() => {
    'worklet';
    const o = pose === 'correct' ? bump(k.value, 0.20, 0.32, 0.70) : 0;
    const s = 0.72 + 0.28 * o;
    return { opacity: o,
      transform: `translate(500 560) scale(${s}) translate(-500 -560)` };
  });
  const puffProps = useAnimatedProps(() => {
    'worklet';
    const o = pose === 'wrong' ? bump(k.value, 0.10, 0.26, 0.92) : 0;
    return { opacity: o, transform: tr(0, (1 - o) * 14) };
  });

  const eyesOpen = pose === 'correct' || pose === 'wrong' ? null : (
    <AG animatedProps={eyeProps}><Parts.Eyes /></AG>);
  const eyesHappy = pose === 'correct' ? <Parts.EyesHappy /> : null;
  const eyesFlat = pose === 'wrong' ? <Parts.EyesFlat /> : null;

  return (
    <Svg width={size} height={size} viewBox={Parts.VIEW_BOX}>
      <Defs><Parts.DEFS /></Defs>
      <AG animatedProps={burstProps}><Parts.FxBurst /></AG>
      <Parts.SHADOW />
      <Parts.Ground />
      <AG animatedProps={bodyProps}><Parts.Body /></AG>
      <AG animatedProps={bodyProps}><Parts.Carapace /></AG>
      <AG animatedProps={bodyProps}><Parts.Shoulder /></AG>
      <AG animatedProps={leg1Props}><Parts.Leg1 /></AG>
      <AG animatedProps={leg2Props}><Parts.Leg2 /></AG>
      <AG animatedProps={leg3Props}><Parts.Leg3 /></AG>
      <AG animatedProps={bodyProps}>
        <Parts.Band1 /><Parts.Band2 /><Parts.Band3 />
        <Parts.Band4 /><Parts.Band5 /><Parts.Tab />
      </AG>
      <AG animatedProps={boulderProps}><Parts.Boulder /></AG>
      <AG animatedProps={plateProps}><Parts.Plate /></AG>
      <G transform="__ROCKRTF__">
        <AG animatedProps={rockRProps}>
          <Parts.BoulderR /><Parts.PlateR />
        </AG>
      </G>
      <G transform="__CLAWLTF__">
        <AG animatedProps={clawLProps}><Parts.ClawL /></AG>
      </G>
      <AG animatedProps={headProps}>
        <Parts.Head eyes={eyesOpen} eyesHappy={eyesHappy} eyesFlat={eyesFlat} />
      </AG>
      <G transform="__CLAWTF__">
        <AG animatedProps={clawProps}><Parts.Claw /></AG>
      </G>
      <AG animatedProps={puffProps}><Parts.FxPuff /></AG>
    </Svg>
  );
}
'''

legs = "".join('''  const leg%dProps = useAnimatedProps(() => {
    'worklet';
    if (pose === 'correct') {
      const tuck = 10 * bump(k.value, 0.16, 0.34, 0.62)
        - 5 * bump(k.value, 0.60, 0.68, 0.86);
      return { transform: rot(tuck * %d, P.leg%d, 0,
        shotY.value + 6 * bump(k.value, 0.16, 0.34, 0.62)) };
    }
    if (pose === 'wrong') {
      return { transform: tr(shotX.value * %.2f, shotY.value * 0.7) };
    }
    if (pose !== 'walk') return { transform: tr(0, bob.value * %.2f) };
    const s = Math.sin(TAU * (t.value + %d / 3));
    return { transform: rot(7 * s, P.leg%d, 4 * s, -6 * Math.max(s, 0)) };
  });
''' % (i, 1 if (i - 1) % 2 else -1, i, 0.6 - 0.15 * (i - 1), 0.15 + 0.2 * i,
       i - 1, i) for i in (1, 2, 3))

tsx = (tsx.replace('__LEGS__', legs)
          .replace('__CLAWTF__', d['tf']['claw'])
          .replace('__CLAWLTF__', d['tf']['clawL'])
          .replace('__ROCKRTF__', d['tf']['boulderR']).lstrip())
open('app/src/CrabGator.tsx', 'w').write(tsx)

# ---------------------------------------------------------------- static
stat = '''/**
 * CrabGatorStatic — no animation, no Reanimated dependency.
 *   npm i react-native-svg
 */
import * as React from 'react';
import Svg, { G, Defs } from 'react-native-svg';
import * as Parts from './CrabGatorParts';

export type Face = 'open' | 'happy' | 'flat';

export default function CrabGatorStatic(
  { size = 120, face = 'open' }: { size?: number; face?: Face },
) {
  return (
    <Svg width={size} height={size} viewBox={Parts.VIEW_BOX}>
      <Defs><Parts.DEFS /></Defs>
      <Parts.SHADOW />
      <Parts.Ground />
      <Parts.Body /><Parts.Carapace /><Parts.Shoulder />
      <Parts.Leg1 /><Parts.Leg2 /><Parts.Leg3 />
      <Parts.Band1 /><Parts.Band2 /><Parts.Band3 />
      <Parts.Band4 /><Parts.Band5 /><Parts.Tab />
      <Parts.Boulder /><Parts.Plate />
      <Parts.Head
        eyes={face === 'open' ? <Parts.Eyes /> : null}
        eyesHappy={face === 'happy' ? <Parts.EyesHappy /> : null}
        eyesFlat={face === 'flat' ? <Parts.EyesFlat /> : null}
      />
      <G transform="__CLAWTF__"><Parts.Claw /></G>
    </Svg>
  );
}
'''.replace('__CLAWTF__', d['clawTF'])
open('app/src/CrabGatorStatic.tsx', 'w').write(stat)
print('tsx written')
