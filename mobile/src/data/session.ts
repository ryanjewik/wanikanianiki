/**
 * What just happened in a study session, handed from the session screen to the
 * summary.
 *
 * Deliberately in memory and deliberately not in the router's params. Params
 * are strings, and this is a list of objects; the outbox is for things that
 * must survive being killed, and a summary of a session that already recorded
 * its answers is not one of them. If the app restarts before the summary
 * renders, the answers are still safely queued — only the report is lost.
 *
 * The screens that write this record what they *know*: which items were asked,
 * how they were answered, and the SRS stage each one had when the session
 * started. What they cannot know is where WaniKani moved those stages to —
 * that is WaniKani's decision, arrives with the review response, and reaches
 * the phone through the sync that follows. The summary diffs the two.
 */

export type SessionKind = 'review' | 'lesson';

export interface SessionItem {
  subjectId: number;
  characters: string;
  meaning: string;
  reading: string;
  /**
   * The stage the item had before this session. Read off the assignment the
   * queue was already carrying, so it costs nothing and is true even offline.
   */
  startingStage: number;
  /** False if the item was missed at least once, whatever happened after. */
  correct: boolean;
  /** Why it is in the missed list: what was typed, or which half went wrong. */
  note: string;
}

export interface FinishedSession {
  kind: SessionKind;
  startedAt: number;
  finishedAt: number;
  /** Items asked. For a lesson, items taught. */
  items: SessionItem[];
}

let last: FinishedSession | null = null;

export function recordSession(session: FinishedSession): void {
  last = session;
}

export function getLastSession(): FinishedSession | null {
  return last;
}

export function clearLastSession(): void {
  last = null;
}

/** Whole minutes, floored to 1 — "0 min" reads as a bug rather than as brevity. */
export function durationMinutes(session: FinishedSession): number {
  return Math.max(1, Math.round((session.finishedAt - session.startedAt) / 60_000));
}
