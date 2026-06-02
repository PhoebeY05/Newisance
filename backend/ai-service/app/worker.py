"""AI verification worker (Phase 6).

Consumes `analyse_submission(submission_id)` jobs enqueued by community-service.
Analysis is **deterministic-first**: a heuristic report (domain reputation +
BeautifulSoup metadata + text signals — no AI, no rate limits) always runs and
is the source of truth for the rich AI Analysis page. When a Gemini key is
configured it adds a *semantic* layer on top — a claim verdict and, crucially,
suggestions of INDEPENDENT sources to cross-reference (which heuristics can't
produce). If Gemini is off or errors out, the deterministic report stands and
the submission is still `analysed` (only truly unexpected failures →
community_only). Also hosts a 15-min dashboard cache-refresh cron for Phase 7.

Run locally:  arq worker.WorkerSettings
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus

from sqlalchemy import delete, select

from shared.config import settings
from shared.db.models import AiAnalysis, Submission, User, Vote
from shared.db.session import AsyncSessionLocal
from shared.schemas import AnalysisReport, AnalysisResult, ConfItem, EvidenceCard, GeminiAssessment

import gemini
import report as report_engine

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Free tier is rate-limited — pause after each real Gemini call to stay under it.
GEMINI_THROTTLE_SECONDS = float(os.getenv('GEMINI_THROTTLE_SECONDS', '4'))
# How much the Gemini semantic verdict weighs vs the deterministic credibility.
AI_BLEND_WEIGHT = float(os.getenv('AI_BLEND_WEIGHT', '0.55'))

_MEDIA_ROOT = Path(settings.LOCAL_MEDIA_DIR).resolve()
_IMAGE_MIME = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
               'gif': 'image/gif', 'webp': 'image/webp'}


def _media_path(content_url: str) -> Path:
    """Resolve a stored `media_uploads/<file>` path to an absolute file path."""
    return _MEDIA_ROOT / Path(content_url).name


async def _run_analysis(
    content_type: str, content_url: str
) -> tuple[AnalysisResult, AnalysisReport, str | None]:
    """Deterministic analysis (no AI). Returns (verdict, report, gemini_input)
    where gemini_input is the text to hand to Gemini for enrichment (or None)."""
    if content_type == 'image':
        return report_engine.analyse_image(_media_path(content_url))
    if content_type == 'url':
        return await report_engine.analyse_text(content_url, is_url=True)
    return await report_engine.analyse_text(content_url, is_url=False)


def _verdict_for(credibility: int) -> str:
    if credibility >= 66:
        return 'likely_real'
    if credibility <= 40:
        return 'likely_fake'
    return 'uncertain'


def _search_url(query: str) -> str:
    return f'https://www.google.com/search?q={quote_plus(query)}'


def _blend(
    result: AnalysisResult, report: AnalysisReport, ai: GeminiAssessment
) -> tuple[AnalysisResult, AnalysisReport]:
    """Fold Gemini's semantic verdict into the deterministic report. The
    credibility % is blended; the AI-suggested independent sources become the
    evidence cards AND feed Source Credibility (graded for authority locally);
    and the AI's corroboration findings drive Cross-Verification."""
    ai_credibility = round((1.0 - ai.confidence) * 100)
    blended = round((1 - AI_BLEND_WEIGHT) * report.credibility_score + AI_BLEND_WEIGHT * ai_credibility)
    blended = max(0, min(100, blended))
    report.credibility_score = blended

    report.ai_assessment = ConfItem(
        title=f'AI Assessment: {ai.verdict.replace("_", " ")}',
        confidence=ai_credibility,
        detail=ai.explanation or 'Gemini semantic assessment.',
    )

    # Independent cross-reference suggestions (not the submitter's own links).
    sources = [cr for cr in ai.cross_references[:6] if cr.source]
    cards = [
        EvidenceCard(
            icon='🔍',
            title=cr.source,
            detail=cr.reason,
            link_label='Search',
            link_url=_search_url(cr.query or cr.source),
        )
        for cr in sources
    ]
    if cards:
        report.evidence = cards
        report.cross_reference_count = len(cards)
        # The independent sources' *authority* is a source-credibility signal —
        # graded deterministically (no extra API) and appended to that section.
        for cr in sources:
            confidence, label = report_engine.source_confidence(cr.source)
            report.source_credibility.append(ConfItem(
                title=f'Reference: {cr.source}',
                confidence=confidence,
                detail=f'{label}. {cr.reason}'.strip(),
            ))

    # Cross-Verification = the AI's corroboration findings on checkable aspects
    # of the claim (timeline, figures, quoted authority, …). Only replace the
    # deterministic trio when the model actually returned findings.
    findings = [v for v in ai.verifications[:6] if v.aspect]
    if findings:
        report.cross_verification = [
            ConfItem(
                title=v.aspect,
                confidence=max(0, min(100, round(v.confidence * 100))),
                detail=v.finding or 'Assessed against publicly known information.',
            )
            for v in findings
        ]

    verdict = _verdict_for(blended)

    # Keep the headline summary and the misinformation verdict consistent with
    # the *blended* score — otherwise the gauge (blended) and the summary text
    # (which embedded the pre-blend heuristic %) disagree.
    verdict_phrase = {
        'likely_real': 'likely legitimate',
        'likely_fake': 'likely misinformation',
        'uncertain': 'inconclusive',
    }[verdict]
    report.summary = (
        f'AI-powered analysis rates this {blended}% credible '
        f'({verdict_phrase}). {ai.explanation}'.strip()
    )
    report.misinformation_verdict = (
        'NO MISINFORMATION DETECTED' if verdict == 'likely_real'
        else 'POTENTIAL MISINFORMATION SIGNALS DETECTED'
    )

    merged_signals = list(dict.fromkeys([*result.signals, *ai.signals]))[:8]
    new_result = AnalysisResult(
        confidence=round((100 - blended) / 100, 2),
        signals=merged_signals,
        verdict=verdict,
        explanation=ai.explanation or result.explanation,
    )
    return new_result, report


