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
  DetectedItem,
  LessonBundle,
  ReviewAnswer,
  Subject,
  VocabItem,
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

/** Everything the dashboard needs, precomputed server-side from Postgres. */
export function fetchDashboard(signal?: AbortSignal): Promise<DashboardSummary> {
  return request<DashboardSummary>('/api/dashboard', { signal });
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

/**
 * Hands a textbook photo to the vision-ingestion service, which returns the
 * three textbook columns kept separate rather than one blob of raw text.
 */
export async function uploadVocabPhoto(
  imageUri: string,
  jlptLevel: number | null,
): Promise<{ sourceId: number; items: DetectedItem[] }> {
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

  const response = await fetch(`${API_BASE_URL}/api/vocab-sources`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new ApiError(`Photo import failed with ${response.status}`, response.status);
  }
  return (await response.json()) as { sourceId: number; items: DetectedItem[] };
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

/**
 * Pulls the next pregenerated bundle. Bundles are generated 3–5 at a time so
 * there is always something to study offline; the bundle is the offline unit,
 * not the individual question.
 */
export function fetchLessonBundle(signal?: AbortSignal): Promise<LessonBundle | null> {
  return request<LessonBundle | null>('/api/lesson-bundles/next', { signal });
}
