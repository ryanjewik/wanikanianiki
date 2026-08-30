"""Client-facing response shapes.

These match `src/data/types.ts` in the React Native app field for field. The
backend does the joining and the deriving so the client never has to: an
assignment goes out with its subject already attached, and streaks / level pace
arrive computed rather than as raw timestamps.

Everything serialises to camelCase via the alias generator, so the TypeScript
side needs no mapping layer.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

# WaniKani has four subject types. The app's design system defines a colour for
# only three, so `kana_vocabulary` is folded into `vocabulary` on the way out —
# see `normalise_subject_type`.
SubjectType = Literal["radical", "kanji", "vocabulary"]
ReadingType = Literal["onyomi", "kunyomi", "nanori", "vocabulary"]


def normalise_subject_type(raw: str) -> SubjectType:
    """Collapses WaniKani's four types onto the three the UI knows.

    `kana_vocabulary` is a real word with no kanji in it (e.g. ラーメン). It
    behaves like vocabulary everywhere that matters — it has meanings, readings
    and an SRS stage — so it renders as vocabulary rather than needing a fourth
    colour and glyph.
    """
    if raw == "kana_vocabulary":
        return "vocabulary"
    if raw in ("radical", "kanji", "vocabulary"):
        return raw  # type: ignore[return-value]
    raise ValueError(f"Unknown WaniKani subject type: {raw!r}")


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# -- content ---------------------------------------------------------------


class Meaning(CamelModel):
    meaning: str
    primary: bool
    accepted_answer: bool


class Reading(CamelModel):
    reading: str
    type: ReadingType
    primary: bool
    # False for nanori and some kunyomi — WaniKani lists them for reference but
    # will not accept them as an answer. The client's grader depends on this.
    accepted_answer: bool


class Subject(CamelModel):
    id: int
    type: SubjectType
    # Null on the handful of radicals that have no Unicode glyph; those carry
    # `character_image_url` instead.
    characters: str | None = None
    character_image_url: str | None = None
    level: int
    slug: str
    meanings: list[Meaning] = []
    readings: list[Reading] = []
    meaning_mnemonic: str | None = None
    reading_mnemonic: str | None = None
    meaning_hint: str | None = None
    reading_hint: str | None = None
    component_subject_ids: list[int] = []
    amalgamation_subject_ids: list[int] = []
    jlpt_level: int | None = None


# -- progress --------------------------------------------------------------


class Assignment(CamelModel):
    id: int
    subject_id: int
    subject_type: SubjectType
    # WaniKani's own 0–9 scale. 0 means unlocked but not yet started.
    srs_stage: int
    unlocked_at: datetime | None = None
    started_at: datetime | None = None
    passed_at: datetime | None = None
    available_at: datetime | None = None
    burned_at: datetime | None = None


class StudyItem(CamelModel):
    """An assignment already joined to its subject, ready to render."""

    assignment: Assignment
    subject: Subject


class Counted(CamelModel):
    passed: int
    total: int


class DayActivity(CamelModel):
    label: str
    # 0 = nothing done, 1 = a full day. Partial days render in a soft tint.
    intensity: float
    is_today: bool


class StreakSummary(CamelModel):
    days: int
    best: int
    week: list[DayActivity]


class LevelProgress(CamelModel):
    level: int
    radicals: Counted
    kanji: Counted
    vocabulary: Counted
    kanji_remaining_to_level_up: int
    days_at_level: int


class UserSummary(CamelModel):
    username: str
    level: int
    # Below this, content is invisible regardless of level. 3 on a free account.
    max_level_granted: int = 60
    subscription_active: bool = False


class DashboardSummary(CamelModel):
    user: UserSummary
    lesson_count: int
    review_count: int
    streak: StreakSummary
    level_progress: LevelProgress
    # Item counts per display bucket, five entries.
    stage_spread: list[int]
    last_synced_at: datetime | None = None
    # When the next batch comes due, straight from `/summary`.
    next_reviews_at: datetime | None = None


# -- photo import ----------------------------------------------------------
# These mirror the Part 2 block of `src/data/types.ts`.


VocabItemSource = Literal["wanikani", "ocr_import"]
ImportStatus = Literal["pending", "processed", "failed"]
DetectionStatus = Literal["ok", "ambiguous", "duplicate"]


class DetectedItem(CamelModel):
    """One row of the OCR review list, before the user commits anything.

    `status` is what makes the review screen useful rather than a wall of text:
    `ok` imports as-is, `ambiguous` needs the user to pick a reading, and
    `duplicate` is already in the deck and is skipped rather than duplicated.
    """

    key: str
    kanji_furigana: str
    furigana_only: str
    english: str
    jlpt_level: int | None = None
    status: DetectionStatus = "ok"
    selected: bool = True
    # Populated only when status is `ambiguous`, e.g. ["からい", "つらい"].
    reading_choices: list[str] | None = None
    note: str | None = None


class VocabItem(CamelModel):
    """A word in the deck, whatever it came from."""

    id: int
    source: VocabItemSource
    wanikani_subject_id: int | None = None
    kanji_furigana: str
    furigana_only: str
    english: str
    source_image_id: int | None = None
    is_user_edited: bool = False
    jlpt_level: int | None = None
    updated_at: datetime


class VocabSourceImage(CamelModel):
    """An imported page, and how far along its extraction is."""

    id: int
    image_uri: str
    uploaded_at: datetime
    status: ImportStatus
    jlpt_level: int | None = None
    label: str | None = None


class VocabSourceResult(CamelModel):
    """What the upload returns, and what polling returns afterwards.

    `items` is empty while `status` is `pending`. The client uploads, gets a
    `sourceId` back immediately, and polls this shape until the rows appear —
    a vision call takes far too long to hold an HTTP request open for.
    """

    source_id: int
    status: ImportStatus
    items: list[DetectedItem] = []
    detail: str | None = None


class ConfirmImportRequest(BaseModel):
    """The rows the user kept after correcting the extraction."""

    items: list[DetectedItem]


# -- writes ----------------------------------------------------------------


class ReviewSubmission(BaseModel):
    """Mirrors WaniKani's own `POST /reviews` body, so the client's outbox
    payload can be forwarded without reshaping."""

    assignment_id: int
    incorrect_meaning_answers: int = 0
    incorrect_reading_answers: int = 0
    created_at: datetime | None = None


class ReviewRequest(BaseModel):
    review: ReviewSubmission


class ReviewResult(CamelModel):
    """What came back after a review landed.

    `assignment` is WaniKani's recomputed state — the only authoritative source
    for the new SRS stage and the real next-review time. The client should
    replace its optimistic guess with this.
    """

    assignment: Assignment
    starting_srs_stage: int
    ending_srs_stage: int


class SyncResult(CamelModel):
    ok: bool
    assignments_updated: int
    subjects_updated: int
    last_synced_at: datetime | None = None
    detail: str | None = None
