import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


ROOT = Path(__file__).resolve().parents[3]
# The container copies backend/dashboard-service/app/ to /app and runs
# `uvicorn main:app` with PYTHONPATH=/app, so source modules are top-level
# (main, routers, schemas, redis_client). Mirror that here.
APP_ROOT = ROOT / 'backend' / 'dashboard-service' / 'app'

for path in (ROOT, APP_ROOT):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


from main import app  # noqa: E402
from shared.config import settings  # noqa: E402
from shared.db.models import Base  # noqa: E402
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


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def session_factory():
    """Expose the test session maker for builder-level (non-HTTP) tests."""
    return TestSessionLocal


@pytest.fixture()
def cleanup():
    """Track rows created during a test and delete them on teardown.

    Dashboard tests run against the shared dev DB, so created submissions /
    votes / users / ai_analysis must be cleaned up to avoid leaking into real
    data (mirrors the community-service pattern).
    """
    from sqlalchemy import delete

    from shared.db.models import AiAnalysis, Submission, User, Vote

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
                await session.execute(delete(Vote).where(Vote.user_id.in_(registry['users'])))
                await session.execute(delete(User).where(User.id.in_(registry['users'])))
            await session.commit()

    asyncio.run(_cleanup())
