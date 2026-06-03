"""Tests for the Phase 10 shareable result card."""
import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from main import app
from conftest import TestSessionLocal
from shared.db.models import GameSession


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def game_session():
    """Insert a finished game session, return its id, delete it on teardown."""
    created: list[int] = []

    def _make(score: float = 1234.0) -> int:
        async def _insert() -> int:
            async with TestSessionLocal() as session:
                gs = GameSession(user_id=None, mode='timed', score=score)
                session.add(gs)
                await session.commit()
                await session.refresh(gs)
                return gs.id

        sid = asyncio.run(_insert())
        created.append(sid)
        return sid

    yield _make

    async def _cleanup() -> None:
        async with TestSessionLocal() as session:
            await session.execute(delete(GameSession).where(GameSession.id.in_(created)))
            await session.commit()

    asyncio.run(_cleanup())


def test_share_card_returns_png(client: TestClient, game_session) -> None:
    sid = game_session(score=1234.0)
    res = client.get(f'/share/card/{sid}')
    assert res.status_code == 200
    assert res.headers['content-type'] == 'image/png'
    assert res.content[:8] == b'\x89PNG\r\n\x1a\n'  # valid PNG signature
    assert len(res.content) > 1000  # a real rendered image, not empty


def test_share_card_missing_session_404(client: TestClient) -> None:
    assert client.get('/share/card/999999999').status_code == 404
