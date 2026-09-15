#!/usr/bin/env python3
"""
Synthesises the interface sounds into `assets/sfx/`.

The sounds are generated rather than sourced so they are licence-free, tiny,
and — the actual reason — *tunable*. A sound effect that is 40ms too long or a
semitone too bright is the difference between a cue that rewards and one that
nags on the four-hundredth review, and that is not something you can fix in a
downloaded wav. Re-run after changing anything here:

    python scripts/make-sfx.py

Everything is built from one voice: a struck tone with a handful of harmonics,
doubled by a slightly detuned copy, and given a short room. The detune is what
makes it sound like an instrument rather than an oscillator — two voices a few
cents apart beat slowly against each other, which is most of what "full" means
here — and the room is what stops each cue ending in a hard wall of silence.

All pitches come from A major pentatonic, so no two cues can clash if they
overlap: an answer landing while the streak chime is still ringing stays
consonant. Descending motion, not dissonance, is what marks a wrong answer —
being told off in a minor second is a worse teacher than being told off gently.

The chrome cues (`tap`, `select`, `toggle`, `back`, `advance`) get almost no
room and stay short. They fire an order of magnitude more often than anything
else, and reverb on a sound you hear six times a minute turns into smear.
"""
import math
import os
import struct
import wave

# 22.05kHz: the highest partial any cue generates is under 5kHz, so this is
# transparent here and halves what the bundle carries.
RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sfx')

# A major pentatonic, the scale every cue is drawn from.
A3, E4, A4, B4, CS5, E5, FS5, A5, B5, CS6, E6, A6 = (
    220.00, 329.63, 440.00, 493.88, 554.37, 659.25, 739.99,
    880.00, 987.77, 1108.73, 1318.51, 1760.00
)
F4, G4, D5 = 349.23, 392.00, 587.33  # only for the descending "wrong" figure

# Relative weights of the first six partials. A gentler rolloff than a pure
# sine stack: the upper partials are what carry over a phone speaker, which has
# no low end to reproduce in the first place.
HARMONICS = (1.0, 0.42, 0.22, 0.12, 0.07, 0.04)

# Cents of detune between the two voices. Small enough to read as one note,
# large enough to beat audibly over a half-second ring.
DETUNE = 7.0


def _partials(freq, dur, amp, decay, attack, harmonics):
    """One oscillator: harmonics over an exponential decay."""
    frames = int(RATE * dur)
    attack_frames = max(1, int(RATE * attack))
    out = [0.0] * frames

    for i in range(frames):
        t = i / RATE
        env = math.exp(-decay * t)
        if i < attack_frames:
            # Without a ramp the waveform starts at a discontinuity and every
            # note gets a click in front of it.
            env *= i / attack_frames
        sample = 0.0
        for partial, weight in enumerate(harmonics, start=1):
            if weight == 0.0:
                continue
            # Harmonics decay faster than the fundamental, which is what makes
            # a struck bar sound struck rather than bowed.
            sample += weight * math.exp(-decay * 0.55 * partial * t) * math.sin(
                2 * math.pi * freq * partial * t
            )
        out[i] = amp * env * sample
    return out


def tone(freq, dur, amp=0.5, decay=14.0, attack=0.004, harmonics=HARMONICS,
         detune=DETUNE, body=0.18):
    """One struck note, as two detuned voices plus an octave-down body.

    `decay` is the exponential rate, so a bigger number is a shorter ring.
    `body` adds a quiet sub-octave sine — it does almost nothing on a phone
    speaker and a lot on headphones, which is the cheapest width available.
    """
    ratio = 2 ** (detune / 1200.0)
    left = _partials(freq, dur, amp * 0.6, decay, attack, harmonics)
    right = _partials(freq * ratio, dur, amp * 0.6, decay, attack, harmonics)
    out = [a + b for a, b in zip(left, right)]

    if body:
        low = _partials(freq / 2, dur, amp * body, decay * 0.8, attack, (1.0,))
        out = [a + b for a, b in zip(out, low)]
    return out


