"""Where one study day ends and the next begins.

No database and no network: these pin the boundary logic itself, which is the
part a streak is only as correct as.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.services.dates import (
    DEFAULT_TIMEZONE,
    is_valid_timezone,
    resolve_timezone,
    timezone_name,
    today_in,
)


def test_a_real_zone_is_accepted():
    assert is_valid_timezone("America/Los_Angeles")
    assert timezone_name("America/Los_Angeles") == "America/Los_Angeles"


@pytest.mark.parametrize(
    "value",
    [None, "", "Mars/Olympus_Mons", "PST8PDT7", "'; drop table users; --"],
)
def test_anything_unrecognised_falls_back_to_utc(value):
    """Client-supplied and therefore untrusted — an unknown zone is ignored, not fatal."""
    assert not is_valid_timezone(value)
    assert timezone_name(value) == DEFAULT_TIMEZONE
    assert str(resolve_timezone(value)) == DEFAULT_TIMEZONE


def test_an_evening_in_california_is_still_that_day_locally():
    """The bug this module exists for.

    6pm on the 3rd in Los Angeles is already the 4th in UTC. Filing that session
    under the 4th credits the wrong calendar square, and two such evenings in a
    row collapse into one day — which reads as a broken streak.
    """
    evening_pst = datetime(2026, 9, 4, 1, 30, tzinfo=timezone.utc)  # 18:30 on the 3rd

    assert today_in("UTC", now=evening_pst) == date(2026, 9, 4)
    assert today_in("America/Los_Angeles", now=evening_pst) == date(2026, 9, 3)


def test_a_morning_in_tokyo_is_already_tomorrow():
    """The same error in the other direction, for a zone ahead of UTC."""
    morning_jst = datetime(2026, 9, 3, 23, 0, tzinfo=timezone.utc)  # 08:00 on the 4th

    assert today_in("UTC", now=morning_jst) == date(2026, 9, 3)
    assert today_in("Asia/Tokyo", now=morning_jst) == date(2026, 9, 4)


def test_a_naive_datetime_is_refused():
    """Converting one would reinvent the ambiguity this module removes."""
    with pytest.raises(ValueError):
        today_in("America/Los_Angeles", now=datetime(2026, 9, 4, 1, 30))
