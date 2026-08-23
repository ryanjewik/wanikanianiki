#!/usr/bin/env python3
import json, textwrap
d = json.load(open('app/src/_parts.json'))
P, order, VB, PIV = d['parts'], d['order'], d['viewBox'], d['piv']
BODY = d['bodyParts']
ANIM = ['body', 'carapace', 'shoulder', 'tab', 'band1', 'band2', 'band3',
        'band4', 'band5', 'leg1', 'leg2', 'leg3', 'boulder', 'plate',
        'head', 'claw']

# ---------------------------------------------------------------- parts file
lines = ['// AUTO-GENERATED from crabigator6.py — do not hand-edit.',
         '// Every path here was machine-traced from the source artwork.',
         "import * as React from 'react';",
         "import { Path, Ellipse, G } from 'react-native-svg';", '']
for k in order + ['eyes']:
    body = P[k]
    if k == 'head':
        lines.append(f'export const {k.capitalize()} = ({{ eyes }}: {{ eyes?: React.ReactNode }}) => (<>{body}</>);')
    else:
        lines.append(f'export const {k.capitalize()} = () => (<>{body}</>);')
lines.append('')
lines.append(f'export const VIEW_BOX = "{VB[0]} {VB[1]} {VB[2]} {VB[3]}";')
lines.append('export const DEFS = () => (<>' + d['defs'] + '</>);')
lines.append('export const SHADOW = () => (<>' + d['shadow'] + '</>);')
lines.append('export const PIVOTS = ' + json.dumps(PIV) + ' as const;')
open('app/src/CrabGatorParts.tsx', 'w').write('\n'.join(lines) + '\n')

