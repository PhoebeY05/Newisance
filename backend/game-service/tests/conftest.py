import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path
import sys

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


ROOT = Path(__file__).resolve().parents[3]
# The container copies backend/game-service/app/ to /app and runs `uvicorn main:app`
# with PYTHONPATH=/app, so source modules are top-level (main, routers, schemas...).
# Mirror that here by putting the app dir on the path rather than the service dir.
APP_ROOT = ROOT / 'backend' / 'game-service' / 'app'

for path in (ROOT, APP_ROOT):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


from sqlalchemy import delete  # noqa: E402

import battle  # noqa: E402
import leaderboard  # noqa: E402
from main import app  # noqa: E402
from shared.auth import create_access_token  # noqa: E402
from shared.config import settings  # noqa: E402
from shared.db.models import Base, Question, SessionAnswer, User  # noqa: E402
from shared.deps import get_db  # noqa: E402


TEST_DATABASE_URL = settings.DATABASE_URL.replace('postgresql://', 'postgresql+asyncpg://')
test_engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False)


async def override_get_db() -> AsyncGenerator:
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture(scope='session', autouse=True)
def prepare_database() -> None:
    async def _prepare() -> None:
        async with test_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(_prepare())
    yield
    asyncio.run(test_engine.dispose())


@pytest.fixture(autouse=True)
def override_dependencies() -> None:
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def isolate_loop_bound_resources(monkeypatch) -> None:
    """Keep async resources from leaking across the per-test event loops.

    `battle.py` reaches for `AsyncSessionLocal` directly (not via the get_db
    dependency override), so it would otherwise use the production engine —
    whose pooled asyncpg connections get bound to whichever event loop first
    used them. Each `TestClient` context spins up and tears down its own loop,
    so a later test reusing a pooled connection raises "attached to a different
    loop". Pointing battle at the NullPool test sessionmaker means every DB
    operation opens a fresh connection on the *current* loop and closes it
    immediately, so nothing crosses loops. The Redis client is a loop-bound
    singleton with the same hazard, so reset it per test too.
    """
    monkeypatch.setattr(battle, 'AsyncSessionLocal', TestSessionLocal)
    leaderboard._redis = None
    yield
    leaderboard._redis = None


@pytest.fixture()
def question_factory():
    """Insert questions and remove them (and their answers) on teardown.

    Tests run against the shared dev DB, so cleaning up keeps test rows from
    leaking into the seeded question pool the games actually serve.
    """
    created: list[int] = []

    def _make(
        content: str = 'Suspicious headline',
        type: str = 'misleading_headline',
        correct_answer: str = 'Fake',
        difficulty: str = 'easy',
        explanation: str = 'Tell-tale signs of misinformation.',
        is_active: bool = True,
    ) -> int:
        async def _insert() -> int:
            async with TestSessionLocal() as session:
                question = Question(
                    content=content,
                    type=type,
                    correct_answer=correct_answer,
                    difficulty=difficulty,
                    explanation=explanation,
                    is_active=is_active,
                )
                session.add(question)
                await session.commit()
                await session.refresh(question)
                return question.id

        qid = asyncio.run(_insert())
        created.append(qid)
        return qid

    yield _make

    if created:
        async def _cleanup() -> None:
            async with TestSessionLocal() as session:
                await session.execute(delete(SessionAnswer).where(SessionAnswer.question_id.in_(created)))
                await session.execute(delete(Question).where(Question.id.in_(created)))
                await session.commit()

        asyncio.run(_cleanup())


@pytest.fixture()
def user_factory():
    """Insert a user and return (user_id, bearer_token)."""
    import uuid

    def _make(credibility_score: float = 50.0, is_guest: bool = False) -> tuple[int, str]:
        async def _insert() -> int:
            async with TestSessionLocal() as session:
                suffix = uuid.uuid4().hex[:8]
                user = User(
                    username=f'player_{suffix}',
                    email=f'player_{suffix}@example.com',
                    hashed_password=None if is_guest else 'x',
                    is_guest=is_guest,
                    credibility_score=credibility_score,
                )
                session.add(user)
                await session.commit()
                await session.refresh(user)
                return user.id

        user_id = asyncio.run(_insert())
        token = create_access_token(user_id, is_guest, credibility_score)
        return user_id, token

    return _make
