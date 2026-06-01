"""Redis-backed weekly leaderboard helpers (shared by both game modes).

`leaderboard:weekly` is a Redis sorted set of cumulative weekly score keyed by
user id. Phase 7's dashboard reads it with ZREVRANGE. All writes are
best-effort: if Redis is unavailable the game continues unaffected.
"""
from __future__ import annotations

import logging

import redis.asyncio as aioredis

from shared.config import settings

logger = logging.getLogger(__name__)

WEEKLY_KEY = 'leaderboard:weekly'

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def incr_weekly(user_id: int, points: float) -> None:
    """Add `points` to a user's weekly leaderboard score (best-effort)."""
    if points <= 0:
        return
    try:
        await get_redis().zincrby(WEEKLY_KEY, float(points), str(user_id))
    except Exception as exc:  # noqa: BLE001 — never let Redis break gameplay
        logger.warning('leaderboard incr failed for user %s: %s', user_id, exc)
