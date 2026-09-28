"""per-set flashcard progress: which cards of a set you know

Revision ID: e8a3c6d1f047
Revises: d7f2b8e4a1c3
Create Date: 2026-09-26 03:00:00.000000

Flashcards are studied a set at a time, Quizlet-style: a card answered right
is known and stays out of the set's sessions until the set is reset. One row
per known card per set; resetting a set deletes its rows. Cascades from both
sides, so deleting a set or a word leaves nothing behind.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e8a3c6d1f047'
down_revision: str | Sequence[str] | None = 'd7f2b8e4a1c3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'vocab_set_progress',
        sa.Column('set_id', sa.Integer(), nullable=False),
        sa.Column('srs_state_id', sa.Integer(), nullable=False),
        sa.Column(
            'known_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['set_id'], ['vocab_sets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['srs_state_id'], ['srs_state.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('set_id', 'srs_state_id'),
    )
    # Matches every other table: RLS on, no policies. The backend owns the
    # table and is unaffected; Supabase's public API is shut out.
    op.execute('ALTER TABLE vocab_set_progress ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('vocab_set_progress')
