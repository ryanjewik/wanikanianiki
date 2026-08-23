/**
 * Session summary — artboard 6c.
 *
 * What moved, what to fix, and one clear next step. The accuracy ring is drawn
 * with an SVG arc rather than a conic gradient, which CSS has and React Native
 * does not.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { MascotStill } from '@/components/Mascot';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ChunkyButton, SectionHeading, TextButton } from '@/components/ui';
import { SESSION_SUMMARY } from '@/data/fixtures';
import { formatDueIn } from '@/data/sync';
import {
  colors,
  jp,
  radius,
  spacing,
  srsStages,
  stageVocabularies,
  type as typeScale,
} from '@/theme/tokens';

export default function SessionSummaryScreen() {
  const router = useRouter();
  const summary = SESSION_SUMMARY;
  const names = stageVocabularies.Botanical;
  const movedUp = summary.movements.reduce((total, m) => total + m.count, 0);
  const peak = Math.max(1, ...summary.movements.map((m) => m.count));

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Session Complete" trailingText={`${summary.durationMinutes} min`} />

      <ScrollView contentContainerStyle={styles.content}>
        <Card variant="bordered" style={styles.heroCard}>
          <AccuracyRing percentage={summary.percentageCorrect} />
          <View style={styles.heroBody}>
            <View>
              <Text style={styles.heroTitle}>Best run this week</Text>
              <Text style={styles.heroSubtitle}>
                {summary.total} reviews · {summary.correct} right, {summary.incorrect} wrong
              </Text>
            </View>
            <View style={styles.streakPill}>
              <Text style={styles.streakValue}>{summary.streakDays}</Text>
              <Text style={styles.streakLabel}>day streak</Text>
            </View>
          </View>
        </Card>

        <Card variant="bordered">
          <SectionHeading
            title="Items that moved up"
            trailing={`+${movedUp}`}
            trailingColor={colors.success}
          />
          <View style={styles.movementList}>
            {summary.movements.map((movement) => (
              <View key={`${movement.from}-${movement.to}`} style={styles.movementRow}>
                <Text style={styles.movementLabel}>
                  {names[movement.from]} → {names[movement.to]}
                </Text>
                <View style={styles.movementTrack}>
                  <View
                    style={{
                      width: `${(movement.count / peak) * 100}%`,
                      height: '100%',
                      backgroundColor: srsStages[movement.to].color,
                    }}
                  />
                </View>
                <Text style={styles.movementCount}>{movement.count}</Text>
              </View>
            ))}
          </View>
        </Card>

        {summary.missed.length > 0 ? (
          <Card variant="bordered">
            <SectionHeading
              title="Worth another look"
              trailing={`${summary.missed.length} items`}
              trailingColor={colors.dangerInk}
            />
            <View>
              {summary.missed.map((missed, index) => (
                <View
                  key={missed.subjectId}
                  style={[styles.missedRow, index < summary.missed.length - 1 && styles.rowDivider]}
                >
                  <View style={styles.missedChip}>
                    <Text style={styles.missedChipText}>{missed.characters}</Text>
                  </View>
                  <View style={styles.missedBody}>
                    <Text style={styles.missedMeaning}>{missed.meaning}</Text>
                    <Text style={styles.missedNote}>{missed.note}</Text>
                  </View>
                  <Text style={styles.missedReading}>{missed.reading}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <Card variant="bordered" style={styles.nextCard}>
          <View style={styles.nextGlyphTile}>
            <Text style={styles.nextGlyph}>次</Text>
          </View>
          <View style={styles.nextBody}>
            <Text style={styles.nextTitle}>
              Next reviews {formatDueIn(summary.nextReviewAt)}
            </Text>
            <Text style={styles.nextSubtitle}>
              {summary.nextReviewCount} items · we&apos;ll remind you
            </Text>
          </View>
          <MascotStill pose="correct" size={44} />
        </Card>

        {summary.pendingSync > 0 ? (
          <Text style={styles.pendingNote}>
            {summary.pendingSync} answers queued — they&apos;ll sync when you&apos;re back online.
            Until then, the next-review times above are an estimate.
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <ChunkyButton label="Start 24 lessons" tone="kanji" onPress={() => router.replace('/lesson')} />
        <TextButton label="Back to home" onPress={() => router.replace('/')} />
      </View>
    </View>
  );
}

/** Accuracy ring — a stroked circle with `strokeDasharray` for the arc. */
function AccuracyRing({ percentage }: { percentage: number }) {
  const size = 96;
  const strokeWidth = 10;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, percentage)) / 100) * circumference;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.ground}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.success}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          // Start the arc at twelve o'clock rather than three.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCentre}>
        <Text style={styles.ringValue}>{percentage}%</Text>
        <Text style={styles.ringLabel}>CORRECT</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 14,
    paddingBottom: 16,
    gap: spacing.stack,
  },

  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  heroBody: {
    flex: 1,
    gap: 9,
  },
  heroTitle: {
    fontFamily: typeScale.title.fontFamily,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  heroSubtitle: {
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  streakPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.warningTint,
    borderRadius: radius.tile,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  streakValue: {
    fontFamily: typeScale.title.fontFamily,
    fontSize: 13,
    color: colors.warningInk,
  },
  streakLabel: {
    ...typeScale.statLabel,
    color: colors.warningInkSoft,
  },

  ringCentre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValue: {
    fontFamily: typeScale.title.fontFamily,
    fontSize: 24,
    lineHeight: 26,
    color: colors.ink,
  },
  ringLabel: {
    fontFamily: typeScale.overline.fontFamily,
    fontSize: 9,
    letterSpacing: 0.54,
    color: colors.inkFaint,
  },

  movementList: {
    gap: 9,
  },
  movementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  movementLabel: {
    flex: 1,
    ...typeScale.meta,
    fontSize: 12,
    color: colors.inkMuted,
  },
  movementTrack: {
    flex: 1.4,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.ground,
    overflow: 'hidden',
  },
  movementCount: {
    width: 22,
    textAlign: 'right',
    fontFamily: typeScale.title.fontFamily,
    fontSize: 12,
    color: colors.ink,
  },

  missedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  missedChip: {
    backgroundColor: colors.dangerTint,
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 9,
  },
  missedChipText: {
    ...jp.tile,
    color: colors.dangerInk,
  },
  missedBody: {
    flex: 1,
    gap: 1,
  },
  missedMeaning: {
    ...typeScale.body,
    fontFamily: typeScale.section.fontFamily,
    color: colors.ink,
  },
  missedNote: {
    ...typeScale.meta,
    fontFamily: typeScale.caption.fontFamily,
    color: colors.inkFaint,
  },
  missedReading: {
    ...typeScale.meta,
    color: colors.inkFaint,
  },

  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  nextGlyphTile: {
    width: 44,
    height: 44,
    borderRadius: radius.art,
    backgroundColor: colors.radicalTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextGlyph: {
    fontFamily: jp.tile.fontFamily,
    fontSize: 20,
    color: colors.radical,
  },
  nextBody: {
    flex: 1,
    gap: 2,
  },
  nextTitle: {
    ...typeScale.section,
    color: colors.ink,
  },
  nextSubtitle: {
    ...typeScale.captionBold,
    fontFamily: typeScale.caption.fontFamily,
    color: colors.inkSoft,
  },

  pendingNote: {
    ...typeScale.metaSmall,
    color: colors.warningInk,
    paddingHorizontal: 4,
    lineHeight: 16,
  },

  footer: {
    marginTop: 'auto',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
    gap: 7,
  },
});
