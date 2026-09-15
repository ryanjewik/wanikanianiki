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
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MascotCoach } from '@/components/MascotCoach';
import { RiseIn } from '@/components/motion';
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
import { recordSession, type SessionItem } from '@/data/session';
import type { StudyItem, Subject } from '@/data/types';
import { feedback } from '@/feedback';
import { speakJapanese } from '@/feedback/speech';
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

  const startedAt = React.useRef(Date.now());
  /** Items actually taught — a deferred item comes back round and is not one. */
  const taught = React.useRef<StudyItem[]>([]);

  /**
   * One scroll view serves every item in the queue, so moving on leaves the
   * offset where the last item was read to — tap through a long mnemonic and
   * the next item opens halfway down itself. Reset on each change of item.
   */
  const scroller = React.useRef<ScrollView>(null);
  React.useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [index]);

  const advance = React.useCallback(() => {
    if (index + 1 >= items.length) {
      // A lesson has nothing to get wrong, so every item taught is `correct`.
      // The movement it produces is real all the same: WaniKani takes an
      // unlocked item to stage 1 when the lesson lands.
      const session: SessionItem[] = taught.current.map(({ subject, assignment }) => ({
        subjectId: subject.id,
        characters: subject.characters ?? '?',
        meaning: subject.meanings.find((m) => m.primary)?.meaning ?? '',
        reading: subject.readings.find((r) => r.primary)?.reading ?? '',
        startingStage: assignment.srsStage,
        correct: true,
        note: '',
      }));

      recordSession({
        kind: 'lesson',
        startedAt: startedAt.current,
        finishedAt: Date.now(),
        items: session,
      });
      feedback.complete();
      router.replace('/session-summary');
      return;
    }
    setIndex((i) => i + 1);
  }, [index, items.length, router]);

  const onGotIt = React.useCallback(async () => {
    if (current) {
      taught.current.push(current);
      await completeLesson(current.assignment);
    }
    // Deliberately `advance` and not the level-up fanfare, even though an item
    // taught really is an item unlocked. A lesson queue is twenty-odd items
    // long, and a cue that says "this is a big moment" twenty times in four
    // minutes stops meaning it. The fanfare is kept for the end of the run.
    feedback.advance();
    advance();
  }, [current, completeLesson, advance]);

  const onDefer = React.useCallback(() => {
    if (current) setDeferred((rest) => [...rest, current]);
    feedback.advance();
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
  // Vocabulary is spoken as written; anything else is spoken as its reading,
  // since a bare kanji has no pronunciation to read out.
  const spoken =
    subject.type === 'vocabulary'
      ? (subject.characters ?? '')
      : (subject.readings.find((r) => r.primary) ?? subject.readings[0])?.reading ?? '';
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

      <ScrollView ref={scroller} contentContainerStyle={styles.content}>
        {/* Keyed on the subject so each new item's card rises in, rather than
            its contents swapping under a stationary frame. */}
        <RiseIn key={subject.id}>
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
        </RiseIn>

        {subject.meaningMnemonic ? (
          <Card style={styles.mnemonicCard}>
            {/* A mnemonic is the one place in the app where something is being
                explained to you rather than tested, so it is the one place the
                mascot should be doing the talking. */}
            <MascotCoach
              label="Mnemonic"
              tone={subject.type}
              size={84}
              speed={0.6}
              pose="idle"
            >
              <Text style={styles.mnemonicText}>{subject.meaningMnemonic}</Text>
            </MascotCoach>
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
                  works offline once a Japanese voice pack is installed.

                  What gets spoken is not the glyph: a kanji in isolation has no
                  one pronunciation, so a kanji or radical is read by its
                  primary reading and only a vocabulary word reads as itself. */}
              <Pressable
                onPress={() => {
                  feedback.tap();
                  speakJapanese(spoken);
                }}
                disabled={!spoken}
                style={[styles.speakButton, !spoken && styles.speakButtonMuted]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Read aloud"
              >
                <Text style={styles.speakGlyph}>♪</Text>
              </Pressable>
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
  speakButtonMuted: {
    opacity: 0.4,
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
