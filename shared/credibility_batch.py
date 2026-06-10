"""Batch credibility recalculation.

The score is recomputed from current activity instead of adjusted in real time:
game accuracy, verifiable vote accuracy, and lightweight participation through
votes/comments. This keeps credibility deterministic for a given database state.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.credibility import clamp_credibility, tier_for
from shared.db.models import (
    AiAnalysis,
    Comment,
    CredibilityLog,
    GameSession,
    SessionAnswer,
    Submission,
    User,
    Vote,
)

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def _vote_truths(session: AsyncSession) -> dict[int, str]:
    submissions = (
        await session.execute(select(Submission.id).where(Submission.status == 'analysed'))
    ).scalars().all()
    if not submissions:
        return {}

    ai_rows = (
        await session.execute(
            select(AiAnalysis.submission_id, AiAnalysis.verdict).where(
                AiAnalysis.submission_id.in_(submissions)
            )
        )
    ).all()
    ai = {sid: verdict for sid, verdict in ai_rows}

    vote_rows = (
        await session.execute(
            select(Vote.submission_id, Vote.verdict, Vote.credibility_weight).where(
                Vote.submission_id.in_(submissions)
            )
        )
    ).all()
    grouped: dict[int, list[tuple[str, float]]] = defaultdict(list)
    for submission_id, verdict, weight in vote_rows:
        grouped[submission_id].append((verdict, float(weight)))

    truths: dict[int, str] = {}
    for submission_id in submissions:
        verdict = ai.get(submission_id)
        if verdict == 'likely_fake':
            truths[submission_id] = 'fake'
            continue
        if verdict == 'likely_real':
            truths[submission_id] = 'real'
            continue
        rows = grouped.get(submission_id, [])
        total = sum(weight for _, weight in rows)
        fake = sum(weight for verdict, weight in rows if verdict == 'fake')
        truths[submission_id] = 'fake' if total > 0 and fake / total >= 0.5 else 'real'
    return truths


async def run_credibility_batch(session: AsyncSession, redis: Any | None = None) -> dict[str, Any]:
    run_at = now_utc()
    truths = await _vote_truths(session)
    users = (
        await session.execute(select(User).where(User.is_guest.is_(False)).order_by(User.id))
    ).scalars().all()

    updated = 0
    for user in users:
        uid = user.id
        game_row = (
            await session.execute(
                select(
                    func.count(SessionAnswer.id),
                    func.coalesce(func.sum(cast(SessionAnswer.is_correct, Integer)), 0),
                )
                .select_from(SessionAnswer)
                .join(GameSession, SessionAnswer.session_id == GameSession.id)
                .where(GameSession.user_id == uid)
            )
        ).one()
        answered = int(game_row[0] or 0)
        correct = int(game_row[1] or 0)
        game_accuracy = correct / answered if answered else 0.5

        vote_rows = (
            await session.execute(select(Vote.submission_id, Vote.verdict).where(Vote.user_id == uid))
        ).all()
        verifiable_votes = [(sid, verdict) for sid, verdict in vote_rows if sid in truths]
        vote_accuracy = (
            sum(1 for sid, verdict in verifiable_votes if truths[sid] == verdict) / len(verifiable_votes)
            if verifiable_votes else 0.5
        )

        comments = (
            await session.execute(
                select(func.count()).select_from(Comment).where(Comment.user_id == uid)
            )
        ).scalar_one()
        participation = min((len(vote_rows) + int(comments)) / 20, 1.0)

        new_score = clamp_credibility(
            round(50 + (game_accuracy - 0.5) * 30 + (vote_accuracy - 0.5) * 40 + participation * 10, 2)
        )
        before = float(user.credibility_score)
        user.credibility_score = new_score
        user.tier = tier_for(new_score)
        if round(before, 2) != new_score:
            session.add(
                CredibilityLog(
                    user_id=uid,
                    delta=round(new_score - before, 2),
                    reason='credibility_batch',
                    new_score=new_score,
                )
            )
        updated += 1

    await session.commit()

    if redis is not None:
        try:
            await redis.publish('leaderboard:changed', 'credibility_batch')
        except Exception:
            pass

    return {
        'updated_users': updated,
        'ran_at': run_at.isoformat(),
        'next_run': None,
    }
