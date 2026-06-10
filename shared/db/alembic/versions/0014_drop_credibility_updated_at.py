"""drop credibility updated at from users

Revision ID: 0014_drop_cred_updated
Revises: 0013_no_cred_schedule
Create Date: 2026-06-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0014_drop_cred_updated'
down_revision = '0013_no_cred_schedule'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('users', 'credibility_updated_at')


def downgrade() -> None:
    op.add_column('users', sa.Column('credibility_updated_at', sa.DateTime(timezone=True), nullable=True))
