"""AI verification worker (Phase 6).

Consumes `analyse_submission(submission_id)` jobs enqueued by community-service,
runs text/URL/image analysis (Gemini, or an offline heuristic when no key is
set), writes the verdict to `ai_analysis`, flips the submission status, and
caches the composite `final_score` in Redis. Also hosts a 15-minute dashboard
cache-refresh cron that Phase 7 will fill in.

Run locally:  arq worker.WorkerSettings
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select

from shared.config import settings
from shared.db.models import AiAnalysis, Submission, User, Vote
from shared.db.session import AsyncSessionLocal
from shared.schemas import AnalysisResult

import gemini
from analysers import image as image_analyser
from analysers import text as text_analyser

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Free tier is rate-limited — pause between real Gemini calls to stay under it.
GEMINI_THROTTLE_SECONDS = float(os.getenv('GEMINI_THROTTLE_SECONDS', '4'))

# Transient failures (429/503/network) are retried with backoff before a
# submission is finally degraded to community_only.
MAX_TRIES = int(os.getenv('AI_MAX_TRIES', '4'))
RETRY_DEFER_SECONDS = float(os.getenv('AI_RETRY_DEFER_SECONDS', '10'))

_MEDIA_ROOT = Path(settings.LOCAL_MEDIA_DIR).resolve()


def _media_path(content_url: str) -> Path:
    """Resolve a stored `media_uploads/<file>` path to an absolute file path."""
    return _MEDIA_ROOT / Path(content_url).name


async def _run_analysis(content_type: str, content_url: str) -> AnalysisResult:
    if content_type == 'image':
        return await image_analyser.analyse(_media_path(content_url))
    if content_type == 'url':
        return await text_analyser.analyse(content_url, is_url=True)
    return await text_analyser.analyse(content_url, is_url=False)


async def _fake_likelihood(session, submission_id: int) -> float:
    """Credibility-weighted share of 'fake' votes (0.5 when there are no votes)."""
    rows = (
        await session.execute(
            select(Vote.verdict, Vote.credibility_weight).where(Vote.submission_id == submission_id)
        )
    ).all()
    total = sum(float(weight) for _, weight in rows)
    if total <= 0:
        return 0.5
    fake = sum(float(weight) for verdict, weight in rows if verdict == 'fake')
    return fake / total


async def _submitter_credibility(session, user_id: int | None) -> float:
    if user_id is None:
        return 0.5
    score = (
        await session.execute(select(User.credibility_score).where(User.id == user_id))
    ).scalar_one_or_none()
    if score is None:
        return 0.5
    return min(float(score) / 100.0, 1.0)


async def _compute_final_score(session, submission: Submission, ai_confidence: float) -> float:
    """final = 0.5·weighted_community_vote + 0.3·ai_confidence + 0.2·submitter_credibility."""
    fake_likelihood = await _fake_likelihood(session, submission.id)
    submitter_cred = await _submitter_credibility(session, submission.user_id)
    return round(0.5 * fake_likelihood + 0.3 * ai_confidence + 0.2 * submitter_cred, 4)


async def _mark_community_only(submission_id: int) -> None:
    async with AsyncSessionLocal() as session:
        submission = await session.get(Submission, submission_id)
        if submission is not None:
            submission.status = 'community_only'
            await session.commit()


async def _handle_analysis_error(ctx, submission_id: int, exc: Exception) -> None:
    """Retry transient failures (with backoff) until tries run out, then degrade
    to community_only. Raises arq's Retry to trigger a retry."""
    job_try = ctx.get('job_try', 1)
    if gemini.is_transient_error(exc) and job_try < MAX_TRIES:
        logger.warning(
            'transient AI error for submission %s (try %s/%s), retrying: %s',
            submission_id, job_try, MAX_TRIES, exc,
        )
        from arq import Retry

        raise Retry(defer=job_try * RETRY_DEFER_SECONDS)

    logger.warning('analysis failed for submission %s; marking community_only: %s', submission_id, exc)
    await _mark_community_only(submission_id)


async def analyse_submission(ctx, submission_id: int) -> None:
    """Analyse one submission.

    Transient errors (429/503/network) re-raise as arq `Retry` for a few
    backed-off attempts; permanent errors (or exhausted retries) degrade the
    submission to community_only without crashing the worker.
    """
    async with AsyncSessionLocal() as session:
        submission = await session.get(Submission, submission_id)
        if submission is None:
            logger.warning('analyse_submission: submission %s not found', submission_id)
            return
        content_type = submission.content_type
        content_url = submission.content_url

    used_gemini = gemini.gemini_enabled()
    try:
        result = await _run_analysis(content_type, content_url)
    except Exception as exc:  # noqa: BLE001
        await _handle_analysis_error(ctx, submission_id, exc)  # may raise arq Retry
        return
    finally:
        # Throttle real API usage to respect the free-tier rate limit.
        if used_gemini:
            await asyncio.sleep(GEMINI_THROTTLE_SECONDS)

    async with AsyncSessionLocal() as session:
        submission = await session.get(Submission, submission_id)
        if submission is None:
            return
        # Replace any prior analysis (e.g. re-run after an edit).
        await session.execute(delete(AiAnalysis).where(AiAnalysis.submission_id == submission_id))
        session.add(
            AiAnalysis(
                submission_id=submission_id,
                confidence=result.confidence,
                signals=result.signals,
                verdict=result.verdict,
                explanation=result.explanation,
                processed_at=datetime.now(timezone.utc),
            )
        )
        submission.status = 'analysed'
        final_score = await _compute_final_score(session, submission, result.confidence)
        await session.commit()

    # Cache the composite score for the dashboard (Phase 7); best-effort.
    try:
        await ctx['redis'].set(f'submission:{submission_id}:final_score', final_score, expire=3600)
    except TypeError:
        # arq's ArqRedis vs redis-py differ on the kwarg name.
        await ctx['redis'].set(f'submission:{submission_id}:final_score', final_score, ex=3600)
    except Exception as exc:  # noqa: BLE001
        logger.warning('could not cache final_score for %s: %s', submission_id, exc)

    logger.info(
        'analysed submission %s → %s (confidence=%.2f, final_score=%.3f, %s)',
        submission_id, result.verdict, result.confidence, final_score,
        'gemini' if used_gemini else 'heuristic',
    )


async def refresh_dashboard_cache(ctx) -> None:
    """Pre-warm the public dashboard caches. Filled in by Phase 7."""
    logger.info('refresh_dashboard_cache tick (no-op until Phase 7)')


def _redis_settings():
    from arq.connections import RedisSettings

    return RedisSettings.from_dsn(settings.REDIS_URL)


def _cron_jobs():
    from arq import cron

    # Every 15 minutes, on the quarter hours.
    return [cron(refresh_dashboard_cache, minute={0, 15, 30, 45})]


class WorkerSettings:
    functions = [analyse_submission]
    cron_jobs = _cron_jobs()
    redis_settings = _redis_settings()
    max_jobs = 5
    # Allow our in-task retry budget (MAX_TRIES) for transient AI failures.
    max_tries = MAX_TRIES + 1
