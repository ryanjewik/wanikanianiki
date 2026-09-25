"""subjects: the rest of what WaniKani sends

Revision ID: c5e1a7f3d902
Revises: 3413a054bc88
Create Date: 2026-09-25 14:30:00.000000

Five things WaniKani returns for a subject that sync used to drop on the floor:
context sentences, parts of speech, pronunciation audio, visually similar
kanji, and auxiliary meanings. All JSONB with an empty-list default, because
"none" is the correct value for every row until the next sync fills it -- a
radical has no context sentences, a kanji no audio -- so the default is true
rather than a placeholder.

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c5e1a7f3d902'
down_revision: str | Sequence[str] | None = '3413a054bc88'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    'context_sentences',
    'parts_of_speech',
    'pronunciation_audios',
    'visually_similar_subject_ids',
    'auxiliary_meanings',
)


def upgrade() -> None:
    """Upgrade schema."""
    for name in COLUMNS:
        op.add_column(
            'subjects',
            sa.Column(
                name,
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    for name in reversed(COLUMNS):
        op.drop_column('subjects', name)
