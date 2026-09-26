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
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot, type Pose } from '@/components/Mascot';
import { useAnswerRun } from '@/components/MascotCoach';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  Pill,
  SectionHeading,
  SessionProgressBar,
  StatTile,
} from '@/components/ui';
import { halvesOf, type Half, shuffle, WkQuestion } from '@/components/WkQuestion';
import { recordSession, type SessionItem } from '@/data/session';
import { feedback } from '@/feedback';
import type { StudyItem } from '@/data/types';
import { useReviewQueue, useStudyActions } from '@/hooks/useStudyData';
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

interface QueueEntry {
  item: StudyItem;
  half: Half;
}

export default function ReviewScreen() {
  const router = useRouter();
  const { data: queue } = useReviewQueue();
  const { submitAnswer } = useStudyActions();

  const [entries, setEntries] = React.useState<QueueEntry[] | null>(null);
  const [pose, setPose] = React.useState<Pose>('idle');
  /** Whether the current question has been graded, for the coach's line. */
  const [graded, setGraded] = React.useState(false);
  /** Counts questions asked; keys each one so it always starts clean. */
  const [turn, setTurn] = React.useState(0);
  const [stats, setStats] = React.useState({ correct: 0, incorrect: 0, missed: [] as StudyItem[] });
  const { line, register } = useAnswerRun();

  // Kept in refs, not state: the summary reads them once on the way out, and
  // re-rendering the card on every strike would be churn for nothing.
  const startedAt = React.useRef(Date.now());
  const strikes = React.useRef(new Map<number, { meaning: number; reading: number }>());

  // Radicals have no reading to ask for, so they contribute one card, not two.
  React.useEffect(() => {
    if (!queue || entries) return;
    setEntries(
      // Shuffled, meaning and reading apart, as WaniKani presents a session:
      // the reading straight after its meaning gives half of it away.
      shuffle(queue.flatMap((item) => halvesOf(item.subject).map((half) => ({ item, half })))),
    );
  }, [queue, entries]);

  const current = entries?.[0];
  const total = (entries?.length ?? 0) + stats.correct;

  /** The moment a question is graded: the strike, the cue, the mascot. */
  const onGraded = React.useCallback(
    (ok: boolean) => {
      if (!current) return;
      setGraded(true);
      setPose(ok ? 'correct' : 'wrong');

      if (ok) {
        feedback.correct();
        // A milestone chimes on top of the correct cue rather than replacing it,
        // so a run of five still confirms the answer first.
        if (register(true)) feedback.streak();
      } else {
        const id = current.item.subject.id;
        const tally = strikes.current.get(id) ?? { meaning: 0, reading: 0 };
        tally[current.half] += 1;
        strikes.current.set(id, tally);
        feedback.wrong();
        register(false);
      }

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
    },
    [current, register],
  );

  /**
   * On to the next question: after a right answer by itself, after a wrong one
   * only once the correct answer has been seen and dismissed.
   */
  const onNext = React.useCallback(
    (ok: boolean) => {
      if (!current) return;
      setGraded(false);
      setTurn((n) => n + 1);
      // The only thing that ends the reaction — under `holdReaction` the
      // mascot cycles until the next card replaces it.
      setPose('idle');

      setEntries((rest) => {
        if (!rest) return rest;
        const [, ...remaining] = rest;

        if (ok) {
          // Both halves clear only when this was the last card for the item.
          const itemDone = !remaining.some((e) => e.item.subject.id === current.item.subject.id);
          if (itemDone) {
            // Both halves' strikes, from the per-subject tally — not the card
            // that happens to be finishing. WaniKani derives the SRS stage from
            // these two counts, so reporting only the last half answered moves
            // the item to the wrong stage: miss the meaning twice, get the
            // reading right last, and the meaning misses vanish.
            const tally = strikes.current.get(current.item.subject.id);
            void submitAnswer({
              assignmentId: current.item.assignment.id,
              subjectId: current.item.subject.id,
              incorrectMeaningAnswers: tally?.meaning ?? 0,
              incorrectReadingAnswers: tally?.reading ?? 0,
              answeredAt: new Date().toISOString(),
            });
          }
          return remaining;
        }

        // Missed: back of the queue. The strike is already recorded against
        // the subject, which is what the submitted review reports.
        return [...remaining, current];
      });
    },
    [current, submitAnswer],
  );

  /**
   * Hands the session to the summary and leaves.
   *
   * Only items actually reached are reported — wrapping up early should say
   * what was answered, not credit the rest of the queue. `startingStage` comes
   * off the assignment the queue was already carrying, so it is true offline.
   */
  const finish = React.useCallback(() => {
    const asked = (queue ?? []).filter(
      (item) => !entries?.some((e) => e.item.subject.id === item.subject.id),
    );

    const items: SessionItem[] = asked.map(({ subject, assignment }) => {
      const tally = strikes.current.get(subject.id);
      const missedHalves = [
        tally?.meaning ? `meaning ×${tally.meaning}` : null,
        tally?.reading ? `reading ×${tally.reading}` : null,
      ].filter(Boolean);

      return {
        subjectId: subject.id,
        characters: subject.characters ?? '?',
        meaning: subject.meanings.find((m) => m.primary)?.meaning ?? '',
        reading: subject.readings.find((r) => r.primary)?.reading ?? '',
        startingStage: assignment.srsStage,
        correct: missedHalves.length === 0,
        note: missedHalves.join(', '),
      };
    });

    recordSession({
      kind: 'review',
      startedAt: startedAt.current,
      finishedAt: Date.now(),
      items,
    });
    feedback.complete();
    router.replace('/session-summary');
  }, [entries, queue, router]);

  React.useEffect(() => {
    if (entries && entries.length === 0) finish();
  }, [entries, finish]);

  if (!current) return <View style={styles.screen} />;

  const { subject } = current.item;
  const palette = subjectPalette[subject.type];
  const bucket = stageBucket(current.item.assignment.srsStage);
  const stage = srsStages[bucket];
  const done = stats.correct + stats.incorrect;
  const accuracy = done > 0 ? Math.round((stats.correct / done) * 100) : 100;

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
        <WkQuestion
          // Keyed per turn, so a missed item coming straight back round -- the
          // last one left -- is a fresh question rather than the old one.
          key={turn}
          subject={subject}
          half={current.half}
          meta={
            <>
              <Pill
                label={stageName(current.item.assignment.srsStage)}
                color={stage.ink}
                background={stage.tint}
              />
              <Text style={styles.promptMetaText}>level {subject.level}</Text>
            </>
          }
          onGraded={onGraded}
          onNext={onNext}
        />

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
        <Mascot pose={pose} size={64} speed={1} lively holdReaction />
        {/* Only alongside a verdict — an encouragement that outlived the
            answer it was about would be talking to nobody. */}
        {graded && line ? (
          <Text style={styles.coachLine} numberOfLines={1}>
            {line}
          </Text>
        ) : null}
        <Pressable onPress={finish} hitSlop={8}>
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

  promptMetaText: {
    ...typeScale.metaSmall,
    color: 'rgba(255, 255, 255, 0.85)',
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
  coachLine: {
    flex: 1,
    ...typeScale.captionBold,
    color: colors.successInk,
    marginHorizontal: 10,
  },
});
