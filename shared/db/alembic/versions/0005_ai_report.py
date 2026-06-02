"""ai report column (Phase 6 enhancement)

Revision ID: 0005_ai_report
Revises: 0004_community_phase5
Create Date: 2026-06-02 00:00:00.000000

Adds the rich, deterministic analysis report (JSON) to ai_analysis.
"""

from alembic import op
import sqlalchemy as sa


revision = '0005_ai_report'
down_revision = '0004_community_phase5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('ai_analysis', sa.Column('report', sa.JSON, nullable=True))


def downgrade() -> None:
    op.drop_column('ai_analysis', 'report')
