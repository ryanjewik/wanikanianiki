"""grammar entries and examples

Revision ID: d44cf9719b8e
Revises: b71c4f9d20ae
Create Date: 2026-09-04 20:29:32.878159

Grammar moves into the app, replacing the Obsidian read-file the design notes
describe. Two tables: the point itself, and the sentences that show it in use.

`sense_label` is NOT NULL with an empty-string default rather than nullable, and
that is what makes `uq_grammar_entries_point` work at all — Postgres treats
NULLs as distinct under a unique constraint, so a nullable column would accept
the same pattern twice as long as neither row named a sense.

`learned_on` is a DATE, not a timestamp. The device picks it, so the calendar
never needs the zone conversion `services/dates.py` does for reviews.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd44cf9719b8e'
down_revision: str | Sequence[str] | None = 'b71c4f9d20ae'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('grammar_entries',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('pattern', sa.String(length=128), nullable=False),
    sa.Column('sense_label', sa.String(length=64), server_default=sa.text("''"), nullable=False),
    sa.Column('meaning', sa.Text(), nullable=True),
    sa.Column('formation', sa.Text(), nullable=True),
    sa.Column('style', sa.String(length=32), nullable=True),
    sa.Column('jlpt_level', sa.Integer(), nullable=True),
    sa.Column('source', sa.String(length=128), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('learned_on', sa.Date(), nullable=False),
    sa.Column('enriched', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_grammar_entries_user_id'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'pattern', 'sense_label', name='uq_grammar_entries_point')
    )
    op.create_index('ix_grammar_entries_user_day', 'grammar_entries', ['user_id', 'learned_on'], unique=False)
    op.create_table('grammar_examples',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('grammar_entry_id', sa.Integer(), nullable=False),
    sa.Column('japanese', sa.Text(), nullable=False),
    sa.Column('english', sa.Text(), nullable=True),
    sa.Column('is_user_supplied', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['grammar_entry_id'], ['grammar_entries.id'], name='fk_grammar_examples_entry_id', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_grammar_examples_entry', 'grammar_examples', ['grammar_entry_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_grammar_examples_entry', table_name='grammar_examples')
    op.drop_table('grammar_examples')
    op.drop_index('ix_grammar_entries_user_day', table_name='grammar_entries')
    op.drop_table('grammar_entries')
