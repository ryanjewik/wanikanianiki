/**
 * Client for *our* backend — never for WaniKani.
 *
 * The WaniKani token lives on the server and only the server holds it, so
 * nothing here sends an `Authorization: Bearer <wanikani token>` header or
 * knows the `Wanikani-Revision` dance. The server owns rate limiting, the
 * `updated_after` cursor bookkeeping against WaniKani, and the two write
 * endpoints that actually mutate the account.
 */
import Constants from 'expo-constants';

import type {
  Assignment,
  DashboardSummary,
  DayActivitySummary,
  DetectedItem,
  Flashcard,
  FlashcardOutcome,
  GrammarEnrichment,
  GrammarEntry,
  GrammarExampleInput,
  LessonBundle,
  ReviewAnswer,
  Subject,
  VocabItem,
  VocabSet,
} from './types';

/**
 * Points at the API server. Set `EXPO_PUBLIC_API_URL` in `.env` for a real
 * backend; the placeholder keeps the app running against mock data until one
 * exists.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  '';

/** True when no backend is configured, so callers fall back to fixtures. */
export const isBackendConfigured = API_BASE_URL.length > 0;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Milliseconds before the request is abandoned. */
  timeoutMs?: number;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!isBackendConfigured) {
    throw new ApiError('No API server configured (set EXPO_PUBLIC_API_URL)', 0);
  }

  const { method = 'GET', body, signal, timeoutMs = 15_000 } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort());

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    const parsed = text ? safeParse(text) : null;

    if (!response.ok) {
      throw new ApiError(
        `${method} ${path} failed with ${response.status}`,
        response.status,
        parsed,
      );
    }
    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The device's IANA zone name, or null when the runtime cannot say.
 *
 * The server decides where a study day ends from this, so the phone reporting
 * it is what keeps an evening session on the evening it happened rather than on
 * UTC's tomorrow. Reported rather than configured: the device already knows,
 * and it re-reports on every dashboard load, so changing zones fixes itself.
 *
 * Guarded because `Intl` is not guaranteed on every JS engine build. Sending
 * nothing is safe — the server keeps whatever zone the account already had.
 */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Everything the dashboard needs, precomputed server-side from Postgres. */
export function fetchDashboard(signal?: AbortSignal): Promise<DashboardSummary> {
  const tz = deviceTimeZone();
  const query = tz ? `?tz=${encodeURIComponent(tz)}` : '';
  return request<DashboardSummary>(`/api/dashboard${query}`, { signal });
}

/**
 * Incremental assignment pull. `updatedAfter` comes from
 * `sync_meta['last_synced_at']`, so each poll is a cheap diff rather than a
 * full re-pull.
 */
export function fetchAssignments(
  updatedAfter?: string | null,
  signal?: AbortSignal,
): Promise<Assignment[]> {
  const query = updatedAfter ? `?updated_after=${encodeURIComponent(updatedAfter)}` : '';
  return request<Assignment[]>(`/api/assignments${query}`, { signal });
}

/**
 * Subject content. Kanji and vocabulary essentially never change, so this is
 * pulled once per level and then cached in SQLite indefinitely.
 */
export function fetchSubjects(ids: number[], signal?: AbortSignal): Promise<Subject[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return request<Subject[]>(`/api/subjects?ids=${ids.join(',')}`, { signal });
}

export function fetchSubjectsByLevel(level: number, signal?: AbortSignal): Promise<Subject[]> {
  return request<Subject[]>(`/api/subjects?level=${level}`, { signal });
}

/* -------------------------------------------------------------------------- */
/* Writes — the only two calls that change state upstream                      */
/* -------------------------------------------------------------------------- */

/**
 * Moves a lesson out of "unlocked" and into the SRS at stage 1. Proxies
 * `PUT /assignments/{id}/start` on WaniKani's side.
 */
export function startAssignment(assignmentId: number): Promise<Assignment> {
  return request<Assignment>(`/api/assignments/${assignmentId}/start`, { method: 'PUT' });
}

/**
 * Submits one review result. Only the incorrect counts go up — WaniKani
 * computes the new SRS stage server-side, so the client never sends a stage.
 */
