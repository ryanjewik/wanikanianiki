"""generation_runs, and questions.run_id

Revision ID: c5e2a8f41b07
Revises: f2b9d4e7a150
Create Date: 2026-09-28 10:00:00.000000

One row per pass of the lesson worker, so the app can show what each run
wrote and whether the worker is running at all.

Questions written before this existed are grouped into `backfilled` runs
rather than left loose: a run is a burst of questions created within minutes
of each other, so a gap of more than ten minutes between two consecutive
questions starts a new one. Their drafted/rejected counts come from the
questions themselves; how many bundles each built is not recoverable and is
left at zero.

"""
from collections.abc import Sequence
from datetime import timedelta

import sqlalchemy as sa

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c5e2a8f41b07'
down_revision: str | Sequence[str] | None = 'f2b9d4e7a150'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUN_GAP = timedelta(minutes=10)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'generation_runs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('trigger', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column(
            'started_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('bundles_waiting', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('drafted', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('rejected', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('bundles_created', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_generation_runs_user_id'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_generation_runs_user_started', 'generation_runs', ['user_id', 'started_at']
    )

    op.add_column('questions', sa.Column('run_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_questions_run_id', 'questions', 'generation_runs',
        ['run_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_questions_run_id', 'questions', ['run_id'])

    _backfill_runs()


def _backfill_runs() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, user_id, created_at, verified, verifier_note "
            "FROM questions ORDER BY user_id, created_at, id"
        )
    ).fetchall()

    groups: list[list] = []
    for row in rows:
        last = groups[-1][-1] if groups else None
        if last is None or last.user_id != row.user_id or row.created_at - last.created_at > RUN_GAP:
            groups.append([row])
        else:
            groups[-1].append(row)

    for group in groups:
        # A rejected question kept its verifier note; a verified one did not.
        rejected = sum(1 for q in group if not q.verified)
        run_id = bind.execute(
            sa.text(
                "INSERT INTO generation_runs "
                "(user_id, trigger, status, reason, started_at, finished_at, drafted, rejected) "
                "VALUES (:user_id, 'backfilled', 'completed', "
                "'Written before runs were recorded', :started, :finished, :drafted, :rejected) "
                "RETURNING id"
            ),
            {
                "user_id": group[0].user_id,
                "started": group[0].created_at,
                "finished": group[-1].created_at,
                "drafted": len(group),
                "rejected": rejected,
            },
        ).scalar_one()
        bind.execute(
            sa.text("UPDATE questions SET run_id = :run_id WHERE id = ANY(:ids)"),
            {"run_id": run_id, "ids": [q.id for q in group]},
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_questions_run_id', table_name='questions')
    op.drop_constraint('fk_questions_run_id', 'questions', type_='foreignkey')
    op.drop_column('questions', 'run_id')
    op.drop_index('ix_generation_runs_user_started', table_name='generation_runs')
    op.drop_table('generation_runs')
