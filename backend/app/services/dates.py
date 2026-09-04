"""Where one study day ends and the next begins.

A streak is a count of *days*, so it is only as correct as the boundary between
them. The boundary that matters is the user's, not the server's: someone in
America/Los_Angeles studying at 6pm is studying on that day, but 6pm PST is
01:00 UTC the following morning. Deriving days in UTC therefore files an evening
session under tomorrow, which both credits the wrong square on the calendar and
can break a streak that was never actually broken — two evening sessions on
consecutive days collapse into one UTC day, leaving a gap behind them.

So every day-boundary decision goes through a zone name, and the same zone is
used on both sides of the comparison: the SQL that buckets rows into days and
the "today" the streak counts back from. Using the user's zone for one and the
server's for the other is worse than using UTC for both.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

#: What an account gets before its client has ever reported a zone. Chosen
#: because it is exactly the old behaviour — an unconfigured account keeps the
#: days it already had rather than silently shifting them.
DEFAULT_TIMEZONE = "UTC"


def is_valid_timezone(name: str | None) -> bool:
    """True for a name the system zone database actually knows.

    Everything reaching this comes off a client request, so it is checked
    against `zoneinfo` rather than trusted. An unknown name is not an error
    worth failing a dashboard load over — it just is not adopted.
    """
    if not name:
        return False
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def resolve_timezone(name: str | None) -> ZoneInfo:
    """The named zone, or UTC when it is missing or unrecognised."""
    if is_valid_timezone(name):
        return ZoneInfo(str(name))
    return ZoneInfo(DEFAULT_TIMEZONE)


def timezone_name(name: str | None) -> str:
    """The name to hand to Postgres — validated, so it is never interpolated raw."""
    return str(name) if is_valid_timezone(name) else DEFAULT_TIMEZONE


def today_in(name: str | None, *, now: datetime | None = None) -> date:
    """The calendar date it currently is for this user.

    `now` is injectable so a test can pin the instant; it must be timezone-aware,
    since converting a naive datetime would reintroduce the very ambiguity this
    module exists to remove.
    """
    moment = now or datetime.now(tz=ZoneInfo(DEFAULT_TIMEZONE))
    if moment.tzinfo is None:
        raise ValueError("today_in() needs an aware datetime")
    return moment.astimezone(resolve_timezone(name)).date()
