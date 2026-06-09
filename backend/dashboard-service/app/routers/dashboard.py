"""Public awareness dashboard endpoints (Phase 7).

All four are public (no auth required) and Redis-cached for 15 min; the
ai-service worker pre-warms the same cache keys every 15 min. `get_optional_user`
is accepted so an authenticated caller is tolerated, but the data is identical
for everyone.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared import dashboard as dash
from shared.db.models import User
from shared.deps import get_db, get_optional_user

from redis_client import get_redis
from schemas import LeaderboardEntry, ScamTypes, Stats, TrendingItem

# Routes are mounted bare (e.g. /trending); the frontend's Vite proxy supplies
# the /api/dashboard namespace (and strips it), matching the community/game
# convention. A /dashboard prefix here would double up → 404 through the proxy.
router = APIRouter(tags=['dashboard'])

Scope = str


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


@router.get('/stats', response_model=Stats)
async def stats(
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    _user: User | None = Depends(get_optional_user),
) -> dict:
    return await dash.get_stats(db, get_redis(), refresh=refresh)
