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
