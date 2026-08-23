/**
 * The icon set from `Asset Sheet.dc.html`, transcribed to react-native-svg.
 *
 * House rules the sheet sets out, worth keeping if you draw more:
 *   Shape      everything fits a 100×100 box; squircles at rx 27, circles at
 *              r 46. No sharp corners — the smallest radius in the set is 6.5.
 *   Weight     strokes are 9–11 at that scale, round caps and joins, always.
 *              Thin lines vanish at 22px and break the family.
 *   Colour     one saturated fill plus white marks. Only the empty states get
 *              more than one colour, and only as confetti dots.
 *   Restraint  four elements maximum in a tile. More than that means it wants
 *              to be an illustration, not an icon.
 */
import * as React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors, subjectPalette, type SubjectType } from '@/theme/tokens';

interface IconProps {
  size?: number;
}

/* -------------------------------------------------------------------------- */
/* Item types — replaces the 部 / 字 / 語 glyph tiles in nav and lists          */
/* -------------------------------------------------------------------------- */

/** One building block: the pieces kanji are made of. */
export function RadicalIcon({ size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x={0} y={0} width={100} height={100} rx={27} fill={subjectPalette.radical.solid} />
      <Rect x={31} y={31} width={38} height={38} rx={11} fill="#fff" />
    </Svg>
  );
}

/** Blocks put together: radicals combined into a character. */
export function KanjiIcon({ size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x={0} y={0} width={100} height={100} rx={27} fill={subjectPalette.kanji.solid} />
      <Rect x={22} y={22} width={26} height={26} rx={7} fill="#fff" />
      <Rect x={52} y={22} width={26} height={26} rx={7} fill="#fff" />
      <Rect x={22} y={52} width={26} height={26} rx={7} fill="#fff" />
      <Rect x={52} y={52} width={26} height={26} rx={7} fill="#fff" />
    </Svg>
  );
}

/** Characters making words: real words you'll actually say. */
export function VocabularyIcon({ size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x={0} y={0} width={100} height={100} rx={27} fill={subjectPalette.vocabulary.solid} />
      <Rect x={24} y={28} width={52} height={13} rx={6.5} fill="#fff" />
      <Rect x={24} y={47} width={38} height={13} rx={6.5} fill="#fff" />
      <Rect x={24} y={66} width={28} height={13} rx={6.5} fill="#fff" />
    </Svg>
  );
}

export function SubjectTypeIcon({ type, size = 22 }: IconProps & { type: SubjectType }) {
  if (type === 'radical') return <RadicalIcon size={size} />;
  if (type === 'kanji') return <KanjiIcon size={size} />;
  return <VocabularyIcon size={size} />;
}

/* -------------------------------------------------------------------------- */
/* Stage badges — a dot appears each time an item survives a review            */
/* -------------------------------------------------------------------------- */

/**
 * `bucket` is 0–4, matching the five display stages. Use at 22px in lists and
 * 60px in item detail.
 */
export function StageBadge({ bucket, size = 22 }: IconProps & { bucket: number }) {
  const clamped = Math.max(0, Math.min(4, bucket));

  if (clamped === 0) {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={46} fill={colors.warning} />
        <Circle cx={50} cy={50} r={9} fill="#fff" />
      </Svg>
    );
  }
  if (clamped === 1) {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={46} fill={colors.success} />
        <Circle cx={35} cy={50} r={9} fill="#fff" />
        <Circle cx={65} cy={50} r={9} fill="#fff" />
      </Svg>
    );
  }
  if (clamped === 2) {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={46} fill={colors.radical} />
        <Circle cx={50} cy={34} r={9} fill="#fff" />
        <Circle cx={36} cy={59} r={9} fill="#fff" />
        <Circle cx={64} cy={59} r={9} fill="#fff" />
      </Svg>
    );
  }
  if (clamped === 3) {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={46} fill={colors.vocabulary} />
        <Circle cx={50} cy={32} r={8.5} fill="#fff" />
        <Circle cx={68} cy={50} r={8.5} fill="#fff" />
        <Circle cx={50} cy={68} r={8.5} fill="#fff" />
        <Circle cx={32} cy={50} r={8.5} fill="#fff" />
      </Svg>
    );
  }
  // Retired — the dots give way to a tick.
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={46} fill={colors.inkDisabled} />
      <Path
        d="M32,52 L44,64 L70,36"
        fill="none"
        stroke="#fff"
        strokeWidth={11}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Answer feedback — shows for ~600ms, then the next item slides in            */
