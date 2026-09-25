/**
 * The primitives every screen is built from.
 *
 * Two card treatments exist in the designs and they are not interchangeable:
 * the dashboard and lesson screens use a *shadowed* card (no border), while
 * detail, browser, summary and import screens use a *bordered* card (no
 * shadow). `Card` takes `variant` rather than picking one, so a screen can
 * match its artboard exactly.
 */
import * as React from 'react';
import {
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AnimatedSessionProgress, PressBounce } from '@/components/motion';
import { cue as fireCue, feedback, type Cue } from '@/feedback';
import {
  colors,
  controlBorder,
  jp,
  radius,
  shadows,
  spacing,
  subjectPalette,
  type SubjectType,
  type as typeScale,
} from '@/theme/tokens';

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

export interface CardProps extends ViewProps {
  /** `shadow` for dashboard/lesson surfaces, `bordered` everywhere else. */
  variant?: 'shadow' | 'bordered';
  /** Turns off the default 13/14 padding, for cards with a coloured header. */
  flush?: boolean;
}

export function Card({ variant = 'shadow', flush = false, style, ...rest }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        variant === 'shadow' ? shadows.card : styles.cardBordered,
        flush ? styles.cardFlush : styles.cardPadded,
        style,
      ]}
      {...rest}
    />
  );
}

/** The saturated strip across the top of an item card. */
export function CardBanner({
  type,
  label,
  trailing,
}: {
  type: SubjectType;
  label: string;
  trailing?: string;
}) {
  return (
    <View style={[styles.cardBanner, { backgroundColor: subjectPalette[type].solid }]}>
      <Text style={styles.cardBannerLabel}>{label}</Text>
      {trailing ? <Text style={styles.cardBannerTrailing}>{trailing}</Text> : null}
    </View>
  );
}

/** The all-caps label above a group inside a card. */
export function Overline({ style, ...rest }: TextProps) {
  return <Text style={[styles.overline, style]} {...rest} />;
}

