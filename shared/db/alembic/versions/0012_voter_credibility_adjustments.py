"""make submission credibility adjustments per voter

Revision ID: 0012_voter_credibility
Revises: 0011_submission_appeals
Create Date: 2026-06-10
"""
from __future__ import annotations

from alembic import op


revision = '0012_voter_credibility'
down_revision = '0011_submission_appeals'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH old AS (
            UPDATE submission_credibility_adjustments
            SET reversed = true
            WHERE reversed = false
            RETURNING user_id, delta
        ),
        totals AS (
            SELECT user_id, SUM(delta) AS delta
            FROM old
            GROUP BY user_id
        )
        UPDATE users u
        SET credibility_score = LEAST(100, GREATEST(0, u.credibility_score - totals.delta))
        FROM totals
        WHERE u.id = totals.user_id
        """
    )
    op.execute(
        """
        UPDATE users
        SET tier = CASE
            WHEN credibility_score >= 81 THEN 'Expert'
            WHEN credibility_score >= 61 THEN 'Analyst'
            WHEN credibility_score >= 31 THEN 'Verified'
            ELSE 'Newcomer'
        END
        """
    )
    op.drop_constraint(
        'uq_submission_credibility_adjustment_submission',
        'submission_credibility_adjustments',
        type_='unique',
    )
    op.create_unique_constraint(
        'uq_submission_credibility_adjustment_submission_user',
        'submission_credibility_adjustments',
        ['submission_id', 'user_id'],
    )
    op.execute(
        """
        WITH vote_counts AS (
            SELECT
                submission_id,
                SUM(CASE WHEN verdict = 'real' THEN 1 ELSE 0 END) AS real_votes,
                SUM(CASE WHEN verdict = 'fake' THEN 1 ELSE 0 END) AS fake_votes
            FROM votes
            GROUP BY submission_id
        ),
        effective AS (
            SELECT
                s.id AS submission_id,
                CASE
                    WHEN a.verdict = 'likely_real' THEN 'real'
                    WHEN a.verdict = 'likely_fake' THEN 'fake'
                    WHEN a.verdict = 'uncertain' AND COALESCE(vc.real_votes, 0) > COALESCE(vc.fake_votes, 0) THEN 'real'
                    WHEN a.verdict = 'uncertain' AND COALESCE(vc.fake_votes, 0) > COALESCE(vc.real_votes, 0) THEN 'fake'
                    ELSE NULL
                END AS effective_verdict
            FROM submissions s
            LEFT JOIN ai_analysis a ON a.submission_id = s.id
            LEFT JOIN vote_counts vc ON vc.submission_id = s.id
        ),
        desired AS (
            SELECT
                v.submission_id,
                v.user_id,
                e.effective_verdict,
                v.verdict AS voter_verdict,
                CASE WHEN v.verdict = e.effective_verdict THEN 2.0 ELSE -2.0 END AS delta
            FROM votes v
            JOIN effective e ON e.submission_id = v.submission_id
            WHERE e.effective_verdict IS NOT NULL
        ),
        upserted AS (
            INSERT INTO submission_credibility_adjustments (
                submission_id, user_id, effective_verdict, community_verdict,
                delta, reversed, created_at, updated_at
            )
            SELECT
                submission_id, user_id, effective_verdict, voter_verdict,
                delta, false, NOW(), NOW()
            FROM desired
            ON CONFLICT (submission_id, user_id) DO UPDATE
            SET
                effective_verdict = EXCLUDED.effective_verdict,
                community_verdict = EXCLUDED.community_verdict,
                delta = EXCLUDED.delta,
                reversed = false,
                updated_at = NOW()
            RETURNING user_id, delta
        ),
        totals AS (
            SELECT user_id, SUM(delta) AS delta
            FROM upserted
            GROUP BY user_id
        )
        UPDATE users u
        SET credibility_score = LEAST(100, GREATEST(0, u.credibility_score + totals.delta))
        FROM totals
        WHERE u.id = totals.user_id
        """
    )
    op.execute(
        """
        UPDATE users
        SET tier = CASE
            WHEN credibility_score >= 81 THEN 'Expert'
            WHEN credibility_score >= 61 THEN 'Analyst'
            WHEN credibility_score >= 31 THEN 'Verified'
            ELSE 'Newcomer'
        END
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        'uq_submission_credibility_adjustment_submission_user',
        'submission_credibility_adjustments',
        type_='unique',
    )
    op.create_unique_constraint(
        'uq_submission_credibility_adjustment_submission',
        'submission_credibility_adjustments',
        ['submission_id'],
    )