/* -------------------------------------------------------------------------- */

export function CorrectMark({ size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={46} fill={colors.success} />
      <Path
        d="M32,52 L44,64 L70,36"
        fill="none"
        stroke="#fff"
        strokeWidth={11}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * A bare tick, no disc behind it.
 *
 * Neither Zen Kaku Gothic New nor Shippori Mincho contains U+2713, so drawing
 * a check as text silently falls back to whatever system font the device
 * happens to pick — inconsistent across Android builds, and tofu on the
 * unlucky ones. Drawing it keeps the weight and cap style in the family.
 */
export function CheckMark({ size = 22, color = '#fff' }: IconProps & { color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path
        d="M26,52 L42,68 L74,32"
        fill="none"
        stroke={color}
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IncorrectMark({ size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={46} fill={colors.danger} />
      <Path d="M36,36 L64,64 M64,36 L36,64" fill="none" stroke="#fff" strokeWidth={11} strokeLinecap="round" />
    </Svg>
  );
}

/** Badge gains a dot — the item moved up a stage. */
export function StageUpMark({ size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={46} fill={colors.radical} />
      <Path
        d="M50,66 L50,34 M50,32 L37,45 M50,32 L63,45"
        fill="none"
        stroke="#fff"
        strokeWidth={11}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Rays scale out over 400ms. */
export function LevelUpBurst({ size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={46} fill={colors.warning} />
      <Path
        d="M50,10 L50,26 M50,74 L50,90 M10,50 L26,50 M74,50 L90,50 M22,22 L33,33 M67,67 L78,78 M78,22 L67,33 M33,67 L22,78"
        fill="none"
        stroke="#fff"
        strokeWidth={9}
        strokeLinecap="round"
      />
      <Circle cx={50} cy={50} r={15} fill="#fff" />
    </Svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty states — one per screen that can legitimately have nothing on it      */
/* -------------------------------------------------------------------------- */

/** Nothing left in the queue. */
export function AllCaughtUpArt({ size = 108 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Circle cx={60} cy={64} r={34} fill={colors.success} />
      <Path
        d="M46,66 L56,76 L75,54"
        fill="none"
        stroke="#fff"
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={20} cy={34} r={6} fill={colors.warning} />
      <Circle cx={100} cy={28} r={7} fill={colors.kanji} />
      <Circle cx={106} cy={82} r={5} fill={colors.vocabulary} />
      <Circle cx={16} cy={86} r={5} fill={colors.radical} />
    </Svg>
  );
}

/** Nothing due yet — next reviews in a few hours. */
export function NothingDueArt({ size = 108 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Circle cx={60} cy={60} r={36} fill="none" stroke={colors.radical} strokeWidth={9} />
      <Path
        d="M60,38 L60,62 L78,70"
        fill="none"
        stroke={colors.radical}
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Deck is empty — import a page to start one. */
export function EmptyDeckArt({ size = 108 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Rect x={22} y={28} width={58} height={44} rx={11} fill={colors.vocabularyTint} />
      <Rect
        x={34}
        y={46}
        width={58}
        height={44}
        rx={11}
        fill="#fff"
        stroke={colors.vocabulary}
        strokeWidth={6}
      />
      <Path d="M52,68 L74,68" fill="none" stroke={colors.vocabulary} strokeWidth={6} strokeLinecap="round" />
    </Svg>
  );
}

/** Offline — answers queued, nothing lost. */
export function OfflineArt({ size = 108 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Rect x={26} y={62} width={68} height={18} rx={9} fill={colors.outline} />
      <Circle cx={44} cy={60} r={15} fill={colors.outline} />
      <Circle cx={62} cy={54} r={19} fill={colors.outline} />
      <Circle cx={80} cy={61} r={14} fill={colors.outline} />
      <Circle cx={94} cy={34} r={9} fill={colors.warning} />
    </Svg>
  );
}
