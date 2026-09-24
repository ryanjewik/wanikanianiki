"""Domain events, published to EventBridge.

The workers used to be woken by the clock alone. That is the right backstop
and the wrong trigger: the lesson queue drains when a person studies, not at
07:00 and 19:00, so a user who works through the queue at lunch waited until
evening for more, and a first photographed page produced no lessons until the
next scheduled pass. Publishing what happened lets the worker react within
seconds, while the schedule stays as the net under anything missed.

Two events, each with a consumer. An event nobody routes is an invitation to
build a consumer for it later, which is backwards:

* `LessonBundleClaimed` — a bundle left the queue, which may have taken it
  below the low-water mark.
* `VocabConfirmed` — words entered the deck, which is new material for the
  generator; on a fresh account it is the only material.

Both route to `lessons_handler`, which checks the queue first and usually stops
at one COUNT. So an event that turns out to be unnecessary is cheap, and the
consumer is not asked to tell the two apart.

**Publishing never fails a request.** The claim or the confirm has already been
committed by the time an event goes out; failing the response over a missed
nudge would tell the user their action did not happen when it did. The worst
case of a lost event is the wait the schedule already imposed.
"""

from __future__ import annotations

import asyncio
import json
import logging
from functools import lru_cache
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

SOURCE = "kanji-workshop.api"

LESSON_BUNDLE_CLAIMED = "LessonBundleClaimed"
VOCAB_CONFIRMED = "VocabConfirmed"


@lru_cache
def _client() -> Any:
    # Imported here, not at module scope: boto3 is provided by the Lambda
    # runtime and is an optional extra locally, where events are off anyway.
    import boto3

    return boto3.client("events")


def _put(bus_name: str, detail_type: str, detail: dict[str, Any]) -> None:
    response = _client().put_events(
        Entries=[
            {
                "EventBusName": bus_name,
                "Source": SOURCE,
                "DetailType": detail_type,
                "Detail": json.dumps(detail),
            }
        ]
    )
    # PutEvents reports a rejected entry in the body with a 200, not as an
    # exception, so a check on the status alone would miss exactly this case.
    if response.get("FailedEntryCount"):
        entry = response["Entries"][0]
        raise RuntimeError(f"{entry.get('ErrorCode')}: {entry.get('ErrorMessage')}")


async def publish(detail_type: str, detail: dict[str, Any]) -> bool:
    """Send one event. Returns whether it was sent; never raises.

    Call it only after the change it describes is committed. The consumer
    reads the database in its own transaction, and an event that arrives first
    sees the world as it was before the thing it announces.
    """
    bus_name = get_settings().event_bus_name
    if not bus_name:
        return False

    try:
        # boto3 is synchronous; a thread keeps the call off the event loop.
        await asyncio.to_thread(_put, bus_name, detail_type, detail)
    except Exception:
        logger.warning("Could not publish %s", detail_type, exc_info=True)
        return False
    return True
