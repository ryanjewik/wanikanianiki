/**
 * Review — artboard 4d.
 *
 * A review asks for one half of an item at a time (meaning or reading), and
 * both halves have to land before the item leaves the queue. Only the
 * *incorrect* counts are ever reported: WaniKani recomputes the SRS stage
 * server-side, so the client never sends a stage of its own.
 *
 * A missed item is not dropped — it goes to the back of the queue and is
 * retried at the end of the session.
 */
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import * as React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CheckMark, CorrectMark, IncorrectMark } from '@/components/icons';
import { Mascot, type Pose } from '@/components/Mascot';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  Pill,
  SectionHeading,
  SessionProgressBar,
  StatTile,
} from '@/components/ui';
import type { StudyItem } from '@/data/types';
import { useReviewQueue, useStudyActions } from '@/hooks/useStudyData';
import {
  colors,
  controlBorder,
  jp,
  radius,
  shadows,
  spacing,
  srsStages,
  stageBucket,
  stageName,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

type Half = 'meaning' | 'reading';
type Verdict = 'correct' | 'incorrect';

interface QueueEntry {
  item: StudyItem;
  half: Half;
  /** Incorrect attempts so far, carried into the submitted review. */
  strikes: number;
}

export default function ReviewScreen() {
  const router = useRouter();
  const { data: queue } = useReviewQueue();
  const { submitAnswer } = useStudyActions();

  const [entries, setEntries] = React.useState<QueueEntry[] | null>(null);
  const [answer, setAnswer] = React.useState('');
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);
  const [pose, setPose] = React.useState<Pose>('idle');
  const [stats, setStats] = React.useState({ correct: 0, incorrect: 0, missed: [] as StudyItem[] });

  // Radicals have no reading to ask for, so they contribute one card, not two.
  React.useEffect(() => {
    if (!queue || entries) return;
    setEntries(
      queue.flatMap((item) => {
        const halves: Half[] = item.subject.readings.length > 0 ? ['meaning', 'reading'] : ['meaning'];
        return halves.map((half) => ({ item, half, strikes: 0 }));
      }),
    );
  }, [queue, entries]);

  const current = entries?.[0];
  const total = (entries?.length ?? 0) + stats.correct;

  const grade = React.useCallback(
    (entry: QueueEntry, typed: string): boolean => {
      const normalised = typed.trim().toLowerCase();
      if (!normalised) return false;

      if (entry.half === 'meaning') {
        return entry.item.subject.meanings.some(
          (m) => m.acceptedAnswer && m.meaning.toLowerCase() === normalised,
        );
      }
      return entry.item.subject.readings.some(
        (r) => r.acceptedAnswer && r.reading === typed.trim(),
      );
    },
    [],
  );

  const onSubmit = React.useCallback(async () => {
    if (!current || !entries || verdict) return;

    const ok = grade(current, answer);
    setVerdict(ok ? 'correct' : 'incorrect');
    setPose(ok ? 'correct' : 'wrong');

    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(
        ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
      );
    }

    // The feedback mark holds for ~600ms, then the next item comes in.
    setTimeout(() => {
      setVerdict(null);
      setAnswer('');

      setEntries((rest) => {
        if (!rest) return rest;
        const [, ...remaining] = rest;

        if (ok) {
          // Both halves clear only when this was the last card for the item.
          const itemDone = !remaining.some((e) => e.item.subject.id === current.item.subject.id);
          if (itemDone) {
            void submitAnswer({
              assignmentId: current.item.assignment.id,
              subjectId: current.item.subject.id,
              incorrectMeaningAnswers: current.half === 'meaning' ? current.strikes : 0,
              incorrectReadingAnswers: current.half === 'reading' ? current.strikes : 0,
              answeredAt: new Date().toISOString(),
            });
          }
          return remaining;
        }

        // Missed: back of the queue, with the strike recorded.
        return [...remaining, { ...current, strikes: current.strikes + 1 }];
      });

      setStats((prev) =>
        ok
          ? { ...prev, correct: prev.correct + 1 }
          : {
              ...prev,
              incorrect: prev.incorrect + 1,
              missed: prev.missed.some((m) => m.subject.id === current.item.subject.id)
                ? prev.missed
                : [...prev.missed, current.item],
            },
      );
    }, 600);
  }, [answer, current, entries, grade, submitAnswer, verdict]);

  React.useEffect(() => {
    if (entries && entries.length === 0) router.replace('/session-summary');
  }, [entries, router]);

  if (!current) return <View style={styles.screen} />;

  const { subject } = current.item;
  const palette = subjectPalette[subject.type];
  const bucket = stageBucket(current.item.assignment.srsStage);
  const stage = srsStages[bucket];
  const done = stats.correct + stats.incorrect;
  const accuracy = done > 0 ? Math.round((stats.correct / done) * 100) : 100;

  const promptLabel =
    current.half === 'meaning'
      ? "What's the meaning?"
      : subject.type === 'vocabulary'
        ? "What's the reading?"
        : "What's the reading?";

  const headerLabel = `${subject.type === 'vocabulary' ? 'Vocabulary' : subject.type === 'kanji' ? 'Kanji' : 'Radical'} ${
    current.half === 'meaning' ? 'Meaning' : 'Reading'
  }`;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={headerLabel}
        glyph={palette.glyph}
        glyphColor={palette.solid}
        trailingText={`${stats.correct} / ${total}`}
      >
        <SessionProgressBar correct={stats.correct} incorrect={stats.incorrect} total={total} />
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.promptCard}>
          <Text style={styles.promptLabel}>{promptLabel}</Text>
          <Text style={styles.promptGlyph}>{subject.characters}</Text>
          <View style={styles.promptMeta}>
            <Pill label={stageName(current.item.assignment.srsStage)} color={stage.ink} background={stage.tint} />
            <Text style={styles.promptMetaText}>level {subject.level}</Text>
          </View>
        </Card>

        <View style={styles.answerRow}>
          <View
            style={[
              styles.answerField,
              controlBorder,
              shadows.hard,
              verdict === 'correct' && { borderColor: colors.success },
              verdict === 'incorrect' && { borderColor: colors.danger },
            ]}
          >
            <TextInput
              value={answer}
              onChangeText={setAnswer}
              onSubmitEditing={onSubmit}
              editable={!verdict}
              style={styles.answerInput}
              placeholder={current.half === 'reading' ? 'かな' : 'meaning'}
              placeholderTextColor={colors.inkDisabled}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              // The reading half wants kana; romaji conversion is handled by the
              // platform IME rather than re-implemented here.
              keyboardType="default"
            />
          </View>

          <Pressable onPress={onSubmit} disabled={Boolean(verdict)}>
            <View
              style={[
                styles.submitButton,
                controlBorder,
                shadows.hard,
                {
                  backgroundColor:
                    verdict === 'incorrect' ? colors.danger : verdict === 'correct' ? colors.success : colors.success,
                },
              ]}
            >
              {verdict === 'incorrect' ? (
                <IncorrectMark size={26} />
              ) : verdict === 'correct' ? (
                <CorrectMark size={26} />
              ) : (
                <CheckMark size={26} />
              )}
            </View>
          </Pressable>
        </View>

        <Text style={styles.inputHint}>
          {current.half === 'reading' ? 'Kana input · romaji converts as you type' : 'Type the English meaning'}
        </Text>

        <Card style={styles.sessionCard}>
          <SectionHeading
            title="This session"
            trailing={stats.incorrect > 0 ? `${stats.incorrect} to retry` : undefined}
            trailingColor={colors.warning}
          />
          <View style={styles.statRow}>
            <StatTile value={`${accuracy}%`} label="correct" tone="success" />
            <StatTile value={stats.incorrect} label="missed" tone="danger" />
            <StatTile value={entries?.length ?? 0} label="left" tone="neutral" />
          </View>

          {stats.missed.length > 0 ? (
            <View style={styles.missedRow}>
              {stats.missed.slice(0, 4).map((missed) => (
                <View key={missed.subject.id} style={styles.missedChip}>
                  <Text style={styles.missedChipText}>{missed.subject.characters}</Text>
                </View>
              ))}
              <Text style={styles.missedNote}>retry at the end</Text>
            </View>
          ) : null}
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Mascot
          pose={pose}
          size={56}
          speed={1}
          onReactionEnd={() => setPose('idle')}
        />
        <Pressable onPress={() => router.replace('/session-summary')} hitSlop={8}>
          <Text style={styles.wrapUp}>Wrap up ›</Text>
        </Pressable>
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
    paddingTop: 20,
    paddingBottom: 16,
  },

  promptCard: {
    alignItems: 'center',
    gap: 18,
    paddingTop: 34,
    paddingHorizontal: 18,
    paddingBottom: 28,
    borderRadius: radius.cardLarge,
  },
  promptLabel: {
    fontFamily: typeScale.overline.fontFamily,
    fontSize: 11,
    letterSpacing: 1.43,
    textTransform: 'uppercase',
    color: colors.inkFaint,
  },
  promptGlyph: {
    ...jp.hero,
    color: colors.ink,
  },
  promptMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  promptMetaText: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },

  answerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
  },
  answerField: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 15,
  },
  answerInput: {
    ...jp.answer,
    color: colors.ink,
    padding: 0,
  },
  submitButton: {
    width: 56,
    height: 56,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputHint: {
    marginTop: 10,
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },

  sessionCard: {
    marginTop: 18,
  },
  statRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 12,
  },
  missedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  missedChip: {
    backgroundColor: colors.dangerTint,
    borderRadius: radius.tile,
    paddingVertical: 3,
    paddingHorizontal: 11,
  },
  missedChipText: {
    ...jp.tileSmall,
    color: colors.dangerInk,
  },
  missedNote: {
    marginLeft: 'auto',
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },

  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
  },
  wrapUp: {
    ...typeScale.meta,
    color: colors.inkFaint,
  },
});
