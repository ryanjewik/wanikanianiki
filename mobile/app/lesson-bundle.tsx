/**
 * Generated lesson — not drawn in the artboards.
 *
 * One pregenerated bundle, one question at a time. The four question types
 * differ only in how the answer is collected: tap a choice, order some tiles,
 * or type. Everything after that — grading, advancing, moving on — is shared.
 *
 * **The bundle is claimed on mount and never refetched.** Asking the server
 * for the next bundle marks it consumed, so a reload would burn a second one
 * and show a lesson nobody asked for. What arrives is what this screen has.
 *
 * The phone shows a verdict immediately from `payload.answer`, and the server
 * regrades the same answer and advances every word the question tested. Where
 * the two disagree the server wins — the same rule the flashcard quiz follows.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Mascot, type Pose } from '@/components/Mascot';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ChunkyButton, Pill, SessionProgressBar } from '@/components/ui';
import { answerQuestion } from '@/data/api';
import type { Question } from '@/data/types';
import { useLessonBundle } from '@/hooks/useStudyData';
import { colors, jp, radius, spacing, type as typeScale } from '@/theme/tokens';

type Verdict = { correct: boolean; expected: string } | null;

/**
 * A reading printed beside the word it belongs to — `相手 (あいて)`.
 *
 * **The leading whitespace is load-bearing.** A textbook also prints
 * `決心（する）` and `[〜が]苦手な`, where the bracketed kana is part of the
 * entry rather than a pronunciation gloss; stripping those would change the
 * word the question is asking about. The generator writes a gloss with a space
 * in front and a qualifier without one, so that is what separates them.
 *
 * Deliberately narrow. Hiding a reading that is genuinely part of the answer
 * would make a question unanswerable, which is worse than leaving one showing.
 */
const READING_GLOSS = /\s+[（(]\s*[ぁ-んァ-ヶー]+\s*[）)]/g;

function hideReadings(text: string): string {
  // Collapses the space the gloss left behind, so 「免許 が必要です」
  // does not read with a gap where the reading used to be.
  return text.replace(READING_GLOSS, '').replace(/\s{2,}/g, ' ');
}

