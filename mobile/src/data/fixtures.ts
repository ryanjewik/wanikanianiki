/**
 * Sample content, so every screen renders before a backend exists.
 *
 * The values are the ones drawn in the design files — level 12, 明 / 山, the
 * Genki II page 84 import — so a screen built against these fixtures can be
 * compared to its artboard directly. Swap `useDashboard` & co. over to the API
 * client and nothing here is needed.
 */
import type {
  Assignment,
  DashboardSummary,
  DetectedItem,
  SessionSummary,
  StudyItem,
  Subject,
} from './types';

function subject(partial: Partial<Subject> & Pick<Subject, 'id' | 'type' | 'characters' | 'level'>): Subject {
  return {
    slug: partial.characters ?? String(partial.id),
    meanings: [],
    readings: [],
    meaningMnemonic: null,
    readingMnemonic: null,
    componentSubjectIds: [],
    amalgamationSubjectIds: [],
    jlptLevel: null,
    ...partial,
  };
}

/* -------------------------------------------------------------------------- */
/* Subjects                                                                    */
/* -------------------------------------------------------------------------- */

export const SUN_RADICAL = subject({
  id: 8761,
  type: 'radical',
  characters: '日',
  level: 1,
  meanings: [{ meaning: 'Sun', primary: true, acceptedAnswer: true }],
  amalgamationSubjectIds: [8801],
});

export const MOON_RADICAL = subject({
  id: 8762,
  type: 'radical',
  characters: '月',
  level: 2,
  meanings: [{ meaning: 'Moon', primary: true, acceptedAnswer: true }],
  amalgamationSubjectIds: [8801],
});

export const BRIGHT_KANJI = subject({
  id: 8801,
  type: 'kanji',
  characters: '明',
  level: 12,
  slug: 'bright',
  meanings: [
    { meaning: 'Bright', primary: true, acceptedAnswer: true },
    { meaning: 'Clear', primary: false, acceptedAnswer: true },
    { meaning: 'Light', primary: false, acceptedAnswer: true },
  ],
  readings: [
    { reading: 'めい', type: 'onyomi', primary: true, acceptedAnswer: true },
    { reading: 'あか', type: 'kunyomi', primary: false, acceptedAnswer: true },
  ],
  meaningMnemonic:
    'The sun and the moon both turned up for the same shift. Of course it is bright — nobody told them to take turns.',
  readingMnemonic:
    'Both of them are shouting "May!" at each other across the sky, because that is the month the rota was drawn up.',
  componentSubjectIds: [SUN_RADICAL.id, MOON_RADICAL.id],
  amalgamationSubjectIds: [8901, 8902],
  jlptLevel: 4,
});

export const MOUNTAIN_KANJI = subject({
  id: 8455,
  type: 'kanji',
  characters: '山',
  level: 4,
  slug: 'mountain',
  meanings: [{ meaning: 'Mountain', primary: true, acceptedAnswer: true }],
  readings: [
    { reading: 'やま', type: 'kunyomi', primary: true, acceptedAnswer: true },
    { reading: 'さん', type: 'onyomi', primary: false, acceptedAnswer: true },
  ],
  meaningMnemonic: 'Three peaks, one after another. It could not be anything but a mountain.',
  readingMnemonic: 'You yell "yamaaa!" as you roll back down it.',
  jlptLevel: 5,
});

export const TOMORROW_VOCAB = subject({
  id: 8901,
  type: 'vocabulary',
  characters: '明日',
  level: 12,
  slug: 'tomorrow',
  meanings: [{ meaning: 'Tomorrow', primary: true, acceptedAnswer: true }],
  readings: [{ reading: 'あした', type: 'vocabulary', primary: true, acceptedAnswer: true }],
  componentSubjectIds: [BRIGHT_KANJI.id],
  jlptLevel: 5,
});

export const EXPLANATION_VOCAB = subject({
  id: 8902,
  type: 'vocabulary',
  characters: '説明',
  level: 12,
  slug: 'explanation',
  meanings: [{ meaning: 'Explanation', primary: true, acceptedAnswer: true }],
  readings: [{ reading: 'せつめい', type: 'vocabulary', primary: true, acceptedAnswer: true }],
  componentSubjectIds: [BRIGHT_KANJI.id],
  jlptLevel: 3,
});

