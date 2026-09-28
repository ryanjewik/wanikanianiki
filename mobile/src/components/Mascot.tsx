/**
 * The Crabigator.
 *
 * Plays the sprite strips exported to `assets/mascot/anim/`. Each strip is a
 * single horizontal row of 256×256 frames, so the whole animation is one
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
  useWindowDimensions,
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
  /** Fired when a `correct` / `wrong` one-shot finishes. Never fires while
   *  `holdReaction` is set, since under it a reaction has no end. */
  onReactionEnd?: () => void;
  /**
   * Keeps a reaction cycling instead of playing once.
   *
   * A single 30-frame jump is over in a second, and on a screen that waits for
   * the user to tap Next that leaves the mascot sitting idle for as long as it
   * takes them to read the answer — which reads as the reaction having been
   * missed rather than finished. Under this flag the caller owns the ending:
   * set the pose back to a loop when the screen moves on.
   */
  holdReaction?: boolean;
  /**
   * Slips an occasional blink into a looping pose.
   *
   * One animation cycling forever is the thing that makes a mascot read as a
   * decal rather than a creature — you stop seeing it within a screen or two.
   * An unscheduled blink every few seconds costs nothing and is most of the
   * difference. Ignored while a reaction is playing.
   */
  lively?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Returns the pose to actually draw, folding in the idle blink.
 *
 * The timer is re-randomised each cycle: a blink on a fixed interval is worse
 * than no blink at all, because a regular rhythm is exactly what reads as
 * mechanical.
 */
function useLivelyPose(pose: Pose, speed: number, enabled: boolean): Pose {
  const [blinking, setBlinking] = React.useState(false);

  // A reaction, or an explicitly chosen pose that is not the resting one,
  // owns the mascot outright — nothing should interrupt a wave mid-wave.
  const eligible = enabled && pose === 'idle';

  React.useEffect(() => {
    if (!eligible) {
      setBlinking(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      timer = setTimeout(() => {
        setBlinking(true);
        // Hold for exactly one cycle of the blink strip at the caller's speed,
        // so it never cuts off half-closed.
        const cycleMs = (SPECS.blink.frames / (SPECS.blink.fps * Math.max(0.05, speed))) * 1000;
        timer = setTimeout(() => {
          setBlinking(false);
          schedule();
        }, cycleMs);
      }, 3500 + Math.random() * 4500);
    };

    schedule();
    return () => clearTimeout(timer);
  }, [eligible, speed]);

  return blinking ? 'blink' : pose;
}

export function Mascot({
  size = 120,
  pose = 'idle',
  speed = 1,
  onReactionEnd,
  lively = false,
  holdReaction = false,
  style,
}: MascotProps) {
  const drawn = useLivelyPose(pose, speed, lively);
  const spec = SPECS[drawn];
  const frame = useSharedValue(0);

  // Keep the latest callback without restarting the animation when it changes
  // identity — an inline arrow prop would otherwise retrigger every render.
  const reactionEnd = React.useRef(onReactionEnd);
  React.useEffect(() => {
    reactionEnd.current = onReactionEnd;
  }, [onReactionEnd]);

  /**
   * The bridge the finish worklet calls, and the reason it exists.
   *
   * A worklet serialises everything it closes over. Reaching into the ref from
   * inside one captures the *ref object*, and every later
   * `reactionEnd.current = ...` is then a write to something already
   * serialised — which Reanimated warns about on every render, because an
   * inline arrow prop changes identity each time.
   *
   * This function is stable (no deps), so it serialises once and is never
   * mutated; the ref is only ever read back here, on the JS thread.
   */
  const notifyReactionEnd = React.useCallback(() => {
    reactionEnd.current?.();
  }, []);

  React.useEffect(() => {
    const durationMs = (spec.frames / (spec.fps * Math.max(0.05, speed))) * 1000;
    frame.value = 0;

    if (spec.oneShot && !holdReaction) {
      frame.value = withTiming(
        spec.frames,
        { duration: durationMs, easing: Easing.linear },
        (finished) => {
          'worklet';
          // Closes over the stable bridge, never the ref — see above.
          if (finished) runOnJS(notifyReactionEnd)();
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
  }, [drawn, frame, holdReaction, notifyReactionEnd, spec.frames, spec.fps, spec.oneShot, speed]);

  const animatedStyle = useAnimatedStyle(() => {
    // Floor to a whole frame — a fractional offset would show two half-frames.
    const index = Math.min(spec.frames - 1, Math.floor(frame.value));
    return { transform: [{ translateX: -index * size }] };
  });

  return (
    <View style={[{ width: size, height: size }, styles.clip, style]}>
      <Animated.View style={animatedStyle}>
        <Image
          source={SPRITES[drawn]}
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
  fill = 'contain',
  style,
}: {
  variant?: 'header' | 'celebrate' | 'wide';
  height?: number;
  /**
   * `cover` fills the full width at `height`, trimming a little off the top
   * and bottom of the art. Right for the wide strip, whose 5:1 art loses only
   * a few pixels; wrong for the 3:1 scenes, where it crops the crabigator.
   */
  fill?: 'contain' | 'cover';
  style?: StyleProp<ImageStyle>;
}) {
  const source =
    variant === 'celebrate'
      ? require('../../assets/mascot/banners/scene-celebrate-1200x400.png')
      : variant === 'wide'
        ? require('../../assets/mascot/banners/scene-wide-1200x240.png')
        : require('../../assets/mascot/banners/scene-header-1200x400.png');

  // Exactly the screen's width: every caller bleeds the scene past its page
  // gutter with negative margins so it runs edge to edge. `width: '100%'` is
  // measured inside that gutter, so the scene shifted left and stopped short
  // of the right edge; `alignSelf: 'stretch'` let the image fall back to its
  // own 1200-point width, which `cover` then showed as a zoomed-in slice.
  const { width } = useWindowDimensions();

  return <Image source={source} style={[{ width, height }, style]} resizeMode={fill} />;
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});
