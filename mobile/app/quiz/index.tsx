/**
 * Quiz — imported vocabulary.
 *
 * The counterpart to `app/review/index.tsx`, and deliberately not a variant of
 * it. WaniKani owns its own scheduler, so a review reports raw incorrect counts
 * and lets the server decide the stage. This deck is scheduled by us, on SM-2,
 * and each card is already one skill — recognition or production — so a card
 * here is one question rather than an item with two halves.
 *
 * Grading happens twice on purpose. The card ships every accepted answer, so
 * the screen can show a verdict on the keystroke; the server regrades what you
 * typed, and its verdict is what the deck records. `data/grading.ts` is a port
 * of the server's grader kept in step so the two never disagree in front of
 * you.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { FuriganaText } from '@/components/Furigana';
import { AllCaughtUpArt, CheckMark, CorrectMark, IncorrectMark, OfflineArt } from '@/components/icons';
import { finishKana, LanguageInput } from '@/components/LanguageInput';
import { Mascot, type Pose } from '@/components/Mascot';
import { useAnswerRun } from '@/components/MascotCoach';
import { Pop, useShake } from '@/components/motion';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  ChunkyButton,
  EmptyState,
  InlineButton,
  Pill,
  SectionHeading,
  SessionProgressBar,
  StatTile,
} from '@/components/ui';
import { matches } from '@/data/grading';
import type { Flashcard } from '@/data/types';
import { feedback } from '@/feedback';
import { useDueFlashcards, useStudyActions } from '@/hooks/useStudyData';
import {
  colors,
  controlBorder,
  jp,
  radius,
  shadows,
  spacing,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

type Verdict = 'correct' | 'incorrect';

interface QueueEntry {
  card: Flashcard;
  /**
   * Whether this card's graded attempt has already gone up. A missed card
   * comes back before the session ends, but SM-2 has already taken the lapse —
   * resubmitting would charge the same mistake twice.
   */
  submitted: boolean;
}

const palette = subjectPalette.vocabulary;

/**
 * Furigana rides on the kanji until a card has been answered right this many
 * times in a row. A brand-new word is being learned, not recalled, and making
 * the reading a second puzzle only slows that down; once it has held twice the
 * kanji stands alone. SM-2's `repetitions` is exactly that run — it resets on a
 * miss, so a lapse brings the reading back.
 */
const FURIGANA_UNTIL_REPETITIONS = 2;

