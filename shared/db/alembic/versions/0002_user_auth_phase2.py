"""user auth phase 2

Revision ID: 0002_user_auth_phase2
Revises: 0001_initial
Create Date: 2026-06-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = '0002_user_auth_phase2'
down_revision = '0001_initial'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        'users',
        'is_guest',
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text('false'),
    )
    op.alter_column(
        'users',
        'credibility_score',
        existing_type=sa.Float(),
        nullable=False,
        server_default=sa.text('50'),
    )
    op.alter_column(
        'users',
        'is_admin',
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text('false'),
    )


def downgrade() -> None:
    op.alter_column(
        'users',
        'is_admin',
        existing_type=sa.Boolean(),
        nullable=True,
        server_default=None,
    )
    op.alter_column(
        'users',
        'credibility_score',
        existing_type=sa.Float(),
        nullable=True,
        server_default=None,
    )
    op.alter_column(
        'users',
        'is_guest',
        existing_type=sa.Boolean(),
        nullable=True,
        server_default=None,
    )