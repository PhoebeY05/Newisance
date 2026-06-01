"""community phase 5: submissions, votes, ai_analysis

Revision ID: 0004_community_phase5
Revises: 0003_game_phase3
Create Date: 2026-06-01 00:00:00.000000

Adds the Community Verification Hub tables. `ai_analysis` is populated by the
Phase 6 AI worker — Phase 5 only creates the table so the detail endpoint can
return null for it.
"""

from alembic import op
import sqlalchemy as sa


revision = '0004_community_phase5'
down_revision = '0003_game_phase3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'submissions',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('content_type', sa.String(20), nullable=False),
        sa.Column('content_url', sa.Text, nullable=False),
        sa.Column('caption', sa.Text, nullable=True),
        sa.Column('status', sa.String(30), nullable=False, server_default='pending'),
        sa.Column('credibility_settled', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    op.create_table(
        'votes',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('submission_id', sa.Integer, sa.ForeignKey('submissions.id'), nullable=False),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('verdict', sa.String(10), nullable=False),
        sa.Column('impact_score', sa.Integer, nullable=False, server_default='1'),
        sa.Column('credibility_weight', sa.Float, nullable=False, server_default='0.5'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('submission_id', 'user_id', name='uq_votes_submission_user'),
    )

    op.create_table(
        'ai_analysis',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('submission_id', sa.Integer, sa.ForeignKey('submissions.id'), nullable=False),
        sa.Column('confidence', sa.Float, nullable=True),
        sa.Column('signals', sa.JSON, nullable=True),
        sa.Column('verdict', sa.String(30), nullable=True),
        sa.Column('explanation', sa.Text, nullable=True),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('ai_analysis')
    op.drop_table('votes')
    op.drop_table('submissions')