def _read_image(path: Path) -> tuple[bytes, str]:
    mime = _IMAGE_MIME.get(path.suffix.lstrip('.').lower(), 'application/octet-stream')
    return path.read_bytes(), mime


async def _maybe_enrich(
    content_type: str,
    content_url: str,
    gemini_input: str | None,
    result: AnalysisResult,
    report: AnalysisReport,
) -> tuple[AnalysisResult, AnalysisReport]:
    """Add the Gemini semantic layer when a key is set. Any failure (quota,
    503, network, bad image) falls back silently to the deterministic result."""
    if not gemini.gemini_enabled():
        return result, report
    try:
        if content_type == 'image':
            data, mime = _read_image(_media_path(content_url))
            if not mime.startswith('image/'):
                return result, report
            ai = await gemini.assess_image(data, mime)
        else:
            ai = await gemini.assess_text(gemini_input or content_url)
    except Exception as exc:  # noqa: BLE001
        level = 'rate-limited' if gemini.is_rate_limit_error(exc) else 'failed'
        logger.warning('Gemini enrichment %s; using deterministic report only: %s', level, exc)
        return result, report
    finally:
        await asyncio.sleep(GEMINI_THROTTLE_SECONDS)

    result, report = _blend(result, report, ai)
    report.methodology['Analysis Model'] = f'Heuristic + Gemini ({settings.GEMINI_MODEL})'
    report.methodology['Cross-References'] = f'{report.cross_reference_count} source(s)'
    return result, report


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


async def analyse_submission(ctx, submission_id: int) -> None:
    """Analyse one submission: deterministic report first, then optional Gemini
    enrichment. The deterministic pass always succeeds, so a submission only
    becomes community_only on a truly unexpected error."""
    async with AsyncSessionLocal() as session:
        submission = await session.get(Submission, submission_id)
        if submission is None:
            logger.warning('analyse_submission: submission %s not found', submission_id)
            return
        content_type = submission.content_type
        content_url = submission.content_url

    try:
        result, report, gemini_input = await _run_analysis(content_type, content_url)
        result, report = await _maybe_enrich(content_type, content_url, gemini_input, result, report)
    except Exception:  # noqa: BLE001 — deterministic shouldn't fail; guard anyway
        logger.exception('unexpected error analysing submission %s', submission_id)
        await _mark_community_only(submission_id)
        return

    enriched = report.ai_assessment is not None

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
                report=report.model_dump(),
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
        'analysed submission %s → %s (credibility=%s%%, final_score=%.3f, %s)',
        submission_id, result.verdict, report.credibility_score, final_score,
        'heuristic+gemini' if enriched else 'heuristic',
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
