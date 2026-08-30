"""Where uploaded page photos live.

Deliberately the thinnest possible seam. Today it is a directory; in Lambda it
will be S3, and the only thing that has to change is which branch of `save`
and `load` runs — nothing above this module knows the difference, because the
rest of the app only ever passes around the opaque URI this returns.

The local branch writes under `/tmp` by default, which is the one writable
path in a Lambda container. That makes the fallback *work* there rather than
crash, but it is not durable: a frozen container's `/tmp` is gone by the next
cold start. Set `VOCAB_IMAGE_BUCKET` before that matters.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

# The formats a phone camera actually produces, mapped to the extensions we
# store them under. Anything else is rejected at the route rather than here.
SUPPORTED_MEDIA_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class UnsupportedImageType(ValueError):
    """The upload was not an image Claude's vision API accepts."""


def save_image(data: bytes, media_type: str, *, settings: Settings | None = None) -> str:
    """Store the bytes and return the URI to put on `vocab_sources.image_uri`."""
    settings = settings or get_settings()

    suffix = SUPPORTED_MEDIA_TYPES.get(media_type)
    if suffix is None:
        raise UnsupportedImageType(
            f"{media_type!r} is not a supported image type "
            f"({', '.join(sorted(SUPPORTED_MEDIA_TYPES))})"
        )

    name = f"{uuid.uuid4().hex}{suffix}"

    if settings.vocab_image_bucket:
        # Not wired yet. Raising here beats silently writing to a /tmp that a
        # cold start will discard, which would look like data loss later.
        raise NotImplementedError(
            "VOCAB_IMAGE_BUCKET is set but S3 storage is not implemented yet; "
            "unset it to use local storage."
        )

    directory = Path(settings.vocab_image_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(data)
    return path.as_uri()


def load_image(uri: str) -> bytes:
    """Read back what `save_image` wrote."""
    if uri.startswith("file://"):
        from urllib.parse import unquote, urlparse

        return Path(unquote(urlparse(uri).path)).read_bytes()
    raise NotImplementedError(f"Cannot load image from {uri!r}")


def media_type_for(uri: str) -> str:
    """Recover the media type from a stored URI's extension."""
    suffix = Path(uri).suffix.lower()
    for media_type, ext in SUPPORTED_MEDIA_TYPES.items():
        if ext == suffix:
            return media_type
    return "image/jpeg"
