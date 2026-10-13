/**
 * Every answer, logged for analysis.
 *
 * The study writes (`submit_review`, `answer_flashcard`, practice answers)
 * carry what the schedulers need. This carries what a model of memory needs:
 * each attempt including retries, how long it took, how much was typed and
 * erased, near misses, and the item's state the moment before -- the data the
 * ISyE 6740 project fits forgetting curves to. The server adds item features
 * (level, JLPT tier, stroke counts) on insert.
 *
 * Queued through the outbox like any other write, so an answer given offline
 * is logged once the phone is back online; each event carries its own id, so
 * a replay never stores it twice.
 */
import Constants from 'expo-constants';
import * as React from 'react';
import { Platform } from 'react-native';

import { enqueueWrite } from './db';

export type AnswerSource = 'wk_review' | 'wk_lesson_quiz' | 'flashcard' | 'practice';
export type InputMode = 'typed' | 'flip' | 'choice' | 'tiles';
export type Outcome = 'correct' | 'incorrect' | 'gave_up' | 'self_correct' | 'self_incorrect';

/** What a screen knows about an answer. Timing comes from `useAnswerTimer`. */
export interface AnswerEventFields {
  source: AnswerSource;
  sessionId: string;
  position: number;
  attempt: number;
  questionKind: string;
  inputMode: InputMode;

  subjectId?: number | null;
  subjectType?: string | null;
  assignmentId?: number | null;
  vocabItemId?: number | null;
  srsStateId?: number | null;
  setId?: number | null;
  questionId?: number | null;

  prompt?: string | null;
  answerGiven?: string | null;
  expected?: string[] | null;
  correct: boolean;
  outcome: Outcome;
  furiganaShown?: boolean | null;
  choicesShown?: string[] | null;
  pickedIndex?: number | null;

  srsStage?: number | null;
  srsEase?: number | null;
  srsIntervalDays?: number | null;
  srsRepetitions?: number | null;
  srsLapses?: number | null;
  dueAt?: string | null;
}

export interface AnswerTiming {
  shownAt: string;
  firstInputAt: string | null;
  answeredAt: string;
  nextAt: string | null;
  keystrokes: number;
  deletions: number;
  nearMisses: number;
  nearMissAnswers: string[];
}

export type AnswerEvent = AnswerEventFields &
  AnswerTiming & {
    clientEventId: string;
    timezone: string | null;
    appVersion: string | null;
    platform: string;
  };

/** Random enough to be unique per answer, without a crypto dependency. */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** One per screen visit: the answers of a sitting, grouped. */
export function newSessionId(): string {
  return newId();
}

const TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
})();

const APP_VERSION = Constants.expoConfig?.version ?? null;

/** Queues one answer for the server. Never throws: a log must not break a session. */
export function logAnswer(fields: AnswerEventFields, timing: AnswerTiming): void {
  const event: AnswerEvent = {
    ...fields,
    ...timing,
    clientEventId: newId(),
    timezone: TIMEZONE,
    appVersion: APP_VERSION,
    platform: Platform.OS,
  };
  void enqueueWrite('answer_event', event).catch(() => undefined);
}

/**
 * Times one question: when it was shown, the first keystroke, how much was
 * typed and erased, near misses, when it was answered and when it was left.
 *
 * `start()` when a question appears (a component keyed per question can just
 * mount); `onText(next)` from the input's change handler; `answered()` when
 * it is graded; `finish()` for the timing to log, stamped with when the next
 * question came.
 */
export function useAnswerTimer() {
  const state = React.useRef(blank());

  const start = React.useCallback(() => {
    state.current = blank();
  }, []);

  const onText = React.useCallback((next: string) => {
    const s = state.current;
    if (s.firstInputAt === null && next.length > 0) s.firstInputAt = new Date();
    const delta = next.length - s.lastLength;
    if (delta > 0) s.keystrokes += delta;
    else if (delta < 0) s.deletions += -delta;
    s.lastLength = next.length;
  }, []);

  /** A first response that is not typing -- tapping to flip a card. */
  const responded = React.useCallback(() => {
    if (state.current.firstInputAt === null) state.current.firstInputAt = new Date();
  }, []);

  const nearMiss = React.useCallback((answer: string) => {
    state.current.nearMissAnswers.push(answer);
  }, []);

  const answered = React.useCallback(() => {
    if (state.current.answeredAt === null) state.current.answeredAt = new Date();
  }, []);

  const finish = React.useCallback((): AnswerTiming => {
    const s = state.current;
    const now = new Date();
    const answeredAt = s.answeredAt ?? now;
    return {
      shownAt: s.shownAt.toISOString(),
      firstInputAt: s.firstInputAt?.toISOString() ?? null,
      answeredAt: answeredAt.toISOString(),
      nextAt: now.toISOString(),
      keystrokes: s.keystrokes,
      deletions: s.deletions,
      nearMisses: s.nearMissAnswers.length,
      nearMissAnswers: [...s.nearMissAnswers],
    };
  }, []);

  return React.useMemo(
    () => ({ start, onText, responded, nearMiss, answered, finish }),
    [start, onText, responded, nearMiss, answered, finish],
  );
}

function blank() {
  return {
    shownAt: new Date(),
    firstInputAt: null as Date | null,
    answeredAt: null as Date | null,
    keystrokes: 0,
    deletions: 0,
    lastLength: 0,
    nearMissAnswers: [] as string[],
  };
}
