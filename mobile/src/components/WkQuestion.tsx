/**
 * One WaniKani question — the meaning or the reading of one item — typed,
 * graded, and, when it was wrong, answered.
 *
 * Shared by reviews and the lesson quiz, which ask exactly the same thing: a
 * review checks what you know, a lesson quiz checks you learned what you just
 * read. Both have to grade the same way, so the grading lives here once.
 *
 * A wrong answer stops and shows the right one, with the mnemonic for that
 * half, until you move on. Advancing on a timer after a miss — which reviews
 * used to — flashed the red mark and moved on before you had seen what the
 * answer was, and a miss you never see corrected teaches nothing.
 *
 * Keyed by the parent on each question, so every question starts clean.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { toKana } from 'wanakana';

import { CheckMark, CorrectMark, IncorrectMark } from '@/components/icons';
import { finishKana, LanguageInput } from '@/components/LanguageInput';
import { Pop, useShake } from '@/components/motion';
import { Card, ChunkyButton } from '@/components/ui';
import type { Subject } from '@/data/types';
import { feedback } from '@/feedback';
import {
  colors,
  controlBorder,
  jp,
  radius,
  shadows,
  subjectPalette,
  type as typeScale,
} from '@/theme/tokens';

export type Half = 'meaning' | 'reading';

/** How long a right answer stays on screen before the next question. */
const CORRECT_HOLD_MS = 600;

