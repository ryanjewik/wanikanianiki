/**
 * One place that decides what a moment in the app feels like.
 *
 * A cue is a *meaning* — "they got it right", "we are moving on" — not a sound
 * and not a vibration. Screens name the meaning and this module picks the
 * pairing, so the character of the app is tuned here rather than negotiated
 * separately on seven screens. It also means a screen can never ship a sound
 * without its haptic, which is the usual way this kind of thing drifts.
 *
 * Both channels are independently switchable and both are read synchronously:
 * a cue fires inside a tap handler, which cannot await a database read. The
 * flags are hydrated once at boot and kept in memory from then on.
 */
import * as Haptics from 'expo-haptics';
import * as React from 'react';
import { Platform } from 'react-native';

import { getPref, setPref } from '@/data/db';

import { available as soundAvailable, play, prime, type Cue } from './audio';

export type { Cue };
export { soundAvailable };

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

const PREF_SOUND = 'feedback_sound';
const PREF_HAPTICS = 'feedback_haptics';

export interface FeedbackSettings {
  sound: boolean;
  haptics: boolean;
}

// Both default on.
//
// The argument for defaulting sound off is the lecture hall, and it is a real
// one — but it is already answered by not overriding the hardware silent
// switch (see `audio.prime`), which is where a phone in a lecture already is.
// Defaulting off would instead mean almost nobody ever hears the cues, since
// the switch for them is one card on the study tab; a feature nobody finds is
// worse than one somebody turns off.
let settings: FeedbackSettings = { sound: true, haptics: true };

const listeners = new Set<(next: FeedbackSettings) => void>();

function publish(): void {
  for (const listener of listeners) listener(settings);
}

/**
 * Loads the stored preferences and warms the audio players.
 *
 * Called once from the root layout, after the database is open. Until it
 * resolves the defaults above apply, so an early tap is quiet rather than
 * wrong.
 */
export async function initFeedback(): Promise<void> {
  try {
    const [sound, haptics] = await Promise.all([getPref(PREF_SOUND), getPref(PREF_HAPTICS)]);
    settings = {
      sound: sound === null ? settings.sound : sound === '1',
      haptics: haptics === null ? settings.haptics : haptics === '1',
    };
    publish();
  } catch {
    // No database yet — the defaults are a fine place to start.
  }

  // Only when sound is actually on — nine native players is not a cost to pay
  // for a user who has muted them. Turning the switch back on primes them
  // there instead, so the first cue after that is not the one that pays.
  if (settings.sound) prime();
}

export function getFeedbackSettings(): FeedbackSettings {
  return settings;
}

export async function setFeedbackSetting(
  key: keyof FeedbackSettings,
  value: boolean,
): Promise<void> {
  settings = { ...settings, [key]: value };
  publish();

  if (key === 'sound' && value) {
    prime();
    // Play the thing being switched on, so the toggle demonstrates itself.
    play('select');
  }

  try {
    await setPref(key === 'sound' ? PREF_SOUND : PREF_HAPTICS, value ? '1' : '0');
  } catch {
    // The in-memory value still holds for this session.
  }
}

/** Subscribes a settings screen to both switches. */
export function useFeedbackSettings(): FeedbackSettings {
  return React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    getFeedbackSettings,
    getFeedbackSettings,
  );
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                        */
/* -------------------------------------------------------------------------- */

type Buzz =
  | { kind: 'impact'; style: Haptics.ImpactFeedbackStyle }
  | { kind: 'notify'; type: Haptics.NotificationFeedbackType }
  | { kind: 'select' }
  | null;

/**
 * The pairing table — the whole design of how the app feels, in one place.
 *
 * The haptic is the half that carries the meaning when the phone is silent,
 * which is most of the time, so the weights are graded rather than uniform:
 * `Light` for chrome, a notification buzz only where there is a verdict, and
 * `Heavy` reserved for the two endings so they land as events.
 */
const CUES: Record<Cue, Buzz> = {
  tap: { kind: 'impact', style: Haptics.ImpactFeedbackStyle.Light },
  select: { kind: 'select' },
  toggle: { kind: 'impact', style: Haptics.ImpactFeedbackStyle.Rigid },
  back: { kind: 'impact', style: Haptics.ImpactFeedbackStyle.Soft },
  correct: { kind: 'notify', type: Haptics.NotificationFeedbackType.Success },
  wrong: { kind: 'notify', type: Haptics.NotificationFeedbackType.Error },
  // No buzz. The verdict card arriving is a consequence of the answer the user
  // just felt; buzzing twice for one action reads as a stutter.
  reveal: null,
  advance: { kind: 'impact', style: Haptics.ImpactFeedbackStyle.Soft },
  complete: { kind: 'impact', style: Haptics.ImpactFeedbackStyle.Heavy },
  levelup: { kind: 'impact', style: Haptics.ImpactFeedbackStyle.Heavy },
  streak: { kind: 'impact', style: Haptics.ImpactFeedbackStyle.Medium },
};

// Web has no vibration motor worth the name, and the API resolves to a no-op
// that still costs a promise per tap.
const hapticsSupported = Platform.OS !== 'web';

function buzz(cue: Cue): void {
  if (!settings.haptics || !hapticsSupported) return;
  const spec = CUES[cue];
  if (!spec) return;

  try {
    if (spec.kind === 'impact') void Haptics.impactAsync(spec.style);
    else if (spec.kind === 'notify') void Haptics.notificationAsync(spec.type);
    else void Haptics.selectionAsync();
  } catch {
    // No motor, or the OS refused. Never worth surfacing.
  }
}

/** Fires a cue on both channels, honouring each one's switch. */
export function cue(name: Cue): void {
  if (settings.sound) play(name);
  buzz(name);
}

/**
 * The vocabulary the screens use.
 *
 * Named for what happened, not what it sounds like, so the mapping above stays
 * the only thing that has to change when the character of the app is retuned.
 */
export const feedback = {
  /** A button or chrome control was pressed. */
  tap: () => cue('tap'),
  /** A choice or tile was picked. */
  select: () => cue('select'),
  /** A switch flipped — furigana, sound, haptics. */
  toggle: () => cue('toggle'),
  /** Navigating back, or out of a pass. */
  back: () => cue('back'),
  /** An answer landed correct. */
  correct: () => cue('correct'),
  /** An answer landed wrong. */
  wrong: () => cue('wrong'),
  /** An explanation or answer was revealed. */
  reveal: () => cue('reveal'),
  /** Moving to the next card or lesson step. */
  advance: () => cue('advance'),
  /** A session finished. */
  complete: () => cue('complete'),
  /** An item reached a new SRS stage, or the user levelled up. */
  levelUp: () => cue('levelup'),
  /** A run of correct answers passed a milestone. */
  streak: () => cue('streak'),
} as const;