/** The level-12 grid on the browser screen. `passed` drives the chip styling. */
export const LEVEL_12_ITEMS: { subject: Subject; state: 'passed' | 'in_progress' | 'locked' }[] = [
  // Radicals
  { subject: subject({ id: 9001, type: 'radical', characters: '日', level: 12 }), state: 'passed' },
  { subject: subject({ id: 9002, type: 'radical', characters: '月', level: 12 }), state: 'passed' },
  { subject: subject({ id: 9003, type: 'radical', characters: '田', level: 12 }), state: 'passed' },
  { subject: subject({ id: 9004, type: 'radical', characters: '土', level: 12 }), state: 'passed' },
  { subject: subject({ id: 9005, type: 'radical', characters: '寺', level: 12 }), state: 'in_progress' },
  { subject: subject({ id: 9006, type: 'radical', characters: '頁', level: 12 }), state: 'locked' },
  { subject: subject({ id: 9007, type: 'radical', characters: '舌', level: 12 }), state: 'locked' },
  // Kanji
  { subject: BRIGHT_KANJI, state: 'passed' },
  { subject: subject({ id: 9012, type: 'kanji', characters: '時', level: 12 }), state: 'passed' },
  { subject: subject({ id: 9013, type: 'kanji', characters: '音', level: 12 }), state: 'passed' },
  { subject: subject({ id: 9014, type: 'kanji', characters: '計', level: 12 }), state: 'in_progress' },
  { subject: subject({ id: 9015, type: 'kanji', characters: '記', level: 12 }), state: 'in_progress' },
  { subject: subject({ id: 9016, type: 'kanji', characters: '話', level: 12 }), state: 'locked' },
  { subject: subject({ id: 9017, type: 'kanji', characters: '語', level: 12 }), state: 'locked' },
  // Vocabulary
  { subject: TOMORROW_VOCAB, state: 'passed' },
  { subject: EXPLANATION_VOCAB, state: 'passed' },
  { subject: subject({ id: 9022, type: 'vocabulary', characters: '時間', level: 12 }), state: 'in_progress' },
  { subject: subject({ id: 9023, type: 'vocabulary', characters: '記事', level: 12 }), state: 'locked' },
];

export const ALL_SUBJECTS: Subject[] = [
  SUN_RADICAL,
  MOON_RADICAL,
  BRIGHT_KANJI,
  MOUNTAIN_KANJI,
  TOMORROW_VOCAB,
  EXPLANATION_VOCAB,
  ...LEVEL_12_ITEMS.map((item) => item.subject),
];

export function findSubject(id: number): Subject | undefined {
  return ALL_SUBJECTS.find((s) => s.id === id);
}

/* -------------------------------------------------------------------------- */
/* Queues                                                                      */
/* -------------------------------------------------------------------------- */

function assignment(
  subjectItem: Subject,
  srsStage: number,
  overrides: Partial<Assignment> = {},
): Assignment {
  const now = Date.now();
  return {
    id: 1_400_000 + subjectItem.id,
    subjectId: subjectItem.id,
    subjectType: subjectItem.type,
    srsStage,
    unlockedAt: new Date(now - 9 * 864e5).toISOString(),
    startedAt: srsStage > 0 ? new Date(now - 8 * 864e5).toISOString() : null,
    passedAt: srsStage >= 5 ? new Date(now - 3 * 864e5).toISOString() : null,
    availableAt: srsStage > 0 ? new Date(now - 3600e3).toISOString() : null,
    burnedAt: null,
    ...overrides,
  };
}

/** Unlocked but never started — the lesson backlog. */
export const LESSON_QUEUE: StudyItem[] = [
  { subject: BRIGHT_KANJI, assignment: assignment(BRIGHT_KANJI, 0, { startedAt: null, availableAt: null }) },
  { subject: TOMORROW_VOCAB, assignment: assignment(TOMORROW_VOCAB, 0, { startedAt: null, availableAt: null }) },
  { subject: EXPLANATION_VOCAB, assignment: assignment(EXPLANATION_VOCAB, 0, { startedAt: null, availableAt: null }) },
  { subject: SUN_RADICAL, assignment: assignment(SUN_RADICAL, 0, { startedAt: null, availableAt: null }) },
  { subject: MOON_RADICAL, assignment: assignment(MOON_RADICAL, 0, { startedAt: null, availableAt: null }) },
];

