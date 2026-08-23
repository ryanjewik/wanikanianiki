/**
 * Design tokens, lifted verbatim from `Japanese Kanji Learning App Designs`.
 *
 * The whole system is: light grey ground, flat white cards with a 1px #E7E7EA
 * edge and 16px radius, one saturated colour per item type, and outlined
 * controls that carry a hard offset shadow when they commit to something.
 */

/** Per-type colour. Radicals are blue, kanji pink, vocabulary violet. */
export const subjectPalette = {
  radical: { solid: '#2F7CE0', tint: '#E6F0FD', ink: '#4D84CF', glyph: '部' },
  kanji: { solid: '#E8447F', tint: '#FDEAF1', ink: '#D43A73', glyph: '字' },
  vocabulary: { solid: '#8B5CD6', tint: '#F3ECFD', ink: '#7A4FC0', glyph: '語' },
} as const;

export type SubjectType = keyof typeof subjectPalette;

export const colors = {
  /** App ground behind every card. */
  ground: '#F2F2F4',
  surface: '#FFFFFF',
  /** The 1px card edge. */
  border: '#E7E7EA',
  /** Hairline between rows inside a card. */
  hairline: '#F2F2F4',
  divider: '#EEEEF1',

  ink: '#1F2024',
  inkMuted: '#4A4B52',
  inkSoft: '#75767D',
  inkFaint: '#9A9BA2',
  inkDisabled: '#C9CAD1',
  outline: '#D3D4D9',

  radical: subjectPalette.radical.solid,
  radicalTint: subjectPalette.radical.tint,
  radicalInk: subjectPalette.radical.ink,

  kanji: subjectPalette.kanji.solid,
  kanjiTint: subjectPalette.kanji.tint,
  kanjiInk: subjectPalette.kanji.ink,

  vocabulary: subjectPalette.vocabulary.solid,
  vocabularyTint: subjectPalette.vocabulary.tint,
  vocabularyInk: subjectPalette.vocabulary.ink,

  success: '#4BAB6B',
  successTint: '#EAF7EE',
  successInk: '#3D9159',
  successInkSoft: '#57795F',

  warning: '#F0A02C',
  warningTint: '#FFF7E9',
  warningBorder: '#F6DFB4',
  warningInk: '#C8801A',
  warningInkSoft: '#A5751F',
  warningInkDeep: '#7D5A12',
  warningRow: '#FFFDF7',
  warningSoft: '#F7CD8C',

  danger: '#E8447F',
  dangerTint: '#FDEAF1',
  dangerInk: '#D43A73',
  dangerInkSoft: '#A5476B',

  onSolid: '#FFFFFF',
  /** White at 85%, used for secondary text on a coloured card header. */
  onSolidMuted: 'rgba(255,255,255,0.85)',
} as const;

/**
 * Two families. `sans` carries all UI chrome; `serif` is reserved for Japanese
 * — the material being studied — and never used for English copy.
 */
export const fonts = {
  sans: {
    regular: 'ZenKakuGothicNew_400Regular',
    medium: 'ZenKakuGothicNew_500Medium',
    bold: 'ZenKakuGothicNew_700Bold',
    black: 'ZenKakuGothicNew_900Black',
  },
  // The designs only ever use Shippori Mincho at 500 and 700, so no other
  // weight is loaded — a single Japanese face is ~8.5MB.
  serif: {
    medium: 'ShipporiMincho_500Medium',
    bold: 'ShipporiMincho_700Bold',
  },
} as const;

/**
 * The design uses CSS numeric weights on a single family. React Native picks a
 * face by name, so each weight maps to its own loaded font file instead.
 */
export const type = {
  /** 27–24px, the one-line answer or headline on a card. */
  display: { fontFamily: fonts.sans.black, fontSize: 27, letterSpacing: -0.4 },
  title: { fontFamily: fonts.sans.black, fontSize: 24, letterSpacing: -0.3 },
  /** Card headline, e.g. "Today's Lessons". */
  cardTitle: { fontFamily: fonts.sans.bold, fontSize: 16.5 },
  /** Screen header title. */
  screenTitle: { fontFamily: fonts.sans.bold, fontSize: 14.5 },
  /** Section heading inside a card, e.g. "Your progress". */
  section: { fontFamily: fonts.sans.bold, fontSize: 13.5 },
  sectionSmall: { fontFamily: fonts.sans.bold, fontSize: 14 },
  body: { fontFamily: fonts.sans.medium, fontSize: 12.5 },
  bodyLoose: { fontFamily: fonts.sans.medium, fontSize: 13, lineHeight: 20.8 },
  /** Supporting copy under a card title. */
  caption: { fontFamily: fonts.sans.medium, fontSize: 12 },
  captionBold: { fontFamily: fonts.sans.bold, fontSize: 11.5 },
  /** The grey metadata line, e.g. "seen 6× · level 4". */
  meta: { fontFamily: fonts.sans.bold, fontSize: 11 },
  metaSmall: { fontFamily: fonts.sans.bold, fontSize: 10.5 },
  /** All-caps label above a group, e.g. "READINGS". */
  overline: {
    fontFamily: fonts.sans.bold,
    fontSize: 11,
    letterSpacing: 0.99,
    textTransform: 'uppercase' as const,
  },
  /** Tab bar label. */
  tab: { fontFamily: fonts.sans.bold, fontSize: 9.5 },
  /** Big stat, e.g. "96%". */
  stat: { fontFamily: fonts.sans.black, fontSize: 19 },
  statLabel: { fontFamily: fonts.sans.bold, fontSize: 10 },
  /** Button face. */
  button: { fontFamily: fonts.sans.black, fontSize: 16 },
  buttonSmall: { fontFamily: fonts.sans.bold, fontSize: 13 },
} as const;

