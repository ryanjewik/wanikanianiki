"""JLPT coverage arithmetic.

The database half is covered by the integration suite; what is worth testing
without one is the part that is easy to get quietly wrong — where the
denominator comes from, and what counts as known.
"""

from __future__ import annotations

from app.services.jlpt import TIERS, tier_of, totals


def test_tiers_run_easiest_first():
    """N5 first. The exam numbers them the other way, and a ladder drawn
    hardest-first reads as going backwards."""
    assert TIERS == (5, 4, 3, 2, 1)


def test_denominators_come_from_the_reference_list():
    """Not from `subjects`, which holds only what a user has synced.

    This is the whole reason the reference data is vendored. Counting the
    denominator out of our own table would make every tier read as complete the
    moment it was unlocked, which is the opposite of what a coverage bar is
    for.
    """
    assert totals() == {5: 79, 4: 166, 3: 367, 2: 367, 1: 1232}
    assert sum(totals().values()) == 2211


def test_every_tier_has_a_denominator():
    """A missing tier would divide by zero in the client rather than here."""
    assert set(totals()) == set(TIERS)
    assert all(count > 0 for count in totals().values())


def test_the_lookup_is_keyed_by_character():
    levels = tier_of()
    assert levels["一"] == 5
    assert levels["愛"] == 3
    # Kanji outside every list are absent, so a lookup returns None and the
    # character counts toward no tier at all.
    assert levels.get("鬱") is None


def test_the_lookup_is_cached():
    """Read once per process: this is called per request and the file is 50KB."""
    assert tier_of() is tier_of()
    assert totals() is totals()