/** Section heading with an optional link or stat on the right. */
export function SectionHeading({
  title,
  trailing,
  trailingColor = colors.radical,
  onPressTrailing,
}: {
  title: string;
  trailing?: string;
  trailingColor?: string;
  onPressTrailing?: () => void;
}) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {trailing ? (
        <Pressable
          onPress={onPressTrailing}
          onPressIn={onPressTrailing ? feedback.tap : undefined}
          disabled={!onPressTrailing}
          hitSlop={8}
        >
          <Text style={[styles.sectionTrailing, { color: trailingColor }]}>{trailing}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The card that offers a queue: lessons, reviews, generated practice.
 *
 * One component rather than the near-identical pair the dashboard and study
 * hub each had, because they were already the same card and drifting — and
 * because the colour treatment below has to be decided once to read as a set.
 *
 * Unlike the rest of the system these are *tinted* rather than white. Three of
 * them sit above the fold on both screens and they are the only things there
 * you can act on; a white card among white cards makes the primary action look
 * like another read-only panel. The art slot stays white so the mascot keeps
 * its contrast against the ink line-work.
 */
export function QueueCard({
  title,
  count,
  tone,
  blurb,
  cta,
  art,
  onPress,
  disabled = false,
}: {
  title: string;
  /** Hidden when zero — a badge reading 0 is worse than no badge. */
  count: number;
  tone: SubjectType;
  blurb: string;
  cta: string;
  /** The mascot, or whatever belongs in the square. */
  art: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  const palette = subjectPalette[tone];

  return (
    <View
      style={[
        styles.queueCard,
        { backgroundColor: palette.tint, borderColor: palette.solid },
        disabled && styles.queueCardEmpty,
      ]}
    >
      <View style={styles.queueArt}>{art}</View>

      <View style={styles.queueBody}>
        <View style={styles.queueTitleRow}>
          <Text style={styles.queueTitle}>{title}</Text>
          {count > 0 ? <CountBadge count={count} color={palette.solid} /> : null}
        </View>
        <Text style={styles.queueBlurb}>{blurb}</Text>
        <ChunkyButton
          label={cta}
          tone={disabled ? 'neutral' : tone}
          size="small"
          disabled={disabled}
          onPress={onPress}
          style={styles.queueCta}
        />
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

export interface ChunkyButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  /** Filled in the given colour, or white with an ink outline. */
  tone?: 'kanji' | 'vocabulary' | 'radical' | 'neutral';
  size?: 'large' | 'small';
  /** Appends the "›" the designs put on anything that moves you forward. */
  chevron?: boolean;
  /**
   * Which feedback cue to fire. `tap` is right for almost everything; a button
   * that ends a session or moves to the next card should say so, since the cue
   * is most of how those moments read when the screen barely changes.
   */
  cue?: Cue;
  style?: ViewStyle;
}

/**
 * The committing control: a 1.5px ink outline over a hard, un-blurred offset
 * shadow. Pressing it collapses the offset, so the button physically presses
 * down rather than just changing colour.
 */
export function ChunkyButton({
  label,
  tone = 'kanji',
  size = 'large',
  chevron = true,
  cue = 'tap',
  style,
  disabled,
  onPress,
  ...rest
}: ChunkyButtonProps) {
  const filled = tone !== 'neutral';
  const background = filled ? subjectPalette[tone].solid : colors.surface;
  const foreground = filled ? colors.onSolid : colors.ink;
  const offset = size === 'large' ? 3 : 2;

  // The cue fires on press-down rather than inside `onPress`, so it lands with
  // the finger instead of after whatever the handler does — which on the
  // committing buttons here is often a navigation.
  const onPressIn = rest.onPressIn;
  const handlePressIn = React.useCallback(
    (event: GestureResponderEvent) => {
      if (!disabled) fireCue(cue);
      onPressIn?.(event);
    },
    [cue, disabled, onPressIn],
  );

  return (
    <Pressable disabled={disabled} onPress={onPress} {...rest} onPressIn={handlePressIn}>
      {({ pressed }) => (
        <View
          style={[
            styles.chunkyButton,
            controlBorder,
            {
              backgroundColor: background,
              // A floor, not a fixed height, and padding of its own: a fixed
              // height clipped the label under a larger system font size, and
              // with no side padding the text ran almost to the border.
              minHeight: size === 'large' ? 52 : 42,
              paddingHorizontal: size === 'large' ? 24 : 18,
              paddingVertical: 8,
              // Collapse the hard shadow and drop into the gap it leaves.
              shadowOffset: { width: 0, height: pressed ? 0 : offset },
              transform: [{ translateY: pressed ? offset : 0 }],
              opacity: disabled ? 0.45 : 1,
            },
            shadows.hard,
            style,
          ]}
        >
          <Text
            style={[
              size === 'large' ? typeScale.button : typeScale.buttonSmall,
              { color: foreground },
            ]}
          >
            {label}
            {chevron ? ' ›' : ''}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** The quiet option under a primary CTA — no border, no shadow. */
export function TextButton({
  label,
  onPress,
  color = colors.inkSoft,
}: {
  label: string;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <Pressable onPress={onPress} onPressIn={feedback.tap} style={styles.textButton} hitSlop={6}>
      <Text style={[typeScale.buttonSmall, { color }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A compact outlined control, used inline in a card — "Retake" on the import
 * screen, and the row of secondary actions. `emphasis` picks whether it gets
 * the hard ink outline or the quiet grey one.
 */
export function InlineButton({
  label,
  onPress,
  emphasis = 'strong',
}: {
  label: string;
  onPress?: () => void;
  emphasis?: 'strong' | 'quiet';
}) {
  const strong = emphasis === 'strong';
  return (
    <Pressable onPress={onPress} onPressIn={feedback.tap}>
      {({ pressed }) => (
        <View
          style={[
            styles.inlineButton,
            strong
              ? [controlBorder, shadows.hardSmall, { shadowOffset: { width: 0, height: pressed ? 0 : 2 } }]
              : styles.inlineButtonQuiet,
            strong && pressed ? { transform: [{ translateY: 2 }] } : null,
          ]}
        >
          <Text style={[typeScale.captionBold, { color: strong ? colors.ink : colors.inkSoft }]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Chips and tiles                                                             */
/* -------------------------------------------------------------------------- */

export type TileState = 'passed' | 'in_progress' | 'locked';

/**
 * A Japanese character on a coloured ground. State is carried entirely by the
 * fill: solid means passed, tinted means in progress, grey means locked.
 */
export function CharTile({
  characters,
  type,
  state = 'passed',
  size = 'default',
  onPress,
}: {
  characters: string;
  type: SubjectType;
  state?: TileState;
  size?: 'default' | 'small';
  onPress?: () => void;
}) {
  const palette = subjectPalette[type];
  const background =
    state === 'passed' ? palette.solid : state === 'in_progress' ? palette.tint : colors.ground;
  const foreground =
    state === 'passed' ? colors.onSolid : state === 'in_progress' ? palette.solid : colors.inkFaint;

  const content = (
    <View style={[styles.charTile, { backgroundColor: background }]}>
      <Text style={[size === 'small' ? jp.tileSmall : jp.tile, { color: foreground }]}>
        {characters}
      </Text>
    </View>
  );

  return onPress ? (
    <PressBounce onPress={onPress} onPressIn={feedback.select}>
      {content}
    </PressBounce>
  ) : content;
}

/** The count badge beside a card title, e.g. the "24" on Today's Lessons. */
export function CountBadge({ count, color }: { count: number; color: string }) {
  return (
    <View style={[styles.countBadge, { backgroundColor: color }]}>
      <Text style={styles.countBadgeText}>{count}</Text>
    </View>
  );
}

/** A small tinted pill, e.g. the stage name on the review card. */
export function Pill({
  label,
  color,
  background,
}: {
  label: string;
  color: string;
  background: string;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

/**
 * A reading on its tinted ground, with the reading type underneath.
 * On'yomi takes the radical blue, kun'yomi the vocabulary violet.
 */
export function ReadingChip({
  reading,
  label,
  tone,
}: {
  reading: string;
  label: string;
  tone: 'radical' | 'vocabulary';
}) {
  const palette = subjectPalette[tone];
  return (
    <View style={[styles.readingChip, { backgroundColor: palette.tint }]}>
      <Text style={[jp.reading, { color: palette.solid }]}>{reading}</Text>
      <Text style={[styles.readingChipLabel, { color: palette.ink }]}>{label}</Text>
    </View>
  );
}

/** One number over its label, on a tinted ground. Three of these sit in a row. */
export function StatTile({
  value,
  label,
  tone = 'neutral',
}: {
  value: string | number;
  label: string;
  tone?: 'success' | 'danger' | 'neutral' | 'radical' | 'kanji';
}) {
  const palettes = {
    success: { bg: colors.successTint, fg: colors.successInk, label: colors.successInkSoft },
    danger: { bg: colors.dangerTint, fg: colors.dangerInk, label: colors.dangerInkSoft },
    radical: { bg: colors.radicalTint, fg: colors.radical, label: colors.radicalInk },
    kanji: { bg: colors.kanjiTint, fg: colors.kanji, label: colors.kanjiInk },
    neutral: { bg: colors.ground, fg: colors.ink, label: colors.inkSoft },
  } as const;
  const palette = palettes[tone];

  return (
    <View style={[styles.statTile, { backgroundColor: palette.bg }]}>
      <Text style={[styles.statValue, { color: palette.fg }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: palette.label }]}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

/** A single filled track. */
export function ProgressBar({
  progress,
  color = colors.kanji,
  height = 8,
  track = colors.border,
}: {
  progress: number;
  color?: string;
  height?: number;
  track?: string;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2, backgroundColor: track }]}>
      <View style={{ flex: clamped, backgroundColor: color }} />
      <View style={{ flex: 1 - clamped }} />
    </View>
  );
}

/**
 * The five-segment stage ladder on the item-detail screen. Segments up to and
 * including the current bucket take their stage colour; the rest stay grey.
 */
export function StageLadder({ bucket }: { bucket: number }) {
  return (
    <View style={styles.stageLadder}>
      {[colors.warning, colors.success, colors.radical, colors.vocabulary, colors.inkDisabled].map(
        (color, index) => (
          <View
            key={index}
            style={[styles.stageRung, { backgroundColor: index <= bucket ? color : colors.border }]}
          />
        ),
      )}
    </View>
  );
}

/**
 * Progress split into a correct run and an incorrect tail.
 *
 * The fill is tweened rather than stepped. This bar is the only thing on a
 * review screen that reports the shape of the session, and a card answered
 * every four seconds gives it no other way to be noticed — a jump between two
 * renders is change the eye never catches, whereas 340ms of travel is.
 */
export function SessionProgressBar({
  correct,
  incorrect,
  total,
}: {
  correct: number;
  incorrect: number;
  total: number;
}) {
  return (
    <AnimatedSessionProgress
      correct={correct}
      incorrect={incorrect}
      total={total}
      height={6}
      correctColor={colors.success}
      incorrectColor={colors.kanji}
      trackColor={colors.border}
    />
  );
}

/** The lesson header's segment run — one dash per item, filled as you go. */
export function StepDots({
  total,
  completed,
  color = colors.kanji,
}: {
  total: number;
  completed: number;
  color?: string;
}) {
  return (
    <View style={styles.stepDots}>
      {Array.from({ length: total }, (_, index) => (
        <StepDot key={index} filled={index < completed} color={color} />
      ))}
    </View>
  );
}

/**
 * One dash. The colour crossfades rather than switching, so the dash that was
 * just earned is visibly the one that changed — with a dozen identical dashes
 * in a row, an instant swap is impossible to attribute to your own last answer.
 */
function StepDot({ filled, color }: { filled: boolean; color: string }) {
  const progress = useSharedValue(filled ? 1 : 0);

  React.useEffect(() => {
    progress.value = withTiming(filled ? 1 : 0, { duration: 240 });
  }, [filled, progress]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.border, color]),
  }));

  return <Animated.View style={[styles.stepDot, animated]} />;
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                 */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  art,
  title,
  body,
}: {
  art: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.emptyState}>
      {art}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
  },
  cardBordered: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPadded: {
    paddingVertical: spacing.cardPadV,
    paddingHorizontal: spacing.cardPadH,
  },
  cardFlush: {
    overflow: 'hidden',
  },
  cardBanner: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardBannerLabel: {
    ...typeScale.overline,
    color: colors.onSolid,
  },
  cardBannerTrailing: {
    ...typeScale.meta,
    color: colors.onSolidMuted,
  },
  overline: {
    ...typeScale.overline,
    color: colors.inkFaint,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  sectionTitle: {
    ...typeScale.section,
    color: colors.ink,
  },
  sectionTrailing: typeScale.captionBold,

  queueCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    borderRadius: radius.card,
    // A hairline of the type colour rather than the usual grey, so the three
    // cards read as a set of three different things.
    borderWidth: 1,
  },
  queueCardEmpty: {
    opacity: 0.6,
  },
  queueArt: {
    width: 80,
    height: 80,
    borderRadius: radius.art,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  queueBody: {
    flex: 1,
    gap: 5,
  },
  queueTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queueTitle: {
    ...typeScale.cardTitle,
    color: colors.ink,
    flexShrink: 1,
  },
  queueBlurb: {
    ...typeScale.caption,
    color: colors.inkMuted,
    lineHeight: 16,
  },
  queueCta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    marginTop: 3,
  },

  chunkyButton: {
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    minHeight: 40,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineButton: {
    borderRadius: radius.tile,
    minHeight: 36,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: colors.surface,
  },
  inlineButtonQuiet: {
    borderWidth: 1,
    borderColor: colors.border,
  },

  charTile: {
    borderRadius: radius.tile,
    paddingVertical: 4,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadge: {
    minWidth: 26,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  countBadgeText: {
    ...typeScale.caption,
    fontFamily: typeScale.button.fontFamily,
    color: colors.onSolid,
  },
  pill: {
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 11,
  },
  pillText: typeScale.metaSmall,

  readingChip: {
    borderRadius: radius.control,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 1,
  },
  readingChipLabel: {
    fontFamily: typeScale.overline.fontFamily,
    fontSize: 9,
    letterSpacing: 0.63,
  },

  statTile: {
    flex: 1,
    borderRadius: radius.control,
    paddingVertical: 9,
    paddingHorizontal: 11,
    gap: 1,
  },
  statValue: {
    ...typeScale.stat,
    lineHeight: 22,
  },
  statLabel: typeScale.statLabel,

  progressTrack: {
    overflow: 'hidden',
    flexDirection: 'row',
  },
  stageLadder: {
    flexDirection: 'row',
    gap: 4,
  },
  stageRung: {
    flex: 1,
    height: 7,
    borderRadius: 4,
  },
  stepDots: {
    flexDirection: 'row',
    gap: 4,
  },
  stepDot: {
    width: 16,
    height: 5,
    borderRadius: 3,
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 6,
  },
  emptyTitle: {
    ...typeScale.cardTitle,
    color: colors.ink,
    marginTop: 10,
  },
  emptyBody: {
    ...typeScale.caption,
    color: colors.inkSoft,
    textAlign: 'center',
  } as TextStyle,
});
