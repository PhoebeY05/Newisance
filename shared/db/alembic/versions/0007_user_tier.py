"""user credibility tier (Phase 8)

Revision ID: 0007_user_tier
Revises: 0006_comments
Create Date: 2026-06-03 00:00:00.000000

Adds the denormalised `tier` column to users and backfills it from each user's
existing credibility_score using the bracket rules (Newcomer 0–30, Verified
31–60, Analyst 61–80, Expert 81–100).
"""

from alembic import op
import sqlalchemy as sa


revision = '0007_user_tier'
down_revision = '0006_comments'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('tier', sa.String(20), nullable=False, server_default='Verified'),
    )
    # Backfill existing rows from their credibility_score.
    op.execute(
        """
        UPDATE users SET tier = CASE
            WHEN credibility_score >= 81 THEN 'Expert'
            WHEN credibility_score >= 61 THEN 'Analyst'
            WHEN credibility_score >= 31 THEN 'Verified'
            ELSE 'Newcomer'
        END
        """
    )


def downgrade() -> None:
    op.drop_column('users', 'tier')
