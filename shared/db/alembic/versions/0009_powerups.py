"""power-up shop inventory (Phase 11)

Revision ID: 0009_powerups
Revises: 0008_rewards
Create Date: 2026-06-08 00:00:00.000000

Adds the user_powerups table — power-ups a user has bought from the shop with
credibility points, consumed when activated in a game.
"""

from alembic import op
import sqlalchemy as sa


revision = '0009_powerups'
down_revision = '0008_rewards'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_powerups',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('key', sa.String(40), nullable=False),
        sa.Column('quantity', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('user_id', 'key', name='uq_user_powerups_user_key'),
    )
    op.create_index('ix_user_powerups_user_id', 'user_powerups', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_user_powerups_user_id', table_name='user_powerups')
    op.drop_table('user_powerups')
