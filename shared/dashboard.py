"""Public dashboard aggregates (Phase 7).

Single source of truth for the four dashboard endpoints, shared by the
`dashboard-service` (computes on cache miss) and the `ai-service` arq worker
(pre-warms the cache every 15 min via `refresh_all`). All functions are pure
async over a SQLAlchemy session + a Redis client and return plain
JSON-serialisable dicts/lists so they can be cached and returned as-is.

Caching: each result is stored under `dashboard:<name>` in Redis with a 15-min
TTL. Reads fall back to a live DB query on miss (and re-populate the cache).

The leaderboard is read from the Redis sorted sets `leaderboard:weekly` /
`leaderboard:alltime` (written by game-service on every correct answer) and
joined with the DB for usernames + credibility tiers.
"""
from __future__ import annotations

import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.db.models import AiAnalysis, Submission, User, Vote

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 15 * 60
WEEK_SECONDS = 7 * 24 * 3600

LEADERBOARD_KEYS = {'weekly': 'leaderboard:weekly', 'alltime': 'leaderboard:alltime'}

# Tier brackets (Credibility System Rules in AGENTS.md).
_TIERS = (
    (81, 'Expert'),
    (61, 'Analyst'),
    (31, 'Verified'),
    (0, 'Newcomer'),
)


def tier_for(score: float) -> str:
    for threshold, name in _TIERS:
        if score >= threshold:
            return name
    return 'Newcomer'


# ---------------------------------------------------------------------------
# Redis cache helpers (best-effort — a Redis hiccup never breaks the endpoint)
# ---------------------------------------------------------------------------

def _cache_key(name: str) -> str:
    return f'dashboard:{name}'


async def _get_cache(redis: Any, name: str) -> Any | None:
    if redis is None:
        return None
    try:
        raw = await redis.get(_cache_key(name))
    except Exception as exc:  # noqa: BLE001
        logger.warning('dashboard cache read failed (%s): %s', name, exc)
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


async def _set_cache(redis: Any, name: str, value: Any) -> None:
    if redis is None:
        return
    payload = json.dumps(value)
    try:
        await redis.set(_cache_key(name), payload, ex=CACHE_TTL_SECONDS)
    except TypeError:
        # arq's ArqRedis historically used `expire=` rather than `ex=`.
        await redis.set(_cache_key(name), payload, expire=CACHE_TTL_SECONDS)
    except Exception as exc:  # noqa: BLE001
        logger.warning('dashboard cache write failed (%s): %s', name, exc)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


# ---------------------------------------------------------------------------
# Per-submission composite score (mirrors the AI worker's final_score formula)
# ---------------------------------------------------------------------------

async def _submission_metrics(
    session: AsyncSession, submissions: list[Submission]
) -> dict[int, dict[str, Any]]:
    """Compute community + AI metrics for many submissions in a few queries.

    final_score = 0.5·weighted_fake_likelihood + 0.3·ai_confidence + 0.2·submitter_credibility
    (ai_confidence falls back to the community fake-likelihood when no AI verdict
    exists yet, so community-only posts still rank sensibly).
    """
    ids = [s.id for s in submissions]
    if not ids:
        return {}

    vote_rows = (
        await session.execute(
            select(Vote.submission_id, Vote.verdict, Vote.impact_score, Vote.credibility_weight)
            .where(Vote.submission_id.in_(ids))
        )
    ).all()
    grouped: dict[int, list[tuple[str, int, float]]] = defaultdict(list)
    for sid, verdict, impact, weight in vote_rows:
        grouped[sid].append((verdict, int(impact), float(weight)))

    ai_rows = (
        await session.execute(
            select(
                AiAnalysis.submission_id,
                AiAnalysis.confidence,
                AiAnalysis.verdict,
                AiAnalysis.explanation,
            ).where(AiAnalysis.submission_id.in_(ids))
        )
    ).all()
    ai = {sid: (conf, verdict, expl) for sid, conf, verdict, expl in ai_rows}

    user_ids = [s.user_id for s in submissions if s.user_id is not None]
    creds: dict[int, float] = {}
    if user_ids:
        for uid, score in (
            await session.execute(
                select(User.id, User.credibility_score).where(User.id.in_(user_ids))
            )
        ).all():
            creds[uid] = min(float(score) / 100.0, 1.0)

    metrics: dict[int, dict[str, Any]] = {}
    for sub in submissions:
        rows = grouped.get(sub.id, [])
        total_w = sum(w for _, _, w in rows)
        fake_w = sum(w for v, _, w in rows if v == 'fake')
        impact_w = sum(i * w for _, i, w in rows)
        fake_likelihood = (fake_w / total_w) if total_w > 0 else 0.5
        weighted_impact = (impact_w / total_w) if total_w > 0 else None

        conf, verdict, explanation = ai.get(sub.id, (None, None, None))
        ai_confidence = float(conf) if conf is not None else fake_likelihood
        submitter_cred = creds.get(sub.user_id, 0.5)
        final_score = round(
            0.5 * fake_likelihood + 0.3 * ai_confidence + 0.2 * submitter_cred, 4
        )

        metrics[sub.id] = {
            'fake_likelihood': round(fake_likelihood, 4) if total_w > 0 else None,
            'weighted_impact': round(weighted_impact, 4) if weighted_impact is not None else None,
            'final_score': final_score,
            'vote_count': len(rows),
            'verdict': verdict,
            'explanation': explanation,
        }
    return metrics


