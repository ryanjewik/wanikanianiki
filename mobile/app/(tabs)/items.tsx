/**
 * Level browser — artboard 6b.
 *
 * What is in the current level and where each item stands. The chip fill is
 * the entire legend: solid means passed, tinted means in progress, grey means
 * still locked.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, CharTile, ProgressBar, SectionHeading, type TileState } from '@/components/ui';
import { LEVEL_12_ITEMS } from '@/data/fixtures';
import type { SubjectType } from '@/data/types';
import { useDashboard } from '@/hooks/useStudyData';
import {
  colors,
  jp,
  radius,
  spacing,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

export default function LevelBrowserScreen() {
  const router = useRouter();
  const { data: dashboard } = useDashboard();

  const level = dashboard?.levelProgress;
  const groups: { type: SubjectType; title: string }[] = [
    { type: 'radical', title: 'Radicals' },
    { type: 'kanji', title: 'Kanji' },
    { type: 'vocabulary', title: 'Vocabulary' },
  ];

  const counts = {
    radical: level?.radicals,
    kanji: level?.kanji,
    vocabulary: level?.vocabulary,
  };

  const totalItems =
    (level?.radicals.total ?? 0) + (level?.kanji.total ?? 0) + (level?.vocabulary.total ?? 0);

  // Level progress is measured in kanji: WaniKani unlocks the next level once
  // enough of them reach stage 5, not once everything is finished.
  const kanjiProgress =
    level && level.kanji.total > 0 ? level.kanji.passed / level.kanji.total : 0;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={`Level ${level?.level ?? 1}`}
        trailingText={`${totalItems} items`}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Card variant="bordered">
          <SectionHeading
            title="Level progress"
            trailing={`${level?.daysAtLevel ?? 0} days in`}
            trailingColor={colors.warning}
          />
          <View style={styles.progressWrap}>
            <ProgressBar progress={kanjiProgress} color={colors.kanji} />
          </View>
          <Text style={styles.footnote}>
            <Text style={styles.footnoteStrong}>
              {level?.kanjiRemainingToLevelUp ?? 0} more kanji
            </Text>{' '}
            at stage 3 or higher to reach level {(level?.level ?? 1) + 1}.
          </Text>
        </Card>

        {groups.map((group) => {
          const items = LEVEL_12_ITEMS.filter((item) => item.subject.type === group.type);
          const counted = counts[group.type];
          const palette = subjectPalette[group.type];

          return (
            <Card key={group.type} variant="bordered">
              <View style={styles.groupHead}>
                <View style={styles.groupTitleRow}>
                  <View style={[styles.groupGlyphTile, { backgroundColor: palette.solid }]}>
                    <Text style={styles.groupGlyph}>{palette.glyph}</Text>
                  </View>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                </View>
                {counted ? (
                  <Text style={styles.groupCount}>
                    {counted.passed} / {counted.total} passed
                  </Text>
                ) : null}
              </View>

              <View style={styles.tileGrid}>
                {items.map(({ subject, state }) => (
                  <CharTile
                    key={subject.id}
                    characters={subject.characters ?? '?'}
                    type={subject.type}
                    state={state as TileState}
                    size={group.type === 'vocabulary' ? 'small' : 'default'}
                    onPress={() => router.push(`/item/${subject.id}`)}
                  />
                ))}
              </View>
            </Card>
          );
        })}

        <Card variant="bordered" style={styles.legend}>
          <LegendSwatch color={colors.kanji} label="passed" />
          <LegendSwatch color={colors.kanjiTint} label="in progress" />
          <LegendSwatch color={colors.ground} label="locked" />
        </Card>
      </ScrollView>
    </View>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
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
    paddingTop: 12,
    paddingBottom: 20,
    gap: spacing.stack,
  },

  progressWrap: {
    marginBottom: 11,
  },
  footnote: {
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  footnoteStrong: {
    fontFamily: typeScale.section.fontFamily,
    color: colors.ink,
  },

  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  groupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupGlyphTile: {
    width: 21,
    height: 21,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupGlyph: {
    fontFamily: jp.icon.fontFamily,
    fontSize: 12,
    color: colors.onSolid,
  },
  groupTitle: {
    ...typeScale.section,
    color: colors.ink,
  },
  groupCount: {
    ...typeScale.captionBold,
    color: colors.inkFaint,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },

  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 11,
    height: 11,
    borderRadius: 4,
  },
  legendLabel: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
  },
});
