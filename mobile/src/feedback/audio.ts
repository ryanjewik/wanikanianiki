/**
 * The sound engine behind `feedback`.
 *
 * Nine short cues, each on its own `AudioPlayer` held for the life of the
 * process. One player per sound rather than one shared player, because a
 * player cannot overlap itself: answer a card fast and `correct` has to be
 * able to start again while the previous ring is still decaying.
 *
 * Playing is `seekTo(0)` then `play()` — the players are never released, so a
 * cue after the first costs no load.
 *
 * **Everything here is best-effort and silent on failure.** `expo-audio` is a
 * native module: a build made before it was added has the JavaScript but not
 * the native side, and a throwing sound effect is a far worse outcome than a
 * quiet one. Every entry point is wrapped, and the engine simply reports
 * itself unavailable.
 */
export type Cue =
  | 'tap'
  | 'select'
  | 'toggle'
  | 'back'
  | 'correct'
  | 'wrong'
  | 'reveal'
  | 'advance'
  | 'complete'
  | 'levelup'
  | 'streak';

/** Metro needs literal paths, so the cues are mapped rather than built. */
const SOURCES: Record<Cue, number> = {
  tap: require('../../assets/sfx/tap.wav'),
  select: require('../../assets/sfx/select.wav'),
  toggle: require('../../assets/sfx/toggle.wav'),
  back: require('../../assets/sfx/back.wav'),
  correct: require('../../assets/sfx/correct.wav'),
  wrong: require('../../assets/sfx/wrong.wav'),
  reveal: require('../../assets/sfx/reveal.wav'),
  advance: require('../../assets/sfx/advance.wav'),
  complete: require('../../assets/sfx/complete.wav'),
  levelup: require('../../assets/sfx/levelup.wav'),
  streak: require('../../assets/sfx/streak.wav'),
};

/**
 * Per-cue trim, on top of the normalisation the generator already applies.
 *
 * The generator makes every file peak at the same level; this is the
 * *musical* balance on top of that. `tap` and `advance` fire constantly and
 * belong under the content, while an ending is allowed to be heard.
 */
const GAIN: Record<Cue, number> = {
  tap: 0.35,
  select: 0.45,
  toggle: 0.45,
  back: 0.38,
  correct: 0.75,
  wrong: 0.7,
  reveal: 0.5,
  advance: 0.4,
  complete: 0.85,
  levelup: 0.9,
  streak: 0.6,
};

interface Player {
  volume: number;
  play(): void;
  seekTo(seconds: number): void;
}

let audio: typeof import('expo-audio') | null = null;
try {
  audio = require('expo-audio');
} catch {
  // No native module in this build. `available` stays false and every cue
  // below is a no-op.
}

const players = new Map<Cue, Player>();
let primed = false;

/** False when the native module is missing, so callers can hide a sound toggle. */
export const available = audio !== null;

/**
 * Creates every player and configures the audio session.
 *
 * Called once from the root layout. Preloading is the point: a player built on
 * first use adds decode latency to exactly the cue where timing matters most,
 * the one that fires the instant an answer lands.
 */
export function prime(): void {
  if (primed || !audio) return;
  primed = true;

  try {
    // `playsInSilentMode: false` is the deliberate choice. These are interface
    // sounds, not content — a phone on silent should stay silent, and an app
    // that overrides the hardware switch to play a blip is one people mute in
    // settings and never turn back on.
    //
    // `mixWithOthers` so studying over a podcast does not stop the podcast.
    void audio.setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
  } catch {
    // Session config is a nicety; the cues still play without it.
  }

  for (const cue of Object.keys(SOURCES) as Cue[]) {
    try {
      const player = audio.createAudioPlayer(SOURCES[cue]) as unknown as Player;
      player.volume = GAIN[cue];
      players.set(cue, player);
    } catch {
      // One cue failing should not cost the other eight.
    }
  }
}

/** Plays a cue from the top. Silent — never throws — if anything is missing. */
export function play(cue: Cue): void {
  if (!audio) return;
  if (!primed) prime();

  const player = players.get(cue);
  if (!player) return;

  try {
    // Rewind first: a cue retriggered before it finished should restart rather
    // than be ignored, which is what a bare `play()` on a playing player does.
    player.seekTo(0);
    player.play();
  } catch {
    // A player can be torn down under us on Android when audio focus is lost.
  }
}
