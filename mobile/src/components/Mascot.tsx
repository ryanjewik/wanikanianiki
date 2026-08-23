/**
 * The Crabigator.
 *
 * Plays the sprite strips exported to `assets/mascot/anim/`. Each strip is a
 * single horizontal row of 200×200 frames, so the whole animation is one
 * `translateX` on an oversized image inside a clipped box — no per-frame image
 * decoding, and the stepping runs on the UI thread rather than through React
 * state, which matters at 24–30fps.
 *
 * Poses split in two:
 *   loops      idle | wave | walk | blink   run forever
 *   one-shots  correct | wrong              play once, for answer feedback
 *
 * `correct` squats, jumps with both claws up and lands with a squash; `wrong`
 * recoils and shakes with a decaying envelope. Set the pose when an answer
 * lands and return to idle from `onReactionEnd`.
 */
import * as React from 'react';
import {
  Image,
  type ImageSourcePropType,
  type ImageStyle,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import manifest from '../../assets/mascot/anim/manifest.json';

export type LoopPose = 'idle' | 'wave' | 'walk' | 'blink';
export type ReactionPose = 'correct' | 'wrong';
export type Pose = LoopPose | ReactionPose;

/**
 * Metro needs literal paths, so the strips are mapped rather than built from
 * the manifest's `sprite` field at runtime. The manifest still drives frame
 * counts and fps, so a re-export with different timing needs no code change.
 */
const SPRITES: Record<Pose, ImageSourcePropType> = {
  idle: require('../../assets/mascot/anim/idle-sprite.png'),
  wave: require('../../assets/mascot/anim/wave-sprite.png'),
  walk: require('../../assets/mascot/anim/walk-sprite.png'),
  blink: require('../../assets/mascot/anim/blink-sprite.png'),
  correct: require('../../assets/mascot/anim/correct-sprite.png'),
  wrong: require('../../assets/mascot/anim/wrong-sprite.png'),
};

interface PoseSpec {
  frames: number;
  fps: number;
  loop: boolean;
  oneShot: boolean;
  size: number;
}

const SPECS = manifest as unknown as Record<Pose, PoseSpec>;

export interface MascotProps {
  /** Square, in dp. */
  size?: number;
  pose?: Pose;
  /**
   * Multiplies the exported frame rate. 1 plays at the authored speed; lower
   * is calmer, which suits an idle sitting behind content.
   */
  speed?: number;
  /** Fired when a `correct` / `wrong` one-shot finishes. */
  onReactionEnd?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Mascot({
  size = 120,
  pose = 'idle',
  speed = 1,
  onReactionEnd,
  style,
}: MascotProps) {
  const spec = SPECS[pose];
  const frame = useSharedValue(0);

  // Keep the latest callback without restarting the animation when it changes
  // identity — an inline arrow prop would otherwise retrigger every render.
  const reactionEnd = React.useRef(onReactionEnd);
  React.useEffect(() => {
    reactionEnd.current = onReactionEnd;
  }, [onReactionEnd]);

  React.useEffect(() => {
    const durationMs = (spec.frames / (spec.fps * Math.max(0.05, speed))) * 1000;
    frame.value = 0;

    if (spec.oneShot) {
      frame.value = withTiming(
        spec.frames,
        { duration: durationMs, easing: Easing.linear },
        (finished) => {
          'worklet';
          if (finished && reactionEnd.current) runOnJS(reactionEnd.current)();
        },
      );
    } else {
      frame.value = withRepeat(
        withTiming(spec.frames, { duration: durationMs, easing: Easing.linear }),
        -1,
        false,
      );
    }

    return () => cancelAnimation(frame);
  }, [frame, pose, spec.frames, spec.fps, spec.oneShot, speed]);

  const animatedStyle = useAnimatedStyle(() => {
    // Floor to a whole frame — a fractional offset would show two half-frames.
    const index = Math.min(spec.frames - 1, Math.floor(frame.value));
    return { transform: [{ translateX: -index * size }] };
  });

  return (
    <View style={[{ width: size, height: size }, styles.clip, style]}>
      <Animated.View style={animatedStyle}>
        <Image
          source={SPRITES[pose]}
          style={{ width: size * spec.frames, height: size }}
          resizeMode="stretch"
          fadeDuration={0}
        />
      </Animated.View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Stills                                                                      */
/* -------------------------------------------------------------------------- */

export type PoseStill = 'idle' | 'wave' | 'walk' | 'blink' | 'correct' | 'wrong';

const POSES: Record<PoseStill, ImageSourcePropType> = {
  idle: require('../../assets/mascot/poses/crabgator-idle.png'),
  wave: require('../../assets/mascot/poses/crabgator-wave.png'),
  walk: require('../../assets/mascot/poses/crabgator-walk.png'),
  blink: require('../../assets/mascot/poses/crabgator-blink.png'),
  correct: require('../../assets/mascot/poses/crabgator-correct.png'),
  wrong: require('../../assets/mascot/poses/crabgator-wrong.png'),
};

/**
 * A single frame, for the art slots on cards where a running animation would
 * just be noise. Costs nothing to render.
 */
export function MascotStill({
  pose = 'idle',
  size = 80,
  style,
}: {
  pose?: PoseStill;
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={POSES[pose]}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
    />
  );
}

/** Head-and-shoulders crop, for a profile row or a compact card. */
export function MascotBust({ size = 64, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={require('../../assets/mascot/views/bust.png')}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
    />
  );
}

/** Circular avatar, already cropped to a circle in the export. */
export function MascotAvatar({ size = 40, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={require('../../assets/mascot/views/avatar-256.png')}
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
      resizeMode="cover"
    />
  );
}

/**
 * A transparent scene strip for the top of a screen. `celebrate` is the
 * level-up / session-complete variant.
 */
export function MascotBanner({
  variant = 'header',
  height = 96,
  style,
}: {
  variant?: 'header' | 'celebrate' | 'wide';
  height?: number;
  style?: StyleProp<ImageStyle>;
}) {
  const source =
    variant === 'celebrate'
      ? require('../../assets/mascot/banners/scene-celebrate-1200x400.png')
      : variant === 'wide'
        ? require('../../assets/mascot/banners/scene-wide-1200x240.png')
        : require('../../assets/mascot/banners/scene-header-1200x400.png');

  return <Image source={source} style={[{ width: '100%', height }, style]} resizeMode="contain" />;
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});
