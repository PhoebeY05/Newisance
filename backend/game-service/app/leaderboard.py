"""Redis-backed leaderboard helpers (shared by both game modes).

`leaderboard:weekly` and `leaderboard:alltime` are Redis sorted sets of
cumulative score keyed by user id. Weekly is reset every Monday (Phase 10);
all-time persists. Phase 7's dashboard reads both with ZREVRANGE. All writes are
best-effort: if Redis is unavailable the game continues unaffected.
"""
from __future__ import annotations

import logging

import redis.asyncio as aioredis

from shared.config import settings
from shared.dashboard import LEADERBOARD_CHANNEL

logger = logging.getLogger(__name__)

WEEKLY_KEY = 'leaderboard:weekly'
ALLTIME_KEY = 'leaderboard:alltime'

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


async def incr_weekly(user_id: int, points: float) -> None:
    """Add `points` to a user's weekly AND all-time leaderboard score.

    Best-effort: a Redis outage is logged and swallowed so it never breaks
    gameplay. Both sets are bumped together since every scoring event counts
    toward both the rolling weekly board and the persistent all-time board.
    """
    if points <= 0:
        return
    try:
        redis = get_redis()
        await redis.zincrby(WEEKLY_KEY, float(points), str(user_id))
        await redis.zincrby(ALLTIME_KEY, float(points), str(user_id))
        # Wake any live dashboard SSE streams so the leaderboard updates the
        # instant a score lands (subscribers re-read the sorted set themselves).
        await redis.publish(LEADERBOARD_CHANNEL, str(user_id))
    except Exception as exc:  # noqa: BLE001 — never let Redis break gameplay
        logger.warning('leaderboard incr failed for user %s: %s', user_id, exc)
