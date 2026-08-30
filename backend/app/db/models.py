"""ORM models.

Follows the Postgres schema in `wanikani-api-notes.md`, with one deliberate
simplification: meanings and readings are stored as JSONB on `subjects` rather
than in separate child tables.

The notes propose normalised `subject_meanings` / `subject_readings`, which is
right if you ever need to query *across* meanings ("find every subject meaning
'bright'"). Nothing in the app does — meanings and readings are only ever read
back as a whole subject, to render a card or grade an answer. JSONB keeps that
a single row read instead of a three-way join, and a GIN index can still be
added later if a cross-subject query ever appears.

`subject_id` reuses WaniKani's own id as the primary key throughout, which
avoids an id-mapping layer entirely.

A column gets a `server_default` alongside its Python `default` when "unset"
has an unambiguous correct value — a boolean flag, a counter, a status a row
begins life in, an empty list. Columns that must come from upstream
(`users.level`, `max_level_granted`, every `type`) deliberately have neither, so
an insert that forgets them fails loudly instead of inventing a plausible wrong
answer. Without this, a raw SQL insert outside the ORM hits NOT NULL on columns
the ORM was quietly filling in.

`vocab_items` and `vocab_sources` are here from the first revision even though
nothing writes them yet. They are the table the SRS engine and the question
generator will hang off, and introducing them now costs an empty CREATE TABLE
rather than a migration that has to move live rows later.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Subject(Base):
    """Content. Effectively immutable — pulled once, then only topped up."""

    __tablename__ = "subjects"

    subject_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    characters: Mapped[str | None] = mapped_column(String(32))
    character_image_url: Mapped[str | None] = mapped_column(Text)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    slug: Mapped[str] = mapped_column(String(128), default="", server_default="")

    meanings: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    readings: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))

    meaning_mnemonic: Mapped[str | None] = mapped_column(Text)
    reading_mnemonic: Mapped[str | None] = mapped_column(Text)
    meaning_hint: Mapped[str | None] = mapped_column(Text)
    reading_hint: Mapped[str | None] = mapped_column(Text)

    component_subject_ids: Mapped[list] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    amalgamation_subject_ids: Mapped[list] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )

    # Backfilled once from the kanji-data seed import; null until then.
    jlpt_level: Mapped[int | None] = mapped_column(Integer)

    # WaniKani's own `data_updated_at`, used as the `updated_after` cursor.
    data_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_subjects_level", "level"),
        Index("ix_subjects_type", "type"),
        Index("ix_subjects_jlpt_level", "jlpt_level"),
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # WaniKani's own user UUID, so a token swap for the same account is a no-op.
    wanikani_user_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    level: Mapped[int] = mapped_column(Integer, default=1)
    max_level_granted: Mapped[int] = mapped_column(Integer, default=3)
    subscription_active: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )

    # NOTE: the token is NOT stored here. It lives in the environment, injected
    # from Secrets Manager. This column exists in the design notes for a
    # multi-user build; adding it means encrypting at rest and is deliberately
    # deferred until there is more than one account.

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    progress: Mapped[list[StudyProgress]] = relationship(back_populates="user")


class StudyProgress(Base):
    """One row per (user, subject) — where users meet subjects.

    This is what the dashboard and both queues are built from. It mirrors
    WaniKani's assignment rather than reimplementing scheduling: `srs_stage`
    and `available_at` are always WaniKani's values, never ours.
    """

    __tablename__ = "study_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.subject_id"), nullable=False
    )

    # WaniKani's assignment id — needed for the two write endpoints.
    assignment_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    subject_type: Mapped[str] = mapped_column(String(20), nullable=False)

    srs_stage: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    unlocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    passed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    available_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    burned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    data_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="progress")

    __table_args__ = (
        # A reset gives a second progress row for the same subject, so the
        # uniqueness that actually holds is on the assignment.
        UniqueConstraint("user_id", "assignment_id", name="uq_progress_user_assignment"),
        Index("ix_progress_available_at", "user_id", "available_at"),
        Index("ix_progress_started_at", "user_id", "started_at"),
    )


class ReviewLog(Base):
    """Every answered review, appended.

    Hangs off `study_progress`, not `subjects` — a review is "this user's
    attempt at this assignment", which matters after a reset.

    WaniKani itself no longer persists reviews (its `POST /reviews` returns
    `id: 0`), so this table is the only durable history of what was answered
    and when. The streak is derived from it.
    """

    __tablename__ = "reviews_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    study_progress_id: Mapped[int] = mapped_column(
        ForeignKey("study_progress.id"), nullable=False
    )

    incorrect_meaning: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    incorrect_reading: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    starting_srs_stage: Mapped[int | None] = mapped_column(Integer)
    ending_srs_stage: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_reviews_log_created_at", "created_at"),)


class SyncMeta(Base):
    """Key/value cursor store.

    `last_synced_at` does double duty: it is the "Synced 4 minutes ago" line in
    the UI *and* the `updated_after` value for the next poll, so freshness
    display and incremental sync share one source of truth.
    """

    __tablename__ = "sync_meta"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class VocabSource(Base):
    """One imported page.

    A row is created the moment the photo lands, before the vision model has
    read anything — `status` is what the client polls while extraction runs.
    """

    __tablename__ = "vocab_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    # The set this page was photographed into. Null for a one-off import.
    #
    # Named explicitly, unlike the foreign keys on tables created whole: this
    # one arrives by ALTER TABLE, and a downgrade has to drop it by name.
    # Postgres would invent one, but autogenerate emits `drop_constraint(None)`
    # and fails to compile — so the name has to exist in the model.
    set_id: Mapped[int | None] = mapped_column(
        ForeignKey("vocab_sets.id", name="fk_vocab_sources_set_id")
    )
    # Where this page sits in the set, so "page 2 of 5" survives the pages
    # being read out of order — extraction finishes when it finishes.
    position: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))

    # Where the original photo is kept, once anywhere durable keeps it.
    # Null today: the bytes are buffered in memory for the length of the
    # extraction and then dropped, because nothing reads them afterwards — the
    # review screen renders the device's own copy. This gets populated when
    # `ocr-fn` separates and the photo has to cross a process boundary.
    image_uri: Mapped[str | None] = mapped_column(Text)

    # pending | processed | failed. Left as free text rather than an enum for
    # the same reason `subjects.type` is: adding a state should not need a
    # migration that rewrites a type.
    status: Mapped[str] = mapped_column(
        String(16), default="pending", server_default="pending", nullable=False
    )

    # The tier the user picks at upload time, which cascades onto every row
    # extracted from the page.
    jlpt_level: Mapped[int | None] = mapped_column(Integer)
    # Human label for the page, e.g. "Genki II - page 84".
    label: Mapped[str | None] = mapped_column(String(128))

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    items: Mapped[list[VocabItem]] = relationship(back_populates="source_image")

    __table_args__ = (Index("ix_vocab_sources_user_status", "user_id", "status"),)


class VocabItem(Base):
    """The unifying table: one row per word, whatever it came from.

    Vocabulary now has two origins — WaniKani and photo import — and the things
    built on top of it (SRS state, generated questions) should not care which.
    They reference `vocab_items.id`; a WaniKani-sourced row simply carries
    `wanikani_subject_id` as well.

    Deliberately has no `user_id`. This is a catalogue of words, not of anyone's
    progress through them — per-user state hangs off it in `srs_state` and
    `study_progress` instead. That also keeps a word importable once and
    scheduled independently per skill.
    """

    __tablename__ = "vocab_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # 'wanikani' | 'ocr_import'
    source: Mapped[str] = mapped_column(String(16), nullable=False)

    # Populated only for WaniKani-sourced rows. Unique so a sync can upsert by
    # it idempotently; Postgres allows many NULLs under a unique constraint,
    # which is exactly right for imported rows.
    wanikani_subject_id: Mapped[int | None] = mapped_column(
        ForeignKey("subjects.subject_id"), unique=True
    )

    kanji_furigana: Mapped[str] = mapped_column(String(64), nullable=False)
    furigana_only: Mapped[str] = mapped_column(
        String(64), nullable=False, default="", server_default=""
    )
    english: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")

    # The particle or object the textbook prints a word with: "〜が" for
    # [〜が]苦手な, "病気を" for [病気を]治す. Grammatical information the entry
    # loses if it is folded into the word, and which does not belong in the
    # meaning either — so it gets its own column and its own place on the card.
    usage_context: Mapped[str | None] = mapped_column(String(64))

    source_image_id: Mapped[int | None] = mapped_column(ForeignKey("vocab_sources.id"))

    # Set when the user corrects a bad extraction. A local edit never syncs
    # upstream — WaniKani's own content is read-only from here.
    is_user_edited: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )

    jlpt_level: Mapped[int | None] = mapped_column(Integer)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    source_image: Mapped[VocabSource | None] = relationship(back_populates="items")

    __table_args__ = (
        Index("ix_vocab_items_source", "source"),
        Index("ix_vocab_items_jlpt_level", "jlpt_level"),
    )



class VocabSet(Base):
    """A named group of vocabulary — "Quartet I, Lesson 1", "N3 verbs".

    A set is how a person organises their own deck, so it is deliberately not
    tied to how the words arrived: pages photographed in one sitting land in a
    set, but a word can belong to several sets, and a set can be curated by
    hand later.
    """

    __tablename__ = "vocab_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        # Two sets with the same name are a mistake, not a feature.
        UniqueConstraint("user_id", "name", name="uq_vocab_sets_user_name"),
    )


class VocabSetItem(Base):
    """Membership. Many-to-many on purpose.

    The same word plausibly belongs to a textbook lesson *and* a JLPT tier at
    once, and pinning it to one would force a duplicate row — which would then
    have its own, divergent SRS state.
    """

    __tablename__ = "vocab_set_items"

    set_id: Mapped[int] = mapped_column(
        ForeignKey("vocab_sets.id", ondelete="CASCADE"), primary_key=True
    )
    vocab_item_id: Mapped[int] = mapped_column(
        ForeignKey("vocab_items.id", ondelete="CASCADE"), primary_key=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class VocabAnswer(Base):
    """One thing a person may type and be marked correct.

    This is the table that makes "多くの correct answers" real, and it exists
    because a textbook line like

        相手  あいて  partner; the other person

    is not one answer, it is four: 相手 and あいて are both acceptable when the
    card asks for the Japanese, and *either* English gloss is acceptable when it
    asks for the meaning. Storing the raw line and matching against it would
    mark "partner" wrong for want of a semicolon.

    `kind` is what lets one table serve both directions: a card asking for the
    Japanese accepts `written` and `reading`, one asking for the meaning accepts
    `meaning`. That is exactly the "kanji or furigana both count" rule, stated
    once as data rather than spread through the grader.

    `accepted` exists because a form can be worth *showing* without being worth
    accepting — the same distinction WaniKani draws for nanori readings.
    """

    __tablename__ = "vocab_answers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vocab_item_id: Mapped[int] = mapped_column(
        ForeignKey("vocab_items.id", ondelete="CASCADE"), nullable=False
    )

    # 'written' | 'reading' | 'meaning'
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    value: Mapped[str] = mapped_column(String(128), nullable=False)

    # The one to print on the card. Exactly one per kind, by convention.
    is_primary: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    accepted: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("vocab_item_id", "kind", "value", name="uq_vocab_answer"),
        Index("ix_vocab_answers_item", "vocab_item_id"),
    )


class SrsState(Base):
    """SM-2 scheduling for one skill on one word, for one person.

    Deliberately separate from `study_progress`. WaniKani owns the schedule for
    its own content and this app only mirrors it; everything imported is
    scheduled here instead. Keeping them apart is what stops the two ever
    disagreeing about the same word.

    `skill_type` splits recognition (see the word, recall the meaning) from
    production (see the meaning, produce the word). They are genuinely different
    skills — recognising 免許 is easy long before you can write it — so they
    carry their own intervals and come due independently.
    """

    __tablename__ = "srs_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    vocab_item_id: Mapped[int] = mapped_column(
        ForeignKey("vocab_items.id", ondelete="CASCADE"), nullable=False
    )

    # 'recognition' | 'production'
    skill_type: Mapped[str] = mapped_column(String(16), nullable=False)

    # --- SM-2 proper ---------------------------------------------------------
    # Standard starting ease. Falls as a card proves difficult, floored at 1.3.
    ease_factor: Mapped[float] = mapped_column(
        Float, default=2.5, server_default=text("2.5"), nullable=False
    )
    interval_days: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    # Consecutive successes. Reset to zero by a lapse, which is what makes a
    # forgotten card start its ladder again.
    repetitions: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )

    # --- tracking beyond what SM-2 needs to run -----------------------------
    # Kept because the algorithm forgets: it knows the current interval but not
    # that this card has been forgotten four times, which is what marks a word
    # worth relearning differently rather than rescheduling forever.
    lapses: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    reviews_total: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    reviews_correct: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )

    due_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "vocab_item_id", "skill_type", name="uq_srs_state_user_item_skill"
        ),
        # The review queue is "mine, due before now, soonest first".
        Index("ix_srs_state_due", "user_id", "due_at"),
    )


class VocabReviewLog(Base):
    """Every answered card, appended.

    The counterpart to `reviews_log`, which holds the WaniKani side. Two tables
    rather than one because they hang off different parents and carry different
    facts — but the streak is the union of both, since a day spent on imported
    vocab is still a day studied.

    `answer_given` is kept deliberately: when the grader marks something wrong
    that a person is sure was right, the only way to tell a scheduling problem
    from a matching problem is to see what they actually typed.
    """

    __tablename__ = "vocab_review_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    srs_state_id: Mapped[int] = mapped_column(
        ForeignKey("srs_state.id", ondelete="CASCADE"), nullable=False
    )

    correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # SM-2 quality, 0-5. A binary right/wrong maps onto it; a four-button
    # again/hard/good/easy grade maps onto it too.
    grade: Mapped[int] = mapped_column(Integer, nullable=False)
    answer_given: Mapped[str | None] = mapped_column(String(256))

    interval_before_days: Mapped[int] = mapped_column(Integer, nullable=False)
    interval_after_days: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_vocab_review_log_created_at", "created_at"),)


SYNC_KEY_ASSIGNMENTS = "assignments_updated_after"
SYNC_KEY_SUBJECTS = "subjects_updated_after"
SYNC_KEY_LAST_SYNCED = "last_synced_at"
