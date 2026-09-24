"""The calendar feed carries real counts, not one bit per day.

The route is exercised with the repository faked out, because the database
tests only run where TEST_DATABASE_URL is set. The SQL itself is checked by
compiling it for Postgres, which catches a malformed statement without a server.
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import httpx2 as httpx
from sqlalchemy.dialects import postgresql

from app.api.deps import db_session
from app.db import repository as repo
from app.db.models import ReviewLog
from app.main import create_app


async def test_counts_reach_the_calendar(monkeypatch):
    async def fake(value):
        return value

    user = SimpleNamespace(id=1)
    monkeypatch.setattr(repo, "get_default_user", lambda session: fake(user))
    monkeypatch.setattr(repo, "adopt_timezone", lambda session, u, tz: fake("UTC"))
    monkeypatch.setattr(
        repo,
        "count_reviews_by_day",
        lambda session, zone, since=None: fake({date(2026, 9, 1): 37, date(2026, 9, 2): 4}),
    )
    monkeypatch.setattr(
        repo,
        "count_vocab_reviews_by_day",
        lambda session, zone, since=None: fake({date(2026, 9, 2): 12}),
    )
    monkeypatch.setattr(
        repo,
        "get_grammar_days",
        lambda session, user_id, since=None: fake({date(2026, 9, 3): 2}),
    )

    app = create_app()

    async def no_session():
        yield None

    app.dependency_overrides[db_session] = no_session
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        days = (await client.get("/api/activity")).json()

    assert days == [
        {"day": "2026-09-01", "reviews": 37, "vocabReviews": 0, "grammarLogged": 0},
        {"day": "2026-09-02", "reviews": 4, "vocabReviews": 12, "grammarLogged": 0},
        {"day": "2026-09-03", "reviews": 0, "vocabReviews": 0, "grammarLogged": 2},
    ]


async def test_the_count_query_buckets_by_local_day_and_filters_on_it():
    class CapturingSession:
        statement = None

        async def execute(self, statement):
            self.statement = statement
            return SimpleNamespace(all=lambda: [(date(2026, 9, 1), 5), ("2026-09-02", 3)])

    session = CapturingSession()
    counts = await repo.count_reviews_by_day(session, "Asia/Tokyo", since=date(2026, 9, 1))

    # Postgres returns dates, SQLite ISO strings; both come back as dates.
    assert counts == {date(2026, 9, 1): 5, date(2026, 9, 2): 3}

    sql = str(session.statement.compile(dialect=postgresql.dialect()))
    assert "GROUP BY" in sql and "count(*)" in sql
    assert ReviewLog.__tablename__ in sql
    # The filter is on the zoned day, not the raw timestamp: a UTC cut would
    # drop the first hours of the user's first day.
    assert sql.count("date(timezone(") >= 2
