/**
 * Dashboard — artboard 3b.
 *
 * Two action cards at the top, then read-only progress. The art slots on the
 * action cards hold the Crabigator: a waving pose for lessons, a walking one
 * for reviews.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/Mascot';
import { ProfileAvatar, ScreenHeader } from '@/components/ScreenHeader';
import { Card, ChunkyButton, CountBadge, SectionHeading } from '@/components/ui';
import { formatSyncedAgo } from '@/data/sync';
import type { Counted, DayActivity, SubjectType } from '@/data/types';
import { useDashboard, useSync } from '@/hooks/useStudyData';
import {
  colors,
  jp,
  radius,
  spacing,
  srsStages,
  stageVocabularies,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

export default function DashboardScreen() {
  const router = useRouter();
  const { data, reload } = useDashboard();
  const { syncing, refresh } = useSync();

  const onRefresh = React.useCallback(async () => {
    await refresh();
    reload();
  }, [refresh, reload]);

  if (!data) return <View style={styles.screen} />;

  const { levelProgress: level } = data;
  const syncedLabel = formatSyncedAgo(data.lastSyncedAt);

  return (
    <View style={styles.screen}>
      <ScreenHeader branded title="KANJI WORKSHOP" trailing={<ProfileAvatar />} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={onRefresh} />}
      >
        <ActionCard
          title="Today's Lessons"
          count={data.lessonCount}
          tone="kanji"
          blurb="Learn something new."
          cta="Start Lessons"
          pose="wave"
          onPress={() => router.push('/lesson')}
        />

        <ActionCard
          title="Reviews"
          count={data.reviewCount}
          tone="radical"
          blurb="Do your Reviews to unlock new Lessons."
          cta="Start Reviews"
          pose="walk"
          onPress={() => router.push('/review')}
        />

        <StreakCard streak={data.streak} />

        <Card>
          <SectionHeading
            title="Level Progress"
            trailing={`Level ${level.level} ›`}
            onPressTrailing={() => router.push('/items')}
          />
          <View style={styles.countRow}>
            <CountTile type="radical" label="Radicals" counted={level.radicals} />
            <CountTile type="kanji" label="Kanji" counted={level.kanji} />
            <CountTile type="vocabulary" label="Vocab" counted={level.vocabulary} />
          </View>
          <Text style={styles.footnote}>
            <Text style={styles.footnoteStrong}>
              {level.kanjiRemainingToLevelUp} more kanji
            </Text>{' '}
            to level up.
          </Text>
        </Card>

        <SpreadCard spread={data.stageSpread} />

        <View style={styles.syncRow}>
          <View
            style={[
              styles.syncDot,
              { backgroundColor: syncedLabel ? colors.success : colors.inkDisabled },
            ]}
          />
          <Text style={styles.syncText}>{syncedLabel ?? 'Not synced yet'}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function ActionCard({
  title,
  count,
  tone,
  blurb,
  cta,
  pose,
  onPress,
}: {
  title: string;
  count: number;
  tone: 'kanji' | 'radical';
  blurb: string;
  cta: string;
  pose: 'wave' | 'walk';
  onPress: () => void;
}) {
  const palette = subjectPalette[tone];

  return (
    <Card style={styles.actionCard}>
      <View style={[styles.artSlot, { backgroundColor: palette.tint }]}>
        <Mascot pose={pose} size={80} speed={0.7} />
      </View>

      <View style={styles.actionBody}>
        <View style={styles.actionTitleRow}>
          <Text style={styles.actionTitle}>{title}</Text>
          <CountBadge count={count} color={palette.solid} />
        </View>
        <Text style={styles.blurb}>{blurb}</Text>
        <ChunkyButton
          label={cta}
          tone="neutral"
          size="small"
          onPress={onPress}
          style={styles.actionCta}
        />
      </View>
    </Card>
  );
}

function StreakCard({ streak }: { streak: { days: number; best: number; week: DayActivity[] } }) {
  return (
    <Card>
      <View style={styles.streakHead}>
        <View style={styles.streakTitleRow}>
          <Text style={styles.sectionSmall}>Study Streak</Text>
          <Text style={styles.streakDays}>{streak.days}日</Text>
        </View>
        <Text style={styles.meta}>best {streak.best}</Text>
      </View>

      <View style={styles.weekRow}>
        {streak.week.map((day) => (
          <View key={day.label} style={styles.dayColumn}>
            <Text style={[styles.dayLabel, day.isToday && styles.dayLabelToday]}>{day.label}</Text>
            <View
              style={[
                styles.dayBar,
                day.isToday
                  ? styles.dayBarToday
                  : {
                      backgroundColor:
                        day.intensity >= 1
                          ? colors.warning
                          : day.intensity > 0
                            ? colors.warningSoft
                            : colors.border,
                    },
              ]}
            />
          </View>
        ))}
      </View>
    </Card>
  );
}

function CountTile({
  type,
  label,
  counted,
}: {
  type: SubjectType;
  label: string;
  counted: Counted;
}) {
  const palette = subjectPalette[type];
  return (
    <View style={styles.countTile}>
      <View style={styles.countTileHead}>
        <View style={[styles.glyphTile, { backgroundColor: palette.solid }]}>
          <Text style={styles.glyphTileText}>{palette.glyph}</Text>
        </View>
        <Text style={styles.countTileLabel}>{label}</Text>
      </View>
      <Text style={styles.countTileValue}>
        {counted.passed}/{counted.total}
      </Text>
    </View>
  );
}

/** Item counts per stage bucket. Bars are scaled against the tallest column. */
function SpreadCard({ spread }: { spread: number[] }) {
  const peak = Math.max(1, ...spread);
  const names = stageVocabularies.Botanical;

  return (
    <Card>
      <SectionHeading title="Active Item Spread" trailing="Details ›" />
      <View style={styles.spreadChart}>
        {spread.map((value, index) => (
          <View
            key={index}
            style={[
              styles.spreadBar,
              { height: `${Math.max(4, (value / peak) * 100)}%`, backgroundColor: srsStages[index].color },
            ]}
          />
        ))}
      </View>
      <View style={styles.spreadLabels}>
        {names.map((name) => (
          <Text key={name} style={styles.spreadLabel} numberOfLines={1}>
            {name}
          </Text>
        ))}
      </View>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 10,
    paddingBottom: 20,
    gap: 4,
  },

  actionCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 12,
  },
  artSlot: {
    width: 80,
    height: 80,
    borderRadius: radius.art,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBody: {
    flex: 1,
    gap: 7,
  },
  actionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionTitle: {
    ...typeScale.cardTitle,
    color: colors.ink,
  },
  blurb: {
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  actionCta: {
    borderRadius: radius.tile,
  },

  streakHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  streakTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 9,
  },
  sectionSmall: {
    ...typeScale.sectionSmall,
    color: colors.ink,
  },
  streakDays: {
    fontFamily: typeScale.stat.fontFamily,
    fontSize: 19,
    color: colors.warning,
  },
  meta: {
    ...typeScale.meta,
    color: colors.inkFaint,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 5,
  },
  dayColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  dayLabel: {
    fontFamily: typeScale.meta.fontFamily,
    fontSize: 9.5,
    color: colors.inkFaint,
  },
  dayLabelToday: {
    color: colors.ink,
  },
  dayBar: {
    width: '100%',
    height: 26,
    borderRadius: 7,
  },
  dayBarToday: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.inkDisabled,
  },

  countRow: {
    flexDirection: 'row',
    gap: 8,
  },
  countTile: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 6,
  },
  countTileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  glyphTile: {
    width: 19,
    height: 19,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphTileText: {
    fontFamily: jp.icon.fontFamily,
    fontSize: 11,
    color: colors.onSolid,
  },
  countTileLabel: {
    ...typeScale.meta,
    color: colors.ink,
  },
  countTileValue: {
    fontFamily: typeScale.title.fontFamily,
    fontSize: 15,
    color: colors.ink,
  },
  footnote: {
    marginTop: 10,
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  footnoteStrong: {
    fontFamily: typeScale.section.fontFamily,
    color: colors.ink,
  },

  spreadChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
    height: 38,
  },
  spreadBar: {
    flex: 1,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  spreadLabels: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 7,
  },
  spreadLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: typeScale.meta.fontFamily,
    fontSize: 9,
    color: colors.inkFaint,
  },

  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 6,
    paddingTop: 9,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  syncText: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },
});