# ---------------------------------------------------------------- animated
tsx = r'''
/**
 * CrabGator — animated mascot.
 *
 * Geometry comes from CrabGatorParts.tsx, which is generated from the traced
 * artwork. Each rigged part is its own <G>; the animation only ever sets a
 * transform on those groups, so the vectors themselves never change and the
 * whole thing stays crisp at any size.
 *
 *   npm i react-native-svg react-native-reanimated
 */
import * as React from 'react';
import Svg, { G, Defs } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, useDerivedValue,
  withRepeat, withTiming, withSequence, Easing, cancelAnimation,
} from 'react-native-reanimated';
import * as Parts from './CrabGatorParts';

const AG = Animated.createAnimatedComponent(G);

export type Pose = 'idle' | 'wave' | 'walk';

export interface CrabGatorProps {
  size?: number;
  pose?: Pose;
  /** seconds per loop */
  speed?: number;
  /** blink every N seconds; 0 disables */
  blinkEvery?: number;
}

const P = Parts.PIVOTS;
const rot = (deg: number, p: readonly [number, number], dx = 0, dy = 0) =>
  `translate(${dx} ${dy}) rotate(${deg} ${p[0]} ${p[1]})`;
const tr = (dx: number, dy: number) => `translate(${dx} ${dy})`;

export default function CrabGator({
  size = 240, pose = 'idle', speed = 2.4, blinkEvery = 4.5,
}: CrabGatorProps) {
  const t = useSharedValue(0);          // 0..1 loop phase
  const blink = useSharedValue(1);      // 1 open, 0.12 shut

  React.useEffect(() => {
    t.value = 0;
    t.value = withRepeat(
      withTiming(1, { duration: speed * 1000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [speed, pose]);

  React.useEffect(() => {
    if (!blinkEvery) { blink.value = 1; return; }
    blink.value = withRepeat(
      withSequence(
        withTiming(1, { duration: blinkEvery * 1000 - 160 }),
        withTiming(0.12, { duration: 80 }),
        withTiming(1, { duration: 80 })),
      -1, false);
    return () => cancelAnimation(blink);
  }, [blinkEvery]);

  // ---- one derived value per rigged part -------------------------------
  const TAU = Math.PI * 2;

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

  const bodyProps = useAnimatedProps(() => ({
    transform: pose === 'walk'
      ? rot(lean.value, P.body, 0, bob.value)
      : tr(pose === 'wave' ? 1.5 * Math.sin(TAU * t.value) : 0, bob.value),
  }));

  const headProps = useAnimatedProps(() => {
    'worklet';
    const a = TAU * t.value;
    const deg = pose === 'wave' ? -3.5 * Math.sin(a)
      : pose === 'walk' ? lean.value * 1.6 - 1
      : 1.2 * Math.sin(a - 0.5);
    return { transform: rot(deg, P.head, 0, bob.value * 1.4 - 2) };
  });

  const clawProps = useAnimatedProps(() => {
    'worklet';
    const a = TAU * t.value;
    const deg = pose === 'wave' ? 15 * Math.sin(a) - 4
      : pose === 'walk' ? -lean.value * 2.2
      : 2.4 * Math.sin(a - 0.9);
    return { transform: rot(deg, P.claw, 0, bob.value) };
  });

  const rockProps = useAnimatedProps(() => ({
    transform: tr(0, bob.value * 0.25),
  }));

  const legProps = [0, 1, 2].map(i => useAnimatedProps(() => {
    'worklet';
    if (pose !== 'walk') return { transform: tr(0, bob.value * (0.35 + 0.2 * i)) };
    const s = Math.sin(TAU * (t.value + i / 3));
    const p = [P.leg1, P.leg2, P.leg3][i];
    return { transform: rot(7 * s, p, 4 * s, -6 * Math.max(s, 0)) };
  }));

  const eyeProps = useAnimatedProps(() => ({
    transform: `translate(0 ${(1 - blink.value) * 262}) scale(1 ${blink.value})`,
  }));

  const Eyes = (
    <AG animatedProps={eyeProps}><Parts.Eyes /></AG>
  );

  return (
    <Svg width={size} height={size} viewBox={Parts.VIEW_BOX}>
      <Defs><Parts.DEFS /></Defs>
      <Parts.SHADOW />
      <Parts.Ground />
      <AG animatedProps={bodyProps}><Parts.Body /></AG>
      <AG animatedProps={bodyProps}><Parts.Carapace /></AG>
      <AG animatedProps={bodyProps}><Parts.Shoulder /></AG>
      <AG animatedProps={legProps[0]}><Parts.Leg1 /></AG>
      <AG animatedProps={legProps[1]}><Parts.Leg2 /></AG>
      <AG animatedProps={legProps[2]}><Parts.Leg3 /></AG>
      <AG animatedProps={bodyProps}>
        <Parts.Band1 /><Parts.Band2 /><Parts.Band3 />
        <Parts.Band4 /><Parts.Band5 /><Parts.Tab />
      </AG>
      <AG animatedProps={rockProps}><Parts.Boulder /></AG>
      <AG animatedProps={rockProps}><Parts.Plate /></AG>
      <AG animatedProps={headProps}><Parts.Head eyes={Eyes} /></AG>
      <G transform="__CLAWTF__">
        <AG animatedProps={clawProps}><Parts.Claw /></AG>
      </G>
    </Svg>
  );
}
'''.replace('__CLAWTF__', d['clawTF']).lstrip()
open('app/src/CrabGator.tsx', 'w').write(tsx)

# ---------------------------------------------------------------- static
stat = '''/**
 * CrabGatorStatic — no animation, no Reanimated dependency.
 *   npm i react-native-svg
 */
import * as React from 'react';
import Svg, { G, Defs } from 'react-native-svg';
import * as Parts from './CrabGatorParts';

export default function CrabGatorStatic({ size = 120 }: { size?: number }) {
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
      <Parts.Head eyes={<Parts.Eyes />} />
      <G transform="__CLAWTF__"><Parts.Claw /></G>
    </Svg>
  );
}
'''.replace('__CLAWTF__', d['clawTF'])
open('app/src/CrabGatorStatic.tsx', 'w').write(stat)
print('tsx written')
