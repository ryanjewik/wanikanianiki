/**
 * Generated lesson — not drawn in the artboards.
 *
 * One pregenerated bundle, one question at a time. The question types differ
 * only in how the answer is collected: tap a choice (a meaning, or a reply to
 * something said), order some tiles, or type. Everything after that — grading, advancing, moving on — is shared.
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
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Mascot, type Pose } from '@/components/Mascot';
import {
  MascotAside,
  MascotCoach,
  summaryLine,
  summaryPose,
  useAnswerRun,
} from '@/components/MascotCoach';
import { FuriganaText, extractReadings } from '@/components/Furigana';
import { finishKana, LanguageInput, languageOf } from '@/components/LanguageInput';
import { Pop, PressBounce, RiseIn, useShake } from '@/components/motion';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  Card,
  ChunkyButton,
  Pill,
  SectionHeading,
  SessionProgressBar,
  StatTile,
  TextButton,
} from '@/components/ui';
import { KeyboardAwareScroll } from '@/components/KeyboardAwareScroll';
import { shuffle } from '@/components/WkQuestion';
import { answerQuestion } from '@/data/api';
import { logAnswer, newSessionId, useAnswerTimer } from '@/data/answerLog';
import { markStudiedToday } from '@/notifications/reminders';
import { CHOICE_TYPES, QUESTION_TYPE_LABELS, type Question } from '@/data/types';
import { feedback } from '@/feedback';
import { useLessonBundle } from '@/hooks/useStudyData';
import { colors, jp, radius, spacing, type as typeScale } from '@/theme/tokens';

type Verdict = { correct: boolean; expected: string } | null;

/**
 * The three things this screen does, in order. Phases rather than routes
 * because the bundle is claimed on mount and cannot be refetched — navigating
 * to a summary screen and back would lose the questions it is summarising.
 */
type Phase = 'asking' | 'summary' | 'correcting';

/** What one answered question ended up being, for the summary and corrections. */
interface Result {
  questionId: number;
  /** What the user typed or picked, for showing back what went wrong. */
  given: string;
  correct: boolean;
  expected: string;
  /** SRS rows the server moved. Zero offline, and zero for practice-only words. */
  advanced: number;
  practiceOnly: number;
  /**
   * Whether the graded answer actually reached the server. False offline, where
   * the verdict still shows but nothing was written — the summary says so
   * rather than reporting an unrecorded session as progress.
   */
  recorded: boolean;
}