def noise(dur, amp=0.2, decay=90.0, seed=7, colour=0.4):
    """A pinched burst of noise, for the click in front of a tap."""
    frames = int(RATE * dur)
    state = seed
    out = [0.0] * frames
    prev = 0.0
    for i in range(frames):
        # Deterministic LCG — the committed wavs should be byte-identical on
        # any machine that re-runs this script.
        state = (1103515245 * state + 12345) % (1 << 31)
        white = (state / (1 << 30)) - 1.0
        # One-pole lowpass, so it reads as a soft tick rather than a hiss.
        prev = prev * (1 - colour) + white * colour
        out[i] = amp * math.exp(-decay * (i / RATE)) * prev
    return out


def reverb(samples, mix=0.26, room=0.80, tail=0.7):
    """A small room, as four feedback combs into a lowpass.

    Not a good reverb — four combs with no allpass diffusion is the crudest
    thing that works — but these are 300ms cues where the tail is felt rather
    than listened to, and anything more costs file size for detail nobody hears
    through a phone speaker.
    """
    if mix <= 0.0:
        return samples

    length = len(samples) + int(RATE * tail)
    dry = samples + [0.0] * (length - len(samples))
    wet = [0.0] * length

    # Mutually prime-ish delays, so the combs do not reinforce into a pitch.
    for seconds, feedback in ((0.0297, 0.86), (0.0371, 0.83), (0.0411, 0.80), (0.0437, 0.77)):
        delay = int(RATE * seconds)
        gain = feedback * room
        buffer = [0.0] * length
        for i in range(length):
            value = dry[i]
            if i >= delay:
                value += buffer[i - delay] * gain
            buffer[i] = value
            wet[i] += value * 0.25

    # Darken the tail. A bright reverb on a struck tone sounds like a tiled
    # bathroom; rolling the top off leaves warmth without the splash.
    prev = 0.0
    for i in range(length):
        prev = prev * 0.62 + wet[i] * 0.38
        wet[i] = prev

    return [dry[i] * (1.0 - mix * 0.35) + wet[i] * mix for i in range(length)]


def mix_layers(*layers):
    """Overlays layers of different lengths, padding to the longest."""
    length = max(len(layer) for layer in layers)
    out = [0.0] * length
    for layer in layers:
        for i, value in enumerate(layer):
            out[i] += value
    return out


def at(offset_s, samples):
    """Delays a layer by `offset_s`, so notes can be placed on a timeline."""
    return [0.0] * int(RATE * offset_s) + samples


def sequence(notes, amp=0.5, dur=0.6, decay=12.0):
    """`notes` is (time_in_seconds, frequency) pairs."""
    return mix_layers(*[at(t, tone(f, dur, amp=amp, decay=decay)) for t, f in notes])


def trim(samples, floor=0.003):
    """Drops the inaudible tail the reverb leaves behind.

    A comb reverb decays towards zero but never reaches it, so every cue ends
    with a long stretch of samples too quiet to hear and expensive to ship —
    the tap was three-quarters silence before this. Cut at roughly -50dB of
    peak, which is below anything a phone speaker reproduces.
    """
    high = max(abs(s) for s in samples) or 1.0
    threshold = high * floor
    end = len(samples)
    while end > 1 and abs(samples[end - 1]) < threshold:
        end -= 1
    # A handful of samples of headroom, then a short ramp, so the cut itself
    # does not become the click this whole file is designed to avoid.
    end = min(len(samples), end + 64)
    out = samples[:end]
    fade = min(128, len(out))
    for i in range(fade):
        out[len(out) - fade + i] *= 1.0 - (i / fade)
    return out


