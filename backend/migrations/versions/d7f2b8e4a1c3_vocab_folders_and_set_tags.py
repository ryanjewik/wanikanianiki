"""vocab folders, and a folder and JLPT tag on each set

Revision ID: d7f2b8e4a1c3
Revises: c5e1a7f3d902
Create Date: 2026-09-25 15:10:00.000000

One level of folders above sets -- "Quartet I" holding "Lesson 1", "Lesson 2" --
and a JLPT tag on the set itself. Both nullable: an unfiled, untagged set is
the honest state of every set that exists today, not a placeholder for one.

Deleting a folder unfiles its sets (SET NULL) rather than deleting them: a
folder is a way of arranging words, and throwing it away must never throw away
the words.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd7f2b8e4a1c3'
down_revision: str | Sequence[str] | None = 'c5e1a7f3d902'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'vocab_folders',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_vocab_folders_user_id'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'name', name='uq_vocab_folders_user_name'),
    )
    # Supabase exposes new public tables through its REST API; every other
    # table has RLS on with no policies, so this one matches: the backend
    # (the table owner) is unaffected, the public API is shut out.
    op.execute('ALTER TABLE vocab_folders ENABLE ROW LEVEL SECURITY')

    op.add_column('vocab_sets', sa.Column('folder_id', sa.Integer(), nullable=True))
    op.add_column('vocab_sets', sa.Column('jlpt_level', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_vocab_sets_folder_id', 'vocab_sets', 'vocab_folders', ['folder_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_vocab_sets_folder_id', 'vocab_sets', ['folder_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_vocab_sets_folder_id', table_name='vocab_sets')
    op.drop_constraint('fk_vocab_sets_folder_id', 'vocab_sets', type_='foreignkey')
    op.drop_column('vocab_sets', 'jlpt_level')
    op.drop_column('vocab_sets', 'folder_id')
    op.drop_table('vocab_folders')
