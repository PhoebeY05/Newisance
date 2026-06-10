"""remove credibility schedule settings

Revision ID: 0013_no_cred_schedule
Revises: 0012_voter_credibility
Create Date: 2026-06-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0013_no_cred_schedule'
down_revision = '0012_voter_credibility'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table('platform_settings')


def downgrade() -> None:
    op.create_table(
        'platform_settings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('credibility_update_interval', sa.String(20), nullable=False, server_default='weekly'),
        sa.Column('credibility_cron_expression', sa.String(120), nullable=False, server_default='0 16 * * 0'),
        sa.Column('credibility_last_run', sa.DateTime(timezone=True), nullable=True),
        sa.Column('credibility_next_run', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
