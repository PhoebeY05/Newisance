"""Public awareness dashboard endpoints (Phase 7).

All four are public (no auth required) and Redis-cached for 15 min; the
ai-service worker pre-warms the same cache keys every 15 min. `get_optional_user`
is accepted so an authenticated caller is tolerated, but the data is identical
for everyone.
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from shared import dashboard as dash
from shared.dashboard import LEADERBOARD_CHANNEL
from shared.db.models import User
from shared.db.session import AsyncSessionLocal
from shared.deps import get_db, get_optional_user

from redis_client import get_redis
from schemas import LeaderboardEntry, ScamTypes, Stats, TrendingItem

logger = logging.getLogger(__name__)

# Routes are mounted bare (e.g. /trending); the frontend's Vite proxy supplies
# the /api/dashboard namespace (and strips it), matching the community/game
# convention. A /dashboard prefix here would double up → 404 through the proxy.
router = APIRouter(tags=['dashboard'])

Scope = str

# Seconds between keepalive comments when no score change has occurred. Keeps
# the connection (and any intermediary proxy) from idling it out, and lets us
# notice a disconnected client promptly.
STREAM_HEARTBEAT_SECONDS = 15


@router.get('/trending', response_model=list[TrendingItem])
async def trending(
    limit: int = Query(default=6, ge=1, le=20),
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _user: User | None = Depends(get_optional_user),
) -> list[dict]:
    return await dash.get_trending(db, get_redis(), limit=limit, refresh=refresh)


@router.get('/scam-types', response_model=ScamTypes)
async def scam_types(
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _user: User | None = Depends(get_optional_user),
) -> dict:
    return await dash.get_scam_types(db, get_redis(), refresh=refresh)


@router.get('/leaderboard', response_model=list[LeaderboardEntry])
async def leaderboard(
    scope: Scope = Query(default='weekly'),
    limit: int = Query(default=50, ge=1, le=100),
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _user: User | None = Depends(get_optional_user),
) -> list[dict]:
    scope = scope if scope in ('weekly', 'alltime') else 'weekly'
    return await dash.get_leaderboard(db, get_redis(), scope, limit, refresh=refresh)


async def _build_live(scope: str, limit: int) -> list[dict]:
    """Read the current ranking straight from Redis (bypassing the 15-min cache).

    Opens its own short-lived DB session per build so the long-lived stream never
    holds a pooled connection idle between updates.
    """
    async with AsyncSessionLocal() as session:
        return await dash.build_leaderboard(session, get_redis(), scope, limit)


async def _leaderboard_events(
    request: Request, scope: str, limit: int
) -> AsyncIterator[str]:
    """SSE generator: emit the ranking on connect, then again whenever a score
    changes (signalled via the `leaderboard:changed` pub/sub channel)."""
    redis = get_redis()
    last_payload: str | None = None

    try:
        data = await _build_live(scope, limit)
        last_payload = json.dumps(data)
        yield f'data: {last_payload}\n\n'
    except Exception as exc:  # noqa: BLE001 — a build hiccup shouldn't kill the stream
        logger.warning('leaderboard stream initial build failed: %s', exc)

    pubsub = redis.pubsub()
    await pubsub.subscribe(LEADERBOARD_CHANNEL)
    try:
        while not await request.is_disconnected():
            try:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=STREAM_HEARTBEAT_SECONDS
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning('leaderboard stream pubsub error: %s', exc)
                break

            if message is None:
                yield ': keepalive\n\n'  # comment line — ignored by EventSource
                continue

            try:
                payload = json.dumps(await _build_live(scope, limit))
            except Exception as exc:  # noqa: BLE001
                logger.warning('leaderboard stream rebuild failed: %s', exc)
                continue

            if payload != last_payload:
                last_payload = payload
                yield f'data: {payload}\n\n'
    finally:
        try:
            await pubsub.unsubscribe(LEADERBOARD_CHANNEL)
            await pubsub.aclose()
        except Exception:  # noqa: BLE001 — best-effort cleanup
            pass


@router.get('/leaderboard/stream')
async def leaderboard_stream(
    request: Request,
    scope: Scope = Query(default='weekly'),
    limit: int = Query(default=50, ge=1, le=100),
) -> StreamingResponse:
    """Live leaderboard via Server-Sent Events. The board is public and identical
    for everyone, so no auth dependency is taken (which also avoids holding a
    request-scoped DB session open for the stream's whole lifetime)."""
    scope = scope if scope in ('weekly', 'alltime') else 'weekly'
    return StreamingResponse(
        _leaderboard_events(request, scope, limit),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',  # disable proxy buffering (belt-and-braces)
            'Connection': 'keep-alive',
        },
    )


@router.get('/stats', response_model=Stats)
async def stats(
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _user: User | None = Depends(get_optional_user),
) -> dict:
    return await dash.get_stats(db, get_redis(), refresh=refresh)
