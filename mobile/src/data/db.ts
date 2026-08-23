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
}

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
            mnemonics_json, components_json, amalgamations_json, jlpt_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           jlpt_level = excluded.jlpt_level`,
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
 * The lesson backlog: unlocked but never started. There is no separate
 * "backlog" concept to maintain — this query *is* the backlog, and the user
 * can work through it offline until it runs dry.
 */
export async function getLessonQueue(limit = 50): Promise<Assignment[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<AssignmentRow>(
    `SELECT * FROM local_assignments
      WHERE started_at IS NULL AND unlocked_at IS NOT NULL
      ORDER BY unlocked_at ASC
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

export async function getAssignmentForSubject(subjectId: number): Promise<Assignment | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AssignmentRow>(
    'SELECT * FROM local_assignments WHERE subject_id = ?',
    subjectId,
  );
  return row ? toAssignment(row) : null;
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
  }>('SELECT * FROM pending_writes WHERE synced_at IS NULL ORDER BY created_at ASC, id ASC');

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

export async function countPendingWrites(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM pending_writes WHERE synced_at IS NULL',
  );
  return row?.n ?? 0;
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
