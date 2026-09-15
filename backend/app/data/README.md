# Vendored reference data

## `jlpt_kanji.json`

Which JLPT tier each kanji is taught at, and the WaniKani level that teaches
it. Derived from [`davidluzgouveia/kanji-data`][src] — the `jlpt_new` and
`wk_level` fields of `kanji.json`, for the 2,211 kanji that carry a tier.

`jlpt_new` is the post-2010 five-tier scale, the one the exam actually uses;
the dataset also carries `jlpt_old` from the pre-2010 four-tier scale, which is
deliberately not imported.

**A one-time seed, not a live dependency.** Nothing fetches this at runtime and
it does not need refreshing on a schedule — the JLPT kanji lists have been
stable since the 2010 reform. `scripts/backfill_jlpt.py` reads it.

### Why the full set and not `kanji-wanikani.json`

That subset exists and would have been smaller, but it makes a dishonest
denominator. WaniKani teaches every N5–N2 kanji, and only 971 of the 1,232 N1
kanji:

| tier | all kanji | taught by WaniKani |
|-----:|----------:|-------------------:|
| N5   |        79 |                 79 |
| N4   |       166 |                166 |
| N3   |       367 |                367 |
| N2   |       367 |                367 |
| N1   |     1,232 |                971 |

Coverage toward N1 measured against 971 would read as complete while 261 kanji
on the exam were still unseen. The extra rows cost 8KB.

`wanikaniLevels` is kept for the sanity check the design note asked for: a
kanji whose upstream `wk_level` disagrees with our own `subjects.level` means
the two datasets have drifted apart.

### Not covered: vocabulary

`kanji-data` is kanji only. `subjects.jlpt_level` therefore stays null for
WaniKani vocabulary and for radicals — radicals correctly, since they are not
JLPT items, but vocabulary is a real gap. The design note names
`elzup/jlpt-word-list` for it and says the licence should be checked before
use; that has not been done, so no vocabulary list is vendored here.

[src]: https://github.com/davidluzgouveia/kanji-data

---

## Upstream licence

MIT License

Copyright (c) 2019 David Gouveia

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
