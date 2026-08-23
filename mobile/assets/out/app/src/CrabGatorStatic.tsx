/**
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
      <G transform="translate(44 -8)"><Parts.Claw /></G>
    </Svg>
  );
}
