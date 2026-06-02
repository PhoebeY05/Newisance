"""Integration tests for the Phase 7 public dashboard."""
import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from shared import dashboard
from shared.db.models import AiAnalysis, Submission, User, Vote


def _run(coro):
    return asyncio.run(coro)


async def _make_user(session, cleanup, credibility: float) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        username=f'dash_{suffix}',
        email=f'dash_{suffix}@example.com',
        hashed_password=None,
        is_guest=False,
        credibility_score=credibility,
        is_admin=False,
    )
    session.add(user)
    await session.flush()
    cleanup['users'].add(user.id)
    return user


async def _make_submission(
    session, cleanup, *, author: User, content: str, votes, ai_verdict=None, ai_confidence=None
) -> Submission:
    sub = Submission(
        user_id=author.id,
        content_type='text',
        content_url=content,
        caption='Test • Category: Finance • Impact: High',
        status='analysed' if ai_verdict else 'community_only',
    )
    session.add(sub)
    await session.flush()
    cleanup['submissions'].add(sub.id)

    for voter, verdict, impact in votes:
        session.add(
            Vote(
                submission_id=sub.id,
                user_id=voter.id,
                verdict=verdict,
                impact_score=impact,
                credibility_weight=min(float(voter.credibility_score) / 100.0, 1.0),
            )
        )
    if ai_verdict is not None:
        session.add(
            AiAnalysis(
                submission_id=sub.id,
                confidence=ai_confidence,
                signals=['test signal'],
                verdict=ai_verdict,
                explanation='Test explanation.',
            )
        )
    await session.flush()
    return sub


# --- pure helper ---------------------------------------------------------

def test_tier_for_brackets() -> None:
    assert dashboard.tier_for(95) == 'Expert'
    assert dashboard.tier_for(81) == 'Expert'
    assert dashboard.tier_for(80) == 'Analyst'
    assert dashboard.tier_for(61) == 'Analyst'
    assert dashboard.tier_for(60) == 'Verified'
    assert dashboard.tier_for(31) == 'Verified'
    assert dashboard.tier_for(30) == 'Newcomer'
    assert dashboard.tier_for(0) == 'Newcomer'


# --- builders ------------------------------------------------------------

def test_trending_ranks_high_impact_fake_first(session_factory, cleanup) -> None:
    async def _scenario():
        async with session_factory() as session:
            author = await _make_user(session, cleanup, 90.0)
            voter = await _make_user(session, cleanup, 90.0)
            # High fake-likelihood + high impact.
            hot = await _make_submission(
                session, cleanup, author=author, content='Hot fake scam',
                votes=[(voter, 'fake', 5)], ai_verdict='likely_fake', ai_confidence=0.95,
            )
            # Real + low impact.
            cold = await _make_submission(
                session, cleanup, author=author, content='Calm real notice',
                votes=[(voter, 'real', 1)], ai_verdict='likely_real', ai_confidence=0.05,
            )
            await session.commit()

            trending = await dashboard.build_trending(session, limit=50)
            ids = [it['id'] for it in trending]
            assert hot.id in ids and cold.id in ids
            # The hot fake outranks the calm real one.
            assert ids.index(hot.id) < ids.index(cold.id)
            hot_item = next(it for it in trending if it['id'] == hot.id)
            assert hot_item['verdict'] == 'likely_fake'
            assert hot_item['rank_score'] >= hot_item['final_score']  # impact ≥ 1 multiplier

    _run(_scenario())


def test_stats_counts_new_submission(session_factory, cleanup) -> None:
    async def _scenario():
        async with session_factory() as session:
            before = await dashboard.build_stats(session)
            author = await _make_user(session, cleanup, 80.0)
            voter = await _make_user(session, cleanup, 80.0)
            await _make_submission(
                session, cleanup, author=author, content='Fresh fake this week',
                votes=[(voter, 'fake', 4)],
            )
            await session.commit()
            after = await dashboard.build_stats(session)

        assert after['submissions_this_week'] >= before['submissions_this_week'] + 1
        assert 0 <= after['pct_fake'] <= 100
        assert after['active_users_this_week'] >= 1

    _run(_scenario())


def test_scam_types_shape(session_factory) -> None:
    async def _scenario():
        async with session_factory() as session:
            return await dashboard.build_scam_types(session)

    data = _run(_scenario())
    assert set(data.keys()) == {'by_verdict', 'by_content_type', 'by_category', 'weekly'}
    assert len(data['weekly']) == 4
    for bucket in data['weekly']:
        assert set(bucket.keys()) == {'week', 'likely_fake', 'likely_real', 'uncertain'}


def test_leaderboard_reads_redis(session_factory, cleanup) -> None:
    redis = pytest.importorskip('redis.asyncio')

    async def _scenario():
        from shared.config import settings as cfg

        client = redis.from_url(cfg.REDIS_URL, decode_responses=True)
        try:
            await client.ping()
        except Exception:
            pytest.skip('Redis not available')

        async with session_factory() as session:
            user = await _make_user(session, cleanup, 88.0)
            await session.commit()
            member = str(user.id)
            # A score high enough to land at the top of the test read window.
            await client.zadd('leaderboard:weekly', {member: 99999.0})
            try:
                rows = await dashboard.build_leaderboard(session, client, 'weekly', 50)
            finally:
                await client.zrem('leaderboard:weekly', member)
                close = getattr(client, 'aclose', client.close)
                await close()

        entry = next((r for r in rows if r['user_id'] == user.id), None)
        assert entry is not None
        assert entry['rank'] == 1
        assert entry['tier'] == 'Expert'  # credibility 88
        assert entry['username'] == user.username

    _run(_scenario())


# --- HTTP endpoints (smoke: status + shape; data may come from warm cache) --

def test_stats_endpoint(client: TestClient) -> None:
    response = client.get('/stats')
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {
        'submissions_this_week', 'pct_fake', 'most_common_type', 'active_users_this_week'
    }


def test_trending_endpoint(client: TestClient) -> None:
    response = client.get('/trending', params={'limit': 6})
    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert len(items) <= 6


def test_scam_types_endpoint(client: TestClient) -> None:
    response = client.get('/scam-types')
    assert response.status_code == 200
    body = response.json()
    assert len(body['weekly']) == 4


def test_leaderboard_endpoint(client: TestClient) -> None:
    weekly = client.get('/leaderboard', params={'scope': 'weekly', 'limit': 10})
    assert weekly.status_code == 200
    assert isinstance(weekly.json(), list)
    # An unknown scope falls back to weekly rather than erroring.
    fallback = client.get('/leaderboard', params={'scope': 'bogus'})
    assert fallback.status_code == 200
