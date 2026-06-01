import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path
import sys

import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


ROOT = Path(__file__).resolve().parents[3]
SERVICE_ROOT = ROOT / 'backend' / 'community-service'

for path in (ROOT, SERVICE_ROOT):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


from app.main import app  # noqa: E402
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

