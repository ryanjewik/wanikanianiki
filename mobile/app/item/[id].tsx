/**
 * Item detail — artboard 6a.
 *
 * Everything known about one subject, plus where it sits in the SRS. Reached
 * from the level browser, from a missed item on the summary, or from a
 * component chip on another item.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { StageBadge } from '@/components/icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  CardBanner,
  ChunkyButton,
  Overline,
  ReadingChip,
  SectionHeading,
  StageLadder,
  StatTile,
} from '@/components/ui';
import { findSubject } from '@/data/fixtures';
import { formatDueIn } from '@/data/sync';
import type { Subject } from '@/data/types';
import { useSubject } from '@/hooks/useStudyData';
import {
  colors,
  jp,
  radius,
  spacing,
  srsStages,
  stageBucket,
  stageName,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const subjectId = Number(id);
  const { data } = useSubject(Number.isFinite(subjectId) ? subjectId : null);

  if (!data) return <View style={styles.screen} />;

  const { subject, assignment } = data;
  const palette = subjectPalette[subject.type];
  const bucket = assignment ? stageBucket(assignment.srsStage) : 0;
  const stage = srsStages[bucket];

  const primaryMeaning = subject.meanings.find((m) => m.primary)?.meaning ?? '—';
  const otherMeanings = subject.meanings
    .filter((m) => !m.primary)
    .map((m) => m.meaning.toLowerCase());

  const onyomi = subject.readings.find((r) => r.type === 'onyomi');
  const kunyomi = subject.readings.find((r) => r.type === 'kunyomi');
  const plainReading = subject.readings.find((r) => r.type === 'vocabulary');

  const components = subject.componentSubjectIds
    .map(findSubject)
    .filter((s): s is Subject => Boolean(s));
  const usedIn = subject.amalgamationSubjectIds
    .map(findSubject)
    .filter((s): s is Subject => Boolean(s));

  const typeTitle =
    subject.type === 'kanji' ? 'Kanji Detail' : subject.type === 'radical' ? 'Radical Detail' : 'Word Detail';

  return (
    <View style={styles.screen}>
      <ScreenHeader
        showBack
        title={typeTitle}
        trailing={
          <View style={styles.headerTrailing}>
            <Text style={styles.headerLevel}>Level {subject.level}</Text>
            <View style={styles.starTile}>
              <Text style={styles.starGlyph}>★</Text>
            </View>
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Card variant="bordered" flush>
          <CardBanner
            type={subject.type}
            label={subject.type === 'vocabulary' ? 'vocabulary' : subject.type}
            trailing={subject.jlptLevel ? `JLPT N${subject.jlptLevel}` : undefined}
          />
          <View style={styles.subjectRow}>
            <Text style={styles.subjectGlyph}>{subject.characters}</Text>
            <View style={styles.subjectBody}>
              <Text style={styles.subjectMeaning}>{primaryMeaning}</Text>
              {otherMeanings.length > 0 ? (
                <Text style={styles.alsoLine}>also: {otherMeanings.join(', ')}</Text>
              ) : null}

              {components.length > 0 ? (
                <View style={styles.componentRow}>
                  {components.map((component) => (
                    <Pressable
                      key={component.id}
                      onPress={() => router.push(`/item/${component.id}`)}
                    >
                      <View
                        style={[
                          styles.componentChip,
                          { backgroundColor: subjectPalette[component.type].solid },
                        ]}
                      >
                        <Text style={styles.componentChipText}>{component.characters}</Text>
                      </View>
                    </Pressable>
                  ))}
                  <Text style={styles.componentCount}>
                    {components.length} {subject.type === 'kanji' ? 'radicals' : 'kanji'}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </Card>

        {subject.readings.length > 0 ? (
          <Card variant="bordered">
            <Overline style={styles.groupLabel}>Readings</Overline>
            <View style={styles.readingRow}>
              {onyomi ? <ReadingChip reading={onyomi.reading} label="ON'YOMI" tone="radical" /> : null}
              {kunyomi ? (
                <ReadingChip reading={kunyomi.reading} label="KUN'YOMI" tone="vocabulary" />
              ) : null}
              {plainReading ? (
                <ReadingChip reading={plainReading.reading} label="READING" tone="vocabulary" />
              ) : null}
              <View style={styles.speakButton}>
                <Text style={styles.speakGlyph}>♪</Text>
              </View>
            </View>
          </Card>
        ) : null}

        {subject.meaningMnemonic ? (
          <Card variant="bordered">
            <Overline style={[styles.groupLabel, { color: palette.solid, marginBottom: 6 }]}>
              Mnemonic
            </Overline>
            <Text style={styles.mnemonicText}>{subject.meaningMnemonic}</Text>
          </Card>
        ) : null}

        {subject.readingMnemonic ? (
          <Card variant="bordered">
            <Overline style={[styles.groupLabel, { color: colors.radical, marginBottom: 6 }]}>
              Reading mnemonic
            </Overline>
            <Text style={styles.mnemonicText}>{subject.readingMnemonic}</Text>
          </Card>
        ) : null}

        <Card variant="bordered">
          <SectionHeading
            title="Your progress"
            trailing={assignment ? `next review ${formatDueIn(assignment.availableAt)}` : 'not started'}
            trailingColor={colors.inkFaint}
          />
          <View style={styles.ladderRow}>
            <StageLadder bucket={bucket} />
          </View>
          <View style={styles.progressStats}>
            <View style={[styles.stageTile, { backgroundColor: stage.tint }]}>
              <StageBadge bucket={bucket} size={22} />
              <View>
                <Text style={[styles.stageName, { color: stage.ink }]}>
                  {assignment ? stageName(assignment.srsStage) : 'Locked'}
                </Text>
                <Text style={[styles.stageInterval, { color: stage.ink }]}>current stage</Text>
              </View>
            </View>
            <StatTile value="6 / 7" label="correct" tone="neutral" />
          </View>
        </Card>

        {usedIn.length > 0 ? (
          <Card variant="bordered">
            <SectionHeading
              title="Shows up in"
              trailing={`${usedIn.length} words ›`}
              trailingColor={colors.vocabulary}
            />
            <View>
              {usedIn.map((word, index) => (
                <Pressable key={word.id} onPress={() => router.push(`/item/${word.id}`)}>
                  <View style={[styles.wordRow, index < usedIn.length - 1 && styles.rowDivider]}>
                    <Text style={styles.wordGlyph}>{word.characters}</Text>
                    <Text style={styles.wordMeaning}>
                      {word.meanings[0]?.meaning.toLowerCase() ?? ''}
                    </Text>
                    <Text style={styles.wordReading}>{word.readings[0]?.reading ?? ''}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <ChunkyButton
          label="Practice this item"
          tone="neutral"
          onPress={() => router.push('/review')}
        />
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
    paddingTop: 12,
    paddingBottom: 16,
    gap: spacing.stack,
  },

  headerTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  headerLevel: {
    ...typeScale.captionBold,
    color: colors.inkFaint,
  },
  starTile: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starGlyph: {
    fontSize: 12,
    color: colors.inkSoft,
  },

  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingTop: 15,
    paddingHorizontal: 18,
    paddingBottom: 13,
  },
  subjectGlyph: {
    ...jp.detail,
    color: colors.ink,
  },
  subjectBody: {
    flex: 1,
    gap: 7,
  },
  subjectMeaning: {
    ...typeScale.title,
    color: colors.ink,
  },
  alsoLine: {
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  componentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  componentChip: {
    borderRadius: 7,
    paddingVertical: 2,
    paddingHorizontal: 9,
  },
  componentChipText: {
    ...jp.chipSmall,
    color: colors.onSolid,
  },
  componentCount: {
    ...typeScale.meta,
    color: colors.inkFaint,
  },

  groupLabel: {
    marginBottom: 10,
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  speakButton: {
    marginLeft: 'auto',
    width: 36,
    height: 36,
    borderRadius: radius.round,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakGlyph: {
    fontSize: 14,
    color: colors.inkSoft,
  },
  mnemonicText: {
    ...typeScale.bodyLoose,
    color: colors.inkMuted,
  },

  ladderRow: {
    marginBottom: 9,
  },
  progressStats: {
    flexDirection: 'row',
    gap: 9,
  },
  stageTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.control,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  stageName: {
    fontFamily: typeScale.title.fontFamily,
    fontSize: 14,
    lineHeight: 17,
  },
  stageInterval: typeScale.statLabel,

  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  wordGlyph: {
    ...jp.row,
    color: colors.ink,
    width: 56,
  },
  wordMeaning: {
    flex: 1,
    ...typeScale.body,
    fontFamily: typeScale.section.fontFamily,
    color: colors.inkMuted,
  },
  wordReading: {
    ...typeScale.meta,
    fontFamily: typeScale.caption.fontFamily,
    color: colors.inkFaint,
  },

  footer: {
    marginTop: 'auto',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
  },
});
