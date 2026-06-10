"""submission appeals and credibility adjustments

Revision ID: 0011_submission_appeals
Revises: 0010_credibility_schedule
Create Date: 2026-06-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0011_submission_appeals'
down_revision = '0010_credibility_schedule'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'submission_credibility_adjustments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('submission_id', sa.Integer(), sa.ForeignKey('submissions.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('effective_verdict', sa.String(10), nullable=False),
        sa.Column('community_verdict', sa.String(10), nullable=False),
        sa.Column('delta', sa.Float(), nullable=False),
        sa.Column('reversed', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('submission_id', name='uq_submission_credibility_adjustment_submission'),
    )
    op.create_table(
        'submission_appeals',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('submission_id', sa.Integer(), sa.ForeignKey('submissions.id'), nullable=False),
        sa.Column('appellant_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('submission_id', 'appellant_user_id', name='uq_submission_appeals_submission_user'),
    )


def downgrade() -> None:
    op.drop_table('submission_appeals')
    op.drop_table('submission_credibility_adjustments')