export function submitReview(answer: ReviewAnswer): Promise<Assignment> {
  return request<Assignment>('/api/reviews', {
    method: 'POST',
    body: {
      review: {
        assignment_id: answer.assignmentId,
        incorrect_meaning_answers: answer.incorrectMeaningAnswers,
        incorrect_reading_answers: answer.incorrectReadingAnswers,
      },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Part 2 — photo import and generated practice                                */
/* -------------------------------------------------------------------------- */

export type ImportStatus = 'pending' | 'processed' | 'failed';

export interface VocabSourceResult {
  sourceId: number;
  status: ImportStatus;
  items: DetectedItem[];
  detail: string | null;
}

/**
 * Hands a textbook photo to the ingestion service.
 *
 * Returns as soon as the upload lands, with nothing extracted yet. Reading a
 * page is a vision-model call taking tens of seconds, and a phone should not
 * hold a connection open that long: mobile data drops it on a network switch,
 * and both iOS and Android suspend a backgrounded app mid-request. The rows
 * arrive via `pollVocabSource` below.
 */
export async function uploadVocabPhoto(
  imageUri: string,
  jlptLevel: number | null,
  options: { setId?: number; position?: number } = {},
): Promise<VocabSourceResult> {
  if (!isBackendConfigured) {
    throw new ApiError('No API server configured (set EXPO_PUBLIC_API_URL)', 0);
  }

  const form = new FormData();
  // React Native's FormData takes this shape for a local file URI.
  form.append('image', {
    uri: imageUri,
    name: 'page.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  if (jlptLevel !== null) form.append('jlpt_level', String(jlptLevel));
  if (options.setId !== undefined) form.append('set_id', String(options.setId));
  if (options.position !== undefined) form.append('position', String(options.position));

  const response = await fetch(`${API_BASE_URL}/api/vocab-sources`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new ApiError(`Photo import failed with ${response.status}`, response.status);
  }
  return (await response.json()) as VocabSourceResult;
}

/** One poll. `status` stays `pending` until the extraction finishes. */
export function fetchVocabSource(
  sourceId: number,
  signal?: AbortSignal,
): Promise<VocabSourceResult> {
  return request<VocabSourceResult>(`/api/vocab-sources/${sourceId}`, { signal });
}

/**
 * Polls until the page has been read, or gives up.
 *
 * Fixed interval rather than backoff: extraction takes a fairly predictable
 * tens of seconds, and the user is watching a spinner the whole time, so a
 * widening gap would only add latency to the moment that actually matters.
 *
 * The default window is deliberately longer than the server's own
 * `VISION_TIMEOUT_SECONDS` (120s). If it were shorter, a slow extraction would
 * show the user a failure and *then* quietly succeed — the row would reach
 * `processed` with nobody watching. Giving up after the server already has
 * means the only thing this can time out on is a server that never answered.
 */
export async function pollVocabSource(
  sourceId: number,
  { intervalMs = 2000, timeoutMs = 300_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<VocabSourceResult> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await fetchVocabSource(sourceId);
    if (result.status !== 'pending') return result;

    if (Date.now() >= deadline) {
      throw new ApiError('The page is taking longer than expected to read', 504);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Commits the rows the user kept after reviewing the OCR result. */
export function confirmVocabImport(
  sourceId: number,
  items: DetectedItem[],
): Promise<VocabItem[]> {
  return request<VocabItem[]>(`/api/vocab-sources/${sourceId}/confirm`, {
    method: 'POST',
    body: { items },
  });
}

/* -------------------------------------------------------------------------- */
/* Sets                                                                        */
/* -------------------------------------------------------------------------- */

export function fetchVocabSets(signal?: AbortSignal): Promise<VocabSet[]> {
  return request<VocabSet[]>('/api/vocab-sets', { signal });
}

export function createVocabSet(name: string, description?: string): Promise<VocabSet> {
  return request<VocabSet>('/api/vocab-sets', {
    method: 'POST',
    body: { name, description: description ?? null },
  });
}

/**
 * The words in one set.
 *
 * Words, not cards: a word is one row here and two `srs_state` rows, so a deck
 * browser asks for this and a study session asks `fetchDueFlashcards`. Browsing
 * a set deliberately shows everything in it, including what is not due — that
 * is the difference between reading a deck and being quizzed on it.
 */
export function fetchVocabSetItems(setId: number, signal?: AbortSignal): Promise<VocabItem[]> {
  return request<VocabItem[]>(`/api/vocab-sets/${setId}/items`, { signal });
}

/**
 * Uploads several pages into one set, one after another.
 *
 * Sequential rather than parallel on purpose: each page is a vision call, and
 * firing five at once neither finishes sooner nor fails more clearly. Waiting
 * for each also means `onProgress` can say "page 2 of 5" truthfully.
 */
export async function importPagesIntoSet(
  setId: number,
  imageUris: string[],
  jlptLevel: number | null,
  onProgress?: (done: number, total: number) => void,
): Promise<VocabSourceResult[]> {
  const results: VocabSourceResult[] = [];

  for (const [index, uri] of imageUris.entries()) {
    const accepted = await uploadVocabPhoto(uri, jlptLevel, {
      setId,
      position: index,
    });
    results.push(await pollVocabSource(accepted.sourceId));
    onProgress?.(index + 1, imageUris.length);
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/* Studying imported vocabulary                                                */
/* -------------------------------------------------------------------------- */

/** Imported vocabulary due now. Never WaniKani items — those are a separate queue. */
export function fetchDueFlashcards(
  limit = 100,
  signal?: AbortSignal,
): Promise<Flashcard[]> {
  return request<Flashcard[]>(`/api/flashcards/due?limit=${limit}`, { signal });
}

/**
 * Submits one answered card.
 *
 * Send `answerGiven` and the server grades it; send `correct` for a card the
 * user graded themselves. The card already carries `acceptedAnswers` so the UI
 * can show a result instantly, but the server's grading is what gets written.
 */
export function answerFlashcard(
  srsStateId: number,
  answer: { answerGiven?: string; correct?: boolean; grade?: number },
): Promise<FlashcardOutcome> {
  return request<FlashcardOutcome>(`/api/flashcards/${srsStateId}/answer`, {
    method: 'POST',
    body: answer,
  });
}

/**
 * Pulls the next pregenerated bundle. Bundles are generated 3–5 at a time so
 * there is always something to study offline; the bundle is the offline unit,
 * not the individual question.
 */
export function fetchLessonBundle(signal?: AbortSignal): Promise<LessonBundle | null> {
  return request<LessonBundle | null>('/api/lesson-bundles/next', { signal });
}

/* -------------------------------------------------------------------------- */
/* Grammar                                                                     */
/* -------------------------------------------------------------------------- */

export interface GrammarEntryInput {
  pattern: string;
  /** The day it goes on the calendar, YYYY-MM-DD, chosen by the device. */
  learnedOn: string;
  senseLabel?: string;
  source?: string | null;
  note?: string | null;
  examples?: GrammarExampleInput[];
}

/**
 * Log a grammar point.
 *
 * The pattern and a date are all this needs — `～てからでないと` is enough for a
 * model to know the point, and everything else is either your own context or
 * enrichment output. Re-logging one you already have reopens it rather than
 * adding a second calendar mark.
 */
export function createGrammarEntry(entry: GrammarEntryInput): Promise<GrammarEntry> {
  return request<GrammarEntry>('/api/grammar-entries', { method: 'POST', body: entry });
}

/** Points logged, newest first. The window is what a calendar month asks for. */
export function fetchGrammarEntries(
  range: { since?: string; until?: string } = {},
  signal?: AbortSignal,
): Promise<GrammarEntry[]> {
  const query = new URLSearchParams();
  if (range.since) query.set('since', range.since);
  if (range.until) query.set('until', range.until);
  const suffix = query.toString() ? `?${query}` : '';
  return request<GrammarEntry[]>(`/api/grammar-entries${suffix}`, { signal });
}

export function fetchGrammarEntry(
  entryId: number,
  signal?: AbortSignal,
): Promise<GrammarEntry> {
  return request<GrammarEntry>(`/api/grammar-entries/${entryId}`, { signal });
}

/**
 * Correct an entry, or accept what enrichment produced.
 *
 * PATCH, so absent fields stay as they are: confirming an enrichment and fixing
 * a typo are the same call, and neither has to echo back the whole row.
 * `examples` is the exception — sending it replaces the list, which is how a
 * sentence gets deleted.
 */
export function updateGrammarEntry(
  entryId: number,
  changes: Partial<{
    senseLabel: string;
    meaning: string | null;
    formation: string | null;
    style: string | null;
    jlptLevel: number | null;
    source: string | null;
    note: string | null;
    learnedOn: string;
    enriched: boolean;
    examples: GrammarExampleInput[];
  }>,
): Promise<GrammarEntry> {
  return request<GrammarEntry>(`/api/grammar-entries/${entryId}`, {
    method: 'PATCH',
    body: changes,
  });
}

export function deleteGrammarEntry(entryId: number): Promise<void> {
  return request<void>(`/api/grammar-entries/${entryId}`, { method: 'DELETE' });
}

/**
 * Ask a model to fill the entry in, for you to check.
 *
 * Writes the meaning, formation, register, level and examples onto the row and
 * leaves `enriched` false — accepting them is `updateGrammarEntry(id, {enriched:
 * true})`. Two answers write nothing and come back as questions instead: an
 * unrecognised pattern (likely a typo) and one with several senses where none
 * was named. Check `applied` before showing the entry as an answer.
 *
 * Longer than the default timeout because the request is held open rather than
 * polled: the server bounds it at `grammar_timeout_seconds`.
 */
export function enrichGrammarEntry(entryId: number): Promise<GrammarEnrichment> {
  return request<GrammarEnrichment>(`/api/grammar-entries/${entryId}/enrich`, {
    method: 'POST',
    timeoutMs: 75_000,
  });
}

/**
 * What happened on each day — the calendar's source.
 *
 * Richer than the streak on purpose. The streak needs one bit per day and takes
 * it from answered cards; this also carries the days you only logged grammar,
 * which show on the calendar without counting.
 */
export function fetchActivity(
  since?: string,
  signal?: AbortSignal,
): Promise<DayActivitySummary[]> {
  const query = new URLSearchParams();
  if (since) query.set('since', since);
  const tz = deviceTimeZone();
  if (tz) query.set('tz', tz);
  const suffix = query.toString() ? `?${query}` : '';
  return request<DayActivitySummary[]>(`/api/activity${suffix}`, { signal });
}
