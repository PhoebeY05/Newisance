"""leaderboard snapshots + vouchers (Phase 10)

Revision ID: 0008_rewards
Revises: 0007_user_tier
Create Date: 2026-06-03 00:00:00.000000

Adds the weekly leaderboard snapshot table (written by the reset job) and the
voucher table (assigned to weekly top-3 winners).
"""

from alembic import op
import sqlalchemy as sa


revision = '0008_rewards'
down_revision = '0007_user_tier'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'leaderboard_snapshots',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('scope', sa.String(20), nullable=False),
        sa.Column('rank', sa.Integer, nullable=False),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('score', sa.Float, nullable=False),
        sa.Column('snapshot_date', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_leaderboard_snapshots_scope_date', 'leaderboard_snapshots', ['scope', 'snapshot_date'])

    op.create_table(
        'vouchers',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('code', sa.String(80), nullable=False, unique=True),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('claimed', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('vouchers')
    op.drop_index('ix_leaderboard_snapshots_scope_date', table_name='leaderboard_snapshots')
    op.drop_table('leaderboard_snapshots')
