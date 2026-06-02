"""community comments (fact-checks)

Revision ID: 0006_comments
Revises: 0005_ai_report
Create Date: 2026-06-02 12:00:00.000000

Adds the `comments` table backing the "Community Fact-Checks" section on the
submission detail page. One row per community comment on a submission.
"""

from alembic import op
import sqlalchemy as sa


revision = '0006_comments'
down_revision = '0005_ai_report'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'comments',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('submission_id', sa.Integer, sa.ForeignKey('submissions.id'), nullable=False),
        sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('body', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_comments_submission_id', 'comments', ['submission_id'])


def downgrade() -> None:
    op.drop_index('ix_comments_submission_id', table_name='comments')
    op.drop_table('comments')
