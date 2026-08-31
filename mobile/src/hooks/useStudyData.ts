/**
 * Screen-facing data hooks.
 *
 * Each hook reads the local SQLite mirror first — that is what makes a session
 * work offline — and falls back to the fixtures while no backend is
 * configured, so every screen renders on a fresh clone. Swapping in a real
 * server means setting `EXPO_PUBLIC_API_URL`; nothing in the screens changes.
 */
import * as React from 'react';

import * as api from '@/data/api';
import * as db from '@/data/db';
import * as fixtures from '@/data/fixtures';
import { syncNow, type SyncResult } from '@/data/sync';
import type {
  Assignment,
  DashboardSummary,
  Flashcard,
  ReviewAnswer,
  StudyItem,
  Subject,
} from '@/data/types';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useAsync<T>(load: () => Promise<T>, deps: React.DependencyList): AsyncState<T> & {
  reload: () => void;
} {
  const [state, setState] = React.useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    load()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Something went wrong',
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export function useDashboard() {
  return useAsync<DashboardSummary>(async () => {
    if (api.isBackendConfigured) {
      try {
        return await api.fetchDashboard();
      } catch {
        // Fall through to whatever the local mirror can reconstruct — being
        // offline should never blank the home screen.
      }
    }

    const [lessons, reviews, spread, lastSyncedAt] = await Promise.all([
      db.getLessonQueue(500),
      db.getReviewQueue(500),
      db.getStageSpread(),
      db.getSyncMeta(db.SYNC_KEY_LAST_SYNCED),
    ]);

    const hasLocalData = lessons.length + reviews.length + spread.reduce((a, b) => a + b, 0) > 0;
    if (!hasLocalData) return fixtures.DASHBOARD;

    return {
      ...fixtures.DASHBOARD,
      lessonCount: lessons.length,
      reviewCount: reviews.length,
      stageSpread: spread,
      lastSyncedAt,
    };
  }, []);
}

/* -------------------------------------------------------------------------- */
/* Queues                                                                      */
/* -------------------------------------------------------------------------- */

/** Joins a queue of assignments to their cached subjects. */
async function hydrate(assignments: Assignment[]): Promise<StudyItem[]> {
  const subjects = await db.getSubjectsByIds(assignments.map((a) => a.subjectId));
  const bySubjectId = new Map(subjects.map((s) => [s.id, s]));

  return assignments
    .map((assignment) => {
      const subject = bySubjectId.get(assignment.subjectId);
      return subject ? { assignment, subject } : null;
    })
    .filter((item): item is StudyItem => item !== null);
}

export function useLessonQueue() {
  return useAsync<StudyItem[]>(async () => {
    const items = await hydrate(await db.getLessonQueue());
    return items.length > 0 ? items : fixtures.LESSON_QUEUE;
  }, []);
}

export function useReviewQueue() {
  return useAsync<StudyItem[]>(async () => {
    const items = await hydrate(await db.getReviewQueue());
    return items.length > 0 ? items : fixtures.REVIEW_QUEUE;
  }, []);
}

export function useSubject(subjectId: number | null) {
  return useAsync<{ subject: Subject; assignment: Assignment | null } | null>(async () => {
    if (subjectId === null) return null;

    const local = await db.getSubject(subjectId);
    if (local) {
      return { subject: local, assignment: await db.getAssignmentForSubject(subjectId) };
    }

    const sample = fixtures.findSubject(subjectId);
    if (!sample) return null;

    const queued = [...fixtures.REVIEW_QUEUE, ...fixtures.LESSON_QUEUE].find(
      (item) => item.subject.id === subjectId,
    );
    return { subject: sample, assignment: queued?.assignment ?? null };
  }, [subjectId]);
}

export function useLevelItems(level: number) {
  return useAsync<Subject[]>(async () => {
    const local = await db.getSubjectsByLevel(level);
    if (local.length > 0) return local;
    return fixtures.LEVEL_12_ITEMS.map((item) => item.subject);
  }, [level]);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Finishing a lesson and answering a review take the same shape: write to the
 * outbox first, then try to drain it. Queuing unconditionally is what makes
 * the offline and online paths identical — if the drain fails, the row simply
 * waits for the next sync.
 */
export function useStudyActions() {
  const completeLesson = React.useCallback(async (assignment: Assignment) => {
    await db.enqueueWrite('start_assignment', { assignmentId: assignment.id });
    if (api.isBackendConfigured) {
      // Fire and forget; a failure just leaves the row queued.
      void syncNow();
    }
  }, []);

  const submitAnswer = React.useCallback(async (answer: ReviewAnswer) => {
    await db.enqueueWrite('submit_review', answer);
    if (api.isBackendConfigured) {
      void syncNow();
    }
  }, []);

  /**
   * One answered imported-vocabulary card.
   *
   * The typed string goes up, not the client's verdict: the server regrades it
   * and its answer is what the deck records. The screen has already shown a
   * result by the time this runs, from the answers the card carries.
   */
  const answerFlashcard = React.useCallback(async (srsStateId: number, answerGiven: string) => {
    await db.enqueueWrite('answer_flashcard', { srsStateId, answerGiven });
    if (api.isBackendConfigured) {
      void syncNow();
    }
  }, []);

  return { completeLesson, submitAnswer, answerFlashcard };
}

/* -------------------------------------------------------------------------- */
/* Imported vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Cards due from the user's own imported deck — never WaniKani items, which
 * are scheduled by WaniKani and come through `useReviewQueue`.
 *
 * Unlike the WaniKani queues this has no local mirror and no fixture fallback,
 * and both absences are deliberate. An empty imported deck is the honest state
 * on a fresh install: you have not photographed anything yet, and inventing
 * sample words would put vocabulary in front of you that you never chose to
 * study. The cost is that a session cannot be *started* offline; one already
 * underway finishes fine, because each card carries its own answers and the
 * outbox queues what you type.
 */
export function useDueFlashcards(limit = 100) {
  return useAsync<Flashcard[]>(async () => {
    if (!api.isBackendConfigured) return [];
    return api.fetchDueFlashcards(limit);
  }, [limit]);
}

/* -------------------------------------------------------------------------- */
/* Sync                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Pull-to-refresh state. Polling on app open is the cadence that matters —
 * that is when staleness is visible to the user — so this is deliberately
 * manual rather than an interval.
 */
export function useSync() {
  const [syncing, setSyncing] = React.useState(false);
  const [result, setResult] = React.useState<SyncResult | null>(null);
  const [pendingWrites, setPendingWrites] = React.useState(0);

  const refresh = React.useCallback(async () => {
    setSyncing(true);
    try {
      const next = await syncNow();
      setResult(next);
      setPendingWrites(next.pendingWrites);
      return next;
    } finally {
      setSyncing(false);
    }
  }, []);

  React.useEffect(() => {
    void db.countPendingWrites().then(setPendingWrites);
  }, []);

  return { syncing, result, pendingWrites, refresh };
}
