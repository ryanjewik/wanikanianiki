/**
 * Japanese text with the readings written above the kanji.
 *
 * React Native has no `<ruby>`, and `Text` cannot stack anything over part of
 * itself, so this is built out of boxes: the string is broken into tokens and
 * laid out as a wrapping row, where a glossed word becomes a two-line column
 * with its kana on top. That is the whole trick, and it is why this is a
 * component rather than a string transform.
 *
 * The cost of leaving `Text` behind is real — no text selection, and wrapping
 * happens between tokens rather than by the platform's line breaker. Japanese
 * wraps at almost any character, so per-character tokens give nearly the same
 * result; for the Latin stretches in these prompts, whole words are kept
 * together so English does not break mid-word.
 *
 * Two sources of readings, because the questions come from two eras:
 *
 *   `furigana`  a map the generator now emits alongside the prompt.
 *   inline      older questions wrote them into the sentence — `相手 (あいて)`
 *               — which is exactly the thing that cannot be switched off.
 *               Those are lifted out of the text and treated as map entries,
 *               so the toggle works on questions written before it existed.
 */
import * as React from 'react';
import { StyleSheet, Text, type TextStyle, View } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

/**
 * A reading printed beside the word it belongs to — `相手 (あいて)`.
 *
 * **The leading whitespace is load-bearing.** A textbook also prints
 * `決心（する）` and `[〜が]苦手な`, where the bracketed kana is part of the
 * entry rather than a pronunciation gloss; treating those as readings would
 * change the word the question is asking about. The generator wrote a gloss
 * with a space in front and a qualifier without one, so that is what separates
 * them — and the capture is anchored on a kanji-initial word, so a parenthetical
 * after plain kana is left alone.
 */
const INLINE_GLOSS =
  /([一-鿿々〆][一-鿿々〆぀-ゟ゠-ヿ]*)\s+[（(]\s*([぀-ゟ゠-ヿ ー]+)\s*[）)]/g;

export interface Readings {
  /** Written form → kana, e.g. `{ '免許': 'めんきょ' }`. */
  map: Record<string, string>;
  /** The text with any inline glosses lifted out. */
  text: string;
}

/**
 * Pulls inline glosses out of `text` and folds them in with the supplied map.
 *
 * The supplied map wins: it is structured data from the generator, whereas an
 * inline gloss is a guess recovered from prose.
 */
export function extractReadings(text: string, supplied?: Record<string, string>): Readings {
  const map: Record<string, string> = {};
  const cleaned = text.replace(INLINE_GLOSS, (_match, word: string, reading: string) => {
    map[word] = reading.trim();
    return word;
  });

  return {
    // Collapses the space the gloss left behind, so 「免許 が必要です」 does not
    // read with a gap where the reading used to be.
    text: cleaned.replace(/\s{2,}/g, ' '),
    map: { ...map, ...(supplied ?? {}) },
  };
}

type Token =
  | { kind: 'ruby'; base: string; reading: string }
  | { kind: 'plain'; text: string };

/**
 * Splits `text` on the longest matching reading at each position.
 *
 * Longest-first matters: with both 勉強 and 強 in the map, scanning shortest
 * first would gloss the 強 inside 勉強 and leave 勉 bare.
 */
function tokenise(text: string, map: Record<string, string>): Token[] {
  const keys = Object.keys(map)
    .filter((key) => key.length > 0)
    .sort((a, b) => b.length - a.length);

  const tokens: Token[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (!buffer) return;
    // Latin runs stay whole so English does not break mid-word; everything
    // else goes per character, which is how Japanese wraps anyway.
    for (const piece of buffer.match(/[A-Za-z0-9'’\-.]+|\s+|[\s\S]/g) ?? []) {
      tokens.push({ kind: 'plain', text: piece });
    }
    buffer = '';
  };

  while (i < text.length) {
    const key = keys.find((candidate) => text.startsWith(candidate, i));
    if (key) {
      flush();
      tokens.push({ kind: 'ruby', base: key, reading: map[key] });
      i += key.length;
      continue;
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return tokens;
}

export interface FuriganaTextProps {
  text: string;
  /** Structured readings from the question payload. */
  furigana?: Record<string, string>;
  /** Off renders plain text and costs nothing. */
  show?: boolean;
  style?: TextStyle;
  /** Reading size. Defaults to just under half the base, the usual ruby ratio. */
  readingSize?: number;
}

export function FuriganaText({
  text,
  furigana,
  show = true,
  style,
  readingSize,
}: FuriganaTextProps) {
  const { text: cleaned, map } = React.useMemo(
    () => extractReadings(text, furigana),
    [text, furigana],
  );

  const tokens = React.useMemo(
    () => (show ? tokenise(cleaned, map) : []),
    [show, cleaned, map],
  );

  // Off, or nothing to gloss: a plain Text keeps selection and the platform's
  // own line breaking, both of which the boxed layout below gives up.
  if (!show || tokens.every((token) => token.kind === 'plain')) {
    return <Text style={style}>{cleaned}</Text>;
  }

  const base = (style?.fontSize as number) ?? 20;
  const ruby = readingSize ?? Math.max(9, Math.round(base * 0.45));
  // Reserved on every token, glossed or not, so the baselines of an entire
  // line agree — without it the bare characters ride up level with the kana.
  const gutter = ruby + 2;

  return (
    <View style={styles.row}>
      {tokens.map((token, index) =>
        token.kind === 'ruby' ? (
          <View key={index} style={styles.column}>
            <Text style={[styles.reading, { fontSize: ruby, lineHeight: gutter }]}>
              {token.reading}
            </Text>
            <Text style={style}>{token.base}</Text>
          </View>
        ) : (
          <View key={index} style={styles.column}>
            <View style={{ height: gutter }} />
            <Text style={style}>{token.text}</Text>
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  column: {
    alignItems: 'center',
  },
  reading: {
    fontFamily: fonts.sans.medium,
    color: colors.inkSoft,
    textAlign: 'center',
  },
});
