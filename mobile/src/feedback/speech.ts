/**
 * Reading the material aloud.
 *
 * Separate from `feedback` on purpose. The cues in that module are interface
 * sounds — they can be switched off, they are mixed under the content, and
 * they carry no information you cannot also see. This is the opposite: it is
 * the *content*, it is the whole point of the control that triggers it, and a
 * reading is worth hearing even when the blips are muted.
 *
 * A kanji has no single correct pronunciation in isolation, so the caller
 * decides what to speak: a vocabulary word reads as itself, while a kanji or
 * radical has to be handed its reading instead of its glyph.
 *
 * Best-effort throughout, like the cue engine — `expo-speech` is a native
 * module, and a build predating it should fall quiet rather than crash.
 */
import { Platform } from 'react-native';

let speech: typeof import('expo-speech') | null = null;
try {
  speech = require('expo-speech');
} catch {
  // No native module in this build; `speechAvailable` reports it.
}

export const speechAvailable = speech !== null;

/**
 * Speaks Japanese text.
 *
 * `rate` sits below 1 because the system Japanese voice at full speed is too
 * quick to be useful to someone still learning to hear the morae — the point
 * is to be imitated, not to be efficient.
 *
 * Whether a Japanese voice exists at all is the platform's business: both
 * systems fall back to something rather than failing, and a wrong-sounding
 * reading is still more useful than a control that does nothing.
 */
export function speakJapanese(text: string): void {
  if (!speech || !text) return;

  try {
    // Stop first so tapping twice re-reads rather than queueing a second
    // utterance behind the first — `speak` queues by default.
    speech.stop();
    speech.speak(text, { language: 'ja-JP', rate: 0.85, pitch: 1.0 });
  } catch {
    // No voice data installed, or the engine refused.
  }
}

export function stopSpeaking(): void {
  try {
    speech?.stop();
  } catch {
    // Nothing was speaking.
  }
}

/**
 * iOS honours the hardware silent switch for speech and cannot be made to
 * ignore it without claiming the audio session outright — which would be the
 * wrong trade for a study app. Surfaced so a screen can explain a silent
 * button rather than leave the user tapping it.
 */
export const mutedBySilentSwitch = Platform.OS === 'ios';
