"""Batch credibility recalculation.

The score is recomputed from current activity instead of adjusted in real time:
game accuracy, verifiable vote accuracy, and lightweight participation through
votes/comments. This keeps credibility deterministic for a given database state.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.credibility import clamp_credibility, tier_for
from shared.db.models import (
    AiAnalysis,
    Comment,
    CredibilityLog,
    GameSession,
    PlatformSettings,
    SessionAnswer,
    Submission,
    User,
    Vote,
)

DEFAULT_INTERVAL = 'weekly'
DEFAULT_CRON = '0 16 * * 0'


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _cron_matches(field: str, value: int) -> bool:
    if field == '*':
        return True
    for part in field.split(','):
        if part.startswith('*/') and part[2:].isdigit():
            step = int(part[2:])
            if step > 0 and value % step == 0:
                return True
        if '-' in part:
            start, end = part.split('-', 1)
            if start.isdigit() and end.isdigit() and int(start) <= value <= int(end):
                return True
        if part.isdigit() and int(part) == value:
            return True
    return False


def next_run_from(
    after: datetime | None,
    interval: str | None,
    cron_expression: str | None,
) -> datetime:
    base = as_utc(after) or now_utc()
    interval = interval or DEFAULT_INTERVAL
    cron_expression = (cron_expression or DEFAULT_CRON).strip()
    if interval == 'daily':
        return base + timedelta(days=1)
    if interval == 'weekly':
        return base + timedelta(days=7)

    parts = cron_expression.split()
    if len(parts) != 5:
        return base + timedelta(days=7)

    minute_f, hour_f, day_f, month_f, weekday_f = parts
    probe = base.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(366 * 24 * 60):
        cron_weekday = (probe.weekday() + 1) % 7
        if (
            _cron_matches(minute_f, probe.minute)
            and _cron_matches(hour_f, probe.hour)
            and _cron_matches(day_f, probe.day)
            and _cron_matches(month_f, probe.month)
            and _cron_matches(weekday_f, cron_weekday)
        ):
            return probe
        probe += timedelta(minutes=1)
    return base + timedelta(days=7)


async def get_or_create_settings(session: AsyncSession) -> PlatformSettings:
    settings = (
        await session.execute(select(PlatformSettings).order_by(PlatformSettings.id).limit(1))
    ).scalar_one_or_none()
    if settings is None:
        settings = PlatformSettings(
            credibility_update_interval=DEFAULT_INTERVAL,
            credibility_cron_expression=DEFAULT_CRON,
            credibility_next_run=next_run_from(now_utc(), DEFAULT_INTERVAL, DEFAULT_CRON),
        )
        session.add(settings)
        await session.flush()
    return settings


async def set_schedule(
    session: AsyncSession,
    *,
    interval: str,
    cron_expression: str | None,
) -> PlatformSettings:
    if interval not in {'daily', 'weekly', 'custom'}:
        raise ValueError('interval must be daily, weekly, or custom')
    expression = (cron_expression or '').strip()
    if interval == 'daily':
        expression = '0 0 * * *'
    elif interval == 'weekly':
        expression = DEFAULT_CRON
    elif len(expression.split()) != 5:
        raise ValueError('custom cron expression must have five fields')

    settings = await get_or_create_settings(session)
    settings.credibility_update_interval = interval
    settings.credibility_cron_expression = expression
    settings.credibility_next_run = next_run_from(now_utc(), interval, expression)
    await session.flush()
    return settings


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
        user.credibility_updated_at = run_at
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

    settings = await get_or_create_settings(session)
    settings.credibility_last_run = run_at
    settings.credibility_next_run = next_run_from(
        run_at,
        settings.credibility_update_interval,
        settings.credibility_cron_expression,
    )
    await session.commit()

    if redis is not None:
        try:
            await redis.publish('leaderboard:changed', 'credibility_batch')
        except Exception:
            pass

    return {
        'updated_users': updated,
        'ran_at': run_at.isoformat(),
        'next_run': settings.credibility_next_run.isoformat() if settings.credibility_next_run else None,
    }
