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
import Animated from 'react-native-reanimated';
import { toKana } from 'wanakana';

import { CheckMark, CorrectMark, IncorrectMark } from '@/components/icons';
import { finishKana, LanguageInput } from '@/components/LanguageInput';
import { Mascot, type Pose } from '@/components/Mascot';
import { useAnswerRun } from '@/components/MascotCoach';
import { useShake } from '@/components/motion';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  Pill,
  SectionHeading,
  SessionProgressBar,
  StatTile,
} from '@/components/ui';
import { recordSession, type SessionItem } from '@/data/session';
import { feedback } from '@/feedback';
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
}

/**
 * Which reading a kanji's reading question is after. WaniKani teaches one
 * reading type per kanji and marks only that type accepted, so the prompt can
 * say which -- the same thing WaniKani's own review header tells you.
 * Vocabulary has just "the reading", and radicals none at all.
 */
function wantedReadingType(subject: StudyItem['subject']): 'onyomi' | 'kunyomi' | null {
  if (subject.type !== 'kanji') return null;
  const accepted = subject.readings.find((r) => r.acceptedAnswer && r.primary) ??
    subject.readings.find((r) => r.acceptedAnswer);
  return accepted?.type === 'onyomi' || accepted?.type === 'kunyomi' ? accepted.type : null;
}

/**
 * An answer that is right for a different question, worth a second try
 * rather than a strike -- WaniKani shakes the card on exactly these:
 *
 * - a kanji's other reading type: 山 wants さん, and やま is a real reading of
 *   it, just not the one being tested;
 * - the reading typed into the meaning field ("yama" for "mountain").
 *
 * Returns what to tell the learner, or null for an ordinary answer.
 */
function nearMiss(entry: QueueEntry, typed: string): string | null {
  const answer = typed.trim();
  if (!answer) return null;
  const { readings } = entry.item.subject;

  if (entry.half === 'reading') {
    const other = readings.find((r) => !r.acceptedAnswer && r.reading === answer);
    if (!other) return null;
    const wanted = wantedReadingType(entry.item.subject);
    if (wanted === 'onyomi') return "That's the kun'yomi. This one wants the on'yomi reading.";
    if (wanted === 'kunyomi') return "That's the on'yomi. This one wants the kun'yomi reading.";
    return "That's a reading, just not the one being asked for. Try again.";
  }

  const asKana = toKana(answer.toLowerCase());
  if (readings.some((r) => r.reading === asKana || r.reading === answer)) {
    return "That's the reading — this one wants the meaning.";
  }
  return null;
}

export default function ReviewScreen() {
  const router = useRouter();
  const { data: queue } = useReviewQueue();
  const { submitAnswer } = useStudyActions();

  const [entries, setEntries] = React.useState<QueueEntry[] | null>(null);
  const [answer, setAnswer] = React.useState('');
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);
  const [pose, setPose] = React.useState<Pose>('idle');
  /**
   * A nudge rather than a verdict: the answer was a real answer to a different
   * question. See `nearMiss`.
   */
  const [nudge, setNudge] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState({ correct: 0, incorrect: 0, missed: [] as StudyItem[] });
  const { line, register } = useAnswerRun();
  const { style: shakeStyle, shake } = useShake();

  // Kept in refs, not state: the summary reads them once on the way out, and
  // re-rendering the card on every strike would be churn for nothing.
  const startedAt = React.useRef(Date.now());
  const strikes = React.useRef(new Map<number, { meaning: number; reading: number }>());

  // Radicals have no reading to ask for, so they contribute one card, not two.
  React.useEffect(() => {
    if (!queue || entries) return;
    setEntries(
      queue.flatMap((item) => {
        const halves: Half[] = item.subject.readings.length > 0 ? ['meaning', 'reading'] : ['meaning'];
        return halves.map((half) => ({ item, half }));
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

    const typed = current.half === 'reading' ? finishKana(answer) : answer;
    // Shown back as graded, so a trailing n reads as the ん it was scored as.
    if (typed !== answer) setAnswer(typed);

    const ok = grade(current, typed);

    // Right answer, wrong question: shake and ask again, as WaniKani does,
    // instead of charging a strike for something the learner actually knew.
    // Only after grading -- 酒's meaning "sake" sounds exactly like its
    // reading さけ, and a correct answer must never be turned back.
    if (!ok) {
      const redirect = nearMiss(current, typed);
      if (redirect) {
        setNudge(redirect);
        shake();
        feedback.back();
        return;
      }
    }
    setNudge(null);
    setVerdict(ok ? 'correct' : 'incorrect');
    setPose(ok ? 'correct' : 'wrong');

    if (!ok) {
      const id = current.item.subject.id;
      const tally = strikes.current.get(id) ?? { meaning: 0, reading: 0 };
      tally[current.half] += 1;
      strikes.current.set(id, tally);
    }

    if (ok) {
      feedback.correct();
      // A milestone chimes on top of the correct cue rather than replacing it,
      // so a run of five still confirms the answer first.
      if (register(true)) feedback.streak();
    } else {
      feedback.wrong();
      shake();
      register(false);
    }

    // The feedback mark holds for ~600ms, then the next item comes in.
    setTimeout(() => {
      setVerdict(null);
      setAnswer('');
      setNudge(null);
      // The only thing that ends the reaction now — under `holdReaction` the
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
  }, [answer, current, entries, grade, register, shake, submitAnswer, verdict]);

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

  const wanted = wantedReadingType(subject);
  const promptLabel =
    current.half === 'meaning'
      ? "What's the meaning?"
      : wanted === 'onyomi'
        ? "What's the on'yomi reading?"
        : wanted === 'kunyomi'
          ? "What's the kun'yomi reading?"
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

        <Animated.View style={[styles.answerRow, shakeStyle]}>
          <View
            style={[
              styles.answerField,
              controlBorder,
              shadows.hard,
              verdict === 'correct' && { borderColor: colors.success },
              verdict === 'incorrect' && { borderColor: colors.danger },
            ]}
          >
            <LanguageInput
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
              // Readings are always kana, so romaji typed on any keyboard counts.
              language={current.half === 'reading' ? 'ja' : 'en'}
              kana={current.half === 'reading'}
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
        </Animated.View>

        <Text style={[styles.inputHint, nudge ? styles.nudge : null]}>
          {nudge ??
            (current.half === 'reading'
              ? 'Kana input · romaji converts as you type'
              : 'Type the English meaning')}
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
        <Mascot pose={pose} size={64} speed={1} lively holdReaction />
        {/* Only alongside a verdict — an encouragement that outlived the
            answer it was about would be talking to nobody. */}
        {verdict && line ? (
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
  nudge: {
    ...typeScale.captionBold,
    color: colors.warningInk,
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
  coachLine: {
    flex: 1,
    ...typeScale.captionBold,
    color: colors.successInk,
    marginHorizontal: 10,
  },
});
