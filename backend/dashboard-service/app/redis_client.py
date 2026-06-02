"""Shared async Redis client for the dashboard service.

`decode_responses=True` so sorted-set members and cached JSON come back as str.
"""
from __future__ import annotations

import redis.asyncio as aioredis

from shared.config import settings

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis
