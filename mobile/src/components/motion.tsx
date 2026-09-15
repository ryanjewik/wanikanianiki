/**
 * Motion primitives.
 *
 * The rule these follow: motion is here to explain a change, never to decorate
 * a static screen. Something appearing gets an entrance, something changing
 * gets a tween, something rejected gets a shake. Nothing that is merely
 * sitting there moves, because an app you look at for forty minutes a day
 * cannot afford ambient animation.
 *
 * Durations are short on purpose — 120-340ms. These play on every card of a
 * hundred-item review, so anything the user could learn to wait for is too
 * slow.
 */
import * as React from 'react';
import { Pressable, type PressableProps, type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, {
  type AnimatedStyle,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/**
 * What the hooks below hand back: a Reanimated style, valid only on an
 * `Animated.View`, never on a plain one. The generic is pinned on each
 * `useAnimatedStyle` call too — inferred from the updater alone it comes back
 * narrowed to that exact transform and stops composing with a `ViewStyle`.
 */
type MotionStyle = AnimatedStyle<ViewStyle>;

/** The one spring in the app, so every pop and settle shares a character. */
const SPRING = { damping: 14, stiffness: 220, mass: 0.6 } as const;
const QUICK = { duration: 160, easing: Easing.out(Easing.quad) } as const;

/* -------------------------------------------------------------------------- */
/* Entrances                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fades and lifts its child in once, on mount.
 *
 * `delay` staggers a list. Keep the step small (40-60ms) and the run short:
 * past about six cards a stagger stops reading as choreography and starts
 * reading as the screen being slow.
 */
export function RiseIn({
  delay = 0,
  distance = 12,
  style,
  children,
}: {
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }),
    );
  }, [delay, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * Springs its child in from slightly small.
 *
 * For things that arrive as a *result* — the verdict card after an answer —
 * where a fade would read as the screen loading rather than as a response.
 */
export function Pop({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(0.92);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    scale.value = withSpring(1, SPRING);
    opacity.value = withTiming(1, QUICK);
  }, [opacity, scale]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/* -------------------------------------------------------------------------- */
/* Reactions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A horizontal shake, for a rejected answer.
 *
 * Returns a style for the `Animated.View` wrapping the thing that was
 * rejected, and a `shake()` to call when it is. The amplitude decays rather
 * than staying constant — the gesture means no, and no does not repeat at the
 * same volume.
 */
export function useShake(): { style: MotionStyle; shake: () => void } {
  const offset = useSharedValue(0);

  const style = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const shake = React.useCallback(() => {
    offset.value = withSequence(
      withTiming(-7, { duration: 45 }),
      withTiming(6, { duration: 55 }),
      withTiming(-4, { duration: 55 }),
      withTiming(0, { duration: 60 }),
    );
  }, [offset]);

  return { style, shake };
}

/**
 * A single scale pulse, for something that just became true — a stat ticking
 * up, a badge gaining a number. Returns `pulse()` and the style to put on the
 * surrounding `Animated.View`.
 */
export function usePulse(): { style: MotionStyle; pulse: () => void } {
  const scale = useSharedValue(1);

  const style = useAnimatedStyle<ViewStyle>(() => ({ transform: [{ scale: scale.value }] }));

  const pulse = React.useCallback(() => {
    scale.value = withSequence(
      withTiming(1.12, { duration: 110, easing: Easing.out(Easing.quad) }),
      withSpring(1, SPRING),
    );
  }, [scale]);

  return { style, pulse };
}

/* -------------------------------------------------------------------------- */
/* Press                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A pressable that springs down under the finger.
 *
 * For the surfaces the design leaves flat — answer choices, sentence tiles,
 * character grids — which currently acknowledge a tap only through whatever
 * state changes afterwards. The chunky buttons are deliberately *not* built on
 * this: their hard offset shadow collapsing instantly is what makes them read
 * as physical, and a spring would soften exactly that.
 */
export function PressBounce({
  scaleTo = 0.96,
  style,
  children,
  disabled,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        if (!disabled) scale.value = withTiming(scaleTo, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING);
      }}
      {...rest}
    >
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Animated values on the JS thread                                            */
/* -------------------------------------------------------------------------- */

/**
 * Eases a number from zero towards `target` and returns it as React state.
 *
 * Deliberately not a worklet. The two things that need this — a counting stat
 * and an SVG arc's dash length — both want the value as a *number in JSX*,
 * which on the UI thread means an animated-props bridge per SVG attribute or a
 * text hack. These animate once, on a summary screen, over well under a
 * second; a frame loop that re-renders one number is the simpler and more
 * predictable thing, and nothing else is competing for those frames.
 */
export function useEasedNumber(target: number, duration = 800, delay = 0): number {
  const [value, setValue] = React.useState(0);

  React.useEffect(() => {
    let frame = 0;
    let start = 0;
    let cancelled = false;

    const step = (now: number) => {
      if (cancelled) return;
      if (!start) start = now;
      const elapsed = now - start - delay;

      if (elapsed < 0) {
        frame = requestAnimationFrame(step);
        return;
      }

      const t = Math.min(1, elapsed / duration);
      // Ease-out cubic: quick enough to feel responsive, slow enough at the
      // end that the final number is readable as it settles.
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [target, duration, delay]);

  return value;
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A bar that grows to `fraction` of its track on mount.
 *
 * For the summary and dashboard charts, where every bar is showing a number
 * the user has not seen before — growing them is what makes the chart read as
 * *this session's* result rather than as a static graphic. `delay` cascades a
 * group. Runs on the UI thread, so a dozen of these cost no re-renders.
 */
export function GrowBar({
  fraction,
  color,
  delay = 0,
  vertical = false,
  style,
}: {
  fraction: number;
  color: string;
  delay?: number;
  /** Grows upward instead of rightward, for a column chart. */
  vertical?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const grown = useSharedValue(0);
  const target = Math.max(0, Math.min(1, fraction)) * 100;

  React.useEffect(() => {
    grown.value = withDelay(
      delay,
      withTiming(target, { duration: 520, easing: Easing.out(Easing.cubic) }),
    );
  }, [delay, grown, target]);

  const animated = useAnimatedStyle<ViewStyle>(() =>
    vertical ? { height: `${grown.value}%` } : { width: `${grown.value}%` },
  );

  return <Animated.View style={[{ backgroundColor: color }, style, animated]} />;
}

/**
 * The session progress bar, with the fill tweened rather than jumping.
 *
 * A drop-in replacement for `SessionProgressBar`. The segments are absolutely
 * positioned and sized by percentage width, because `flex` cannot be animated
 * on the UI thread and `width` can.
 */
export function AnimatedSessionProgress({
  correct,
  incorrect,
  total,
  height = 6,
  correctColor,
  incorrectColor,
  trackColor,
}: {
  correct: number;
  incorrect: number;
  total: number;
  height?: number;
  correctColor: string;
  incorrectColor: string;
  trackColor: string;
}) {
  const safeTotal = Math.max(1, total);
  const correctPct = useSharedValue(0);
  const answeredPct = useSharedValue(0);

  React.useEffect(() => {
    correctPct.value = withTiming((correct / safeTotal) * 100, {
      duration: 340,
      easing: Easing.out(Easing.cubic),
    });
    answeredPct.value = withTiming(((correct + incorrect) / safeTotal) * 100, {
      duration: 340,
      easing: Easing.out(Easing.cubic),
    });
  }, [correct, incorrect, safeTotal, correctPct, answeredPct]);

  // The whole answered run is drawn in the incorrect colour, with the correct
  // run painted over it. That is one fewer moving edge than two abutting bars,
  // which would show a hairline of track between them mid-tween.
  const answeredStyle = useAnimatedStyle(() => ({ width: `${answeredPct.value}%` }));
  const correctStyle = useAnimatedStyle(() => ({ width: `${correctPct.value}%` }));

  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: trackColor,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: incorrectColor },
          answeredStyle,
        ]}
      />
      <Animated.View
        style={[
          { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: correctColor },
          correctStyle,
        ]}
      />
    </View>
  );
}
