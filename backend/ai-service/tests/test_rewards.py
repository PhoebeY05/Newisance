"""Tests for the Phase 10 weekly leaderboard reset + rewards."""
import asyncio
import uuid

from sqlalchemy import delete, func, select

import worker
from conftest import FakeRedis, TestSessionLocal
from shared.db.models import LeaderboardSnapshot, User, Voucher


def _run(coro):
    return asyncio.run(coro)


async def _user(session, cleanup) -> int:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        username=f'rw_{suffix}',
        email=f'rw_{suffix}@example.com',
        hashed_password='x',
        credibility_score=50.0,
    )
    session.add(user)
    await session.flush()
    cleanup['users'].add(user.id)
    return user.id


def test_weekly_reset_snapshots_rewards_top3_and_clears(monkeypatch, cleanup) -> None:
    # No real SMTP in tests — capture the calls instead.
    sent: list[tuple] = []
    monkeypatch.setattr(
        worker, '_send_reward_email',
        lambda to, name, rank, score, code: sent.append((to, rank, code)),
    )

    voucher_codes = [f'TST-{uuid.uuid4().hex[:6]}' for _ in range(3)]
    state: dict = {}

    async def setup():
        async with TestSessionLocal() as session:
            uids = [await _user(session, cleanup) for _ in range(4)]
            for code in voucher_codes:
                session.add(Voucher(code=code, claimed=False))
            await session.commit()
            state['uids'] = uids

    _run(setup())
    uids = state['uids']

    # Build an isolated FakeRedis leaderboard: uids ranked by descending score.
    redis = FakeRedis()
    _run(redis.zadd('leaderboard:weekly', {str(uids[i]): 1000 - i * 100 for i in range(4)}))
    ctx = {'redis': redis}

    _run(worker.weekly_leaderboard_reset(ctx))

    async def check():
        async with TestSessionLocal() as session:
            snaps = (
                await session.execute(
                    select(LeaderboardSnapshot)
                    .where(LeaderboardSnapshot.user_id.in_(uids))
                    .order_by(LeaderboardSnapshot.rank)
                )
            ).scalars().all()
            # All 4 ranked, in order, scope=weekly.
            assert [s.user_id for s in snaps] == uids
            assert [s.rank for s in snaps] == [1, 2, 3, 4]
            assert all(s.scope == 'weekly' for s in snaps)
            assert snaps[0].score == 1000.0

            # Exactly the top 3 users each got a claimed voucher assigned. (The
            # worker claims the lowest-id unclaimed voucher, which may be a seed
            # voucher rather than one of ours — that's fine; we restore below.)
            assigned = (
                await session.execute(select(Voucher).where(Voucher.user_id.in_(uids)))
            ).scalars().all()
            assert len(assigned) == 3
            assert all(v.claimed for v in assigned)
            assert {v.user_id for v in assigned} == set(uids[:3])

    _run(check())

    # Weekly key cleared; 3 emails sent for ranks 1–3 (4th place got nothing).
    assert _run(redis.zrevrange('leaderboard:weekly', 0, -1)) == []
    assert len(sent) == 3
    assert {r for _, r, _ in sent} == {1, 2, 3}

    # Restore any SEED vouchers we consumed (un-assign), then delete our own.
    async def _restore_vouchers():
        async with TestSessionLocal() as session:
            seed_consumed = (
                await session.execute(
                    select(Voucher).where(
                        Voucher.user_id.in_(uids), Voucher.code.notin_(voucher_codes)
                    )
                )
            ).scalars().all()
            for voucher in seed_consumed:
                voucher.claimed = False
                voucher.user_id = None
            await session.execute(delete(Voucher).where(Voucher.code.in_(voucher_codes)))
            await session.commit()
    _run(_restore_vouchers())


def test_weekly_reset_noop_on_empty_leaderboard() -> None:
    redis = FakeRedis()  # no members
    # Should simply log and return without error or DB writes.
    _run(worker.weekly_leaderboard_reset({'redis': redis}))
