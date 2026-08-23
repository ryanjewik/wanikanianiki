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
        <Pressable onPress={onPressTrailing} disabled={!onPressTrailing} hitSlop={8}>
          <Text style={[styles.sectionTrailing, { color: trailingColor }]}>{trailing}</Text>
        </Pressable>
      ) : null}
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
  style,
  disabled,
  ...rest
}: ChunkyButtonProps) {
  const filled = tone !== 'neutral';
  const background = filled ? subjectPalette[tone].solid : colors.surface;
  const foreground = filled ? colors.onSolid : colors.ink;
  const offset = size === 'large' ? 3 : 2;

  return (
    <Pressable disabled={disabled} {...rest}>
      {({ pressed }) => (
        <View
          style={[
            styles.chunkyButton,
            controlBorder,
            {
              backgroundColor: background,
              height: size === 'large' ? 50 : 40,
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
    <Pressable onPress={onPress} style={styles.textButton} hitSlop={6}>
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
    <Pressable onPress={onPress}>
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

  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
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
  tone?: 'success' | 'danger' | 'neutral' | 'radical';
}) {
  const palettes = {
    success: { bg: colors.successTint, fg: colors.successInk, label: colors.successInkSoft },
    danger: { bg: colors.dangerTint, fg: colors.dangerInk, label: colors.dangerInkSoft },
    radical: { bg: colors.radicalTint, fg: colors.radical, label: colors.radicalInk },
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

/** Progress split into a correct run and an incorrect tail. */
export function SessionProgressBar({
  correct,
  incorrect,
  total,
}: {
  correct: number;
  incorrect: number;
  total: number;
}) {
  const safeTotal = Math.max(1, total);
  return (
    <View style={styles.sessionTrack}>
      <View style={{ flex: correct / safeTotal, backgroundColor: colors.success }} />
      <View style={{ flex: incorrect / safeTotal, backgroundColor: colors.kanji }} />
      <View style={{ flex: Math.max(0, (safeTotal - correct - incorrect) / safeTotal) }} />
    </View>
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
        <View
          key={index}
          style={[styles.stepDot, { backgroundColor: index < completed ? color : colors.border }]}
        />
      ))}
    </View>
  );
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

  chunkyButton: {
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineButton: {
    borderRadius: radius.tile,
    paddingVertical: 6,
    paddingHorizontal: 11,
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
  sessionTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
    flexDirection: 'row',
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
