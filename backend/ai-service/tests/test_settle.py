"""Tests for the Phase 8 settle_credibility task."""
import asyncio
import uuid

import pytest
from sqlalchemy import func, select

import worker
from shared.db.models import AiAnalysis, CredibilityLog, Submission, User, Vote


def _run(coro):
    return asyncio.run(coro)


async def _user(session, cleanup, credibility: float) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        username=f'st_{suffix}',
        email=f'st_{suffix}@example.com',
        hashed_password='x',
        credibility_score=credibility,
        tier='Verified',
    )
    session.add(user)
    await session.flush()
    cleanup['users'].add(user.id)
    return user


async def _submission(session, cleanup, author: User, *, status='analysed') -> Submission:
    sub = Submission(
        user_id=author.id,
        content_type='text',
        content_url='Settle me',
        caption='why • Category: Finance • Impact: High',
        status=status,
    )
    session.add(sub)
    await session.flush()
    cleanup['submissions'].add(sub.id)
    return sub


def test_settle_rewards_matchers_and_penalises_others(session_factory, ctx, cleanup) -> None:
    state: dict[str, int] = {}

    async def setup():
        async with session_factory() as session:
            author = await _user(session, cleanup, 70.0)
            matcher = await _user(session, cleanup, 50.0)
            misser = await _user(session, cleanup, 50.0)
            climber = await _user(session, cleanup, 80.8)  # +0.5 → 81.3 crosses into Expert
            sub = await _submission(session, cleanup, author)
            session.add(
                AiAnalysis(submission_id=sub.id, verdict='likely_fake', confidence=0.9, signals=[])
            )
            for voter, verdict in (
                (matcher, 'fake'),
                (misser, 'real'),
                (climber, 'fake'),
            ):
                session.add(
                    Vote(
                        submission_id=sub.id,
                        user_id=voter.id,
                        verdict=verdict,
                        impact_score=3,
                        credibility_weight=min(voter.credibility_score / 100, 1.0),
                    )
                )
            await session.commit()
            state.update(
                sub=sub.id, matcher=matcher.id, misser=misser.id, climber=climber.id
            )

    _run(setup())

    # Settle once.
    _run(worker.settle_credibility(ctx, state['sub']))

    async def check_first():
        async with session_factory() as session:
            matcher = await session.get(User, state['matcher'])
            misser = await session.get(User, state['misser'])
            climber = await session.get(User, state['climber'])
            sub = await session.get(Submission, state['sub'])
            assert matcher.credibility_score == pytest.approx(50.5)  # +0.5 match
            assert misser.credibility_score == pytest.approx(49.8)   # -0.2 miss
            assert climber.credibility_score == pytest.approx(81.3)
            assert climber.tier == 'Expert'  # tier recomputed across the bracket
            assert sub.credibility_settled is True
            return matcher.credibility_score, misser.credibility_score

    first = _run(check_first())

    # Idempotent: settling again must not move scores or add logs.
    _run(worker.settle_credibility(ctx, state['sub']))

    async def check_idempotent():
        async with session_factory() as session:
            matcher = await session.get(User, state['matcher'])
            misser = await session.get(User, state['misser'])
            voter_ids = [state['matcher'], state['misser'], state['climber']]
            log_count = (
                await session.execute(
                    select(func.count())
                    .select_from(CredibilityLog)
                    .where(CredibilityLog.user_id.in_(voter_ids))
                )
            ).scalar_one()
            return matcher.credibility_score, misser.credibility_score, log_count

    matcher_score, misser_score, log_count = _run(check_idempotent())
    assert (matcher_score, misser_score) == first  # unchanged on second run
    assert log_count == 3  # one log per voter, not doubled


def test_settle_uses_community_majority_when_uncertain(session_factory, ctx, cleanup) -> None:
    """No decisive AI verdict → grade against the credibility-weighted majority."""
    state: dict[str, int] = {}

    async def setup():
        async with session_factory() as session:
            author = await _user(session, cleanup, 60.0)
            heavy = await _user(session, cleanup, 90.0)  # weight 0.9, votes fake
            light = await _user(session, cleanup, 20.0)  # weight 0.2, votes real
            sub = await _submission(session, cleanup, author)
            session.add(
                AiAnalysis(submission_id=sub.id, verdict='uncertain', confidence=0.5, signals=[])
            )
            session.add(
                Vote(submission_id=sub.id, user_id=heavy.id, verdict='fake',
                     impact_score=3, credibility_weight=0.9)
            )
            session.add(
                Vote(submission_id=sub.id, user_id=light.id, verdict='real',
                     impact_score=3, credibility_weight=0.2)
            )
            await session.commit()
            state.update(sub=sub.id, heavy=heavy.id, light=light.id)

    _run(setup())
    _run(worker.settle_credibility(ctx, state['sub']))

    async def check():
        async with session_factory() as session:
            heavy = await session.get(User, state['heavy'])
            light = await session.get(User, state['light'])
            # Weighted majority is 'fake' (0.9 vs 0.2), so heavy matched, light missed.
            assert heavy.credibility_score == pytest.approx(90.5)
            assert light.credibility_score == pytest.approx(19.8)

    _run(check())


def test_settle_skips_unanalysed(session_factory, ctx, cleanup) -> None:
    state: dict[str, int] = {}

    async def setup():
        async with session_factory() as session:
            author = await _user(session, cleanup, 50.0)
            sub = await _submission(session, cleanup, author, status='pending')
            await session.commit()
            state['sub'] = sub.id

    _run(setup())
    _run(worker.settle_credibility(ctx, state['sub']))

    async def check():
        async with session_factory() as session:
            sub = await session.get(Submission, state['sub'])
            assert sub.credibility_settled is False  # pending → not settled

    _run(check())
