/**
 * A text field that knows which language it is asking for.
 *
 * Two mechanisms, because neither is enough alone:
 *
 * - **A keyboard hint** (Android). The field tells the keyboard it wants
 *   Japanese or English, and Gboard / Samsung Keyboard flip to that layout —
 *   so a review alternating reading and meaning no longer needs the globe key
 *   on every card. It is a hint, not a switch: with no Japanese layout
 *   installed, nothing happens. iOS has no equivalent short of subclassing the
 *   native text field, so there the hint is skipped.
 * - **Romaji to kana**, for fields whose answer can be written in kana. This
 *   works on any keyboard, which is what covers the case the hint cannot. It is
 *   the same conversion WaniKani's own answer field does, via the same library.
 *   Text a Japanese keyboard already produced passes through untouched, so the
 *   two do not fight: the conversion only ever rewrites Latin letters.
 */
import * as React from 'react';
import { findNodeHandle, TextInput, type TextInputProps } from 'react-native';
import { toKana } from 'wanakana';

import KeyboardLanguage from '../../modules/keyboard-language';

export type InputLanguage = 'ja' | 'en';

const LOCALES: Record<InputLanguage, string[]> = {
  ja: ['ja-JP'],
  en: ['en-US'],
};

// Hiragana, katakana, CJK ideographs (plus extension A), half-width katakana.
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

/** Which language an expected answer is written in. */
export function languageOf(text: string): InputLanguage {
  return JAPANESE.test(text) ? 'ja' : 'en';
}

/**
 * Settles what the as-you-type conversion deliberately leaves open.
 *
 * While typing, a trailing `n` stays Latin because the next letter decides
 * whether it is ん or the start of な/に/…. On submit there is no next letter,
 * so it becomes ん. Call this on the answer of a `kana` field before grading
 * it — and only then, since it would happily turn an English answer into kana.
 *
 * Width is folded first because a Japanese keyboard leaves the same dangling
 * letter behind in full width: Gboard commits a pending `n` as `ｎ` on Enter,
 * which the converter does not read as romaji. The graders fold width anyway
 * (NFKC), so this changes nothing else about what is accepted.
 */
export function finishKana(text: string): string {
  return toKana(text.normalize('NFKC'));
}

type FocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];

type Props = Omit<TextInputProps, 'onChangeText'> & {
  language: InputLanguage;
  /** Convert typed romaji to kana as it is typed. */
  kana?: boolean;
  onChangeText: (text: string) => void;
};

export function LanguageInput({ language, kana = false, onChangeText, onFocus, ...rest }: Props) {
  const ref = React.useRef<TextInput>(null);

  const hint = React.useCallback(() => {
    if (!KeyboardLanguage) return;
    const tag = findNodeHandle(ref.current);
    if (tag == null) return;
    // Best-effort: a keyboard that ignores the hint is the normal case on some
    // devices, and never worth surfacing.
    KeyboardLanguage.setHintLocales(tag, LOCALES[language]).catch(() => {});
  }, [language]);

  // On mount so the keyboard opens in the right language on first tap, and on
  // every change so a field that stays focused across cards follows along.
  React.useEffect(hint, [hint]);

  const handleFocus = React.useCallback(
    (event: FocusEvent) => {
      // Again on focus: the mount-time call can land before the native view
      // exists, and repeating it is a no-op when the hint is already set.
      hint();
      onFocus?.(event);
    },
    [hint, onFocus],
  );

  const handleChange = React.useCallback(
    (text: string) => onChangeText(kana ? toKana(text, { IMEMode: true }) : text),
    [kana, onChangeText],
  );

  return <TextInput ref={ref} {...rest} onFocus={handleFocus} onChangeText={handleChange} />;
}
