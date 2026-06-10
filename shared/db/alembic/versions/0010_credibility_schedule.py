"""credibility batch schedule settings

Revision ID: 0010_credibility_schedule
Revises: 0009_powerups
Create Date: 2026-06-10 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = '0010_credibility_schedule'
down_revision = '0009_powerups'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('credibility_updated_at', sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        'platform_settings',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('credibility_update_interval', sa.String(20), nullable=False, server_default='weekly'),
        sa.Column('credibility_cron_expression', sa.String(120), nullable=False, server_default='0 16 * * 0'),
        sa.Column('credibility_last_run', sa.DateTime(timezone=True), nullable=True),
        sa.Column('credibility_next_run', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('platform_settings')
    op.drop_column('users', 'credibility_updated_at')
