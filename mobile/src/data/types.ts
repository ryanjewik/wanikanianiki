/**
 * Domain types.
 *
 * These mirror what the backend returns, not what WaniKani returns. The app
 * never talks to WaniKani directly — the token lives on the server, and the
 * server hands back joined, display-ready shapes (an assignment already
 * carries its subject, rather than just a `subject_id` to look up).
 */
import type { SubjectType } from '@/theme/tokens';

export type { SubjectType };

export interface Meaning {
  meaning: string;
  primary: boolean;
  acceptedAnswer: boolean;
}

export type ReadingType = 'onyomi' | 'kunyomi' | 'nanori' | 'vocabulary';

export interface Reading {
  reading: string;
  type: ReadingType;
  primary: boolean;
  acceptedAnswer: boolean;
}

export interface Subject {
  id: number;
  type: SubjectType;
  /** Absent on a handful of radicals that have no Unicode glyph. */
  characters: string | null;
  /** Fallback artwork for those radicals. */
  characterImageUrl?: string | null;
  level: number;
  slug: string;
  meanings: Meaning[];
  readings: Reading[];
  meaningMnemonic?: string | null;
  readingMnemonic?: string | null;
  /** Radicals that build this kanji, or kanji that build this word. */
  componentSubjectIds: number[];
  /** Kanji this radical appears in, or vocabulary using this kanji. */
  amalgamationSubjectIds: number[];
  /** Backfilled once from the kanji-data seed import; null when unknown. */
  jlptLevel?: number | null;
}

export interface Assignment {
  id: number;
  subjectId: number;
  subjectType: SubjectType;
  /** WaniKani's 0–9 scale. 0 is unlocked-but-not-started. */
  srsStage: number;
  unlockedAt: string | null;
  startedAt: string | null;
  passedAt: string | null;
  /** When this next comes up for review. */
  availableAt: string | null;
  burnedAt: string | null;
}

/** An assignment already joined to its subject, ready to render. */
export interface StudyItem {
  assignment: Assignment;
  subject: Subject;
}

export interface ReviewStatistic {
  subjectId: number;
  meaningCorrect: number;
  meaningIncorrect: number;
  readingCorrect: number;
  readingIncorrect: number;
  percentageCorrect: number;
}

export interface LevelProgression {
  level: number;
  unlockedAt: string | null;
  startedAt: string | null;
  passedAt: string | null;
  completedAt: string | null;
}

/** `GET /api/dashboard` — everything the home screen needs in one payload. */
export interface DashboardSummary {
  user: { username: string; level: number };
  lessonCount: number;
  reviewCount: number;
  /** Seven entries, oldest first; the last one is today. */
  streak: { days: number; best: number; week: DayActivity[] };
  levelProgress: {
    level: number;
    radicals: Counted;
    kanji: Counted;
    vocabulary: Counted;
    /** Copy for the "N more kanji to level up" line. */
    kanjiRemainingToLevelUp: number;
    daysAtLevel: number;
  };
  /** Item counts per display stage bucket, five entries. */
  stageSpread: number[];
  lastSyncedAt: string | null;
}

export interface DayActivity {
  /** Short weekday label, or "Today" for the last entry. */
  label: string;
  /** 0 = nothing done, 1 = a full day. Partial days render in the soft tint. */
  intensity: number;
  isToday: boolean;
}

export interface Counted {
  passed: number;
  total: number;
}

/** What a single review answer produced, before it is sent upstream. */
export interface ReviewAnswer {
  assignmentId: number;
  subjectId: number;
  incorrectMeaningAnswers: number;
  incorrectReadingAnswers: number;
  answeredAt: string;
}

export interface SessionSummary {
  durationMinutes: number;
  total: number;
  correct: number;
  incorrect: number;
  percentageCorrect: number;
  streakDays: number;
  /** Bucket-to-bucket movements, e.g. Sprout → Sapling. */
  movements: { from: number; to: number; count: number }[];
  missed: MissedItem[];
  nextReviewAt: string | null;
  nextReviewCount: number;
  pendingSync: number;
}

export interface MissedItem {
  subjectId: number;
  characters: string;
  meaning: string;
  reading: string;
  /** Why it is here: what the user typed, or which half they missed. */
  note: string;
}

/* -------------------------------------------------------------------------- */
/* Part 2 — self-imported vocab and AI-generated practice                      */
/* -------------------------------------------------------------------------- */

export type VocabSource = 'wanikani' | 'ocr_import';

/**
 * The unifying table. WaniKani-sourced and photo-imported vocabulary are
 * first-class equals here; only their SRS scheduling differs.
 */
export interface VocabItem {
  id: number;
  source: VocabSource;
  wanikaniSubjectId: number | null;
  /** e.g. 食べる */
  kanjiFurigana: string;
  /** e.g. たべる */
  furiganaOnly: string;
  english: string;
  sourceImageId: number | null;
  isUserEdited: boolean;
  jlptLevel: number | null;
  updatedAt: string;
}

export type ImportStatus = 'pending' | 'processed' | 'failed';

export interface VocabSourceImage {
  id: number;
  /**
   * Null until the photo is kept somewhere durable. The server buffers the
   * bytes only for the length of the extraction, since the review screen
   * renders the device's own copy of the picture rather than the server's.
   */
  imageUri: string | null;
  uploadedAt: string;
  status: ImportStatus;
  /** Tier the user picked at upload time; cascades to extracted items. */
  jlptLevel: number | null;
  /** Human label for the page, e.g. "Genki II · page 84". */
  label?: string;
}

/** One row in the OCR review list, before the user commits the import. */
export interface DetectedItem {
  key: string;
  kanjiFurigana: string;
  furiganaOnly: string;
  english: string;
  /** The particle the textbook prints the word with — "〜が" for [〜が]苦手な. */
  usageContext: string | null;
  jlptLevel: number | null;
  /**
   * `ok` imports as-is, `ambiguous` needs the user to disambiguate a reading,
   * `duplicate` is already in the deck and is skipped.
   */
  status: 'ok' | 'ambiguous' | 'duplicate';
  selected: boolean;
  /** Populated when status is `ambiguous`, e.g. ['からい', 'つらい']. */
  readingChoices?: string[];
  note?: string;
}

export type StudyMode = 'notecards' | 'quiz' | 'srs';

export type QuestionType =
  | 'multiple_choice'
  | 'fill_in_blank'
  | 'sentence_construction'
  | 'recall';

export interface Question {
  id: number;
  type: QuestionType;
  /** Shape varies by `type`; narrow on it before reading. */
  payload: unknown;
  vocabItemIds: number[];
  grammarTopic: string | null;
  /** The verifier sub-agent must flip this before a question is servable. */
  verified: boolean;
  createdAt: string;
}

export interface LessonBundle {
  id: number;
  questionIds: number[];
  generatedAt: string;
  consumed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Offline outbox                                                              */
/* -------------------------------------------------------------------------- */

export type PendingWriteType = 'start_assignment' | 'submit_review';

export interface PendingWrite {
  id: number;
  type: PendingWriteType;
  payload: string;
  createdAt: string;
  syncedAt: string | null;
}
