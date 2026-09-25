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
import { durationMinutes, getLastSession } from '@/data/session';
import { syncNow, type SyncResult } from '@/data/sync';
import { stageBucket } from '@/theme/tokens';
import type {
  CalendarDay,
  Assignment,
  DashboardSummary,
  DayActivitySummary,
  Flashcard,
  FlashcardScope,
  GrammarEntry,
  JlptCoverage,
  LessonBundle,
  LessonQueueCount,
  LevelItem,
  ReviewAnswer,
  SessionSummary,
  StudyItem,
  Subject,
  VocabItem,
  VocabFolder,
  VocabSet,
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

    // Not mirrored yet -- a word reached from "Shows up in" usually is not.
    // Ask the server before settling for the samples.
    if (api.isBackendConfigured) {
      try {
        const [fetched] = await api.fetchSubjects([subjectId]);
        if (fetched) {
          await db.upsertSubjects([fetched]).catch(() => undefined);
          return { subject: fetched, assignment: await db.getAssignmentForSubject(subjectId) };
        }
      } catch {
        // Offline: fall through to the samples.
      }
    }

    const sample = fixtures.findSubject(subjectId);
    if (!sample) return null;

    const queued = [...fixtures.REVIEW_QUEUE, ...fixtures.LESSON_QUEUE].find(
      (item) => item.subject.id === subjectId,
    );
    return { subject: sample, assignment: queued?.assignment ?? null };
  }, [subjectId]);
}

/**
 * Several subjects by id, in the order asked for — an item's parts and the
 * words it appears in.
 *
 * The local mirror first, then the server for whatever it lacks (written back
 * so the next lookup is local), and the bundled samples only when no server is
 * configured. The lesson and item screens used to go straight to the samples,
 * so on a real account "radicals + … =" and "Shows up in" were almost always
 * empty: the samples hold a single level.
 */
export function useSubjects(ids: number[]) {
  const key = ids.join(',');
  return useAsync<Subject[]>(async () => {
    if (ids.length === 0) return [];

    const byId = new Map((await db.getSubjectsByIds(ids)).map((s) => [s.id, s]));
    const missing = ids.filter((id) => !byId.has(id));

    if (missing.length > 0 && api.isBackendConfigured) {
      try {
        const fetched = await api.fetchSubjects(missing);
        fetched.forEach((s) => byId.set(s.id, s));
        await db.upsertSubjects(fetched).catch(() => undefined);
      } catch {
        // Offline: show what the mirror has rather than nothing.
      }
    } else if (!api.isBackendConfigured) {
      for (const id of missing) {
        const sample = fixtures.findSubject(id);
        if (sample) byId.set(id, sample);
      }
    }

    return ids.map((id) => byId.get(id)).filter((s): s is Subject => Boolean(s));
  }, [key]);
}

/**
 * Derived from the assignment, because that is the only place the information
 * lives. A missing assignment is not missing data — WaniKani creates one on
 * unlock, so its absence *is* locked.
 */
function tileState(assignment: Assignment | undefined): LevelItem['state'] {
  if (!assignment) return 'locked';
  if (assignment.passedAt) return 'passed';
  return 'in_progress';
}

/**
 * Every subject on a level, each with where it stands. `null` while the level
 * is still unknown (the dashboard supplies it).
 *
 * The server is asked first here, unlike most hooks, and the reason is the
 * locked tiles: `syncNow` only caches subjects that already have assignments,
 * so the local mirror holds what is unlocked and nothing else. Reading the
 * cache alone would silently drop every locked item from the grid and leave a
 * legend describing a state that never appears.
 */