/** Japanese type. Always Shippori Mincho, always sized by role. */
export const jp = {
  /** The single subject under review — 128px. */
  hero: { fontFamily: fonts.serif.medium, fontSize: 128, lineHeight: 128 },
  /** The subject being taught in a lesson — 100px. */
  lesson: { fontFamily: fonts.serif.bold, fontSize: 100, lineHeight: 100 },
  /** Subject on the detail header — 88px. */
  detail: { fontFamily: fonts.serif.bold, fontSize: 88, lineHeight: 88 },
  /** Answer text in the input field. */
  answer: { fontFamily: fonts.serif.medium, fontSize: 26 },
  /** Reading chip, e.g. めい. */
  reading: { fontFamily: fonts.serif.bold, fontSize: 20 },
  /** Character tile in a grid. */
  tile: { fontFamily: fonts.serif.bold, fontSize: 20 },
  tileSmall: { fontFamily: fonts.serif.bold, fontSize: 18 },
  /** Word in a list row. */
  row: { fontFamily: fonts.serif.bold, fontSize: 19 },
  /** Composition chip in the radical → kanji equation. */
  chip: { fontFamily: fonts.serif.bold, fontSize: 21 },
  chipSmall: { fontFamily: fonts.serif.bold, fontSize: 17 },
  /** Glyph inside a nav / type icon. */
  icon: { fontFamily: fonts.serif.bold, fontSize: 13 },
} as const;

export const radius = {
  chip: 6,
  tile: 9,
  control: 11,
  button: 12,
  art: 12,
  /** Every card in the system. */
  card: 16,
  /** The oversized review card. */
  cardLarge: 20,
  pill: 20,
  round: 999,
} as const;

export const spacing = {
  /** Gap between stacked cards. */
  stack: 9,
  /** Horizontal page gutter. */
  gutter: 14,
  cardPadV: 13,
  cardPadH: 14,
  rowGap: 9,
} as const;

/**
 * Cards get a whisper of a drop shadow; committing controls get a hard,
 * un-blurred 2–3px offset in ink — the thing that makes a button look pressable.
 */
export const shadows = {
  card: {
    shadowColor: '#1F2024',
    shadowOpacity: 0.07,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  /** Hard shadow under a primary CTA. */
  hard: {
    shadowColor: '#1F2024',
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 3 },
    elevation: 0,
  },
  /** Hard shadow under a secondary / inline control. */
  hardSmall: {
    shadowColor: '#1F2024',
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 2 },
    elevation: 0,
  },
} as const;

/** The outlined-control border. 1.5px in ink, never a lighter colour. */
export const controlBorder = { borderWidth: 1.5, borderColor: colors.ink } as const;

/**
 * WaniKani ships nine SRS stages; the UI groups them into five buckets, each
 * with a badge and a colour. Naming is swappable — the design shipped three
 * vocabularies and Botanical is the default.
 */
export const srsStages = [
  { key: 'stage1', color: colors.warning, tint: colors.warningTint, ink: colors.warningInk, interval: '4h · 8h' },
  { key: 'stage2', color: colors.success, tint: colors.successTint, ink: colors.successInk, interval: '1d · 2d' },
  { key: 'stage3', color: colors.radical, tint: colors.radicalTint, ink: colors.radicalInk, interval: '1w · 2w' },
  { key: 'stage4', color: colors.vocabulary, tint: colors.vocabularyTint, ink: colors.vocabularyInk, interval: '1mo · 4mo' },
  { key: 'stage5', color: colors.inkDisabled, tint: colors.ground, ink: colors.inkSoft, interval: 'retired' },
] as const;

export const stageVocabularies = {
  Botanical: ['Seed', 'Sprout', 'Sapling', 'Grove', 'Rooted'],
  Forge: ['Ore', 'Molten', 'Tempered', 'Honed', 'Sealed'],
  Plain: ['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Retired'],
} as const;

export type StageVocabulary = keyof typeof stageVocabularies;

/**
 * WaniKani's nine stages collapsed onto the five display buckets:
 * 1-2 apprentice-early, 3-4 apprentice-late, 5-6 guru, 7-8 master/enlightened,
 * 9 burned.
 */
export function stageBucket(srsStage: number): 0 | 1 | 2 | 3 | 4 {
  if (srsStage <= 2) return 0;
  if (srsStage <= 4) return 1;
  if (srsStage <= 6) return 2;
  if (srsStage <= 8) return 3;
  return 4;
}

export function stageName(srsStage: number, vocabulary: StageVocabulary = 'Botanical'): string {
  return stageVocabularies[vocabulary][stageBucket(srsStage)];
}
