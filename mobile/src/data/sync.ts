/**
 * Sync pass.
 *
 * Two triggers, deliberately kept apart:
 *
 *   1. A user action — finishing a lesson, answering a review — writes to the
 *      outbox and then tries to drain it immediately. Online and offline take
 *      the same code path; only the drain succeeds or doesn't.
 *   2. This pass, which catches up on state the app did not cause: new lessons
 *      unlocking on level-up, studying done on wanikani.com, resets. WaniKani
 *      has no webhooks, so it is poll-only.
 *
 * Cadence is pull-to-refresh on app open, since that is when staleness
 * actually matters, with a slow safety-net poll layered on top.
 */
import NetInfo from '@react-native-community/netinfo';

import * as api from './api';
import {
  SYNC_KEY_LAST_SYNCED,
  countPendingWrites,
  getPendingWrites,
  getSyncMeta,
  markWriteFailed,
  markWriteSynced,
  setSyncMeta,
  upsertAssignments,
  upsertSubjects,
} from './db';
import type { FlashcardAnswerWrite, PendingWrite, ReviewAnswer } from './types';

/** How often the safety-net poll runs. Level-ups don't happen faster. */
export const SAFETY_NET_POLL_MS = 20 * 60 * 1000;

export interface SyncResult {
  ok: boolean;
  assignmentsUpdated: number;
  writesReplayed: number;
  pendingWrites: number;
  lastSyncedAt: string | null;
  error?: string;
}

export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  // `isInternetReachable` is null while the probe is still in flight; treat
  // that as connected rather than blocking a sync that would have worked.
  return Boolean(state.isConnected) && state.isInternetReachable !== false;
}

/**
 * What a write is about. Order only matters between writes about the same
 * thing -- two reviews of one assignment, two answers to one card -- so a
 * write that has to wait holds back only the writes that share its key.
 */
function writeKey(type: PendingWrite['type'], payload: Record<string, unknown>): string {
  switch (type) {
    case 'start_assignment':
      return `assignment:${String(payload.assignmentId)}`;
    case 'submit_review':
      return `assignment:${String(payload.assignmentId)}`;
    case 'answer_flashcard':
      return `card:${String(payload.srsStateId)}`;
    default:
      return `unknown:${String(type)}`;
  }
}

/**
 * A refusal that retrying will never change: the server understood the
 * request and said no -- WaniKani reporting a lesson already started, a card
 * that no longer exists. 401 is not one of them (a key can be fixed), nor are
 * 408 and 429 (a later try can succeed).
 */
function isPermanent(error: unknown): error is api.ApiError {
  return (
    error instanceof api.ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 408, 429].includes(error.status)
  );
}

/**
 * Replays the outbox oldest-first. A row is stamped synced only once the
 * server confirms it -- nothing is deleted optimistically.
 *
 * A failure no longer stops everything behind it. A write the server refuses
 * for good is set aside; one that may succeed later holds back only the
 * writes about the same item, so a WaniKani hiccup cannot strand a session's
 * worth of flashcard answers. A lost connection or a refused API key still
 * stops the run, since every write after it would fail the same way.
 */
export async function replayPendingWrites(): Promise<number> {
  const pending = await getPendingWrites();
  const blocked = new Set<string>();
  let replayed = 0;

  for (const write of pending) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(write.payload) as Record<string, unknown>;
    } catch {
      await markWriteFailed(write.id, 'Unreadable payload');
      continue;
    }

    const key = writeKey(write.type, payload);
    if (blocked.has(key)) continue;

    try {
      // Switched exhaustively rather than if/else: an unrecognised type must
      // not fall through into whichever branch happens to be last, which would
      // post one kind of answer to another kind of endpoint.
      switch (write.type) {
        case 'start_assignment':
          await api.startAssignment(payload.assignmentId as number);
          break;
        case 'submit_review':
          await api.submitReview(payload as unknown as ReviewAnswer);
          break;
        case 'answer_flashcard': {
          const answer = payload as unknown as FlashcardAnswerWrite;
          await api.answerFlashcard(answer.srsStateId, {
            answerGiven: answer.answerGiven,
            correct: answer.correct,
            setId: answer.setId,
          });
          break;
        }
        default: {
          // A row written by a newer build than this one. Dropping it silently
          // would lose an answer, so leave it queued and skip past it.
          const unknownType: never = write.type;
          throw new Error(`Unknown pending write type: ${String(unknownType)}`);
        }
      }

      await markWriteSynced(write.id);
      replayed += 1;
    } catch (error) {
      if (isPermanent(error)) {
        console.warn(`[sync] server refused ${write.type} (${error.status}); set aside`);
        await markWriteFailed(write.id, `${error.status}: ${error.message}`);
        continue;
      }
      if (!(error instanceof api.ApiError) || error.status === 401) break;
      // Worth another try later; keep this item's later writes behind it.
      blocked.add(key);
    }
  }

  return replayed;
}

