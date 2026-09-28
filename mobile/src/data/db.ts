/**
 * On-device mirror.
 *
 * This is not just a write queue — it holds a full copy of the subjects and
 * assignments the user might touch, so a whole lesson or review session runs
 * with zero connectivity. The only thing that genuinely needs a live
 * connection is submitting the result, and that goes through `pending_writes`.
 *
 * Schema follows the SQLite layout in the design notes. Meanings, readings and
 * mnemonics collapse into JSON blobs rather than normalised child tables:
 * on-device there are no cross-user queries to serve, so one row per subject
 * is simpler to read and write.
 */
import * as SQLite from 'expo-sqlite';

import type {
  Assignment,
  PendingWrite,
  PendingWriteType,
  Subject,
  SubjectType,
} from './types';

const DATABASE_NAME = 'kanji-workshop.db';

let database: SQLite.SQLiteDatabase | null = null;

/** Opens (once) and migrates the local database. */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;

  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await migrate(db);
  database = db;
  return db;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS local_subjects (
      subject_id     INTEGER PRIMARY KEY NOT NULL,
      type           TEXT    NOT NULL,
      character      TEXT,
      level          INTEGER NOT NULL,
      slug           TEXT    NOT NULL DEFAULT '',
      meanings_json  TEXT    NOT NULL DEFAULT '[]',
      readings_json  TEXT    NOT NULL DEFAULT '[]',
      mnemonics_json TEXT    NOT NULL DEFAULT '{}',
      components_json    TEXT NOT NULL DEFAULT '[]',
      amalgamations_json TEXT NOT NULL DEFAULT '[]',
      jlpt_level     INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_local_subjects_level ON local_subjects (level);
    CREATE INDEX IF NOT EXISTS idx_local_subjects_type  ON local_subjects (type);

    CREATE TABLE IF NOT EXISTS local_assignments (
      subject_id   INTEGER PRIMARY KEY NOT NULL,
      assignment_id INTEGER NOT NULL,
      subject_type TEXT    NOT NULL,
      srs_stage    INTEGER NOT NULL DEFAULT 0,
      unlocked_at  TEXT,
      started_at   TEXT,
      passed_at    TEXT,
      available_at TEXT,
      burned_at    TEXT,
      synced_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_local_assignments_available
      ON local_assignments (available_at);

    -- Local-only outbox. Has no equivalent server-side, which only ever
    -- represents confirmed state.
    CREATE TABLE IF NOT EXISTS pending_writes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      synced_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );

    -- Deliberately not sync_meta: that table is cached server state and
    -- resetLocalData clears it. A preference is the user's, not the server's
    -- — clearing the cache should not silently un-mute the app.
    CREATE TABLE IF NOT EXISTS app_prefs (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );

    -- Part 2: photo-imported vocabulary and its own SM-2 scheduling.
    CREATE TABLE IF NOT EXISTS vocab_items (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      source              TEXT    NOT NULL,
      wanikani_subject_id INTEGER,
      kanji_furigana      TEXT    NOT NULL,
      furigana_only       TEXT    NOT NULL DEFAULT '',
      english             TEXT    NOT NULL DEFAULT '',
      source_image_id     INTEGER,
      is_user_edited      INTEGER NOT NULL DEFAULT 0,
      jlpt_level          INTEGER,
      updated_at          TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vocab_sources (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      image_uri   TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      jlpt_level  INTEGER,
      label       TEXT
    );

    -- SM-2 state, for everything WaniKani does not schedule for us.
    CREATE TABLE IF NOT EXISTS srs_state (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vocab_item_id INTEGER NOT NULL,
      skill_type    TEXT    NOT NULL,
      ease_factor   REAL    NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 0,
      repetitions   INTEGER NOT NULL DEFAULT 0,
      due_at        TEXT,
      UNIQUE (vocab_item_id, skill_type)
    );
  `);

  await upgrade(db);
}

/**
 * Numbered steps on top of the base schema, tracked in `PRAGMA user_version`.
 * The base above only ever creates tables that do not exist, so a column added
 * to an existing table has to arrive here, where it runs exactly once.
 */
async function upgrade(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  if (version < 1) {
    // Everything WaniKani sends beyond the core fields: hints, context
    // sentences, parts of speech, audio, similar kanji, auxiliary meanings.
    // One JSON column rather than six, because the screens read them together
    // and nothing queries inside them.
    //
    // Subjects already mirrored have none of it, and the incremental sync only
    // refetches subjects whose assignments changed -- so the sync cursor is
    // dropped too, and the next sync pulls every assignment and its subject
    // once, filling the new column.
    await db.execAsync(`
      ALTER TABLE local_subjects ADD COLUMN extras_json TEXT NOT NULL DEFAULT '{}';
      DELETE FROM sync_meta WHERE key = '${SYNC_KEY_LAST_SYNCED}';
      PRAGMA user_version = 1;
    `);
  }

  if (version < 2) {
    // A write the server refused outright -- WaniKani saying a lesson was
    // already started -- used to stay queued forever, retried first on every
    // sync, with every answer queued after it stuck behind it. It is now set
    // aside with the reason, and the queue moves on.
    await db.execAsync(`
      ALTER TABLE pending_writes ADD COLUMN failed_at TEXT;
      ALTER TABLE pending_writes ADD COLUMN last_error TEXT;
      PRAGMA user_version = 2;
    `);
  }
}

/* -------------------------------------------------------------------------- */
/* Row mapping                                                                 */
/* -------------------------------------------------------------------------- */

interface SubjectRow {
  subject_id: number;
  type: string;
  character: string | null;
  level: number;
  slug: string;
  meanings_json: string;
  readings_json: string;
  mnemonics_json: string;
  components_json: string;
  amalgamations_json: string;
  jlpt_level: number | null;
  extras_json: string;
}

/** What lives in `extras_json`. */
type SubjectExtras = Pick<
  Subject,
  | 'meaningHint'
  | 'readingHint'
  | 'contextSentences'
  | 'partsOfSpeech'
  | 'pronunciationAudios'
  | 'visuallySimilarSubjectIds'
  | 'auxiliaryMeanings'
>;

/** Tolerates a malformed blob rather than taking the whole screen down. */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSubject(row: SubjectRow): Subject {
  const mnemonics = parseJson<{ meaning?: string; reading?: string }>(row.mnemonics_json, {});
  const extras = parseJson<SubjectExtras>(row.extras_json ?? '{}', {});
  return {
    id: row.subject_id,
    type: row.type as SubjectType,
    characters: row.character,
    level: row.level,
    slug: row.slug,
    meanings: parseJson(row.meanings_json, []),
    readings: parseJson(row.readings_json, []),
    meaningMnemonic: mnemonics.meaning ?? null,
    readingMnemonic: mnemonics.reading ?? null,
    componentSubjectIds: parseJson(row.components_json, []),
    amalgamationSubjectIds: parseJson(row.amalgamations_json, []),
    jlptLevel: row.jlpt_level,
    meaningHint: extras.meaningHint ?? null,
    readingHint: extras.readingHint ?? null,
    contextSentences: extras.contextSentences ?? [],
    partsOfSpeech: extras.partsOfSpeech ?? [],
    pronunciationAudios: extras.pronunciationAudios ?? [],
    visuallySimilarSubjectIds: extras.visuallySimilarSubjectIds ?? [],
    auxiliaryMeanings: extras.auxiliaryMeanings ?? [],
  };
}

interface AssignmentRow {
  subject_id: number;
  assignment_id: number;
  subject_type: string;
  srs_stage: number;
  unlocked_at: string | null;
  started_at: string | null;
  passed_at: string | null;
  available_at: string | null;
  burned_at: string | null;
}

function toAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.assignment_id,
    subjectId: row.subject_id,
    subjectType: row.subject_type as SubjectType,
    srsStage: row.srs_stage,
    unlockedAt: row.unlocked_at,
    startedAt: row.started_at,
    passedAt: row.passed_at,
    availableAt: row.available_at,
    burnedAt: row.burned_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Subjects                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Upserts a batch of subjects. Content basically never changes, so this runs
 * once on first sync and then only for newly unlocked levels.
 */
export async function upsertSubjects(subjects: Subject[]): Promise<void> {
  if (subjects.length === 0) return;
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    for (const subject of subjects) {
      await db.runAsync(
        `INSERT INTO local_subjects
           (subject_id, type, character, level, slug, meanings_json, readings_json,
            mnemonics_json, components_json, amalgamations_json, jlpt_level, extras_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(subject_id) DO UPDATE SET
           type = excluded.type,
           character = excluded.character,
           level = excluded.level,
           slug = excluded.slug,
           meanings_json = excluded.meanings_json,
           readings_json = excluded.readings_json,
           mnemonics_json = excluded.mnemonics_json,
           components_json = excluded.components_json,
           amalgamations_json = excluded.amalgamations_json,
           jlpt_level = excluded.jlpt_level,
           extras_json = excluded.extras_json`,
        subject.id,
        subject.type,
        subject.characters,
        subject.level,
        subject.slug,
        JSON.stringify(subject.meanings),
        JSON.stringify(subject.readings),
        JSON.stringify({
          meaning: subject.meaningMnemonic ?? null,
          reading: subject.readingMnemonic ?? null,
        }),
        JSON.stringify(subject.componentSubjectIds),
        JSON.stringify(subject.amalgamationSubjectIds),
        subject.jlptLevel ?? null,
        JSON.stringify({
          meaningHint: subject.meaningHint ?? null,
          readingHint: subject.readingHint ?? null,
          contextSentences: subject.contextSentences ?? [],
          partsOfSpeech: subject.partsOfSpeech ?? [],
          pronunciationAudios: subject.pronunciationAudios ?? [],
          visuallySimilarSubjectIds: subject.visuallySimilarSubjectIds ?? [],
          auxiliaryMeanings: subject.auxiliaryMeanings ?? [],
        } satisfies SubjectExtras),
      );
    }
  });
}

export async function getSubject(subjectId: number): Promise<Subject | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<SubjectRow>(
    'SELECT * FROM local_subjects WHERE subject_id = ?',
    subjectId,
  );
  return row ? toSubject(row) : null;
}

export async function getSubjectsByIds(ids: number[]): Promise<Subject[]> {
  if (ids.length === 0) return [];
  const db = await getDatabase();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<SubjectRow>(
    `SELECT * FROM local_subjects WHERE subject_id IN (${placeholders})`,
    ...ids,
  );
  return rows.map(toSubject);
}

export async function getSubjectsByLevel(level: number): Promise<Subject[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<SubjectRow>(
    'SELECT * FROM local_subjects WHERE level = ? ORDER BY type, subject_id',
    level,
  );
  return rows.map(toSubject);
}

/* -------------------------------------------------------------------------- */
/* Assignments                                                                 */
/* -------------------------------------------------------------------------- */

export async function upsertAssignments(assignments: Assignment[]): Promise<void> {
  if (assignments.length === 0) return;
  const db = await getDatabase();
  const syncedAt = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const a of assignments) {
      await db.runAsync(
        `INSERT INTO local_assignments
           (subject_id, assignment_id, subject_type, srs_stage, unlocked_at,
            started_at, passed_at, available_at, burned_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(subject_id) DO UPDATE SET
           assignment_id = excluded.assignment_id,
           subject_type = excluded.subject_type,
           srs_stage = excluded.srs_stage,
           unlocked_at = excluded.unlocked_at,
           started_at = excluded.started_at,
           passed_at = excluded.passed_at,
           available_at = excluded.available_at,
           burned_at = excluded.burned_at,
           synced_at = excluded.synced_at`,
        a.subjectId,
        a.id,
        a.subjectType,
        a.srsStage,
        a.unlockedAt,
        a.startedAt,
        a.passedAt,
        a.availableAt,
        a.burnedAt,
        syncedAt,
      );
    }
  });
}

/**
 * Replaces the whole copy with a full pull. Rows WaniKani no longer sends are
 * dropped, and every row is rewritten -- the only way a copy kept by diffs
 * recovers from a change it missed.
 */
export async function replaceAssignments(assignments: Assignment[]): Promise<void> {
  if (assignments.length === 0) return;
  // Every row this pull writes is stamped at or after `before`; anything older
  // was not in it. By timestamp rather than an id list, which a level-60
  // account would push past SQLite's limit on bound parameters.
  const before = new Date().toISOString();
  await upsertAssignments(assignments);
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM local_assignments WHERE synced_at IS NULL OR synced_at < ?',
    before,
  );
}

/** Subject ids with no content on the phone yet -- what a sync has to fetch. */
export async function missingSubjectIds(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ subject_id: number }>('SELECT subject_id FROM local_subjects');
  const have = new Set(rows.map((row) => row.subject_id));
  return ids.filter((id) => !have.has(id));
}

/**
 * A lesson just finished: out of the lesson queue now, rather than after the
 * next sync. Stage 1's first review is four hours out; the sync replaces this
 * guess with WaniKani's own answer.
 */
export async function markLessonStarted(subjectId: number): Promise<void> {
  const db = await getDatabase();
  const now = new Date();
  await db.runAsync(
    `UPDATE local_assignments
        SET started_at = ?, srs_stage = CASE WHEN srs_stage = 0 THEN 1 ELSE srs_stage END,
            available_at = ?
      WHERE subject_id = ?`,
    now.toISOString(),
    new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    subjectId,
  );
}

/**
 * A review just finished: out of the review queue now. When it comes back
 * depends on WaniKani's verdict, which the sync brings; until then it is simply
 * not due.
 */
export async function markReviewAnswered(subjectId: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE local_assignments SET available_at = ? WHERE subject_id = ?',
    new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    subjectId,
  );
}

/**
 * The lesson backlog: unlocked but never started, in the order WaniKani
 * teaches it -- by level, then radicals, kanji, vocabulary -- so a kanji's
 * parts come before the kanji and the kanji before its words.
 */
export async function getLessonQueue(limit = 50): Promise<Assignment[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<AssignmentRow>(
    `SELECT a.* FROM local_assignments a
       LEFT JOIN local_subjects s ON s.subject_id = a.subject_id
      WHERE a.started_at IS NULL AND a.unlocked_at IS NOT NULL
      ORDER BY COALESCE(s.level, 999) ASC,
               CASE a.subject_type WHEN 'radical' THEN 0 WHEN 'kanji' THEN 1 ELSE 2 END ASC,
               a.subject_id ASC
      LIMIT ?`,
    limit,
  );
  return rows.map(toAssignment);
}

/** Items whose `available_at` has already passed. */
export async function getReviewQueue(limit = 100): Promise<Assignment[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<AssignmentRow>(
    `SELECT * FROM local_assignments
      WHERE available_at IS NOT NULL AND available_at <= ?
      ORDER BY available_at ASC
      LIMIT ?`,
    new Date().toISOString(),
    limit,
  );
  return rows.map(toAssignment);
}

/**
 * When the next review lands and how many arrive with it.
 *
 * "How many" means how many share that exact timestamp, not how many are due
 * eventually — WaniKani releases a whole batch at once, and the summary's
 * "N reviews in 4h" is a promise about that batch.
 */
export async function getNextReview(): Promise<{ at: string | null; count: number }> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const row = await db.getFirstAsync<{ at: string | null }>(
    `SELECT MIN(available_at) AS at FROM local_assignments WHERE available_at > ?`,
    now,
  );
  if (!row?.at) return { at: null, count: 0 };

  const tally = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM local_assignments WHERE available_at = ?',
    row.at,
  );
  return { at: row.at, count: tally?.n ?? 0 };
}

export async function getAssignmentForSubject(subjectId: number): Promise<Assignment | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AssignmentRow>(
    'SELECT * FROM local_assignments WHERE subject_id = ?',
    subjectId,
  );
  return row ? toAssignment(row) : null;
}

/**
 * Assignments for a batch of subjects, keyed by subject id. One query rather
 * than one per tile: the level browser asks about every subject on the level
 * at once, and a missing key is meaningful — it means not yet unlocked.
 */
export async function getAssignmentsForSubjects(
  subjectIds: number[],
): Promise<Map<number, Assignment>> {
  if (subjectIds.length === 0) return new Map();
  const db = await getDatabase();
  const placeholders = subjectIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<AssignmentRow>(
    `SELECT * FROM local_assignments WHERE subject_id IN (${placeholders})`,
    ...subjectIds,
  );
  return new Map(rows.map((row) => [row.subject_id, toAssignment(row)]));
}

/** Counts per display bucket, for the dashboard's item-spread chart. */
export async function getStageSpread(): Promise<number[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ srs_stage: number; n: number }>(
    `SELECT srs_stage, COUNT(*) AS n FROM local_assignments
      WHERE started_at IS NOT NULL
      GROUP BY srs_stage`,
  );
  const spread = [0, 0, 0, 0, 0];
  for (const { srs_stage, n } of rows) {
    const bucket = srs_stage <= 2 ? 0 : srs_stage <= 4 ? 1 : srs_stage <= 6 ? 2 : srs_stage <= 8 ? 3 : 4;
    spread[bucket] += n;
  }
  return spread;
}

/* -------------------------------------------------------------------------- */
/* Outbox                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Queues a write for replay. Called whether or not the device is online — the
 * sync pass drains the queue immediately when there is a connection, so the
 * offline and online paths stay identical.
 */
export async function enqueueWrite(type: PendingWriteType, payload: unknown): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    'INSERT INTO pending_writes (type, payload_json, created_at) VALUES (?, ?, ?)',
    type,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
  return result.lastInsertRowId;
}

/**
 * Unsynced writes, oldest first. Order matters: several reviews of the same
 * item have to land in the sequence the user actually answered them.
 */
export async function getPendingWrites(): Promise<PendingWrite[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: number;
    type: string;
    payload_json: string;
    created_at: string;
    synced_at: string | null;
  }>(
    'SELECT * FROM pending_writes WHERE synced_at IS NULL AND failed_at IS NULL ORDER BY created_at ASC, id ASC',
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.type as PendingWriteType,
    payload: row.payload_json,
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  }));
}

/**
 * Marks a write confirmed. Rows are stamped rather than deleted, so a retry
 * that races a slow response cannot double-submit.
 */
export async function markWriteSynced(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE pending_writes SET synced_at = ? WHERE id = ?',
    new Date().toISOString(),
    id,
  );
}

/**
 * Sets aside a write the server refused for good. Kept rather than deleted, so
 * what was refused and why stays on the phone to look at.
 */
export async function markWriteFailed(id: number, reason: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE pending_writes SET failed_at = ?, last_error = ? WHERE id = ?',
    new Date().toISOString(),
    reason.slice(0, 500),
    id,
  );
}

export async function countPendingWrites(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM pending_writes WHERE synced_at IS NULL AND failed_at IS NULL',
  );
  return row?.n ?? 0;
}

/**
 * Flashcard answers typed on this phone that have not reached the server yet,
 * by card. Until they do, the server still counts those cards as due; the quiz
 * grades these against each card to leave out the ones already got right, so
 * coming back picks up where you left off even before the outbox has drained.
 */
export interface PendingFlashcardAnswer {
  answerGiven: string;
  /** Set for a flipped card, which is self-graded rather than typed. */
  correct: boolean | null;
  setId: number | null;
}

export async function getPendingFlashcardAnswers(): Promise<
  Map<number, PendingFlashcardAnswer[]>
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM pending_writes WHERE type = 'answer_flashcard' AND synced_at IS NULL AND failed_at IS NULL",
  );
  const byCard = new Map<number, PendingFlashcardAnswer[]>();
  for (const row of rows) {
    try {
      const { srsStateId, answerGiven, setId, correct } = JSON.parse(row.payload_json) as {
        srsStateId?: number;
        answerGiven?: string;
        setId?: number;
        correct?: boolean;
      };
      if (typeof srsStateId !== 'number') continue;
      byCard.set(srsStateId, [
        ...(byCard.get(srsStateId) ?? []),
        {
          answerGiven: answerGiven ?? '',
          correct: typeof correct === 'boolean' ? correct : null,
          setId: typeof setId === 'number' ? setId : null,
        },
      ]);
    } catch {
      // A malformed row is the outbox's problem, not the quiz's.
    }
  }
  return byCard;
}

/* -------------------------------------------------------------------------- */
/* Sync metadata                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `last_synced_at` does double duty — it is the "Synced 4 minutes ago" line in
 * the UI *and* the `updated_after` cursor for the next poll, so freshness
 * display and incremental sync share one source of truth.
 */
export async function getSyncMeta(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM sync_meta WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

export const SYNC_KEY_LAST_SYNCED = 'last_synced_at';

/* -------------------------------------------------------------------------- */

/** User preferences. Survives `resetLocalData` — see the table comment. */
export async function getPref(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM app_prefs WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setPref(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO app_prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

/** Drops everything local. Used by "reset local cache" in settings. */
export async function resetLocalData(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM local_subjects;
    DELETE FROM local_assignments;
    DELETE FROM pending_writes;
    DELETE FROM sync_meta;
  `);
}
