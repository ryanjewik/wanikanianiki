"""Domain events: sent when a bus is configured, silent when not, never fatal.

The property worth pinning is the last one. An event goes out after the change
it announces is committed, so a publishing failure that escaped would turn a
successful claim or import into an error response for something that happened.
"""

from __future__ import annotations

import json
import os

import pytest

from app.config import get_settings
from app.parameters import load_into_environment
from app.services import events


class FakeEvents:
    def __init__(self, response=None, error: Exception | None = None):
        self.calls: list[dict] = []
        self._response = response if response is not None else {"FailedEntryCount": 0}
        self._error = error

    def put_events(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return self._response


@pytest.fixture
def bus(monkeypatch):
    monkeypatch.setenv("EVENT_BUS_NAME", "kanji-workshop")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def no_bus(monkeypatch):
    # Explicitly empty rather than deleted, so a value in a developer's
    # backend/.env cannot switch events on under the test.
    monkeypatch.setenv("EVENT_BUS_NAME", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _use(monkeypatch, fake: FakeEvents) -> FakeEvents:
    monkeypatch.setattr(events, "_client", lambda: fake)
    return fake


async def test_nothing_is_sent_without_a_bus(no_bus, monkeypatch):
    fake = _use(monkeypatch, FakeEvents())

    assert await events.publish(events.LESSON_BUNDLE_CLAIMED, {"bundleId": 1}) is False
    assert fake.calls == []


async def test_one_entry_goes_to_the_configured_bus(bus, monkeypatch):
    fake = _use(monkeypatch, FakeEvents())

    sent = await events.publish(events.VOCAB_CONFIRMED, {"userId": 7, "words": 12})

    assert sent is True
    [call] = fake.calls
    [entry] = call["Entries"]
    assert entry["EventBusName"] == "kanji-workshop"
    assert entry["Source"] == events.SOURCE
    assert entry["DetailType"] == "VocabConfirmed"
    assert json.loads(entry["Detail"]) == {"userId": 7, "words": 12}


async def test_a_client_error_is_swallowed(bus, monkeypatch):
    _use(monkeypatch, FakeEvents(error=RuntimeError("network down")))

    assert await events.publish(events.LESSON_BUNDLE_CLAIMED, {"bundleId": 1}) is False


async def test_a_rejected_entry_counts_as_not_sent(bus, monkeypatch):
    # PutEvents reports this with a 200 and a count in the body, not an error.
    rejected = {
        "FailedEntryCount": 1,
        "Entries": [{"ErrorCode": "AccessDenied", "ErrorMessage": "no"}],
    }
    _use(monkeypatch, FakeEvents(response=rejected))

    assert await events.publish(events.LESSON_BUNDLE_CLAIMED, {"bundleId": 1}) is False


# -- secrets from Parameter Store -------------------------------------------


class FakeSsm:
    def __init__(self, pages):
        self._pages = pages
        self.kwargs: dict | None = None

    def get_paginator(self, name):
        assert name == "get_parameters_by_path"
        return self

    def paginate(self, **kwargs):
        self.kwargs = kwargs
        return iter(self._pages)


def _fake_boto3(monkeypatch, ssm: FakeSsm) -> None:
    import sys
    import types

    module = types.ModuleType("boto3")
    module.client = lambda service: ssm  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "boto3", module)


def test_parameters_are_skipped_without_a_path(monkeypatch):
    monkeypatch.delenv("SSM_PARAMETER_PATH", raising=False)
    assert load_into_environment() == 0


def test_parameters_land_in_the_environment_by_last_segment(monkeypatch):
    monkeypatch.setenv("SSM_PARAMETER_PATH", "/kanji-workshop/")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://already-set")
    ssm = FakeSsm(
        [
            {"Parameters": [{"Name": "/kanji-workshop/ANTHROPIC_API_KEY", "Value": "k"}]},
            {"Parameters": [{"Name": "/kanji-workshop/DATABASE_URL", "Value": "from-ssm"}]},
        ]
    )
    _fake_boto3(monkeypatch, ssm)

    assert load_into_environment() == 2
    assert ssm.kwargs["WithDecryption"] is True
    assert os.environ["ANTHROPIC_API_KEY"] == "k"
    # A value already on the function wins, so a one-off override still works.
    assert os.environ["DATABASE_URL"] == "postgresql://already-set"
