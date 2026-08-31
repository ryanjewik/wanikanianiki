"""Holding an uploaded page between the request and the extraction.

Deliberately in-process and deliberately not durable.

The photo is needed for exactly one thing — handing the bytes to the vision
call — and for exactly as long as the extraction takes. Nothing else reads it:
the review screen renders the *device's* copy of the picture, not the server's.
So this is a buffer, not storage, and it has the same lifetime as the extracted
rows it produces (`ocr._CACHE`). Both die with the process, and losing either
means re-uploading a photo rather than losing anything from the deck.

**This is what has to change when `ocr-fn` becomes a separate function.** A
queue message cannot carry a several-megabyte photo — SQS caps at 256 KB — so
the bytes would need somewhere both functions can reach. That is the point at
which `vocab_sources.image_uri` gets populated and this module grows a real
backend. Two options fit better than S3 does: Supabase Storage, which comes
with the Postgres already being stood up and needs no IAM, or a `bytea` column,
which keeps the image in the row it belongs to and adds no service at all.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# What a phone camera actually produces, and what the vision API accepts.
SUPPORTED_MEDIA_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif"}
)


class UnsupportedImageType(ValueError):
    """The upload was not an image the vision API accepts."""


def check_media_type(media_type: str) -> str:
    """Reject at the door, before anything is stored or a row is written."""
    if media_type not in SUPPORTED_MEDIA_TYPES:
        raise UnsupportedImageType(
            f"{media_type!r} is not a supported image type "
            f"({', '.join(sorted(SUPPORTED_MEDIA_TYPES))})"
        )
    return media_type


_PENDING: dict[int, tuple[bytes, str]] = {}


def hold(source_id: int, image: bytes, media_type: str) -> None:
    _PENDING[source_id] = (image, media_type)


def take(source_id: int) -> tuple[bytes, str] | None:
    """Read and remove. The bytes are wanted once, by the extractor."""
    return _PENDING.pop(source_id, None)


def discard(source_id: int) -> None:
    _PENDING.pop(source_id, None)
