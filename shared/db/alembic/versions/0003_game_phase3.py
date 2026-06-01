"""game phase 3: sessions, answers, credibility log

Revision ID: 0003_game_phase3
Revises: 0002_user_auth_phase2
Create Date: 2026-06-01 00:00:00.000000

The `questions` table already exists from 0001_initial; Phase 3 only adds the
game-session tables and the credibility audit log.
"""

from alembic import op
import sqlalchemy as sa


revision = '0003_game_phase3'
down_revision = '0002_user_auth_phase2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'game_sessions',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('mode', sa.String(20), nullable=False, server_default='timed'),
        sa.Column('room_id', sa.String(80), nullable=True),
        sa.Column('score', sa.Float, nullable=False, server_default='0'),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    op.create_table(
        'session_answers',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('session_id', sa.Integer, sa.ForeignKey('game_sessions.id'), nullable=False),
        sa.Column('question_id', sa.Integer, sa.ForeignKey('questions.id'), nullable=False),
        sa.Column('chosen_answer', sa.String(200), nullable=True),
        sa.Column('is_correct', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('response_ms', sa.Integer, nullable=True),
        sa.Column('points_earned', sa.Float, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    op.create_table(
        'credibility_log',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('delta', sa.Float, nullable=False),
        sa.Column('reason', sa.String(100), nullable=True),
        sa.Column('new_score', sa.Float, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('credibility_log')
    op.drop_table('session_answers')
    op.drop_table('game_sessions')
