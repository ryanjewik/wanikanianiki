/**
 * Diffs the TypeScript grader against the Python one.
 *
 * `src/data/grading.ts` is a hand port of `backend/app/services/srs.py`, and a
 * port that drifts is the worst outcome available here: the phone shows one
 * verdict and the deck records the other. Nothing in either language's test
 * suite can catch that, because the bug lives in the gap between them.
 *
 *   node --experimental-strip-types scripts/check-grading-parity.mjs
 *
 * Exits non-zero on the first disagreement, naming the input.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { normalise, matches } from '../src/data/grading.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '../../backend');

/** Shapes that actually appear on the textbook pages we extract, plus the
 *  input variants a phone keyboard produces. */
const CORPUS = [
  // Parenthesised qualifiers the page prints and nobody types.
  '決心（する）', '決心する', '結婚（する）', '[〜が]苦手な', '苦手な',
  '[病気を]なおす', 'なおす', '〜について', 'について',
  // Words from the pages we measured.
  'つまり', '働き始める', '免許', 'めんきょ', '食べる', 'たべる',
  // Width and composition variants.
  'ﾒﾝｷｮ', 'ａｂｃ', 'abc', 'ｶﾞ', 'が',
  // English glosses, already split on semicolons server-side.
  'to save', 'to help [vt.]', 'partner', 'the other person', 'other person',
  'a lot', 'an apple', 'The Other Person', '  to  eat  ', 'eat!', 'eat.',
  // Degenerate input.
  '', '   ', '（する）', '[]', '...', '〜',
];

const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(backend)})
from app.services.srs import normalise, matches
payload = json.loads(sys.stdin.read())
print(json.dumps({
    "normalised": [normalise(v) for v in payload["corpus"]],
    "matched": [matches(g, a) for g, a in payload["pairs"]],
}))
`;

// Every ordered pair, so matching is checked across the whole corpus rather
// than only where we guessed a disagreement might be.
const pairs = [];
for (const given of CORPUS) {
  for (const accepted of CORPUS) pairs.push([given, [accepted]]);
}
// Multi-answer cards: the real shape of a production card.
pairs.push(['免許', ['免許', 'めんきょ']]);
pairs.push(['めんきょ', ['免許', 'めんきょ']]);
pairs.push(['めんきよ', ['免許', 'めんきょ']]);
pairs.push(['partner', ['partner', 'the other person']]);
pairs.push(['the other person', ['partner', 'the other person']]);
pairs.push(['nonsense', ['partner', 'the other person']]);

/**
 * The venv interpreter, which is not in the same place on every platform:
 * POSIX puts it in `bin/python`, Windows in `Scripts/python.exe`. Hardcoding
 * the POSIX path meant this check silently refused to run on Windows — on the
 * one script the grading hazard depends on being runnable.
 */
const venvPython = () => {
  const candidates =
    process.platform === 'win32'
      ? ['.venv/Scripts/python.exe', '.venv/bin/python']
      : ['.venv/bin/python', '.venv/Scripts/python.exe'];
  for (const candidate of candidates) {
    const full = path.join(backend, candidate);
    if (existsSync(full)) return full;
  }
  throw new Error(
    `No virtualenv interpreter under ${backend}. Create it, then re-run: the ` +
      'Python grader is half of what this script compares.',
  );
};

const python = JSON.parse(
  execFileSync(
    venvPython(),
    ['-c', PY],
    {
      input: JSON.stringify({ corpus: CORPUS, pairs }),
      encoding: 'utf8',
      // Node writes the payload as UTF-8, but Python picks its stdio encoding
      // from the locale — cp1252 on a default Windows install, which mangles
      // every wave dash and fullwidth letter in the corpus and reports the
      // damage as grader drift. The corpus is almost entirely non-ASCII, so
      // this is not a detail.
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    },
  ),
);

let failures = 0;

CORPUS.forEach((value, i) => {
  const ours = normalise(value);
  const theirs = python.normalised[i];
  if (ours !== theirs) {
    failures += 1;
    console.error(
      `normalise(${JSON.stringify(value)}): ts=${JSON.stringify(ours)} py=${JSON.stringify(theirs)}`,
    );
  }
});

pairs.forEach(([given, accepted], i) => {
  const ours = matches(given, accepted);
  const theirs = python.matched[i];
  if (ours !== theirs) {
    failures += 1;
    console.error(
      `matches(${JSON.stringify(given)}, ${JSON.stringify(accepted)}): ts=${ours} py=${theirs}`,
    );
  }
});

const checks = CORPUS.length + pairs.length;
if (failures > 0) {
  console.error(`\n${failures} disagreement(s) across ${checks} checks.`);
  process.exit(1);
}
console.log(`Graders agree across ${checks} checks.`);
