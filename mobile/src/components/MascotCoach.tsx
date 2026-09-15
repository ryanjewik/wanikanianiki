/**
 * The Crabigator with something to say.
 *
 * `Mascot.tsx` is deliberately a pure sprite player — it knows about frames and
 * nothing about the app. This is the layer above: the mascot placed in a slot,
 * given a speech bubble, and handed a line. Keeping the two apart means the
 * player stays reusable and the copy stays in one findable place.
 *
 * The tone to hold: warm but dry. This app is used in forty-minute sittings on
 * material that is genuinely hard, and a mascot that cheers at full volume for
 * every correct answer becomes something you want to switch off by the second
 * week. Most of the time it says nothing at all.
 */
import * as React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Mascot, type Pose } from '@/components/Mascot';
import { Pop } from '@/components/motion';
import {
  colors,
  radius,
  subjectPalette,
  type SubjectType,
  type as typeScale,
} from '@/theme/tokens';

/* -------------------------------------------------------------------------- */
/* Coach                                                                       */
/* -------------------------------------------------------------------------- */

export interface MascotCoachProps {
  /** What the Crabigator is saying. Omit for a silent mascot in a slot. */
  line?: string;
  /** An overline above the line, e.g. "Mnemonic". */
  label?: string;
  /** Tints the art slot and the bubble to match the item type. */
  tone?: SubjectType | 'neutral';
  pose?: Pose;
  size?: number;
  speed?: number;
  onReactionEnd?: () => void;
  /** Longer copy — a mnemonic — reads better left-aligned and unbubbled. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Mascot in a tinted slot with a speech bubble beside it.
 *
 * The bubble's tail is a rotated square rather than a border triangle: React
 * Native has no `border-*-color: transparent` triangle trick worth using, and
 * a square under the bubble's own background colour is both simpler and
 * survives a change of tint without a second colour to keep in step.
 */
export function MascotCoach({
  line,
  label,
  tone = 'neutral',
  pose = 'idle',
  size = 76,
  speed = 0.6,
  onReactionEnd,
  children,
  style,
}: MascotCoachProps) {
  const tint = tone === 'neutral' ? colors.ground : subjectPalette[tone].tint;
  const ink = tone === 'neutral' ? colors.inkSoft : subjectPalette[tone].solid;

  return (
    <View style={[styles.coach, style]}>
      <View style={[styles.slot, { width: size, height: size, backgroundColor: tint }]}>
        <Mascot pose={pose} size={size} speed={speed} lively onReactionEnd={onReactionEnd} />
      </View>

      <View style={styles.coachBody}>
        {label ? <Text style={[styles.label, { color: ink }]}>{label}</Text> : null}
        {line ? (
          <View style={[styles.bubble, { backgroundColor: tint }]}>
            <View style={[styles.tail, { backgroundColor: tint }]} />
            <Text style={styles.bubbleText}>{line}</Text>
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}

/**
 * A line that appears in response to something, and animates in.
 *
 * Remounted by `key` from the caller so each new line springs in rather than
 * cross-fading its text in place, which reads as a typo correcting itself.
 */
export function MascotAside({
  line,
  pose = 'idle',
  tone = 'neutral',
  size = 56,
}: {
  line: string;
  pose?: Pose;
  tone?: SubjectType | 'neutral';
  size?: number;
}) {
  const tint = tone === 'neutral' ? colors.ground : subjectPalette[tone].tint;

  return (
    <Pop style={styles.aside}>
      <Mascot pose={pose} size={size} speed={0.8} lively />
      <View style={[styles.asideBubble, { backgroundColor: tint }]}>
        <View style={[styles.tail, { backgroundColor: tint }]} />
        <Text style={styles.asideText}>{line}</Text>
      </View>
    </Pop>
  );
}

/* -------------------------------------------------------------------------- */
/* What it says                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Lines keyed by the moment that earns them.
 *
 * Milestones only — a run of three, five, ten — and the recovery after a miss.
 * Silence is the default and is doing real work: a line that appears on every
 * card is wallpaper within a minute, whereas one that appears twice a session
 * is still being read in a month.
 */
const RUN_LINES: Record<number, string[]> = {
  3: ['Three in a row.', 'Nice run going.'],
  5: ['Five straight. You know these.', 'Five clean. Keep the rhythm.'],
  10: ['Ten in a row — that is the good stuff.', 'Ten straight. Genuinely impressive.'],
  20: ['Twenty. Take the win.', 'Twenty in a row. Show-off.'],
};

const RECOVERY_LINES = ['Back on it.', 'That one is yours now.', 'Good recovery.'];

/**
 * Picks the line for the moment, or `null` for the usual case of nothing to
 * say.
 *
 * Selection is seeded off the run length rather than random, so the line does
 * not change under the user if the screen re-renders before it is dismissed.
 */
function coachLine({ length, recovered }: AnswerRun): string | null {
  const milestone = RUN_LINES[length];
  if (milestone) return milestone[length % milestone.length];
  if (recovered) return RECOVERY_LINES[length % RECOVERY_LINES.length];
  return null;
}

export interface AnswerRun {
  /** Consecutive correct answers, reset to zero by a miss. */
  length: number;
  /** This answer was the first hit after a miss. */
  recovered: boolean;
}

/**
 * Tracks the run of correct answers a session is on, and the line it earns.
 *
 * Shared by all three answering screens rather than reimplemented in each,
 * which is how the two subtleties here stayed wrong in triplicate:
 *
 * A run of length zero means *either* nothing answered yet *or* a miss just
 * now, and only the second of those is a recovery — congratulating someone for
 * "getting back on it" on the first question of a session is nonsense, so the
 * preceding miss is tracked explicitly rather than inferred from the run being
 * empty.
 *
 * And the decision is made here, outside any state updater, because React is
 * free to call an updater twice — a sound effect fired from inside one plays
 * twice.
 */
export function useAnswerRun(): {
  run: AnswerRun;
  /** The line the current run has earned, or null. */
  line: string | null;
  /** Records an answer; returns the line it earned, for the caller's cue. */
  register: (ok: boolean) => string | null;
} {
  const [state, setState] = React.useState<{ run: AnswerRun; line: string | null }>({
    run: { length: 0, recovered: false },
    line: null,
  });

  // Mirrors `state.run` so `register` can read the current value without
  // being rebuilt on every answer, and without reading through a stale closure.
  const runRef = React.useRef<AnswerRun>({ length: 0, recovered: false });
  const missedLast = React.useRef(false);

  const register = React.useCallback((ok: boolean): string | null => {
    if (!ok) {
      missedLast.current = true;
      runRef.current = { length: 0, recovered: false };
      setState({ run: runRef.current, line: null });
      return null;
    }

    const next: AnswerRun = { length: runRef.current.length + 1, recovered: missedLast.current };
    missedLast.current = false;
    runRef.current = next;

    const line = coachLine(next);
    setState({ run: next, line });
    return line;
  }, []);

  return { run: state.run, line: state.line, register };
}

/**
 * The closing line, chosen by how the session actually went.
 *
 * Never congratulatory about a bad session — praise that does not track
 * reality is the fastest way to make the mascot stop meaning anything.
 */
export function summaryLine(percentage: number, total: number): string {
  if (total === 0) return 'Nothing to do right now. Enjoy it.';
  if (percentage >= 95) return 'Almost perfect. That is a real level of knowing them.';
  if (percentage >= 85) return 'Strong session. The misses are the useful part.';
  if (percentage >= 70) return 'Solid. The ones that got away come back sooner.';
  if (percentage >= 50) return 'Tough set. That is what the repeats are for.';
  return 'Rough one — which means these are exactly the ones worth drilling.';
}

/** The pose that suits a result, for the summary art. */
export function summaryPose(percentage: number): Pose {
  return percentage >= 70 ? 'correct' : 'idle';
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  coach: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  slot: {
    borderRadius: radius.art,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachBody: {
    flex: 1,
    gap: 5,
    paddingTop: 2,
  },
  label: typeScale.overline,

  bubble: {
    borderRadius: radius.control,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  bubbleText: {
    ...typeScale.bodyLoose,
    color: colors.inkMuted,
  },
  tail: {
    position: 'absolute',
    left: -4,
    top: 14,
    width: 10,
    height: 10,
    transform: [{ rotate: '45deg' }],
    borderRadius: 2,
  },

  aside: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  asideBubble: {
    flex: 1,
    borderRadius: radius.control,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  asideText: {
    ...typeScale.captionBold,
    color: colors.inkMuted,
  },
});
