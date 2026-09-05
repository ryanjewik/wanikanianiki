"""grammar_entries.style is too narrow at 32

Register comes back as a short phrase, not a single word, and 32 characters is
inside the range real answers occupy rather than above it. Measured against the
live model: 'formal, written or speeches' is 27, 'formal, written or stiff
speech' is 31, and '~てからでないと' produced 54. Two of three legitimate answers
were within a character or two of the limit, so the column was not holding a
margin — it was overflowing on ordinary output, and an overflow here is a 500
on the one path the feature exists for.

Widened rather than truncated because the value is prose meant to be read. The
prompt now names the limit and the service clamps to it, so this is the
backstop, not the only guard.

Revision ID: a1c7e33b90f4
Revises: d44cf9719b8e
Create Date: 2026-09-05

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1c7e33b90f4'
down_revision: str | Sequence[str] | None = 'd44cf9719b8e'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'grammar_entries',
        'style',
        existing_type=sa.String(length=32),
        type_=sa.String(length=128),
        existing_nullable=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Anything already stored longer than 32 would not survive the narrowing,
    # so it is truncated explicitly rather than left to fail the ALTER.
    op.execute("UPDATE grammar_entries SET style = left(style, 32) WHERE length(style) > 32")
    op.alter_column(
        'grammar_entries',
        'style',
        existing_type=sa.String(length=128),
        type_=sa.String(length=32),
        existing_nullable=True,
    )