def _is_fake(metric: dict[str, Any]) -> bool:
    if metric['verdict'] == 'likely_fake':
        return True
    fl = metric['fake_likelihood']
    return fl is not None and fl >= 0.5


# ---------------------------------------------------------------------------
# Builders (live DB queries)
# ---------------------------------------------------------------------------

async def build_trending(session: AsyncSession, limit: int = 10) -> list[dict[str, Any]]:
    """Top submissions this week ranked by final_score × impact."""
    week_ago = _now() - timedelta(days=7)
    submissions = (
        await session.execute(
            select(Submission).where(Submission.created_at >= week_ago)
        )
    ).scalars().all()

    metrics = await _submission_metrics(session, list(submissions))

    items: list[dict[str, Any]] = []
    for sub in submissions:
        m = metrics[sub.id]
        impact = m['weighted_impact'] if m['weighted_impact'] is not None else 3.0
        rank_score = round(m['final_score'] * impact, 4)
        items.append(
            {
                'id': sub.id,
                'content_type': sub.content_type,
                'content_url': sub.content_url,
                'caption': sub.caption,
                'status': sub.status,
                'created_at': _iso(sub.created_at),
                'final_score': m['final_score'],
                'fake_likelihood': m['fake_likelihood'],
                'weighted_impact': m['weighted_impact'],
                'vote_count': m['vote_count'],
                'verdict': m['verdict'],
                'explanation': m['explanation'],
                'rank_score': rank_score,
            }
        )

    items.sort(key=lambda it: it['rank_score'], reverse=True)
    return items[:limit]


