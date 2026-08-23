/**
 * Lesson — artboard 4c.
 *
 * A lesson is study-only until the very end: the user reads the composition,
 * mnemonic and readings, and the single write (`PUT /assignments/{id}/start`)
 * fires when they tap through. That call is queued in the outbox first, so
 * finishing a lesson offline works exactly like finishing one online.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/Mascot';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  CardBanner,
  ChunkyButton,
  Overline,
  ReadingChip,
  StepDots,
  TextButton,
} from '@/components/ui';
import { findSubject } from '@/data/fixtures';
import type { StudyItem, Subject } from '@/data/types';
import { useLessonQueue, useStudyActions } from '@/hooks/useStudyData';
import {
  colors,
  jp,
  radius,
  spacing,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

export default function LessonScreen() {
  const router = useRouter();
  const { data: queue } = useLessonQueue();
  const { completeLesson } = useStudyActions();

  const [index, setIndex] = React.useState(0);
  /** Items the user deferred; they go to the back of the queue. */
  const [deferred, setDeferred] = React.useState<StudyItem[]>([]);

  const items = React.useMemo(() => [...(queue ?? []), ...deferred], [queue, deferred]);
  const current = items[index];

  const advance = React.useCallback(() => {
    if (index + 1 >= items.length) {
      router.replace('/session-summary');
      return;
    }
    setIndex((i) => i + 1);
  }, [index, items.length, router]);

  const onGotIt = React.useCallback(async () => {
    if (current) await completeLesson(current.assignment);
    advance();
  }, [current, completeLesson, advance]);

  const onDefer = React.useCallback(() => {
    if (current) setDeferred((rest) => [...rest, current]);
    advance();
  }, [current, advance]);

  if (!current) return <View style={styles.screen} />;

  const { subject } = current;
  const palette = subjectPalette[subject.type];
  const typeLabel = subject.type === 'vocabulary' ? 'vocabulary' : subject.type;

  const primaryMeaning = subject.meanings.find((m) => m.primary)?.meaning ?? '—';
  const onyomi = subject.readings.find((r) => r.type === 'onyomi');
  const kunyomi = subject.readings.find((r) => r.type === 'kunyomi');
  const plainReading = subject.readings.find((r) => r.type === 'vocabulary');
  const components = subject.componentSubjectIds
    .map(findSubject)
    .filter((s): s is Subject => Boolean(s));
  const usedIn = subject.amalgamationSubjectIds
    .map(findSubject)
    .filter((s): s is Subject => Boolean(s))
    .slice(0, 2);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={subject.type === 'kanji' ? 'New Kanji' : subject.type === 'radical' ? 'New Radical' : 'New Word'}
        glyph={palette.glyph}
        glyphColor={palette.solid}
        trailing={
          <View style={styles.progressRow}>
            <StepDots total={items.length} completed={index} color={palette.solid} />
            <Text style={styles.progressCount}>
              {index + 1}/{items.length}
            </Text>
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Card flush>
          <CardBanner
            type={subject.type}
            label={`${typeLabel} · level ${subject.level}`}
            trailing="meaning first"
          />
          <View style={styles.subjectBody}>
            <Text style={styles.subjectGlyph}>{subject.characters}</Text>

            {components.length > 0 ? (
              <View style={styles.equation}>
                {components.map((component, position) => (
                  <React.Fragment key={component.id}>
                    {position > 0 ? <Text style={styles.operator}>+</Text> : null}
                    <View style={[styles.equationChip, { backgroundColor: subjectPalette[component.type].solid }]}>
                      <Text style={styles.equationChipText}>{component.characters}</Text>
                    </View>
                  </React.Fragment>
                ))}
                <Text style={styles.operator}>=</Text>
                <View style={[styles.equationChip, { backgroundColor: palette.solid }]}>
                  <Text style={styles.equationChipText}>{subject.characters}</Text>
                </View>
              </View>
            ) : null}

            <Text style={styles.meaning}>{primaryMeaning}</Text>
          </View>
        </Card>

        {subject.meaningMnemonic ? (
          <Card style={styles.mnemonicCard}>
            <View style={[styles.artSlot, { backgroundColor: palette.tint }]}>
              <Mascot pose="idle" size={84} speed={0.6} />
            </View>
            <View style={styles.mnemonicBody}>
              <Overline style={{ color: palette.solid }}>Mnemonic</Overline>
              <Text style={styles.mnemonicText}>{subject.meaningMnemonic}</Text>
            </View>
          </Card>
        ) : null}

        {subject.readings.length > 0 ? (
          <Card>
            <Overline style={styles.groupLabel}>Readings</Overline>
            <View style={styles.readingRow}>
              {onyomi ? <ReadingChip reading={onyomi.reading} label="ON'YOMI" tone="radical" /> : null}
              {kunyomi ? (
                <ReadingChip reading={kunyomi.reading} label="KUN'YOMI" tone="vocabulary" />
              ) : null}
              {plainReading ? (
                <ReadingChip reading={plainReading.reading} label="READING" tone="vocabulary" />
              ) : null}
              {/* Reads the item aloud via the platform speech engine — free, and
                  works offline once a Japanese voice pack is installed. */}
              <View style={styles.speakButton}>
                <Text style={styles.speakGlyph}>♪</Text>
              </View>
            </View>
          </Card>
        ) : null}

        {usedIn.length > 0 ? (
          <Card>
            <Overline style={styles.groupLabel}>Shows up in</Overline>
            <View style={styles.usedInRow}>
              {usedIn.map((word) => (
                <View key={word.id} style={styles.usedInTile}>
                  <Text style={styles.usedInWord}>{word.characters}</Text>
                  <Text style={styles.usedInGloss}>
                    {word.readings[0]?.reading} · {word.meanings[0]?.meaning.toLowerCase()}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <ChunkyButton label="Got it — next" tone={subject.type} onPress={onGotIt} />
        <TextButton label="Show me this one again later" onPress={onDefer} />
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
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  progressCount: {
    ...typeScale.captionBold,
    color: colors.inkFaint,
  },

  subjectBody: {
    paddingTop: 22,
    paddingHorizontal: 18,
    paddingBottom: 18,
    alignItems: 'center',
    gap: 14,
  },
  subjectGlyph: {
    ...jp.lesson,
    color: colors.ink,
  },
  equation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  equationChip: {
    borderRadius: radius.tile,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  equationChipText: {
    ...jp.chip,
    color: colors.onSolid,
  },
  operator: {
    fontFamily: typeScale.button.fontFamily,
    fontSize: 14,
    color: colors.inkDisabled,
  },
  meaning: {
    ...typeScale.display,
    color: colors.ink,
  },

  mnemonicCard: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  artSlot: {
    width: 84,
    height: 84,
    borderRadius: radius.art,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mnemonicBody: {
    flex: 1,
    gap: 5,
  },
  mnemonicText: {
    fontFamily: typeScale.bodyLoose.fontFamily,
    fontSize: 13.5,
    lineHeight: 21.6,
    color: colors.inkMuted,
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

  usedInRow: {
    flexDirection: 'row',
    gap: 9,
  },
  usedInTile: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingVertical: 9,
    paddingHorizontal: 11,
    gap: 2,
  },
  usedInWord: {
    ...jp.chipSmall,
    color: colors.ink,
  },
  usedInGloss: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
  },

  footer: {
    marginTop: 'auto',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
    gap: 7,
  },
});