/** Due now. 山 is first so the review screen matches artboard 4d. */
export const REVIEW_QUEUE: StudyItem[] = [
  { subject: MOUNTAIN_KANJI, assignment: assignment(MOUNTAIN_KANJI, 5) },
  { subject: BRIGHT_KANJI, assignment: assignment(BRIGHT_KANJI, 3) },
  { subject: TOMORROW_VOCAB, assignment: assignment(TOMORROW_VOCAB, 4) },
  { subject: EXPLANATION_VOCAB, assignment: assignment(EXPLANATION_VOCAB, 2) },
  { subject: SUN_RADICAL, assignment: assignment(SUN_RADICAL, 6) },
];

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export const DASHBOARD: DashboardSummary = {
  user: { username: 'you', level: 12 },
  lessonCount: 24,
  reviewCount: 87,
  streak: {
    days: 41,
    best: 52,
    week: [
      { label: 'Sat', intensity: 1, isToday: false },
      { label: 'Sun', intensity: 1, isToday: false },
      { label: 'Mon', intensity: 1, isToday: false },
      { label: 'Tue', intensity: 1, isToday: false },
      { label: 'Wed', intensity: 0.5, isToday: false },
      { label: 'Thu', intensity: 0, isToday: false },
      { label: 'Today', intensity: 0, isToday: true },
    ],
  },
  levelProgress: {
    level: 12,
    radicals: { passed: 18, total: 25 },
    kanji: { passed: 9, total: 18 },
    vocabulary: { passed: 21, total: 37 },
    kanjiRemainingToLevelUp: 9,
    daysAtLevel: 9,
  },
  stageSpread: [20, 56, 30, 100, 42],
  lastSyncedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
};

export const SESSION_SUMMARY: SessionSummary = {
  durationMinutes: 14,
  total: 87,
  correct: 84,
  incorrect: 3,
  percentageCorrect: 96,
  streakDays: 42,
  movements: [
    { from: 1, to: 2, count: 18 },
    { from: 2, to: 3, count: 9 },
    { from: 3, to: 4, count: 4 },
  ],
  missed: [
    { subjectId: 8300, characters: '女', meaning: 'woman', reading: 'おんな', note: 'you typed おんあ' },
    { subjectId: 8301, characters: '田', meaning: 'rice paddy', reading: 'た', note: 'meaning missed twice' },
    { subjectId: 8302, characters: '大人', meaning: 'adult', reading: 'おとな', note: 'irregular reading' },
  ],
  nextReviewAt: new Date(Date.now() + 4 * 3600e3).toISOString(),
  nextReviewCount: 23,
  pendingSync: 2,
};

/* -------------------------------------------------------------------------- */
/* Photo import                                                                */
/* -------------------------------------------------------------------------- */

export const IMPORT_PAGE_LABEL = 'Quartet I · page 230 vocabulary list';

/**
 * Modelled on a real page rather than invented, so the review screen is
 * exercised against the shapes that actually turn up: a bracketed particle,
 * an ambiguous reading, a word the page lists without a meaning, and a
 * duplicate.
 */
export const DETECTED_ITEMS: DetectedItem[] = [
  {
    key: '免許:めんきょ',
    kanjiFurigana: '免許',
    furiganaOnly: 'めんきょ',
    english: 'license',
    usageContext: null,
    jlptLevel: 3,
    status: 'ok',
    selected: true,
  },
  {
    key: 'お嬢さん:おじょうさん',
    kanjiFurigana: 'お嬢さん',
    furiganaOnly: 'おじょうさん',
    english: "(someone's) daughter (polite)",
    usageContext: null,
    jlptLevel: 3,
    status: 'ok',
    selected: true,
  },
  {
    key: '苦手な:にがてな',
    kanjiFurigana: '苦手な',
    furiganaOnly: 'にがてな',
    english: 'poor at',
    // Printed as [〜が]苦手な. Kept apart from the word, which it would
    // otherwise corrupt.
    usageContext: '〜が',
    jlptLevel: 3,
    status: 'ok',
    selected: true,
  },
  {
    key: '辛い:',
    kanjiFurigana: '辛い',
    furiganaOnly: '',
    english: 'spicy; painful',
    usageContext: null,
    jlptLevel: 3,
    status: 'ambiguous',
    selected: false,
    readingChoices: ['からい', 'つらい'],
    note: 'Pick the reading this page means.',
  },
  {
    key: '言葉:',
    kanjiFurigana: '言葉',
    furiganaOnly: '',
    english: '',
    usageContext: null,
    jlptLevel: 3,
    status: 'ok',
    selected: false,
    note: 'No meaning printed here. Add one, or import it from the word list.',
  },
  {
    key: '自由:じゆう',
    kanjiFurigana: '自由',
    furiganaOnly: 'じゆう',
    english: 'freedom',
    usageContext: null,
    jlptLevel: 3,
    status: 'duplicate',
    selected: false,
    note: 'Already in your deck.',
  },
];

/** The design shows 4 of 12 rows, with the rest behind "Show all". */
export const DETECTED_TOTAL = 12;