async def build_scam_types(session: AsyncSession) -> dict[str, Any]:
    """Verdict + content-type breakdowns, plus a 4-week stacked timeline."""
    submissions = (await session.execute(select(Submission))).scalars().all()
    metrics = await _submission_metrics(session, list(submissions))

    by_verdict: Counter[str] = Counter()
    by_content_type: Counter[str] = Counter()

    # 4 buckets: index 0 = 3 weeks ago … index 3 = this week.
    now = _now()
    weekly = [
        {'week': label, 'likely_fake': 0, 'likely_real': 0, 'uncertain': 0}
        for label in ('3 wks ago', '2 wks ago', '1 wk ago', 'This week')
    ]

    for sub in submissions:
        m = metrics[sub.id]
        verdict = m['verdict'] or ('likely_fake' if _is_fake(m) else 'uncertain')
        by_verdict[verdict] += 1
        by_content_type[sub.content_type] += 1

        if sub.created_at is not None:
            age_weeks = int((now - sub.created_at).total_seconds() // WEEK_SECONDS)
            if 0 <= age_weeks <= 3:
                bucket = weekly[3 - age_weeks]
                key = verdict if verdict in ('likely_fake', 'likely_real', 'uncertain') else 'uncertain'
                bucket[key] += 1

    return {
        'by_verdict': [{'verdict': v, 'count': c} for v, c in by_verdict.most_common()],
        'by_content_type': [
            {'content_type': t, 'count': c} for t, c in by_content_type.most_common()
        ],
        'weekly': weekly,
    }


async def build_stats(session: AsyncSession) -> dict[str, Any]:
    week_ago = _now() - timedelta(days=7)

    submissions = (await session.execute(select(Submission))).scalars().all()
    metrics = await _submission_metrics(session, list(submissions))

    total = len(submissions)
    fake_count = sum(1 for sub in submissions if _is_fake(metrics[sub.id]))
    submissions_this_week = sum(
        1 for sub in submissions if sub.created_at is not None and sub.created_at >= week_ago
    )
    pct_fake = round(100 * fake_count / total) if total else 0

    type_counts = Counter(sub.content_type for sub in submissions)
    most_common_type = type_counts.most_common(1)[0][0] if type_counts else None

    # Active = anyone who submitted or voted in the last 7 days.
    active_users: set[int] = set()
    for (uid,) in (
        await session.execute(
            select(Submission.user_id).where(
                Submission.user_id.is_not(None), Submission.created_at >= week_ago
            )
        )
    ).all():
        active_users.add(uid)
    for (uid,) in (
        await session.execute(
            select(Vote.user_id).where(Vote.created_at >= week_ago)
        )
    ).all():
        active_users.add(uid)

    return {
        'submissions_this_week': submissions_this_week,
        'pct_fake': pct_fake,
        'most_common_type': most_common_type,
        'active_users_this_week': len(active_users),
    }


def _decode_member(member: Any) -> int | None:
    if isinstance(member, bytes):
        member = member.decode()
    try:
        return int(member)
    except (ValueError, TypeError):
        return None


async def build_leaderboard(
    session: AsyncSession, redis: Any, scope: str, limit: int
) -> list[dict[str, Any]]:
    key = LEADERBOARD_KEYS.get(scope, LEADERBOARD_KEYS['weekly'])
    if redis is None:
        return []
    try:
        ranked = await redis.zrevrange(key, 0, limit - 1, withscores=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning('leaderboard read failed (%s): %s', scope, exc)
        return []

    pairs: list[tuple[int, float]] = []
    for member, score in ranked:
        uid = _decode_member(member)
        if uid is not None:
            pairs.append((uid, float(score)))

    if not pairs:
        return []

    users = {
        uid: (username, float(cred))
        for uid, username, cred in (
            await session.execute(
                select(User.id, User.username, User.credibility_score).where(
                    User.id.in_([uid for uid, _ in pairs])
                )
            )
        ).all()
    }

    rows: list[dict[str, Any]] = []
    for rank, (uid, score) in enumerate(pairs, start=1):
        username, cred = users.get(uid, (f'User {uid}', 50.0))
        rows.append(
            {
                'rank': rank,
                'user_id': uid,
                'username': username,
                'score': round(score, 2),
                'credibility_score': round(cred, 2),
                'tier': tier_for(cred),
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Cached read API (used by the service endpoints)
# ---------------------------------------------------------------------------

async def get_trending(session: AsyncSession, redis: Any, limit: int = 10) -> list[dict[str, Any]]:
    cached = await _get_cache(redis, 'trending')
    if cached is not None:
        return cached[:limit]
    data = await build_trending(session, limit=max(limit, 10))
    await _set_cache(redis, 'trending', data)
    return data[:limit]


async def get_scam_types(session: AsyncSession, redis: Any) -> dict[str, Any]:
    cached = await _get_cache(redis, 'scam-types')
    if cached is not None:
        return cached
    data = await build_scam_types(session)
    await _set_cache(redis, 'scam-types', data)
    return data


async def get_stats(session: AsyncSession, redis: Any) -> dict[str, Any]:
    cached = await _get_cache(redis, 'stats')
    if cached is not None:
        return cached
    data = await build_stats(session)
    await _set_cache(redis, 'stats', data)
    return data


async def get_leaderboard(
    session: AsyncSession, redis: Any, scope: str, limit: int
) -> list[dict[str, Any]]:
    name = f'leaderboard-{scope}-{limit}'
    cached = await _get_cache(redis, name)
    if cached is not None:
        return cached
    data = await build_leaderboard(session, redis, scope, limit)
    await _set_cache(redis, name, data)
    return data


# ---------------------------------------------------------------------------
# Pre-warm all caches (called by the ai-service worker cron every 15 min)
# ---------------------------------------------------------------------------

async def refresh_all(session: AsyncSession, redis: Any) -> None:
    await _set_cache(redis, 'trending', await build_trending(session))
    await _set_cache(redis, 'scam-types', await build_scam_types(session))
    await _set_cache(redis, 'stats', await build_stats(session))
    for scope in ('weekly', 'alltime'):
        data = await build_leaderboard(session, redis, scope, 50)
        await _set_cache(redis, f'leaderboard-{scope}-50', data)
