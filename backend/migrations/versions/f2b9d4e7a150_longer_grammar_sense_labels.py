"""longer grammar sense labels

Revision ID: f2b9d4e7a150
Revises: e8a3c6d1f047
Create Date: 2026-09-26 03:40:00.000000

A sense label comes from the model's list of senses, and some of those run
past 64 characters ("speaking of / bringing up a topic that was just
mentioned"). Choosing one failed validation, and the phone reported it as an
unreachable backend. 256 leaves room for any label the model writes; the
unique constraint on (user, pattern, sense) is unaffected by the width.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f2b9d4e7a150'
down_revision: str | Sequence[str] | None = 'e8a3c6d1f047'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'grammar_entries', 'sense_label',
        existing_type=sa.String(length=64), type_=sa.String(length=256),
        existing_nullable=False, existing_server_default=sa.text("''"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'grammar_entries', 'sense_label',
        existing_type=sa.String(length=256), type_=sa.String(length=64),
        existing_nullable=False, existing_server_default=sa.text("''"),
    )
