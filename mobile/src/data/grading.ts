/**
 * Client-side answer grading.
 *
 * A deliberate duplicate of `backend/app/services/srs.py`. The server grades
 * every answer and its verdict is what gets written to the deck — but the
 * phone has to show a result the instant you hit enter, and offline it has to
 * show one with no server at all. That means two graders, and two graders that
 * disagree are worse than none: you would see "correct", and the deck would
 * quietly record a lapse.
 *
 * So this is a port, not a reimplementation. Keep it in step with the Python
 * when either side changes; `scripts/check-grading-parity.mjs` diffs the two
 * over a corpus of real textbook answers.
 */

/**
 * Fold away everything that is not the answer.
 *
 * Japanese input arrives with width and composition variants that are the same
 * character to a reader — ﾒﾝｷｮ against めんきょ, ａ against a — so NFKC first.
 * Then the punctuation a textbook prints around a word but nobody types:
 * 決心（する）is answered "決心", and [〜が]苦手な is answered "苦手な".
 *
 * English gets case and article folding, because "the other person" and "other
 * person" are the same answer and marking one wrong teaches nothing.
 */
export function normalise(value: string): string {
  let out = value.normalize('NFKC').trim().toLowerCase();
  // Bracketed or parenthesised qualifiers: (polite), （する）, [vt.]
  out = out.replace(/[（([][^）)\]]*[）)\]]/g, '');
  // Textbook placeholders and separators that are not part of the answer.
  out = out.replace(/〜/g, '').replace(/~/g, '');
  out = out.replace(/^(to|a|an|the)\s+/, '');
  out = out.replace(/[\s.,!?;:・…'"’]+/g, '');
  return out;
}

/**
 * Whether a typed answer counts.
 *
 * Any accepted value matching is enough — that is the whole point of the card
 * carrying them as a list. A card asking for the Japanese ships both the
 * written form and the reading, so 免許 and めんきょ are both right; one asking
 * for the meaning ships every gloss the page printed, already split on
 * semicolons server-side, so "partner" is right even though the line read
 * "partner; the other person".
 */
export function matches(given: string, accepted: string[]): boolean {
  if (!given.trim()) return false;
  const needle = normalise(given);
  if (!needle) return false;
  return accepted.some((value) => value.trim() !== '' && normalise(value) === needle);
}

/**
 * Typo tolerance for WaniKani review answers, meanings and readings both.
 *
 * Not part of the port above: the server never grades a WaniKani review —
 * WaniKani only ever receives the incorrect counts — so this has no Python
 * twin to keep in step with.
 *
 * The allowance grows with the answer, the way WaniKani's own does for
 * meanings: none for three letters or fewer, where one letter is a different
 * word (cat, cut), one up to six letters, two beyond that.
 *
 * Readings get their own, tighter scale (`readingTypoAllowance`), because kana
 * are denser than letters — a two-kana word changed by one kana is simply a
 * different word (えき, いき). The known cost, accepted by choice: a near miss
 * such as きょ for きょう now passes, with the right reading shown after.
 */
export type TypoVerdict =
  | { result: 'exact' }
  | { result: 'close'; intended: string }
  | { result: 'wrong' };

export function typoAllowance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

/** None up to two kana, one up to five, two beyond. */
export function readingTypoAllowance(length: number): number {
  if (length <= 2) return 0;
  if (length <= 5) return 1;
  return 2;
}

export function gradeMeaning(given: string, accepted: string[]): TypoVerdict {
  return gradeWithLeeway(given, accepted, [], normalise, typoAllowance);
}

/**
 * `rejected` are readings the subject has but does not accept here — a kanji's
 * other yomi. Typing one exactly is a knowledge miss, not a typo, so it is
 * never let through as "close" to an accepted reading one kana away.
 */
export function gradeReading(given: string, accepted: string[], rejected: string[] = []): TypoVerdict {
  return gradeWithLeeway(given, accepted, rejected, normaliseKana, readingTypoAllowance);
}

function normaliseKana(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '');
}

function gradeWithLeeway(
  given: string,
  accepted: string[],
  rejected: string[],
  fold: (value: string) => string,
  allowance: (length: number) => number,
): TypoVerdict {
  const needle = fold(given);
  if (!needle) return { result: 'wrong' };
  if (accepted.some((value) => fold(value) === needle)) return { result: 'exact' };
  if (rejected.some((value) => fold(value) === needle)) return { result: 'wrong' };

  let best: { value: string; distance: number } | null = null;
  for (const value of accepted) {
    const target = fold(value);
    if (!target) continue;
    const distance = editDistance(needle, target);
    if (distance <= allowance(target.length) && (!best || distance < best.distance)) {
      best = { value, distance };
    }
  }
  return best ? { result: 'close', intended: best.value } : { result: 'wrong' };
}

/**
 * Edits to turn `a` into `b`: an insert, a delete, a substitution, or two
 * neighbours swapped each count as one. The swap matters — "freind" is the
 * commonest typo there is, and plain Levenshtein charges it two.
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}