export default function GeneratedLessonScreen() {
  const router = useRouter();
  const { data: bundle, loading } = useLessonBundle();

  const [phase, setPhase] = React.useState<Phase>('asking');
  const [index, setIndex] = React.useState(0);
  const [typed, setTyped] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<string[]>([]);
  const [verdict, setVerdict] = React.useState<Verdict>(null);
  /** Keyed by question id, because the server's verdict lands asynchronously
   *  and has to find the question it belongs to, not the one on screen. */
  const [results, setResults] = React.useState<Record<number, Result>>({});
  /** Question ids put right during the corrections pass. */
  const [corrected, setCorrected] = React.useState<Record<number, true>>({});
  const [pose, setPose] = React.useState<Pose>('idle');
  const [showFurigana, setShowFurigana] = React.useState(true);
  /**
   * The run of correct answers the coach reacts to. Display state only — not
   * scoring; the server remains the authority on what was actually right.
   */
  const { line, register } = useAnswerRun();
  const { style: shakeStyle, shake } = useShake();
  // For the answer log: one id per sitting, a running position, how often each
  // question has come up (a correction is attempt 2), and the answer as given.
  const sessionId = React.useMemo(newSessionId, []);
  const timer = useAnswerTimer();
  const position = React.useRef(0);
  const askedCount = React.useRef(new Map<number, number>());
  const givenRef = React.useRef<string | null>(null);

  const questions = React.useMemo(() => bundle?.questions ?? [], [bundle]);

  /**
   * The questions the corrections pass re-asks: the ones missed first time
   * round, in the order they were originally asked. Frozen when the pass
   * starts, so putting one right does not renumber the rest underneath.
   */
  const missed = React.useMemo(
    () => questions.filter((q) => results[q.id] && !results[q.id].correct),
    [questions, results],
  );
  const missedAtEntry = React.useRef<Question[]>([]);

  const queue = phase === 'correcting' ? missedAtEntry.current : questions;
  const current: Question | undefined = queue[index];

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
  const shuffled = React.useMemo(() => shuffle(current?.payload.tiles ?? []), [current]);

  // Each new question starts the clock.
  React.useEffect(() => {
    if (current) {
      timer.start();
      givenRef.current = null;
    }
  }, [current, timer]);

  // Choices too: the generator writes the right answer first, so shown as
  // stored the answer was always the top option. Once per question, for the
  // same reason as the tiles.
  const choices = React.useMemo(() => shuffle(current?.payload.choices ?? []), [current]);

  const submitted = verdict !== null;

  const answered = React.useMemo(() => Object.values(results), [results]);
  const askedCorrect = answered.filter((r) => r.correct).length;
  const stillWrong = missed.filter((q) => !corrected[q.id]);

  // The bar reports the pass you are in, not the session as a whole: during
  // corrections, progress means corrections made, and showing the original
  // score there would look like the retries were not counting.
  const answeredCorrect =
    phase === 'correcting' ? Object.keys(corrected).length : askedCorrect;
  const answeredTotal =
    phase === 'correcting' ? index + (submitted ? 1 : 0) : answered.length;

  const answerText = React.useCallback((): string => {
    if (!current) return '';
    if (CHOICE_TYPES.has(current.type)) return picked ?? '';
    if (current.type === 'sentence_construction') return order.join('');
    return languageOf(current.payload.answer) === 'ja' ? finishKana(typed.trim()) : typed.trim();
  }, [current, picked, order, typed]);

  /** Clears whatever the last question left behind. */
  const resetInputs = React.useCallback(() => {
    setTyped('');
    setPicked(null);
    setOrder([]);
    setVerdict(null);
    setPose('idle');
  }, []);

  /**
   * Everything that happens to the screen because of a verdict, in one place:
   * the cue, the shake, and the run the coach reads.
   */
  const react = React.useCallback(
    (ok: boolean) => {
      if (ok) {
        feedback.correct();
        // The milestone chime rides on top of the correct cue rather than
        // replacing it, so a run of five still confirms the answer first.
        if (register(true)) feedback.streak();
      } else {
        feedback.wrong();
        shake();
        register(false);
      }
    },
    [register, shake],
  );

  const onSubmit = React.useCallback(async () => {
    if (!current || submitted) return;
    const given = answerText();
    if (!given) return;

    const expected = current.payload.answer;
    const answeredId = current.id;
    const locallyRight = given === expected;
    timer.answered();
    givenRef.current = given;

    setVerdict({ correct: locallyRight, expected });
    setPose(locallyRight ? 'correct' : 'wrong');
    react(locallyRight);

    /**
     * **A correction is never re-graded.**
     *
     * `POST .../questions/{id}/answer` has no already-answered guard — by
     * design, since a question can legitimately appear in more than one bundle
     * — so posting a correction would advance every word the question tests a
     * second time. Worse, the retry is correct by construction (the answer was
     * on the summary a moment ago), so its good grade would partially undo the
     * lapse the original miss correctly recorded. The deck would end up
     * believing a word was known *because* it was missed.
     *
     * So the corrections pass is local and ungraded: it is there to make you
     * produce the right answer once, which is the part that teaches, and the
     * summary is explicit that it changed no schedules.
     */
    if (phase === 'correcting') {
      if (locallyRight) setCorrected((done) => ({ ...done, [answeredId]: true }));
      return;
    }

    // Graded locally first so the screen reacts on the tap; the server's
    // verdict is what the deck records, and it is what replaces this.
    try {
      const outcome = await answerQuestion(answeredId, given);
      // Practice answers count toward the streak too: no reminder tonight.
      void markStudiedToday();
      setResults((all) => ({
        ...all,
        [answeredId]: {
          questionId: answeredId,
          given,
          correct: outcome.correct,
          expected: outcome.expectedAnswer,
          advanced: outcome.schedulesAdvanced,
          practiceOnly: outcome.practiceOnlyWords,
          recorded: true,
        },
      }));

      // The local verdict renders instantly, so the user can be two questions
      // on by the time this lands. Writing it unconditionally marked a
      // question answered that nobody had touched.
      if (activeId.current !== answeredId) return;
      setVerdict({ correct: outcome.correct, expected: outcome.expectedAnswer });
      // The server overruling the local verdict is rare but real, and the
      // feedback has to follow it — being buzzed "right" and then shown "wrong"
      // is worse than a slightly late cue.
      if (outcome.correct !== locallyRight) {
        setPose(outcome.correct ? 'correct' : 'wrong');
        react(outcome.correct);
      }
    } catch {
      // Offline: the local verdict stands for display, but nothing was
      // recorded. Kept in the results all the same — the summary reports it as
      // unrecorded rather than silently dropping a question that was answered.
      setResults((all) => ({
        ...all,
        [answeredId]: {
          questionId: answeredId,
          given,
          correct: locallyRight,
          expected,
          advanced: 0,
          practiceOnly: 0,
          recorded: false,
        },
      }));
      if (activeId.current !== answeredId) return;
      setVerdict({ correct: locallyRight, expected });
    }
  }, [current, submitted, answerText, phase, react]);

  const furigana = current?.payload.furigana;

  /**
   * Whether this question has any readings to show at all.
   *
   * Questions generated before the furigana field existed carry none, and a
   * toggle that visibly does nothing reads as broken rather than as empty — so
   * it is disabled and labelled instead, which says which of the two it is.
   */
  const hasReadings = React.useMemo(() => {
    if (!current) return false;
    const parts = [
      current.payload.prompt,
      ...(current.payload.choices ?? []),
      ...(current.payload.tiles ?? []),
    ];
    return parts.some((part) => Object.keys(extractReadings(part, furigana).map).length > 0);
  }, [current, furigana]);

  /**
   * Logs the answer on screen, once, on the way to the next one -- after the
   * explanation has been read, so that time is in it. The verdict is the
   * server's when it has arrived.
   */
  const logCurrent = React.useCallback(() => {
    if (!current || !verdict || givenRef.current === null) return;
    const answer = givenRef.current;
    givenRef.current = null;
    const attempt = (askedCount.current.get(current.id) ?? 0) + 1;
    askedCount.current.set(current.id, attempt);
    const isChoice = CHOICE_TYPES.has(current.type);
    logAnswer(
      {
        source: 'practice',
        sessionId,
        position: position.current++,
        attempt,
        questionKind: current.type,
        inputMode: isChoice
          ? 'choice'
          : current.type === 'sentence_construction'
            ? 'tiles'
            : 'typed',
        questionId: current.id,
        subjectId: current.payload.subjectId ?? null,
        prompt: current.payload.prompt,
        answerGiven: answer,
        expected: [current.payload.answer],
        correct: verdict.correct,
        outcome: verdict.correct ? 'correct' : 'incorrect',
        furiganaShown: showFurigana && hasReadings,
        choicesShown: isChoice ? choices : current.type === 'sentence_construction' ? shuffled : null,
        pickedIndex: isChoice && picked !== null ? choices.indexOf(picked) : null,
      },
      timer.finish(),
    );
  }, [choices, current, hasReadings, picked, sessionId, showFurigana, shuffled, timer, verdict]);

  /**
   * Leave mid-lesson.
   *
   * The bundle is already spent — claiming it is what consumed it — so there
   * is nothing to hand back, and answers given so far are already recorded.
   * Going back is therefore just navigation, not an abandon that loses work.
   */
  const leave = React.useCallback(() => {
    // An answer still on screen is logged, not lost.
    logCurrent();
    // Backing out of the corrections pass returns to the summary rather than
    // out of the lesson: the summary is the only place the misses are listed,
    // and it cannot be navigated back to once left — the bundle it describes
    // was consumed on mount.
    if (phase === 'correcting') {
      feedback.tap();
      setPhase('summary');
      resetInputs();
      setIndex(0);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/study');
  }, [logCurrent, phase, resetInputs, router]);

  const onNext = React.useCallback(() => {
    logCurrent();
    if (index + 1 >= queue.length) {
      // Both passes end in the same place. The summary is the only exit: it is
      // where the corrections offer lives, and dropping straight back to the
      // study tab is what made a finished lesson feel like nothing happened.
      feedback.complete();
      setPhase('summary');
      resetInputs();
      return;
    }
    feedback.advance();
    setIndex((i) => i + 1);
    resetInputs();
  }, [index, logCurrent, queue.length, resetInputs]);

  /** Starts the corrections pass over the questions missed first time round. */
  const startCorrections = React.useCallback(() => {
    if (stillWrong.length === 0) return;
    // Frozen here rather than read live, for two reasons: putting one right
    // mid-pass must not shorten the queue under the user's feet, and a second
    // pass has to re-ask only what is *still* wrong — `missed` is every
    // question missed first time round and never shrinks, because corrections
    // deliberately do not rewrite the graded result.
    missedAtEntry.current = stillWrong;
    feedback.advance();
    setPhase('correcting');
    setIndex(0);
    resetInputs();
  }, [stillWrong, resetInputs]);

  const finish = React.useCallback(() => {
    feedback.tap();
    router.replace('/(tabs)/study');
  }, [router]);

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

  if (phase === 'summary') {
    return (
      <PracticeSummary
        total={questions.length}
        results={answered}
        missed={missed}
        stillWrong={stillWrong}
        corrected={corrected}
        showFurigana={showFurigana}
        onCorrect={startCorrections}
        onDone={finish}
      />
    );
  }

  if (!current) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={phase === 'correcting' ? 'Corrections' : 'Practice questions'}
        showBack
        onBack={leave}
        trailingText={`${index + 1} / ${queue.length}`}
      />

      <KeyboardAwareScroll contentContainerStyle={styles.content}>
        <SessionProgressBar
          total={queue.length}
          correct={answeredCorrect}
          incorrect={answeredTotal - answeredCorrect}
        />

        <Card variant="bordered">
          <View style={styles.promptHead}>
            <Pill
              label={QUESTION_TYPE_LABELS[current.type]}
              color={colors.inkMuted}
              background={colors.ground}
            />
            <Pressable
              onPress={() => {
                feedback.toggle();
                setShowFurigana((on) => !on);
              }}
              disabled={!hasReadings}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityState={{ checked: showFurigana && hasReadings, disabled: !hasReadings }}
              accessibilityLabel="Show readings"
            >
              <Text style={[styles.furiganaToggle, !hasReadings && styles.furiganaToggleOff]}>
                {!hasReadings ? 'ふりがな なし' : showFurigana ? 'ふりがな ON' : 'ふりがな OFF'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.promptRow}>
            <View style={styles.promptText}>
              <FuriganaText
                text={current.payload.prompt}
                furigana={furigana}
                show={showFurigana}
                style={styles.prompt}
              />
            </View>
            {/* The reaction holds until Next: this screen waits for a tap, so
                a one-second jump would be over before the answer has been
                read. `resetInputs` returns it to idle on the way out. */}
            <Mascot pose={pose} size={64} speed={0.8} lively holdReaction />
          </View>
        </Card>

        {/* Only while the verdict is up: an encouragement that outlived the
            answer it was about would be talking to nobody. Keyed on the line so
            each one springs in fresh rather than cross-fading its text. */}
        {submitted && line ? (
          <MascotAside key={line} line={line} pose="wave" tone="vocabulary" />
        ) : null}

        {/* Whichever control this question type uses, so a rejected answer
            shakes the thing that was rejected rather than the whole screen. */}
        <Animated.View style={[styles.answerArea, shakeStyle]}>
          {CHOICE_TYPES.has(current.type) ? (
            <View style={styles.choices}>
              {choices.map((choice) => (
                <Choice
                  key={choice}
                  label={choice}
                  furigana={furigana}
                  showFurigana={showFurigana}
                  selected={picked === choice}
                  revealed={submitted}
                  isAnswer={choice === verdict?.expected}
                  big={current.type === 'kanji_lookalike'}
                  onPress={() => {
                    if (submitted) return;
                    timer.responded();
                    setPicked(choice);
                  }}
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
                    <PressBounce
                      key={`${tile}-${i}`}
                      disabled={submitted || used}
                      onPress={() => {
                        feedback.select();
                        timer.responded();
                        setOrder((rest) => [...rest, tile]);
                      }}
                      style={[styles.tile, used && styles.tileUsed]}
                    >
                      <FuriganaText
                        text={tile}
                        furigana={furigana}
                        show={showFurigana}
                        style={styles.tileText}
                      />
                    </PressBounce>
                  );
                })}
              </View>
              {order.length > 0 && !submitted ? (
                <Pressable
                  onPress={() => {
                    feedback.tap();
                    setOrder([]);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.clear}>Clear</Text>
                </Pressable>
              ) : null}
            </Card>
          ) : null}

          {current.type === 'fill_in_blank' || current.type === 'recall' ? (
            <LanguageInput
              value={typed}
              onChangeText={(text) => {
                timer.onText(text);
                setTyped(text);
              }}
              editable={!submitted}
              placeholder="Your answer"
              placeholderTextColor={colors.inkFaint}
              style={styles.input}
              autoCorrect={false}
              autoCapitalize="none"
              onSubmitEditing={onSubmit}
              // Recall can go either way — English prompt, Japanese answer or
              // the reverse — so the answer key decides the keyboard.
              language={languageOf(current.payload.answer)}
              kana={languageOf(current.payload.answer) === 'ja'}
            />
          ) : null}
        </Animated.View>

        {submitted ? (
          <Pop>
            <Card variant="bordered" style={verdict.correct ? styles.right : styles.wrong}>
              <Text style={styles.verdictTitle}>
                {verdict.correct ? 'Correct' : 'Not quite'}
              </Text>
              {!verdict.correct ? (
                <Text style={styles.verdictBody}>Answer: {verdict.expected}</Text>
              ) : null}
            </Card>
            <ExplanationCard question={current} picked={picked} expected={verdict.expected} />
          </Pop>
        ) : null}

        <ChunkyButton
          label={submitted ? (index + 1 >= queue.length ? 'Finish' : 'Next') : 'Check'}
          tone={submitted ? 'neutral' : 'kanji'}
          onPress={submitted ? onNext : onSubmit}
        />
      </KeyboardAwareScroll>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How the practice run went, and the offer to put the misses right.
 *
 * Deliberately **not** `/session-summary`. That screen reports WaniKani stage
 * movements — Seed → Sprout and the rest — which a generated lesson does not
 * produce: it moves our own SM-2 rows, and for a WaniKani-sourced word it moves
 * nothing at all. Reusing it would mean inventing stage changes that never
 * happened, which is the same reason the flashcard quiz does not use it either.
 */
function PracticeSummary({
  total,
  results,
  missed,
  stillWrong,
  corrected,
  showFurigana,
  onCorrect,
  onDone,
}: {
  total: number;
  results: Result[];
  missed: Question[];
  stillWrong: Question[];
  corrected: Record<number, true>;
  showFurigana: boolean;
  onCorrect: () => void;
  onDone: () => void;
}) {
  const right = results.filter((r) => r.correct).length;
  const percentage = results.length > 0 ? Math.round((right / results.length) * 100) : 0;
  const advanced = results.reduce((sum, r) => sum + r.advanced, 0);
  const practiceOnly = results.reduce((sum, r) => sum + r.practiceOnly, 0);
  const unrecorded = results.filter((r) => !r.recorded).length;
  const fixed = missed.length - stillWrong.length;

  // `correct` is a one-shot pose: left alone it freezes on the last frame of
  // the jump, so it settles back to the idle loop once it has played.
  const [pose, setPose] = React.useState<Pose>(summaryPose(percentage));
  const settle = React.useCallback(() => setPose('idle'), []);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={missed.length > 0 && stillWrong.length === 0 ? 'All corrected' : 'Practice complete'}
        trailingText={`${results.length} of ${total}`}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <RiseIn>
          <Card variant="bordered">
            <MascotCoach
              pose={pose}
              onReactionEnd={settle}
              tone={percentage >= 70 ? 'vocabulary' : 'neutral'}
              size={84}
              speed={0.8}
              line={summaryLine(percentage, results.length)}
            />
          </Card>
        </RiseIn>

        <RiseIn delay={70}>
          <Card variant="bordered" style={styles.summaryStats}>
            <View style={styles.statRow}>
              <StatTile value={`${percentage}%`} label="correct" tone="success" />
              <StatTile value={missed.length} label="missed" tone="danger" />
              <StatTile value={advanced} label="schedules moved" tone="radical" />
            </View>

            {/* The honest footnotes. A generated lesson that moved nothing
                should say so rather than let a big green percentage imply
                progress that did not happen. */}
            {practiceOnly > 0 ? (
              <Text style={styles.summaryNote}>
                {practiceOnly} {practiceOnly === 1 ? 'word was' : 'words were'} WaniKani&apos;s —
                asking about {practiceOnly === 1 ? 'it' : 'them'} is practice, and moves nothing
                here. WaniKani&apos;s own reviews decide when {practiceOnly === 1 ? 'it comes' : 'they come'} back.
              </Text>
            ) : null}
            {unrecorded > 0 ? (
              <Text style={styles.summaryWarning}>
                {unrecorded} {unrecorded === 1 ? 'answer' : 'answers'} never reached the server, so
                nothing was recorded for {unrecorded === 1 ? 'it' : 'them'}. Generated questions are
                graded server-side and are not queued offline.
              </Text>
            ) : null}
          </Card>
        </RiseIn>

        {missed.length > 0 ? (
          <RiseIn delay={140}>
            <Card variant="bordered">
              <SectionHeading
                title="Worth another look"
                trailing={fixed > 0 ? `${fixed} of ${missed.length} corrected` : undefined}
                trailingColor={colors.successInk}
              />
              <View>
                {missed.map((question, i) => {
                  const result = results.find((r) => r.questionId === question.id);
                  return (
                    <View
                      key={question.id}
                      style={[styles.missRow, i < missed.length - 1 && styles.missDivider]}
                    >
                      <View style={styles.missHead}>
                        <Pill
                          label={QUESTION_TYPE_LABELS[question.type]}
                          color={colors.inkMuted}
                          background={colors.ground}
                        />
                        {corrected[question.id] ? (
                          <Text style={styles.missFixed}>corrected</Text>
                        ) : null}
                      </View>
                      <FuriganaText
                        text={question.payload.prompt}
                        furigana={question.payload.furigana}
                        show={showFurigana}
                        style={styles.missPrompt}
                      />
                      {/* What was typed and what was right are both answers,
                          and an answer never wants its own reading printed
                          over it — that is the thing being learned. */}
                      {result?.given ? (
                        <Text style={styles.missGiven}>You put: {result.given}</Text>
                      ) : null}
                      <Text style={styles.missAnswer}>
                        Answer: {result?.expected ?? question.payload.answer}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Card>
          </RiseIn>
        ) : null}
      </ScrollView>

      <View style={styles.summaryFooter}>
        {stillWrong.length > 0 ? (
          <>
            <ChunkyButton
              label={`Correct the ${stillWrong.length} you missed`}
              tone="vocabulary"
              cue="advance"
              onPress={onCorrect}
            />
            {/* Said up front, because a second pass that silently changed the
                schedule again would be the worse surprise. */}
            <Text style={styles.summaryFootnote}>
              Typing these again is practice only — it records nothing and moves no schedules.
            </Text>
            <TextButton label="Skip for now" onPress={onDone} />
          </>
        ) : (
          <ChunkyButton label="Done" tone="neutral" onPress={onDone} />
        )}
      </View>
    </View>
  );
}

/**
 * After answering: the question in English, and each option with its meaning
 * and why it is right or wrong. The answer and a wrong pick are marked, so the
 * mistake and its correction read side by side.
 */
function ExplanationCard({
  question,
  picked,
  expected,
}: {
  question: Question;
  picked: string | null;
  expected: string;
}) {
  const { translation, explanations } = question.payload;
  if (!translation && !explanations?.length) return null;

  return (
    <Card variant="bordered" style={styles.explainCard}>
      {translation ? (
        <View style={styles.explainBlock}>
          <Text style={styles.explainLabel}>In English</Text>
          <Text style={styles.explainTranslation}>{translation}</Text>
        </View>
      ) : null}
      {(explanations ?? []).map((note) => {
        const right = note.option === expected;
        const wrongPick = !right && note.option === picked;
        return (
          <View
            key={note.option}
            style={[
              styles.explainRow,
              right && styles.explainRowRight,
              wrongPick && styles.explainRowWrong,
            ]}
          >
            <View style={styles.explainHead}>
              <Text style={styles.explainOption}>{note.option}</Text>
              {note.translation ? (
                <Text style={styles.explainGloss}>{note.translation}</Text>
              ) : null}
              <Text style={[styles.explainMark, right ? styles.markRight : styles.markWrong]}>
                {right ? '✓' : wrongPick ? 'your pick' : ''}
              </Text>
            </View>
            {note.why ? <Text style={styles.explainWhy}>{note.why}</Text> : null}
          </View>
        );
      })}
    </Card>
  );
}

function Choice({
  label,
  furigana,
  showFurigana,
  selected,
  revealed,
  isAnswer,
  big = false,
  onPress,
}: {
  label: string;
  furigana?: Record<string, string>;
  showFurigana: boolean;
  selected: boolean;
  revealed: boolean;
  isAnswer: boolean;
  /** One kanji per option: drawn large, since telling them apart is the point. */
  big?: boolean;
  onPress: () => void;
}) {
  // After submitting, the right answer is always marked — including when the
  // user missed it. Showing only what they picked teaches nothing.
  const tone = revealed && isAnswer ? styles.choiceRight : selected ? styles.choicePicked : null;

  return (
    <PressBounce
      onPress={onPress}
      onPressIn={revealed ? undefined : feedback.select}
      disabled={revealed}
      style={[styles.choice, tone]}
    >
      <FuriganaText
        text={label}
        furigana={furigana}
        show={showFurigana}
        style={big ? styles.choiceKanji : styles.choiceText}
      />
    </PressBounce>
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
  furiganaToggleOff: {
    color: colors.inkDisabled,
  },
  promptRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  promptText: { flex: 1 },
  prompt: { ...jp.answer, color: colors.ink },

  // Wraps whichever answer control this question type uses, so a rejected
  // answer shakes the thing that was rejected rather than the whole screen.
  answerArea: { gap: spacing.stack },
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
  choiceKanji: { ...jp.detail, fontSize: 44, lineHeight: 52, color: colors.ink },

  explainCard: { gap: 10, marginTop: 10 },
  explainBlock: { gap: 3 },
  explainLabel: { ...typeScale.overline, color: colors.inkSoft },
  explainTranslation: { ...typeScale.body, color: colors.ink, lineHeight: 20 },
  explainRow: {
    gap: 3,
    padding: 10,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
  },
  explainRowRight: { backgroundColor: colors.successTint, borderColor: colors.success },
  explainRowWrong: { backgroundColor: colors.dangerTint, borderColor: colors.danger },
  explainHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  explainOption: { ...jp.row, fontSize: 17, color: colors.ink },
  explainGloss: { ...typeScale.captionBold, color: colors.inkMuted, flexShrink: 1 },
  explainMark: { ...typeScale.metaSmall, marginLeft: 'auto' },
  markRight: { color: colors.successInk },
  markWrong: { color: colors.dangerInk },
  explainWhy: { ...typeScale.caption, color: colors.inkSoft, lineHeight: 18 },

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

  summaryStats: { gap: 10 },
  statRow: { flexDirection: 'row', gap: 8 },
  summaryNote: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    lineHeight: 16,
  },
  summaryWarning: {
    ...typeScale.metaSmall,
    color: colors.warningInk,
    lineHeight: 16,
  },

  missRow: { paddingVertical: 10, gap: 4 },
  missDivider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  missHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  missFixed: {
    ...typeScale.metaSmall,
    color: colors.successInk,
  },
  missPrompt: { ...jp.row, color: colors.ink, lineHeight: 28 },
  missGiven: { ...typeScale.caption, color: colors.dangerInk },
  missAnswer: { ...typeScale.caption, color: colors.successInk },

  summaryFooter: {
    marginTop: 'auto',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
    gap: 7,
  },
  summaryFootnote: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
    textAlign: 'center',
    lineHeight: 15,
  },

  right: { backgroundColor: colors.successTint, borderColor: colors.success },
  wrong: { backgroundColor: colors.warningTint, borderColor: colors.warningBorder },
  verdictTitle: { ...typeScale.section, color: colors.ink },
  verdictBody: { ...typeScale.caption, color: colors.inkMuted, marginTop: 4 },
});
