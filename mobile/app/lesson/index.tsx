/**
 * Lesson — artboard 4c.
 *
 * Taught in batches, the way WaniKani teaches: read five items, then a quiz on
 * their meanings and readings. An item is learned -- its assignment started,
 * `PUT /assignments/{id}/start` -- only once both halves have been answered
 * right in the quiz. Reading an item is not learning it; an item you leave
 * before passing stays in the lesson queue for next time.
 *
 * The start goes through the outbox, so finishing a lesson offline works
 * exactly like finishing one online.
 */
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Mascot, type Pose } from '@/components/Mascot';
import { MascotCoach, useAnswerRun } from '@/components/MascotCoach';
import { RiseIn } from '@/components/motion';
import { ScreenHeader } from '@/components/ScreenHeader';
import { speakSubject, SubjectExtras } from '@/components/SubjectExtras';
import {
  Card,
  CardBanner,
  ChunkyButton,
  Overline,
  Pill,
  ReadingChip,
  SessionProgressBar,
  StepDots,
  TextButton,
} from '@/components/ui';
import { halvesOf, type Half, WkQuestion } from '@/components/WkQuestion';
import { recordSession, type SessionItem } from '@/data/session';
import type { StudyItem, Subject } from '@/data/types';
import { feedback } from '@/feedback';
import { useLessonQueue, useStudyActions, useSubjects } from '@/hooks/useStudyData';
import {
  colors,
  jp,
  radius,
  spacing,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

/** How far a swipe has to travel before it turns the page. */
const SWIPE_DISTANCE = 70;
/** Items read before each quiz -- WaniKani's own default batch. */
const BATCH_SIZE = 5;
/** "Shows up in" shows this many; a common kanji is in dozens of words. */
const USED_IN_LIMIT = 8;

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
  /** Items learned: passed in a quiz, and so started on WaniKani. */
  const taught = React.useRef<StudyItem[]>([]);

  /** Reading the batch, or being quizzed on it. */
  const [phase, setPhase] = React.useState<'teach' | 'quiz'>('teach');
  /** Items read in this batch and not yet passed -- what the quiz asks. */
  const [batch, setBatch] = React.useState<StudyItem[]>([]);
  /** Where this batch began; "Previous" does not reach back past it. */
  const [batchStart, setBatchStart] = React.useState(0);

  /**
   * One scroll view serves every item in the queue, so moving on leaves the
   * offset where the last item was read to — tap through a long mnemonic and
   * the next item opens halfway down itself. Reset on each change of item.
   */
  const scroller = React.useRef<ScrollView>(null);
  React.useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [index]);

  // Looked up before any early return: hooks run in the same order every
  // render. Empty while the queue loads.
  const { data: components } = useSubjects(current?.subject.componentSubjectIds ?? []);
  const { data: usedIn } = useSubjects(
    (current?.subject.amalgamationSubjectIds ?? []).slice(0, USED_IN_LIMIT),
  );

  /** The session's end: the summary, reporting what was learned. */
  const finish = React.useCallback(() => {
    // Every item reported passed its quiz, so each is `correct`. The movement
    // it produces is real: WaniKani takes an unlocked item to stage 1 when
    // the lesson lands.
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
  }, [router]);

  /** Read: into the batch, then the next item -- or the quiz once the batch is full. */
  const onGotIt = React.useCallback(() => {
    if (!current) return;
    // Swiping back re-reads an item already in the batch; it goes in once.
    const nextBatch = batch.includes(current) ? batch : [...batch, current];
    setBatch(nextBatch);
    // Deliberately `advance` and not the level-up fanfare. A lesson queue is
    // twenty-odd items long, and a cue that says "this is a big moment" twenty
    // times in four minutes stops meaning it.
    feedback.advance();
    if (nextBatch.length >= BATCH_SIZE || index + 1 >= items.length) {
      setPhase('quiz');
    } else {
      setIndex((i) => i + 1);
    }
  }, [batch, current, index, items.length]);

  const onDefer = React.useCallback(() => {
    if (current) setDeferred((rest) => [...rest, current]);
    feedback.advance();
    // Deferring appends the item, so there is always a next one to show.
    setIndex((i) => i + 1);
  }, [current]);

  /** Back one item, to read it again -- within this batch. */
  const onBack = React.useCallback(() => {
    if (index <= batchStart) return;
    feedback.back();
    setIndex((i) => i - 1);
  }, [batchStart, index]);

  /** Passed both halves: learned, and started on WaniKani. */
  const onPassed = React.useCallback(
    (item: StudyItem) => {
      if (taught.current.includes(item)) return;
      taught.current.push(item);
      void completeLesson(item.assignment);
    },
    [completeLesson],
  );

  /** The batch is learned: on to the next five, or the summary. */
  const onQuizDone = React.useCallback(() => {
    setBatch([]);
    setPhase('teach');
    if (index + 1 >= items.length) {
      finish();
      return;
    }
    setBatchStart(index + 1);
    setIndex(index + 1);
  }, [finish, index, items.length]);

  /** Back from the quiz to read the batch again; passed items stay passed. */
  const onReread = React.useCallback(() => {
    setBatch((rest) => rest.filter((item) => !taught.current.includes(item)));
    setPhase('teach');
    setIndex(batchStart);
  }, [batchStart]);

  /**
   * Swipe left to move on -- the same as "Got it" -- and right to go back.
   * Horizontal only, and only past a clear threshold, so a vertical scroll
   * through a long mnemonic never reads as a page turn.
   */
  const swipe = React.useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-24, 24])
        .failOffsetY([-14, 14])
        .onEnd((event) => {
          if (event.translationX < -SWIPE_DISTANCE) void onGotIt();
          else if (event.translationX > SWIPE_DISTANCE) onBack();
        }),
    [onBack, onGotIt],
  );

  if (!current) return <View style={styles.screen} />;

  if (phase === 'quiz') {
    return (
      <LessonQuiz
        items={batch.filter((item) => !taught.current.includes(item))}
        onPassed={onPassed}
        onDone={onQuizDone}
        onReread={onReread}
      />
    );
  }

  const { subject } = current;
  const lastBeforeQuiz =
    (batch.includes(current) ? batch.length : batch.length + 1) >= BATCH_SIZE ||
    index + 1 >= items.length;
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
  const parts: Subject[] = components ?? [];
  const appearsIn: Subject[] = usedIn ?? [];
  const appearsInLabel =
    subject.type === 'radical'
      ? 'Used in kanji'
      : subject.type === 'kanji'
        ? 'Used in vocabulary'
        : 'Shows up in';

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

      <GestureDetector gesture={swipe}>
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

                {parts.length > 0 ? (
                  <View style={styles.equation}>
                    {parts.map((component, position) => (
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
                    speakSubject(subject);
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

          {subject.readingMnemonic ? (
            <Card style={styles.mnemonicCard}>
              <MascotCoach label="Reading mnemonic" tone={subject.type} size={84} speed={0.6} pose="idle">
                <Text style={styles.mnemonicText}>{subject.readingMnemonic}</Text>
              </MascotCoach>
            </Card>
          ) : null}

          <SubjectExtras subject={subject} />

          {appearsIn.length > 0 ? (
            <Card>
              <Overline style={styles.groupLabel}>
                {appearsInLabel}
                {subject.amalgamationSubjectIds.length > appearsIn.length
                  ? ` · ${appearsIn.length} of ${subject.amalgamationSubjectIds.length}`
                  : ''}
              </Overline>
              <View style={styles.usedInRow}>
                {appearsIn.map((word) => (
                  <View key={word.id} style={styles.usedInTile}>
                    <Text style={styles.usedInWord}>{word.characters ?? word.slug}</Text>
                    <Text style={styles.usedInGloss} numberOfLines={2}>
                      {(word.readings.find((r) => r.primary) ?? word.readings[0])?.reading}
                      {word.readings.length > 0 ? ' · ' : ''}
                      {(word.meanings.find((m) => m.primary) ?? word.meanings[0])?.meaning.toLowerCase()}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
        </ScrollView>
      </GestureDetector>

      <View style={styles.footer}>
        <ChunkyButton
          label={lastBeforeQuiz ? 'Got it — start the quiz' : 'Got it — next'}
          tone={subject.type}
          onPress={onGotIt}
        />
        <View style={styles.footerLinks}>
          {index > batchStart ? <TextButton label="‹ Previous" onPress={onBack} /> : <View />}
          <TextButton label="Show me this one again later" onPress={onDefer} />
        </View>
        <Text style={styles.swipeHint}>Swipe left to go on, right to go back</Text>
      </View>
    </View>
  );
}

/**
 * The quiz after a batch: the meaning and the reading of every item just read,
 * shuffled, each asked until it is answered right. A miss shows the answer and
 * comes back later in the quiz. When both halves of an item are right it is
 * learned, there and then -- leaving part-way keeps what was passed.
 */
function LessonQuiz({
  items,
  onPassed,
  onDone,
  onReread,
}: {
  items: StudyItem[];
  onPassed: (item: StudyItem) => void;
  onDone: () => void;
  onReread: () => void;
}) {
  const [queue, setQueue] = React.useState<{ item: StudyItem; half: Half }[]>(() =>
    shuffle(items.flatMap((item) => halvesOf(item.subject).map((half) => ({ item, half })))),
  );
  const [turn, setTurn] = React.useState(0);
  const [pose, setPose] = React.useState<Pose>('idle');
  const [learned, setLearned] = React.useState(0);
  const [missed, setMissed] = React.useState(0);
  const { register } = useAnswerRun();

  const current = queue[0];

  // An empty batch (everything passed before a re-read) has nothing to ask.
  React.useEffect(() => {
    if (queue.length === 0) onDone();
  }, [onDone, queue.length]);

  const onGraded = React.useCallback(
    (ok: boolean) => {
      setPose(ok ? 'correct' : 'wrong');
      if (ok) {
        feedback.correct();
        if (register(true)) feedback.streak();
      } else {
        feedback.wrong();
        register(false);
        setMissed((n) => n + 1);
      }
    },
    [register],
  );

  const onNext = React.useCallback(
    (ok: boolean) => {
      if (!current) return;
      setPose('idle');
      setTurn((n) => n + 1);
      const [, ...remaining] = queue;
      // Both halves right -- no question about this item left -- is learned.
      if (ok && !remaining.some((q) => q.item === current.item)) {
        onPassed(current.item);
        setLearned((n) => n + 1);
      }
      setQueue(ok ? remaining : [...remaining, current]);
    },
    [current, onPassed, queue],
  );

  if (!current) return <View style={styles.screen} />;

  const palette = subjectPalette[current.item.subject.type];
  const questions = items.reduce((n, item) => n + halvesOf(item.subject).length, 0);
  // Answered right so far; a missed question is still in the queue.
  const done = questions - queue.length;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Lesson Quiz"
        glyph={palette.glyph}
        glyphColor={palette.solid}
        trailingText={`${learned} / ${items.length} learned`}
      >
        <SessionProgressBar correct={done} incorrect={0} total={questions} />
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.quizContent} keyboardShouldPersistTaps="handled">
        <WkQuestion
          key={turn}
          subject={current.item.subject}
          half={current.half}
          meta={<Pill label="lesson quiz" color={palette.ink} background={palette.tint} />}
          onGraded={onGraded}
          onNext={onNext}
        />
        <Text style={styles.quizNote}>
          {missed > 0 ? `${missed} missed so far — they come back until they're right. ` : ''}
          An item is learned once its meaning and reading are both right. Anything you leave
          before then stays in your lessons.
        </Text>
      </ScrollView>

      <View style={styles.quizFooter}>
        <Mascot pose={pose} size={64} speed={1} lively holdReaction />
        <Pressable onPress={onReread} onPressIn={feedback.back} hitSlop={8}>
          <Text style={styles.quizReread}>‹ Read these again</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Fisher–Yates, so a batch is not quizzed in the order it was read. */
function shuffle<T>(values: T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const styles = StyleSheet.create({
  quizContent: {
    paddingHorizontal: spacing.gutter,
    paddingTop: 20,
    paddingBottom: 16,
  },
  quizNote: {
    marginTop: 16,
    ...typeScale.metaSmall,
    color: colors.inkFaint,
    lineHeight: 16,
  },
  quizFooter: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
  },
  quizReread: {
    ...typeScale.meta,
    color: colors.inkFaint,
  },
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

  // Not a row: the coach inside lays itself out as one. A row here shrank the
  // coach to the width of its art, leaving the text column zero pixels wide --
  // which is why no mnemonic ever appeared, only the crabigator.
  mnemonicCard: {
    paddingVertical: 11,
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
    flexWrap: 'wrap',
    gap: 9,
  },
  usedInTile: {
    flexBasis: '47%',
    flexGrow: 1,
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
  footerLinks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  swipeHint: {
    ...typeScale.metaSmall,
    color: colors.inkFaint,
    textAlign: 'center',
  },
});
