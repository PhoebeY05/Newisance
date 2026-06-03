import asyncio
from pathlib import Path
import sys

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


ROOT = Path(__file__).resolve().parents[3]
# The container copies backend/ai-service/app/ to /app and runs
# `arq worker.WorkerSettings` with PYTHONPATH=/app, so source modules are
# top-level (worker, gemini, analysers...). Mirror that here.
APP_ROOT = ROOT / 'backend' / 'ai-service' / 'app'

for path in (ROOT, APP_ROOT):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


import worker  # noqa: E402
from shared.config import settings  # noqa: E402
from shared.db.models import (  # noqa: E402
    AiAnalysis,
    Base,
    CredibilityLog,
    LeaderboardSnapshot,
    Submission,
    User,
    Voucher,
    Vote,
)


TEST_DATABASE_URL = settings.DATABASE_URL.replace('postgresql://', 'postgresql+asyncpg://')
test_engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False)


@pytest.fixture(scope='session', autouse=True)
def prepare_database():
    async def _prepare() -> None:
        async with test_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(_prepare())
    yield
    asyncio.run(test_engine.dispose())


@pytest.fixture(autouse=True)
def use_test_db(monkeypatch):
    """Point the worker's direct AsyncSessionLocal at the NullPool test engine
    so per-test event loops never reuse a pooled connection across loops."""
    monkeypatch.setattr(worker, 'AsyncSessionLocal', TestSessionLocal)
    yield


@pytest.fixture()
def cleanup():
    registry: dict[str, set[int]] = {'submissions': set(), 'users': set()}
    yield registry

    async def _cleanup() -> None:
        async with TestSessionLocal() as session:
            if registry['submissions']:
                ids = registry['submissions']
                await session.execute(delete(AiAnalysis).where(AiAnalysis.submission_id.in_(ids)))
                await session.execute(delete(Vote).where(Vote.submission_id.in_(ids)))
                await session.execute(delete(Submission).where(Submission.id.in_(ids)))
            if registry['users']:
                uids = registry['users']
                await session.execute(delete(CredibilityLog).where(CredibilityLog.user_id.in_(uids)))
                await session.execute(
                    delete(LeaderboardSnapshot).where(LeaderboardSnapshot.user_id.in_(uids))
                )
                # NB: voucher cleanup is the reward test's own job (it must
                # RESTORE any seed vouchers it consumed, not delete them).
                await session.execute(delete(User).where(User.id.in_(uids)))
            await session.commit()

    asyncio.run(_cleanup())


@pytest.fixture()
def session_factory():
    """Expose the NullPool test session maker for tests that build DB fixtures."""
    return TestSessionLocal


class FakeRedis:
    """Minimal async stand-in for arq's Redis.

    Captures cached values and supports just enough sorted-set ops for the
    weekly-reset test — fully in-memory so it never touches the real
    leaderboard:weekly key. Members come back as bytes, mirroring arq's Redis
    (decode_responses=False), so callers must decode.
    """

    def __init__(self) -> None:
        self.store: dict[str, object] = {}
        self.zsets: dict[str, dict[str, float]] = {}

    async def set(self, key, value, ex=None, expire=None):  # noqa: ANN001
        self.store[key] = value

    async def enqueue_job(self, name, *args, **kwargs):  # noqa: ANN001
        self.store.setdefault('_jobs', []).append((name, args))

    async def zadd(self, key, mapping):  # noqa: ANN001
        z = self.zsets.setdefault(key, {})
        for member, score in mapping.items():
            z[str(member)] = float(score)

    def _ranked(self, key):
        return sorted(self.zsets.get(key, {}).items(), key=lambda kv: kv[1], reverse=True)

    async def zrevrange(self, key, start, stop, withscores=False):  # noqa: ANN001
        items = self._ranked(key)
        end = None if stop == -1 else stop + 1
        sliced = items[start:end]
        if withscores:
            return [(m.encode(), s) for m, s in sliced]
        return [m.encode() for m, s in sliced]

    async def zrevrank(self, key, member):  # noqa: ANN001
        members = [m for m, _ in self._ranked(key)]
        return members.index(str(member)) if str(member) in members else None

    async def delete(self, *keys):  # noqa: ANN001
        for key in keys:
            self.zsets.pop(key, None)
            self.store.pop(key, None)


@pytest.fixture()
def ctx():
    return {'redis': FakeRedis()}


@pytest.fixture()
def make_submission(cleanup):
    """Insert a user + submission (optionally with votes); return its id."""
    import uuid

    def _make(content_type='text', content_url='Some content', votes=None, credibility=50.0) -> int:
        async def _insert() -> int:
            async with TestSessionLocal() as session:
                suffix = uuid.uuid4().hex[:8]
                user = User(
                    username=f'sub_{suffix}',
                    email=f'sub_{suffix}@example.com',
                    hashed_password='x',
                    credibility_score=credibility,
                )
                session.add(user)
                await session.flush()
                submission = Submission(
                    user_id=user.id,
                    content_type=content_type,
                    content_url=content_url,
                    caption='why • Category: Finance • Impact: High',
                    status='pending',
                )
                session.add(submission)
                await session.flush()
                for verdict, weight in votes or []:
                    session.add(
                        Vote(
                            submission_id=submission.id,
                            user_id=user.id,
                            verdict=verdict,
                            impact_score=3,
                            credibility_weight=weight,
                        )
                    )
                await session.commit()
                cleanup['users'].add(user.id)
                cleanup['submissions'].add(submission.id)
                return submission.id

        return asyncio.run(_insert())

    return _make