let inFlight: Promise<SyncResult> | null = null;
let queued: Promise<SyncResult> | null = null;

/**
 * One sync at a time. Two overlapping replays would each read the same unsent
 * rows and post them both -- an answer charged twice -- and syncs start from
 * several places at once: launch, returning to the app, every answer.
 *
 * A call made while one is running gets one more run after it, shared by
 * everyone who asks in the meantime: the running pass may already have read
 * the outbox, and an answer queued since would otherwise wait for the next
 * sync to leave the phone.
 */
export function syncNow(): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = runSync().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }
  queued ??= inFlight
    .catch(() => undefined)
    .then(() => {
      queued = null;
      return syncNow();
    });
  return queued;
}

/**
 * Full pass: drain the outbox, then pull anything that changed upstream.
 *
 * The outbox goes first so the incoming assignment diff already reflects the
 * user's own answers, rather than overwriting them with stale server state.
 */
async function runSync(): Promise<SyncResult> {
  const lastSyncedAt = await getSyncMeta(SYNC_KEY_LAST_SYNCED);

  if (!api.isBackendConfigured) {
    return {
      ok: false,
      assignmentsUpdated: 0,
      writesReplayed: 0,
      pendingWrites: await countPendingWrites(),
      lastSyncedAt,
      error: 'No API server configured',
    };
  }

  if (!(await isOnline())) {
    return {
      ok: false,
      assignmentsUpdated: 0,
      writesReplayed: 0,
      pendingWrites: await countPendingWrites(),
      lastSyncedAt,
      error: 'Offline',
    };
  }

  try {
    const writesReplayed = await replayPendingWrites();

    // `updated_after` keeps this a cheap incremental diff.
    const assignments = await api.fetchAssignments(lastSyncedAt);
    await upsertAssignments(assignments);

    // Pull content for anything newly unlocked that we have no subject row for.
    const newSubjectIds = assignments.map((a) => a.subjectId);
    if (newSubjectIds.length > 0) {
      const subjects = await api.fetchSubjects(newSubjectIds);
      await upsertSubjects(subjects);
    }

    const syncedAt = new Date().toISOString();
    await setSyncMeta(SYNC_KEY_LAST_SYNCED, syncedAt);

    return {
      ok: true,
      assignmentsUpdated: assignments.length,
      writesReplayed,
      pendingWrites: await countPendingWrites(),
      lastSyncedAt: syncedAt,
    };
  } catch (error) {
    return {
      ok: false,
      assignmentsUpdated: 0,
      writesReplayed: 0,
      pendingWrites: await countPendingWrites(),
      lastSyncedAt,
      error: error instanceof Error ? error.message : 'Sync failed',
    };
  }
}

/**
 * Renders the "Synced 4 minutes ago" line. Returns null when the app has never
 * completed a sync, so the caller can show a first-run state instead.
 */
export function formatSyncedAgo(isoTimestamp: string | null): string | null {
  if (!isoTimestamp) return null;

  const elapsedMs = Date.now() - new Date(isoTimestamp).getTime();
  if (Number.isNaN(elapsedMs)) return null;

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes === 1) return 'Synced 1 minute ago';
  if (minutes < 60) return `Synced ${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'Synced 1 hour ago';
  if (hours < 24) return `Synced ${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'Synced yesterday' : `Synced ${days} days ago`;
}

/**
 * Relative label for a future timestamp, e.g. "in 4 hours" — used for the next
 * review time. While a review is queued but unsynced this is a local guess:
 * the real interval only lands once WaniKani recomputes the SRS stage.
 */
export function formatDueIn(isoTimestamp: string | null): string {
  if (!isoTimestamp) return 'not scheduled';

  const remainingMs = new Date(isoTimestamp).getTime() - Date.now();
  if (Number.isNaN(remainingMs)) return 'not scheduled';
  if (remainingMs <= 0) return 'available now';

  const minutes = Math.round(remainingMs / 60_000);
  if (minutes < 60) return `in ${minutes} minutes`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;

  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
