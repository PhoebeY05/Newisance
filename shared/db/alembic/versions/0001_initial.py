"""initial migration

Revision ID: 0001_initial
Revises: 
Create Date: 2026-05-31 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('username', sa.String(80), nullable=False, unique=True),
        sa.Column('email', sa.String(200), nullable=False, unique=True),
        sa.Column('hashed_password', sa.String(200), nullable=True),
        sa.Column('is_guest', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('credibility_score', sa.Float, nullable=False, server_default='50'),
        sa.Column('is_admin', sa.Boolean, nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )

    op.create_table(
        'questions',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('type', sa.String(50), nullable=False),
        sa.Column('media_url', sa.String(500), nullable=True),
        sa.Column('correct_answer', sa.String(200), nullable=True),
        sa.Column('explanation', sa.Text, nullable=True),
        sa.Column('difficulty', sa.String(20), nullable=True),
        sa.Column('tags', sa.Text, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('questions')
    op.drop_table('users')