/** Fisher–Yates: reviews and lesson quizzes come in random order, as on WaniKani. */
export function shuffle<T>(values: T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Which reading a kanji's reading question is after. WaniKani teaches one
 * reading type per kanji and marks only that type accepted, so the prompt can
 * say which -- the same thing WaniKani's own review header tells you.
 * Vocabulary has just "the reading", and radicals none at all.
 */
export function wantedReadingType(subject: Subject): 'onyomi' | 'kunyomi' | null {
  if (subject.type !== 'kanji') return null;
  const accepted =
    subject.readings.find((r) => r.acceptedAnswer && r.primary) ??
    subject.readings.find((r) => r.acceptedAnswer);
  return accepted?.type === 'onyomi' || accepted?.type === 'kunyomi' ? accepted.type : null;
}

/** The halves an item is asked: radicals have no reading to ask for. */
export function halvesOf(subject: Subject): Half[] {
  return subject.readings.length > 0 ? ['meaning', 'reading'] : ['meaning'];
}

export function promptLabel(subject: Subject, half: Half): string {
  if (half === 'meaning') return "What's the meaning?";
  const wanted = wantedReadingType(subject);
  if (wanted === 'onyomi') return "What's the on'yomi reading?";
  if (wanted === 'kunyomi') return "What's the kun'yomi reading?";
  return "What's the reading?";
}

/** Whether an answer counts, the way WaniKani counts it. */
export function isCorrect(subject: Subject, half: Half, typed: string): boolean {
  const normalised = typed.trim().toLowerCase();
  if (!normalised) return false;

  if (half === 'meaning') {
    // WaniKani also grades on auxiliary meanings: a whitelisted one is right
    // even though it is not among the listed meanings. (A blacklisted one is
    // already wrong here, since it matches nothing that is accepted.)
    return (
      subject.meanings.some((m) => m.acceptedAnswer && m.meaning.toLowerCase() === normalised) ||
      (subject.auxiliaryMeanings ?? []).some(
        (m) => m.type === 'whitelist' && m.meaning.toLowerCase() === normalised,
      )
    );
  }
  return subject.readings.some((r) => r.acceptedAnswer && r.reading === typed.trim());
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
export function nearMiss(subject: Subject, half: Half, typed: string): string | null {
  const answer = typed.trim();
  if (!answer) return null;
  const { readings } = subject;

  if (half === 'reading') {
    const other = readings.find((r) => !r.acceptedAnswer && r.reading === answer);
    if (!other) return null;
    const wanted = wantedReadingType(subject);
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

/** What counts as right, primary first — what the reveal shows. */
function acceptedAnswers(subject: Subject, half: Half): string[] {
  if (half === 'meaning') {
    return [...subject.meanings]
      .filter((m) => m.acceptedAnswer)
      .sort((a, b) => Number(b.primary) - Number(a.primary))
      .map((m) => m.meaning);
  }
  return [...subject.readings]
    .filter((r) => r.acceptedAnswer)
    .sort((a, b) => Number(b.primary) - Number(a.primary))
    .map((r) => r.reading);
}

export function WkQuestion({
  subject,
  half,
  meta,
  onGraded,
  onNext,
}: {
  subject: Subject;
  half: Half;
  /** Under the character: the SRS stage in a review, "lesson quiz" in a lesson. */
  meta?: React.ReactNode;
  /** Once per question, the moment it is graded — for strikes and the mascot. */
  onGraded: (ok: boolean) => void;
  /** When the question is finished with and the next should come. */
  onNext: (ok: boolean) => void;
}) {
  const [answer, setAnswer] = React.useState('');
  const [verdict, setVerdict] = React.useState<'correct' | 'incorrect' | null>(null);
  const [nudge, setNudge] = React.useState<string | null>(null);
  const { style: shakeStyle, shake } = useShake();
  const palette = subjectPalette[subject.type];

  // A right answer moves on by itself; the timer must not outlive the card.
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const submit = React.useCallback(() => {
    // After a miss the same key moves on, so the keyboard never has to close.
    if (verdict === 'incorrect') {
      feedback.advance();
      onNext(false);
      return;
    }
    if (verdict) return;

    const typed = half === 'reading' ? finishKana(answer) : answer;
    if (!typed.trim()) return;
    // Shown back as graded, so a trailing n reads as the ん it was scored as.
    if (typed !== answer) setAnswer(typed);

    const ok = isCorrect(subject, half, typed);

    // Right answer, wrong question: shake and ask again, as WaniKani does,
    // instead of charging a strike for something the learner actually knew.
    // Only after grading -- 酒's meaning "sake" sounds exactly like its
    // reading さけ, and a correct answer must never be turned back.
    if (!ok) {
      const redirect = nearMiss(subject, half, typed);
      if (redirect) {
        setNudge(redirect);
        shake();
        feedback.back();
        return;
      }
    }

    setNudge(null);
    setVerdict(ok ? 'correct' : 'incorrect');
    onGraded(ok);

    if (ok) {
      timer.current = setTimeout(() => onNext(true), CORRECT_HOLD_MS);
    } else {
      shake();
    }
  }, [answer, half, onGraded, onNext, shake, subject, verdict]);

  const accepted = acceptedAnswers(subject, half);
  const mnemonic = half === 'meaning' ? subject.meaningMnemonic : subject.readingMnemonic;
  const wanted = half === 'reading' ? wantedReadingType(subject) : null;

  return (
    <View>
      {/* In the item's own colour, as WaniKani draws it -- blue radical, pink
          kanji, purple vocabulary -- so what kind of thing is being asked
          reads before the character does. */}
      <Card style={[styles.promptCard, { backgroundColor: palette.solid }]}>
        <Text style={styles.promptLabel}>{promptLabel(subject, half)}</Text>
        <Text style={styles.promptGlyph}>{subject.characters}</Text>
        {meta ? <View style={styles.promptMeta}>{meta}</View> : null}
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
            onSubmitEditing={submit}
            editable={!verdict}
            blurOnSubmit={false}
            style={styles.answerInput}
            placeholder={half === 'reading' ? 'かな' : 'meaning'}
            placeholderTextColor={colors.inkDisabled}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType={verdict === 'incorrect' ? 'next' : 'done'}
            // Readings are always kana, so romaji typed on any keyboard counts.
            language={half === 'reading' ? 'ja' : 'en'}
            kana={half === 'reading'}
          />
        </View>

        <Pressable onPress={submit} disabled={verdict === 'correct'}>
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

      <Text style={[styles.inputHint, nudge ? styles.nudge : null]}>
        {nudge ??
          (half === 'reading'
            ? 'Kana input · romaji converts as you type'
            : 'Type the English meaning')}
      </Text>

      {verdict === 'incorrect' ? (
        <Pop style={styles.reveal}>
          <Card variant="bordered" style={styles.revealCard}>
            <Text style={styles.revealLabel}>
              {accepted.length > 1 ? 'Correct answers' : 'Correct answer'}
              {wanted ? ` · ${wanted === 'onyomi' ? "on'yomi" : "kun'yomi"}` : ''}
            </Text>
            <Text style={[styles.revealAnswer, half === 'reading' && styles.revealReading]}>
              {accepted[0] ?? '—'}
            </Text>
            {accepted.length > 1 ? (
              <Text style={styles.revealAlso}>also {accepted.slice(1).join(', ')}</Text>
            ) : null}
            <Text style={styles.revealYours}>
              You wrote <Text style={styles.revealYoursValue}>{answer.trim()}</Text>
            </Text>
            {mnemonic ? (
              <View style={[styles.mnemonic, { borderLeftColor: palette.solid }]}>
                <Text style={styles.mnemonicLabel}>
                  {half === 'meaning' ? 'Meaning mnemonic' : 'Reading mnemonic'}
                </Text>
                <Text style={styles.mnemonicText}>{mnemonic}</Text>
              </View>
            ) : null}
          </Card>
          <ChunkyButton label="Next" tone={subject.type} onPress={submit} cue="advance" />
        </Pop>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: 'rgba(255, 255, 255, 0.85)',
  },
  promptGlyph: {
    ...jp.hero,
    color: colors.onSolid,
  },
  promptMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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

  reveal: {
    marginTop: 14,
    gap: 12,
  },
  revealCard: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    gap: 4,
  },
  revealLabel: {
    ...typeScale.overline,
    color: colors.dangerInk,
  },
  revealAnswer: {
    ...typeScale.title,
    color: colors.ink,
  },
  revealReading: {
    ...jp.answer,
    fontSize: 30,
  },
  revealAlso: {
    ...typeScale.caption,
    color: colors.inkSoft,
  },
  revealYours: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
    marginTop: 4,
  },
  revealYoursValue: {
    fontFamily: typeScale.section.fontFamily,
    color: colors.dangerInk,
    textDecorationLine: 'line-through',
  },
  mnemonic: {
    marginTop: 10,
    borderLeftWidth: 3,
    paddingLeft: 10,
    gap: 3,
  },
  mnemonicLabel: {
    ...typeScale.metaSmall,
    color: colors.inkSoft,
  },
  mnemonicText: {
    ...typeScale.caption,
    color: colors.ink,
    lineHeight: 19,
  },
});