def write(name, samples, peak=0.80):
    """Trims, normalises to `peak` and writes 16-bit mono.

    Normalising matters more than it looks: these play at whatever volume the
    phone is at, and one cue that is 6dB hotter than the others is the one the
    user turns the sound off over.
    """
    os.makedirs(OUT, exist_ok=True)
    samples = trim(samples)
    high = max(abs(s) for s in samples) or 1.0
    scale = peak / high
    frames = b''.join(
        struct.pack('<h', max(-32768, min(32767, int(s * scale * 32767))))
        for s in samples
    )
    path = os.path.join(OUT, name + '.wav')
    with wave.open(path, 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(frames)
    print('%-12s %5.2fs  %6.1f KB' % (name, len(samples) / RATE, len(frames) / 1024))


SOUNDS = {
    # -- chrome ----------------------------------------------------------
    # Short, dry and quiet enough to sit under a fast tapping rhythm. These
    # fire constantly, so they are the ones that have to stay out of the way.
    'tap': lambda: reverb(
        mix_layers(noise(0.03, amp=0.5), tone(CS6, 0.09, amp=0.24, decay=55, body=0.0)),
        mix=0.08, tail=0.15,
    ),
    'select': lambda: reverb(tone(E5, 0.22, amp=0.40, decay=28), mix=0.16, tail=0.25),
    # Two notes a step apart, up for on and the same figure down for off is not
    # worth a second file — one neutral blip reads as "that switched".
    'toggle': lambda: reverb(
        sequence([(0.0, B4), (0.045, FS5)], amp=0.34, dur=0.26, decay=26),
        mix=0.14, tail=0.25,
    ),
    'back': lambda: reverb(
        sequence([(0.0, E5), (0.05, B4)], amp=0.30, dur=0.26, decay=26),
        mix=0.12, tail=0.22,
    ),
    'advance': lambda: reverb(
        mix_layers(noise(0.045, amp=0.35, decay=70),
                   tone(B4, 0.18, amp=0.26, decay=36, body=0.0)),
        mix=0.10, tail=0.2,
    ),

    # -- answer feedback -------------------------------------------------
    # Three notes rather than two, so each reads as a small phrase with an
    # ending rather than as a beep. Rising for right, falling for wrong.
    'correct': lambda: reverb(
        sequence([(0.0, E5), (0.065, A5), (0.13, CS6)], amp=0.46, dur=0.85, decay=8),
        mix=0.30, tail=0.75,
    ),
    'wrong': lambda: reverb(
        sequence([(0.0, D5), (0.08, A4), (0.17, F4)], amp=0.40, dur=0.9, decay=7),
        mix=0.26, tail=0.7,
    ),

    # The verdict card arriving — a swell rather than a strike, so it reads as
    # information appearing and not as a second judgement on the answer.
    'reveal': lambda: reverb(
        tone(A4, 0.5, amp=0.30, decay=7, attack=0.07, harmonics=(1.0, 0.22, 0.08, 0.03)),
        mix=0.28, tail=0.6,
    ),

    # -- endings ---------------------------------------------------------
    # Allowed to be longer and brighter — they happen once.
    'complete': lambda: reverb(
        sequence([(0.0, A4), (0.09, CS5), (0.18, E5), (0.27, A5)], amp=0.44, dur=0.95, decay=6),
        mix=0.34, tail=1.0,
    ),
    'levelup': lambda: reverb(
        mix_layers(
            sequence([(0.0, A4), (0.085, CS5), (0.17, E5), (0.255, A5), (0.36, CS6)],
                     amp=0.44, dur=1.2, decay=4.5),
            # A shimmer over the top, quiet and high, to mark this as the bigger
            # of the two endings without simply making it louder.
            at(0.36, tone(E6, 0.9, amp=0.13, decay=4, harmonics=(1.0, 0.5, 0.25), body=0.0)),
            at(0.46, tone(A6, 0.8, amp=0.08, decay=4.5, harmonics=(1.0, 0.4), body=0.0)),
            # And a low root underneath, which is what stops a bright fanfare
            # sounding thin on a phone.
            at(0.0, tone(A3, 1.4, amp=0.20, decay=3.2, harmonics=(1.0, 0.3, 0.1))),
        ),
        mix=0.34, tail=1.1,
    ),
    'streak': lambda: reverb(
        sequence([(0.0, B5), (0.065, E6), (0.13, CS6)], amp=0.32, dur=0.55, decay=15),
        mix=0.26, tail=0.5,
    ),
}

if __name__ == '__main__':
    for name, build in SOUNDS.items():
        write(name, build())
