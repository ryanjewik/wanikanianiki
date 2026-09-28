"""row-level security on generation_runs

Revision ID: a4d7e2c9b318
Revises: c5e2a8f41b07
Create Date: 2026-09-28 12:00:00.000000

Every other table has RLS on with no policies: the backend owns the tables and
is unaffected, and Supabase's public REST API -- which exposes new tables in
`public` by default -- is shut out. generation_runs was created without it.

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a4d7e2c9b318'
down_revision: str | Sequence[str] | None = 'c5e2a8f41b07'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute('ALTER TABLE generation_runs ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    """Downgrade schema."""
    op.execute('ALTER TABLE generation_runs DISABLE ROW LEVEL SECURITY')
