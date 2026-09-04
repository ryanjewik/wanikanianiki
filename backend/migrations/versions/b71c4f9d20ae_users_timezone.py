"""users.timezone

Revision ID: b71c4f9d20ae
Revises: 94753d45601c
Create Date: 2026-09-04 19:40:00.000000

The zone that decides where one study day ends and the next begins. Added
NOT NULL with a server default of 'UTC' rather than nullable: every existing
row's days were already being bucketed in UTC, so 'UTC' is not a placeholder
here — it is the value those rows actually had, and backfilling it changes
nothing about the streaks already on record.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b71c4f9d20ae'
down_revision: str | Sequence[str] | None = '94753d45601c'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'users',
        sa.Column(
            'timezone',
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'UTC'"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'timezone')