export default function QuizScreen() {
  const router = useRouter();
  const { data: due, loading, error } = useDueFlashcards();
  const { answerFlashcard } = useStudyActions();

  const [entries, setEntries] = React.useState<QueueEntry[] | null>(null);
  const [answer, setAnswer] = React.useState('');
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);
  const [pose, setPose] = React.useState<Pose>('idle');
  const [stats, setStats] = React.useState({ correct: 0, incorrect: 0, missed: [] as Flashcard[] });
  const { line, register } = useAnswerRun();
  const { style: shakeStyle, shake } = useShake();

  React.useEffect(() => {
    if (!due || entries) return;
    setEntries(due.map((card) => ({ card, submitted: false })));
  }, [due, entries]);

  const current = entries?.[0];
  const answered = stats.correct + stats.incorrect;
  const total = (entries?.length ?? 0) + stats.correct;

  /**
   * Grades the current card. `gaveUp` is the "I don't know" path: recorded as
   * a miss exactly like a wrong answer — the server grades an empty answer as
   * wrong, so the schedule treats it the same — but it reveals rather than
   * scolds. Nothing was typed wrong; there is no mistake to buzz at.
   */
  const grade = React.useCallback(
    (gaveUp: boolean) => {
      if (!current || verdict) return;

      // A production card accepts the reading as well as the written form, so
      // romaji converted to kana is a real answer, not a near miss.
      const production = current.card.skillType === 'production';
      const typed = gaveUp ? '' : production ? finishKana(answer) : answer;
      if (!gaveUp && !typed.trim()) return;
      if (typed !== answer) setAnswer(typed);
      const ok = !gaveUp && matches(typed, current.card.acceptedAnswers);

      setVerdict(ok ? 'correct' : 'incorrect');
      setPose(ok ? 'correct' : 'wrong');

      if (ok) {
        feedback.correct();
        // A milestone chimes on top of the correct cue rather than replacing it,
        // so a run of five still confirms the answer first.
        if (register(true)) feedback.streak();
      } else if (gaveUp) {
        feedback.reveal();
        register(false);
      } else {
        feedback.wrong();
        shake();
        register(false);
      }

      // Only the first attempt at a card is the graded one.
      if (!current.submitted) {
        void answerFlashcard(current.card.srsStateId, typed);
        setStats((prev) =>
          ok
            ? { ...prev, correct: prev.correct + 1 }
            : { ...prev, incorrect: prev.incorrect + 1, missed: [...prev.missed, current.card] },
        );
      }

      // A miss holds longer than a hit: the answer is on screen, and that reveal
      // is the only teaching moment the card gets.
      setTimeout(
        () => {
          setVerdict(null);
          setAnswer('');
          setPose('idle');
          setEntries((rest) => {
            if (!rest) return rest;
            const [, ...remaining] = rest;
            if (remaining.length > 0 || !ok) feedback.advance();
            return ok ? remaining : [...remaining, { ...rest[0], submitted: true }];
          });
        },
        // Giving up holds longest: that reveal is the whole lesson for this card.
        ok ? 600 : gaveUp ? 2200 : 1600,
      );
    },
    [answer, answerFlashcard, current, register, shake, verdict],
  );

  const onSubmit = React.useCallback(() => grade(false), [grade]);
  const onGiveUp = React.useCallback(() => grade(true), [grade]);

  if (loading) return <View style={styles.screen} />;

  // No backend, or no connection: the deck has no local mirror to fall back on.
  if (error || (!due && !entries)) {
    return (
      <Shell onBack={() => router.back()}>
        <Card variant="bordered">
          <EmptyState
            art={<OfflineArt />}
            title="Can't reach your deck"
            body="Imported words are stored on the server and this session couldn't load them. Your WaniKani reviews still work offline."
          />
        </Card>
      </Shell>
    );
  }

  if (entries && entries.length === 0) {
    // Deliberately not `/session-summary`: that screen is still fixture-backed
    // and would report invented WaniKani stage movements after a real session
    // on this deck.
    return (
      <Shell onBack={() => router.back()}>
        <Card variant="bordered">
          <EmptyState
            art={<AllCaughtUpArt />}
            title={answered > 0 ? 'Deck cleared' : 'Nothing due'}
            body={
              answered > 0
                ? `${stats.correct} of ${answered} right. The ones you missed come back sooner.`
                : 'No imported words are due right now. Import a page to add some.'
            }
          />
        </Card>
        {answered > 0 ? (
          <View style={styles.statRow}>
            <StatTile value={stats.correct} label="correct" tone="success" />
            <StatTile value={stats.incorrect} label="missed" tone="danger" />
            <StatTile
              value={`${Math.round((stats.correct / Math.max(1, answered)) * 100)}%`}
              label="accuracy"
              tone="neutral"
            />
          </View>
        ) : null}
        <ChunkyButton label="Back to Study" tone="vocabulary" onPress={() => router.back()} />
      </Shell>
    );
  }

  if (!current) return <View style={styles.screen} />;

  const { card } = current;
  const production = card.skillType === 'production';
  const accuracy = answered > 0 ? Math.round((stats.correct / answered) * 100) : 100;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        // Says what it is, not just which way round it is. "Produce" alone
        // never told you this was a flashcard deck on its own schedule; the
        // direction is already spelled out on the prompt card below.
        title={production ? 'Flashcards · Produce' : 'Flashcards · Recognise'}
        glyph={palette.glyph}
        glyphColor={palette.solid}
        trailingText={`${stats.correct} / ${total}`}
      >
        <SessionProgressBar correct={stats.correct} incorrect={stats.incorrect} total={total} />
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.promptCard}>
          <Text style={styles.promptLabel}>
            {production ? 'Write it in Japanese' : "What's the meaning?"}
          </Text>
          {production ? (
            <Text style={styles.promptEnglish}>{card.prompt}</Text>
          ) : (
            <FuriganaText
              text={card.prompt}
              furigana={{ [card.prompt]: card.furiganaOnly }}
              show={
                card.repetitions < FURIGANA_UNTIL_REPETITIONS &&
                Boolean(card.furiganaOnly) &&
                card.furiganaOnly !== card.prompt
              }
              style={styles.promptGlyph}
              readingSize={18}
            />
          )}
          <View style={styles.promptMeta}>
            <Pill
              label={current.submitted ? 'retry' : card.repetitions === 0 ? 'new' : `${card.intervalDays}d`}
              color={palette.ink}
              background={palette.tint}
            />
            {card.lapses > 0 ? (
              <Text style={styles.promptMetaText}>
                missed {card.lapses}×
              </Text>
            ) : null}
          </View>
        </Card>

        {/* The reveal. A wrong answer with nothing shown teaches nothing, so
            the accepted forms and the sentence the word was printed in both
            come up before the next card. */}
        {verdict ? (
          <Pop>
            <Card
              variant="bordered"
              style={verdict === 'correct' ? styles.revealOk : styles.revealBad}
            >
              <Text style={styles.revealLabel}>
                {verdict === 'correct' ? 'Correct' : 'Answer'}
              </Text>
              <Text style={styles.revealAnswer}>
                {production ? card.kanjiFurigana : card.english}
              </Text>
              {production && card.furiganaOnly && card.furiganaOnly !== card.kanjiFurigana ? (
                <Text style={styles.revealReading}>{card.furiganaOnly}</Text>
              ) : null}
              {card.usageContext ? (
                <Text style={styles.revealContext}>{card.usageContext}</Text>
              ) : null}
            </Card>
          </Pop>
        ) : null}

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
              style={[styles.answerInput, production && jp.answer]}
              placeholder={production ? '日本語' : 'meaning'}
              placeholderTextColor={colors.inkDisabled}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              language={production ? 'ja' : 'en'}
              kana={production}
            />
          </View>

          <Pressable onPress={onSubmit} disabled={Boolean(verdict)}>
            <View
              style={[
                styles.submitButton,
                controlBorder,
                shadows.hard,
                { backgroundColor: verdict === 'incorrect' ? colors.danger : colors.success },
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

        <View style={styles.hintRow}>
          <Text style={styles.inputHint}>
            {production ? 'Kanji or kana — either form counts' : 'Type the English meaning'}
          </Text>
          {verdict ? null : <InlineButton label="I don't know" emphasis="quiet" onPress={onGiveUp} />}
        </View>

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
                <View key={missed.srsStateId} style={styles.missedChip}>
                  <Text style={styles.missedChipText}>{missed.kanjiFurigana}</Text>
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
        <Pressable
          onPress={() => {
            feedback.complete();
            setEntries([]);
          }}
          hitSlop={8}
        >
          <Text style={styles.wrapUp}>Wrap up ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Quiz" glyph={palette.glyph} glyphColor={palette.solid} />
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
      <View style={styles.footer}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.wrapUp}>‹ Back</Text>
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
    paddingTop: 12,
    paddingBottom: 20,
    gap: spacing.stack,
  },

  promptCard: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  promptLabel: {
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  promptGlyph: {
    ...jp.hero,
    fontSize: 72,
    lineHeight: 84,
    color: colors.ink,
    textAlign: 'center',
  },
  promptEnglish: {
    ...typeScale.section,
    fontSize: 30,
    lineHeight: 38,
    color: colors.ink,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  promptMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  promptMetaText: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
  },

  revealOk: {
    backgroundColor: colors.successTint,
    borderColor: colors.success,
    gap: 4,
  },
  revealBad: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    gap: 4,
  },
  revealLabel: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
  },
  revealAnswer: {
    ...typeScale.cardTitle,
    color: colors.ink,
  },
  revealReading: {
    ...typeScale.caption,
    color: colors.inkMuted,
  },
  revealContext: {
    ...typeScale.caption,
    color: colors.inkSoft,
    lineHeight: 18,
    marginTop: 4,
  },

  answerRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
  },
  answerField: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.tile,
    justifyContent: 'center',
    paddingHorizontal: 14,
    minHeight: 54,
  },
  answerInput: {
    ...typeScale.cardTitle,
    color: colors.ink,
    padding: 0,
  },
  submitButton: {
    width: 54,
    minHeight: 54,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  inputHint: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
    flexShrink: 1,
  },

  sessionCard: {
    gap: 12,
  },
  statRow: {
    flexDirection: 'row',
    gap: 8,
  },
  missedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  missedChip: {
    backgroundColor: colors.dangerTint,
    borderRadius: radius.tile,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  missedChipText: {
    ...typeScale.caption,
    color: colors.dangerInk,
  },
  missedNote: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 10,
  },
  wrapUp: {
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  coachLine: {
    flex: 1,
    ...typeScale.captionBold,
    color: colors.vocabularyInk,
    marginHorizontal: 10,
  },
});