export default function GeneratedLessonScreen() {
  const router = useRouter();
  const { data: bundle, loading } = useLessonBundle();

  const [index, setIndex] = React.useState(0);
  const [typed, setTyped] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<string[]>([]);
  const [verdict, setVerdict] = React.useState<Verdict>(null);
  const [correctCount, setCorrectCount] = React.useState(0);
  const [pose, setPose] = React.useState<Pose>('idle');
  const [showFurigana, setShowFurigana] = React.useState(true);

  const questions = bundle?.questions ?? [];
  const current: Question | undefined = questions[index];

  // Which question an in-flight answer belongs to. A ref, not state: it is
  // read by a callback that must see the value at resolve time, not the one
  // captured when the callback was created.
  const activeId = React.useRef<number | null>(null);
  React.useEffect(() => {
    activeId.current = current?.id ?? null;
  }, [current]);

  // Tiles arrive in answer order, so they are shuffled once per question for
  // display. Shuffling on every render would reorder them under the user's
  // finger mid-tap.
  const shuffled = React.useMemo(() => {
    const tiles = current?.payload.tiles ?? [];
    return [...tiles].sort(() => Math.random() - 0.5);
  }, [current]);

  const submitted = verdict !== null;

  const answerText = React.useCallback((): string => {
    if (!current) return '';
    if (current.type === 'multiple_choice') return picked ?? '';
    if (current.type === 'sentence_construction') return order.join('');
    return typed.trim();
  }, [current, picked, order, typed]);

  const onSubmit = React.useCallback(async () => {
    if (!current || submitted) return;
    const given = answerText();
    if (!given) return;

    // Graded locally first so the screen reacts on the tap; the server's
    // verdict is what the deck records, and it is what replaces this.
    const expected = current.payload.answer;
    const answeredId = current.id;
    setVerdict({ correct: given === expected, expected });
    setPose(given === expected ? 'correct' : 'wrong');

    try {
      const outcome = await answerQuestion(answeredId, given);
      // The local verdict renders instantly, so the user can be two questions
      // on by the time this lands. Writing it unconditionally marked a
      // question answered that nobody had touched.
      if (activeId.current !== answeredId) return;
      setVerdict({ correct: outcome.correct, expected: outcome.expectedAnswer });
      setPose(outcome.correct ? 'correct' : 'wrong');
      if (outcome.correct) setCorrectCount((n) => n + 1);
    } catch {
      // Offline: the local verdict stands for display, but nothing was
      // recorded. Said plainly rather than pretending it counted.
      if (activeId.current !== answeredId) return;
      setVerdict({ correct: given === expected, expected });
    }
  }, [current, submitted, answerText]);

  /** Every piece of question text goes through this, so one toggle covers
   *  the prompt, the choices and the tiles alike. */
  const render = React.useCallback(
    (text: string) => (showFurigana ? text : hideReadings(text)),
    [showFurigana],
  );

  /**
   * Leave mid-lesson.
   *
   * The bundle is already spent — claiming it is what consumed it — so there
   * is nothing to hand back, and answers given so far are already recorded.
   * Going back is therefore just navigation, not an abandon that loses work.
   */
  const leave = React.useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/study');
  }, [router]);

  /** Stable so the mascot's animation effect is not retriggered by a new
   *  arrow identity on every render. */
  const onReactionEnd = React.useCallback(() => setPose('idle'), []);

  const onNext = React.useCallback(() => {
    if (index + 1 >= questions.length) {
      router.replace('/(tabs)/study');
      return;
    }
    setIndex((i) => i + 1);
    setTyped('');
    setPicked(null);
    setOrder([]);
    setVerdict(null);
    setPose('idle');
  }, [index, questions.length, router]);

  if (loading) return <View style={styles.screen} />;

  if (!bundle || questions.length === 0) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Practice questions" showBack />
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing generated yet</Text>
          <Text style={styles.emptyBody}>
            These are written ahead of time, twice a day, from the words you
            are studying — not the same thing as WaniKani lessons, which are
            always available from the study tab. Check back after your next few
            reviews.
          </Text>
          <ChunkyButton label="Back" tone="neutral" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  if (!current) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Practice questions"
        showBack
        onBack={leave}
        trailingText={`${index + 1} / ${questions.length}`}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <SessionProgressBar
          total={questions.length}
          correct={correctCount}
          incorrect={index - correctCount}
        />

        <Card variant="bordered">
          <View style={styles.promptHead}>
            <Pill
              label={LABELS[current.type]}
              color={colors.inkMuted}
              background={colors.ground}
            />
            <Pressable
              onPress={() => setShowFurigana((on) => !on)}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityState={{ checked: showFurigana }}
              accessibilityLabel="Show readings"
            >
              <Text style={styles.furiganaToggle}>
                {showFurigana ? 'ふりがな ON' : 'ふりがな OFF'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.promptRow}>
            <Text style={styles.prompt}>{render(current.payload.prompt)}</Text>
            <Mascot
              pose={pose}
              size={52}
              speed={0.7}
              onReactionEnd={onReactionEnd}
            />
          </View>
        </Card>

        {current.type === 'multiple_choice' ? (
          <View style={styles.choices}>
            {(current.payload.choices ?? []).map((choice) => (
              <Choice
                key={choice}
                label={render(choice)}
                selected={picked === choice}
                revealed={submitted}
                isAnswer={choice === verdict?.expected}
                onPress={() => !submitted && setPicked(choice)}
              />
            ))}
          </View>
        ) : null}

        {current.type === 'sentence_construction' ? (
          <Card variant="bordered">
            <Text style={styles.builtLine}>{order.join('') || '—'}</Text>
            <View style={styles.tiles}>
              {shuffled.map((tile, i) => {
                const used = order.includes(tile);
                return (
                  <Pressable
                    key={`${tile}-${i}`}
                    disabled={submitted || used}
                    onPress={() => setOrder((rest) => [...rest, tile])}
                    style={[styles.tile, used && styles.tileUsed]}
                  >
                    <Text style={styles.tileText}>{render(tile)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {order.length > 0 && !submitted ? (
              <Pressable onPress={() => setOrder([])} hitSlop={8}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            ) : null}
          </Card>
        ) : null}

        {current.type === 'fill_in_blank' || current.type === 'recall' ? (
          <TextInput
            value={typed}
            onChangeText={setTyped}
            editable={!submitted}
            placeholder="Your answer"
            placeholderTextColor={colors.inkFaint}
            style={styles.input}
            autoCorrect={false}
            autoCapitalize="none"
            onSubmitEditing={onSubmit}
          />
        ) : null}

        {submitted ? (
          <Card variant="bordered" style={verdict.correct ? styles.right : styles.wrong}>
            <Text style={styles.verdictTitle}>
              {verdict.correct ? 'Correct' : 'Not quite'}
            </Text>
            {!verdict.correct ? (
              <Text style={styles.verdictBody}>Answer: {verdict.expected}</Text>
            ) : null}
          </Card>
        ) : null}

        <ChunkyButton
          label={submitted ? (index + 1 >= questions.length ? 'Finish' : 'Next') : 'Check'}
          tone={submitted ? 'neutral' : 'kanji'}
          onPress={submitted ? onNext : onSubmit}
        />
      </ScrollView>
    </View>
  );
}

const LABELS: Record<Question['type'], string> = {
  multiple_choice: 'Choose one',
  fill_in_blank: 'Fill the blank',
  sentence_construction: 'Build the sentence',
  recall: 'Recall',
};

function Choice({
  label,
  selected,
  revealed,
  isAnswer,
  onPress,
}: {
  label: string;
  selected: boolean;
  revealed: boolean;
  isAnswer: boolean;
  onPress: () => void;
}) {
  // After submitting, the right answer is always marked — including when the
  // user missed it. Showing only what they picked teaches nothing.
  const tone = revealed && isAnswer ? styles.choiceRight : selected ? styles.choicePicked : null;

  return (
    <Pressable onPress={onPress} disabled={revealed} style={[styles.choice, tone]}>
      <Text style={styles.choiceText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 12,
    paddingBottom: 24,
    gap: spacing.stack,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyTitle: { ...typeScale.section, color: colors.ink },
  emptyBody: { ...typeScale.caption, color: colors.inkSoft, textAlign: 'center' },

  promptHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  furiganaToggle: {
    ...typeScale.metaSmall,
    color: colors.vocabularyInk,
    letterSpacing: 0.3,
  },
  promptRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  prompt: { ...jp.answer, color: colors.ink, flex: 1 },

  choices: { gap: 8 },
  choice: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  choicePicked: { borderColor: colors.kanji, backgroundColor: colors.kanjiTint },
  choiceRight: { borderColor: colors.success, backgroundColor: colors.successTint },
  choiceText: { ...typeScale.body, color: colors.ink },

  builtLine: { ...jp.answer, color: colors.ink, minHeight: 32, marginBottom: 10 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    backgroundColor: colors.ground,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.outline,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tileUsed: { opacity: 0.35 },
  tileText: { ...jp.row, color: colors.ink },
  clear: { ...typeScale.metaSmall, color: colors.inkSoft, marginTop: 10 },

  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: colors.outline,
    paddingVertical: 14,
    paddingHorizontal: 16,
    ...typeScale.body,
    color: colors.ink,
  },

  right: { backgroundColor: colors.successTint, borderColor: colors.success },
  wrong: { backgroundColor: colors.warningTint, borderColor: colors.warningBorder },
  verdictTitle: { ...typeScale.section, color: colors.ink },
  verdictBody: { ...typeScale.caption, color: colors.inkMuted, marginTop: 4 },
});
