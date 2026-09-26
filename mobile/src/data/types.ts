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

/** One example sentence WaniKani pairs with a vocabulary word. */
export interface ContextSentence {
  ja: string;
  en: string;
}

/** A recording of the word (MP3 only; see the backend schema). */
export interface PronunciationAudio {
  url: string;
  contentType: string;
  gender?: string | null;
  voiceActorName?: string | null;
  pronunciation?: string | null;
}

/**
 * An extra meaning WaniKani grades on. `whitelist` counts as right even though
 * it is not listed among the meanings; `blacklist` is a known wrong answer.
 */
export interface AuxiliaryMeaning {
  meaning: string;
  type: 'whitelist' | 'blacklist';
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
  meaningHint?: string | null;
  readingHint?: string | null;
  /** Radicals that build this kanji, or kanji that build this word. */
  componentSubjectIds: number[];
  /** Kanji this radical appears in, or vocabulary using this kanji. */
  amalgamationSubjectIds: number[];
  /** Backfilled once from the kanji-data seed import; null when unknown. */
  jlptLevel?: number | null;
  /** Vocabulary only. */
  contextSentences?: ContextSentence[];
  /** Vocabulary only, e.g. "noun", "godan verb". */
  partsOfSpeech?: string[];
  /** Vocabulary only. */
  pronunciationAudios?: PronunciationAudio[];
  /** Kanji only: kanji easily mistaken for this one. */
  visuallySimilarSubjectIds?: number[];
  auxiliaryMeanings?: AuxiliaryMeaning[];
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

/**
 * One tile on the level browser. `state` is the whole legend, so it is derived
 * once here rather than recomputed per screen.
 */
export interface LevelItem {
  subject: Subject;
  state: 'passed' | 'in_progress' | 'locked';
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

/**
 * One square of the dashboard's activity calendar, from `/api/activity`.
 *
 * `count` and `grammarOnly` are separate on purpose and must stay that way.
 * Logging a pattern puts a mark on the calendar and never extends the streak —
 * it is a record of the day, not practice of it — so a single number could not
 * express the difference without lying about one of them.
 */
export interface CalendarDay {
  /** The device's local date, `YYYY-MM-DD` — the zone the server bucketed in. */
  date: string;
  /** Reviews answered that day, WaniKani and the imported deck together. */
  count: number;
  /** A pattern was logged and nothing was answered. Shown, never counted. */
  grammarOnly: boolean;
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
  /**
   * The particle or object the textbook prints the word with — "〜が" for
   * [〜が]苦手な. Sent by the server as `usageContext`; the grader folds it away
   * so it is display-only, never part of an accepted answer.
   */
  usageContext: string | null;
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

/* -------------------------------------------------------------------------- */
/* Sets, flashcards and the SRS that schedules them                            */
/* -------------------------------------------------------------------------- */

/** A named group the user organises their own deck with. */
export interface VocabSet {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  itemCount: number;
  /** Pages photographed into it, and how far through reading them we are. */
  pageCount: number;
  pagesPending: number;
  pagesFailed: number;
  /** Null when the set is unfiled. */
  folderId: number | null;
  /** The tier this group is studied as; null when untagged. */
  jlptLevel: number | null;
  /** Flashcards: two per word (meaning, and the Japanese). */
  cardCount: number;
  /** How many of them are known in this set, until it is reset. */
  knownCount: number;
}

/** A set's flashcards still to learn, shuffled, with its progress. */
export interface SetStudy {
  setId: number;
  name: string;
  cardCount: number;
  knownCount: number;
  cards: Flashcard[];
}

/** One level above sets: "Quartet I" holding its lessons. */
export interface VocabFolder {
  id: number;
  name: string;
  createdAt: string;
  setCount: number;
}

/**
 * Which cards a flashcard session draws from. Every field optional; none at
 * all is the whole deck.
 */
export interface FlashcardScope {
  setId?: number;
  folderId?: number;
  jlpt?: number;
}

/**
 * Recognition shows the Japanese and asks for the meaning; production shows the
 * meaning and asks for the word. They schedule independently — recognising 免許
 * is easy long before you can produce it.
 */
export type SkillType = 'recognition' | 'production';

export interface Flashcard {
  srsStateId: number;
  vocabItemId: number;
  skillType: SkillType;
  /** What the card shows. Chosen server-side from `skillType`. */
  prompt: string;
  /**
   * Every string that counts as right. Ships with the card so a session grades
   * offline — for a production card this is the kanji *and* the reading.
   */
  acceptedAnswers: string[];
  kanjiFurigana: string;
  furiganaOnly: string;
  english: string;
  usageContext: string | null;
  dueAt: string;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  easeFactor: number;
}

export interface FlashcardOutcome {
  correct: boolean;
  grade: number;
  acceptedAnswers: string[];
  dueAt: string;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  easeFactor: number;
}

export type StudyMode = 'notecards' | 'quiz' | 'srs';

export type QuestionType =
  | 'multiple_choice'
  | 'fill_in_blank'
  | 'sentence_construction'
  | 'recall';

/**
 * What a question actually carries. One shape with optional halves rather than
 * a union: `type` already says which half is populated, and narrowing a union
 * at every render site buys nothing a single check does not.
 */
export interface QuestionPayload {
  prompt: string;
  /** The answer key. Present because the phone shows a verdict immediately;
   *  the server regrades regardless and its verdict is what the deck records. */
  answer: string;
  /** multiple_choice only — exactly four. */
  choices?: string[];
  /** sentence_construction only — joined in order they reproduce `answer`. */
  tiles?: string[];
  /**
   * Readings for the words written in kanji, as written form → kana. Optional:
   * questions generated before the field existed carry none, and the reader
   * falls back to lifting any glosses written into the prompt itself.
   *
   * The server drops the entry for the word a question is asking for, so this
   * can never answer its own question.
   */
  furigana?: Record<string, string>;
}

export interface Question {
  id: number;
  type: QuestionType;
  payload: QuestionPayload;
  vocabItemIds: number[];
  grammarEntryId: number | null;
  /** The verifier sub-agent must flip this before a question is servable. */
  verified: boolean;
  createdAt: string;
}

/** One JLPT tier's kanji coverage. */
export interface JlptTier {
  level: number;
  /** Every kanji at this tier, from the reference list — never from what has
   *  been synced, which would make coverage permanently complete. */
  total: number;
  /** Passed in WaniKani's sense. */
  passed: number;
  /** Unlocked but not yet passed. */
  started: number;
}

/**
 * Kanji coverage per JLPT tier, N5 first.
 *
 * Coverage, not readiness: the exam tests grammar and listening too, neither
 * of which this app can see. Named that way everywhere so a full bar is never
 * read as "ready to sit it".
 */
export interface JlptCoverage {
  tiers: JlptTier[];
  /** False before the first sync — an empty state rather than a row of 0%. */
  tracked: boolean;
}

/**
 * How much generated practice is waiting.
 *
 * Read from a route that deliberately does *not* consume — asking for the next
 * bundle in order to draw a count would spend one to display it.
 */
export interface LessonQueueCount {
  bundles: number;
  /** What the cards show: a learner counts questions, not the generator's batching. */
  questions: number;
}

export interface LessonBundle {
  id: number;
  generatedAt: string;
  /** Already ordered — the generator chose the order and the server preserves it. */
  questions: Question[];
}

/** What answering a generated question changed. */
export interface QuestionOutcome {
  correct: boolean;
  grade: number;
  expectedAnswer: string;
  /** SRS rows moved. Two per word, so one question about two words moves four. */
  schedulesAdvanced: number;
  /**
   * Words the question tested that carry no local schedule — WaniKani-sourced
   * ones, whose stage only WaniKani may move. Practice, not progress, and the
   * summary says so rather than reporting a no-op as advancement.
   */
  practiceOnlyWords: number;
}

/* -------------------------------------------------------------------------- */
/* Offline outbox                                                              */
/* -------------------------------------------------------------------------- */

export type PendingWriteType =
  | 'start_assignment'
  | 'submit_review'
  | 'answer_flashcard';

/** One answered imported-vocabulary card, queued for the server to grade. */
export interface FlashcardAnswerWrite {
  srsStateId: number;
  /** What the user typed. The server regrades it; the client's verdict is
   *  only ever used to show a result before the write lands. */
  answerGiven: string;
  /** The set it was studied in; a right answer marks the card known there. */
  setId?: number;
}

export interface PendingWrite {
  id: number;
  type: PendingWriteType;
  payload: string;
  createdAt: string;
  syncedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Grammar                                                                     */
/* -------------------------------------------------------------------------- */

export interface GrammarExample {
  id: number;
  japanese: string;
  english: string | null;
  /** Copied out of the actual lesson rather than generated. Sorts first. */
  isUserSupplied: boolean;
}

/**
 * A grammar point, on the day it was learned.
 *
 * Most of this is enrichment output. You type `pattern` and, when it helps,
 * `source`, `note` and one real example; the rest is filled in and is not
 * trusted until `enriched` says a human looked at it.
 *
 * Logging one puts a mark on the calendar and never touches the streak.
 */
export interface GrammarEntry {
  id: number;
  pattern: string;
  /** Empty when the pattern has one sense, which is the common case. */
  senseLabel: string;
  meaning: string | null;
  formation: string | null;
  /** Register: plain / polite / written / conversational. */
  style: string | null;
  jlptLevel: number | null;
  source: string | null;
  note: string | null;
  learnedOn: string;
  enriched: boolean;
  examples: GrammarExample[];
  createdAt: string;
  updatedAt: string;
}

export interface GrammarExampleInput {
  japanese: string;
  english?: string | null;
  isUserSupplied?: boolean;
}

/**
 * What came back from asking a model about a pattern.
 *
 * `applied` is false when nothing was written, and then the two flags say why:
 * the pattern was not recognised, or it has several senses and none was named.
 * Both are questions for the user rather than results to show — the answer is a
 * corrected pattern or a chosen sense, not a retry.
 */
export interface GrammarEnrichment {
  entry: GrammarEntry;
  applied: boolean;
  unrecognised: boolean;
  otherSenses: string[];
}

/**
 * One square on the calendar.
 *
 * Distinct from `DayActivity` above, which is the streak strip's one-bit-per-day
 * shape. This is the richer view: `grammarLogged` is deliberately not part of
 * what counts as studying, so a day you only logged a pattern appears on the
 * calendar without extending the streak.
 */
export interface DayActivitySummary {
  day: string;
  reviews: number;
  vocabReviews: number;
  grammarLogged: number;
}