export function useLevelItems(level: number | null) {
  return useAsync<LevelItem[]>(async () => {
    if (level === null) return [];

    let subjects: Subject[] = [];
    if (api.isBackendConfigured) {
      try {
        subjects = await api.fetchSubjectsByLevel(level);
      } catch {
        // Offline. Fall through to the mirror, which is missing the locked
        // items but is still the real level as far as this device knows.
      }
    }

    if (subjects.length === 0) subjects = await db.getSubjectsByLevel(level);
    if (subjects.length === 0) return fixtures.LEVEL_12_ITEMS;

    const assignments = await db.getAssignmentsForSubjects(subjects.map((s) => s.id));
    return subjects.map((subject) => ({
      subject,
      state: tileState(assignments.get(subject.id)),
    }));
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
export function useDueFlashcards(limit = 100, scope: FlashcardScope = {}) {
  const key = `${scope.setId ?? ''}|${scope.folderId ?? ''}|${scope.jlpt ?? ''}`;
  return useAsync<Flashcard[]>(async () => {
    if (!api.isBackendConfigured) return [];
    return api.fetchDueFlashcards(limit, scope);
  }, [limit, key]);
}

/**
 * The user's named sets.
 *
 * No mirror and no fixtures, for the same reason as `useDueFlashcards`: sets
 * are something you made, and inventing sample ones would put decks on the
 * screen that nobody created. An empty list is the honest state before the
 * first import, and the screen says so rather than pretending.
 */
export function useVocabSets() {
  return useAsync<VocabSet[]>(async () => {
    if (!api.isBackendConfigured) return [];
    return api.fetchVocabSets();
  }, []);
}

/** Folders, alphabetical, with how many sets each holds. */
export function useVocabFolders() {
  return useAsync<VocabFolder[]>(async () => {
    if (!api.isBackendConfigured) return [];
    return api.fetchVocabFolders();
  }, []);
}

/** The words in one set. `null` while no set is selected. */
export function useVocabSetItems(setId: number | null) {
  return useAsync<VocabItem[]>(async () => {
    if (setId === null || !api.isBackendConfigured) return [];
    return api.fetchVocabSetItems(setId);
  }, [setId]);
}

/* -------------------------------------------------------------------------- */
/* Grammar                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Points you have logged, newest first.
 *
 * No mirror and no fixtures, for the same reason as `useVocabSets`: a logged
 * grammar point is something you wrote down, and inventing sample ones would
 * put patterns on the calendar nobody studied. An empty list is the honest
 * state before the first one.
 */
export function useGrammarEntries(range: { since?: string; until?: string } = {}) {
  const { since, until } = range;
  return useAsync<GrammarEntry[]>(async () => {
    if (!api.isBackendConfigured) return [];
    return api.fetchGrammarEntries({ since, until });
  }, [since, until]);
}

/** One point. `null` while none is selected. */
export function useGrammarEntry(entryId: number | null) {
  return useAsync<GrammarEntry | null>(async () => {
    if (entryId === null || !api.isBackendConfigured) return null;
    return api.fetchGrammarEntry(entryId);
  }, [entryId]);
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

/* -------------------------------------------------------------------------- */
/* Session summary                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The report for the session that just ended.
 *
 * Movements are a diff, not a client calculation: the session recorded the
 * stage each item had on the way in, and WaniKani decided where it went. That
 * decision reaches the phone through the sync below, so this syncs first and
 * reads the mirror second. An item whose stage has not moved yet — offline, or
 * a sync that failed — simply contributes no movement rather than a guessed one.
 *
 * With no recorded session (a cold deep-link into the route) this falls back to
 * the fixture, which is what makes the screen render on a fresh clone.
 */
export function useSessionSummary() {
  return useAsync<SessionSummary>(async () => {
    const session = getLastSession();
    if (!session || session.items.length === 0) return fixtures.SESSION_SUMMARY;

    // Best effort: the answers are already queued, so a failure here costs the
    // movements, not the data.
    if (api.isBackendConfigured) {
      try {
        await syncNow();
      } catch {
        /* offline — fall through to whatever the mirror already holds */
      }
    }

    const [assignments, next, pendingSync, dashboard] = await Promise.all([
      db.getAssignmentsForSubjects(session.items.map((i) => i.subjectId)),
      db.getNextReview(),
      db.countPendingWrites(),
      loadStreakDays(),
    ]);

    // Movements are reported in *display buckets*, not WaniKani's raw 0-9
    // stage. The summary screen indexes `srsStages` and the stage vocabulary
    // with these numbers and both are five long, so handing it a raw stage
    // reads past the end of the array — a 7 renders as undefined and throws.
    //
    // Bucketing also merges correctly: raw 1->2 and raw 2->3 are both
    // Seed -> Sprout, and the screen should show that as one row of two, not
    // two rows of one.
    const tally = new Map<string, { from: number; to: number; count: number }>();
    for (const item of session.items) {
      const rawTo = assignments.get(item.subjectId)?.srsStage;
      if (rawTo === undefined) continue;

      const from = stageBucket(item.startingStage);
      const to = stageBucket(rawTo);
      // A move within one bucket (raw 1 -> 2) is real progress but not a
      // visible one, and drawing it as a bar of zero length would be a lie.
      if (to <= from) continue;

      const key = `${from}->${to}`;
      const entry = tally.get(key) ?? { from, to, count: 0 };
      entry.count += 1;
      tally.set(key, entry);
    }

    const correct = session.items.filter((i) => i.correct).length;
    const total = session.items.length;

    return {
      durationMinutes: durationMinutes(session),
      total,
      correct,
      incorrect: total - correct,
      percentageCorrect: Math.round((correct / total) * 100),
      streakDays: dashboard,
      movements: [...tally.values()].sort((a, b) => a.from - b.from),
      missed: session.items
        .filter((i) => !i.correct)
        .map((i) => ({
          subjectId: i.subjectId,
          characters: i.characters,
          meaning: i.meaning,
          reading: i.reading,
          note: i.note,
        })),
      nextReviewAt: next.at,
      nextReviewCount: next.count,
      pendingSync,
    };
  }, []);
}

/** The streak is the dashboard's to compute; this only borrows the number. */
async function loadStreakDays(): Promise<number> {
  if (!api.isBackendConfigured) return fixtures.DASHBOARD.streak.days;
  try {
    return (await api.fetchDashboard()).streak.days;
  } catch {
    return fixtures.DASHBOARD.streak.days;
  }
}

/* -------------------------------------------------------------------------- */
/* Activity calendar                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Half a year. The card shows as many recent weeks as fit its width — about
 * twenty on a phone — and a wider screen shows more without another fetch.
 * The payload is one row per active day, so this is cheap even when full.
 */
const CALENDAR_WEEKS = 26;

/**
 * Local calendar date, not `toISOString()`.
 *
 * The server buckets days in the zone the device reported, so the key has to
 * be the device's own date. UTC would disagree with it for part of every day
 * and slide the whole calendar by one.
 */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Every day from the Sunday `CALENDAR_WEEKS` weeks back through today, oldest
 * first — whole weeks, so the calendar's columns line up the way GitHub's do.
 */
export function useActivityCalendar() {
  return useAsync<CalendarDay[] | null>(async () => {
    if (!api.isBackendConfigured) return null;

    const first = new Date();
    first.setHours(12, 0, 0, 0); // midday, so a DST change cannot skip a date
    first.setDate(first.getDate() - first.getDay() - (CALENDAR_WEEKS - 1) * 7);

    let summaries: DayActivitySummary[];
    try {
      summaries = await api.fetchActivity(isoDate(first));
    } catch {
      return null;
    }

    const byDay = new Map(summaries.map((s) => [s.day, s]));
    const today = isoDate(new Date());
    const days: CalendarDay[] = [];

    for (const cursor = new Date(first); ; cursor.setDate(cursor.getDate() + 1)) {
      const date = isoDate(cursor);
      const summary = byDay.get(date);
      const count = summary ? summary.reviews + summary.vocabReviews : 0;
      days.push({
        date,
        count,
        grammarOnly: count === 0 && !!summary && summary.grammarLogged > 0,
      });
      if (date === today) break;
    }

    return days;
  }, []);
}

/* -------------------------------------------------------------------------- */
/* Generated lessons                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The next pregenerated bundle, claimed from the queue.
 *
 * `null` is a normal answer, not an error — the cron tops the queue up twice a
 * day and a user who has worked through everything is simply early.
 *
 * **Asking consumes it**, so this deliberately does not reload on focus: a
 * remount would burn a second bundle and show a lesson the user never asked
 * for. The screen holds what it got.
 */
/**
 * Kanji coverage per JLPT tier.
 *
 * Server-side, because the denominators live in a reference list the phone has
 * no copy of — and should not, since it is 50KB that would go stale silently.
 * Untracked is the honest answer offline rather than a row of zeroes, which
 * would read as having forgotten everything.
 */
export function useJlptCoverage() {
  return useAsync<JlptCoverage>(async () => {
    if (!api.isBackendConfigured) return { tiers: [], tracked: false };
    try {
      return await api.fetchJlptCoverage();
    } catch {
      return { tiers: [], tracked: false };
    }
  }, []);
}

/**
 * How much generated practice is waiting, for the home and study cards.
 *
 * Emphatically not `useLessonBundle` — that one *claims* a bundle, so a card
 * using it to draw a badge would consume a lesson on every render.
 */
export function usePracticeQueue() {
  return useAsync<LessonQueueCount>(async () => {
    if (!api.isBackendConfigured) return { bundles: 0, questions: 0 };
    try {
      return await api.fetchLessonQueueCount();
    } catch {
      // Offline. Nothing is reachable, so nothing is offered — the card shows
      // its empty state rather than a stale count.
      return { bundles: 0, questions: 0 };
    }
  }, []);
}

export function useLessonBundle() {
  return useAsync<LessonBundle | null>(async () => {
    if (!api.isBackendConfigured) return null;
    try {
      return await api.fetchLessonBundle();
    } catch {
      // Offline, or nothing generated. Either way there is no lesson to show,
      // and the screen says so rather than failing.
      return null;
    }
  }, []);
}
