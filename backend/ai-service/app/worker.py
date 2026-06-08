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
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus

from sqlalchemy import delete, select

from shared.config import settings
from shared.credibility import VOTE_MATCH_DELTA, VOTE_MISS_DELTA, clamp_credibility, tier_for
from shared.db.models import (
    AiAnalysis,
    CredibilityLog,
    LeaderboardSnapshot,
    Submission,
    User,
    Voucher,
    Vote,
)
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


# Caps so AI-generated text can't blow up a report subsection.
_MAX_TITLE = 60
_MAX_DETAIL = 200
_MAX_SUMMARY = 240
# Bare probabilities the model sometimes leaks into prose (e.g. "0.95", ".9").
_PROB_RE = re.compile(r'(?<!\d)[01]?\.\d{1,2}(?!\d)')


def _shorten(text: str, limit: int, *, sentences: int = 0) -> str:
    """Sanitise AI prose: drop leaked confidence numbers, collapse whitespace,
    optionally keep only the first `sentences`, then hard-clip to `limit`."""
    text = _PROB_RE.sub('', text or '')
    text = ' '.join(text.split())
    text = re.sub(r'\s+([,.;:!?])', r'\1', text)        # tidy punctuation left by removals
    text = re.sub(r'([,.;:])\1+', r'\1', text)          # collapse doubled punctuation
    if sentences:
        parts = re.split(r'(?<=[.!?])\s+', text)
        text = ' '.join(parts[:sentences]).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(' ', 1)[0].rstrip(' ,.;:') + '…'
    return text.strip()


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

    explanation = _shorten(ai.explanation, _MAX_DETAIL, sentences=2) or 'Gemini semantic assessment.'
    report.ai_assessment = ConfItem(
        title=f'AI Assessment: {ai.verdict.replace("_", " ")}',
        confidence=ai_credibility,
        detail=explanation,
    )

    # If this was an image, surface the AI vision verdict in the (previously
    # placeholder) "Automated Vision" source-credibility card.
    for item in report.source_credibility:
        if item.title == 'Automated Vision':
            item.confidence = ai_credibility
            item.detail = _shorten(
                f'AI vision assessment: {ai.verdict.replace("_", " ")}. {ai.explanation}',
                _MAX_DETAIL, sentences=2,
            )

    # Independent cross-reference suggestions (not the submitter's own links).
    sources = [cr for cr in ai.cross_references[:6] if cr.source]
    cards = [
        EvidenceCard(
            icon='🔍',
            title=_shorten(cr.source, _MAX_TITLE),
            detail=_shorten(cr.reason, _MAX_DETAIL, sentences=1),
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
                title=_shorten(f'Reference: {cr.source}', _MAX_TITLE),
                confidence=confidence,
                detail=_shorten(f'{label}. {cr.reason}', _MAX_DETAIL, sentences=1),
            ))

    # Add Gemini verdict to Fact-Checking as the primary metric (0–10 scale).
    # Convert AI confidence to 0–10: high confidence → high score for credible, low for fake.
    gemini_metric_score = 10.0 if ai.verdict == 'likely_real' else 0.0 if ai.verdict == 'likely_fake' else 5.0
    gemini_metric_label = f'Gemini Assessment: {ai.verdict.replace("_", " ").title()}'
    # Prepend Gemini verdict to fact_checking metrics.
    from shared.schemas import Metric
    report.fact_checking = [
        Metric(label=gemini_metric_label, score=gemini_metric_score),
        *report.fact_checking,
    ]

    # Cross-Verification = the AI's corroboration findings on checkable aspects
    # of the claim (timeline, figures, quoted authority, …). Only replace the
    # deterministic trio when the model actually returned findings.
    findings = [v for v in ai.verifications[:6] if v.aspect]
    if findings:
        report.cross_verification = [
            ConfItem(
                title=_shorten(v.aspect, _MAX_TITLE),
                confidence=max(0, min(100, round(v.confidence * 100))),
                detail=_shorten(v.finding, _MAX_DETAIL, sentences=1)
                or 'Assessed against publicly known information.',
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
    report.summary = _shorten(
        f'AI-powered analysis rates this {blended}% credible ({verdict_phrase}). {explanation}',
        _MAX_SUMMARY, sentences=3,
    )
    report.misinformation_verdict = (
        'NO MISINFORMATION DETECTED' if verdict == 'likely_real'
        else 'POTENTIAL MISINFORMATION SIGNALS DETECTED'
    )
    # Methodology must echo the blended gauge, not the pre-blend heuristic score.
    report.methodology['Confidence Score'] = f'{blended}% credible'

    merged_signals = [_shorten(s, _MAX_TITLE) for s in
                      dict.fromkeys([*result.signals, *ai.signals])][:8]
    new_result = AnalysisResult(
        confidence=round((100 - blended) / 100, 2),
        signals=merged_signals,
        verdict=verdict,
        explanation=explanation or result.explanation,
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

    # Phase 8: settle voter credibility now that the submission is analysed.
    try:
        await ctx['redis'].enqueue_job('settle_credibility', submission_id)
    except Exception as exc:  # noqa: BLE001 — settlement is best-effort
        logger.warning('could not enqueue settle_credibility(%s): %s', submission_id, exc)


def _resolved_verdict(ai_verdict: str | None, votes: list[Vote]) -> str:
    """The 'truth' a vote is graded against: the AI verdict when decisive,
    otherwise the credibility-weighted community majority. Returns 'fake'|'real'."""
    if ai_verdict == 'likely_fake':
        return 'fake'
    if ai_verdict == 'likely_real':
        return 'real'
    # uncertain / no AI → weighted community majority.
    total = sum(float(v.credibility_weight) for v in votes)
    fake = sum(float(v.credibility_weight) for v in votes if v.verdict == 'fake')
    return 'fake' if total > 0 and fake / total >= 0.5 else 'real'


async def settle_credibility(ctx, submission_id: int) -> None:
    """Reward/penalise each voter once a submission is analysed (Phase 8).

    Voters who matched the resolved verdict get +0.5, others −0.2; a
    credibility_log row is written per voter and each user's tier is recomputed.
    Idempotent: `submissions.credibility_settled` guards against double-counting.
    """
    async with AsyncSessionLocal() as session:
        submission = await session.get(Submission, submission_id)
        if submission is None:
            logger.warning('settle_credibility: submission %s not found', submission_id)
            return
        if submission.credibility_settled:
            return  # already settled — never apply deltas twice
        if submission.status != 'analysed':
            return  # only settle once AI analysis has landed

        ai_verdict = (
            await session.execute(
                select(AiAnalysis.verdict).where(AiAnalysis.submission_id == submission_id)
            )
        ).scalar_one_or_none()

        votes = (
            await session.execute(select(Vote).where(Vote.submission_id == submission_id))
        ).scalars().all()

        if not votes:
            submission.credibility_settled = True
            await session.commit()
            return

        truth = _resolved_verdict(ai_verdict, list(votes))

        settled = 0
        for vote in votes:
            user = await session.get(User, vote.user_id)
            if user is None:
                continue
            matched = vote.verdict == truth
            delta = VOTE_MATCH_DELTA if matched else VOTE_MISS_DELTA
            before = float(user.credibility_score)
            after = clamp_credibility(before + delta)
            user.credibility_score = after
            user.tier = tier_for(after)
            session.add(
                CredibilityLog(
                    user_id=user.id,
                    delta=round(after - before, 4),
                    reason='vote_match' if matched else 'vote_miss',
                    new_score=after,
                )
            )
            settled += 1

        submission.credibility_settled = True
        await session.commit()

    logger.info(
        'settled credibility for submission %s → truth=%s, %s voter(s) updated',
        submission_id, truth, settled,
    )


async def generate_explanation(ctx, content: str, correct_answer: str) -> str:
    """Phase 9: write a question explanation (Gemini, or heuristic fallback).

    Returns the text as the arq job result so game-service can poll for it.
    """
    import explain

    return await explain.generate_explanation_text(content, correct_answer)


async def refresh_dashboard_cache(ctx) -> None:
    """Pre-warm the public dashboard caches (Phase 7).

    Rebuilds trending / scam-types / stats / leaderboard and writes them to the
    `dashboard:*` Redis keys the dashboard-service reads. Best-effort — a failure
    just means the next API hit recomputes on a cache miss.
    """
    from shared import dashboard

    try:
        async with AsyncSessionLocal() as session:
            await dashboard.refresh_all(session, ctx['redis'])
        logger.info('refreshed dashboard caches')
    except Exception as exc:  # noqa: BLE001 — never let the cron crash the worker
        logger.warning('refresh_dashboard_cache failed: %s', exc)


WEEKLY_KEY = 'leaderboard:weekly'
SNAPSHOT_LIMIT = 50
REWARD_TOP_N = 3


def _decode_member(member) -> int:
    if isinstance(member, bytes):
        member = member.decode()
    return int(member)


def _send_reward_email(to_email: str, username: str, rank: int, score: float, code: str) -> None:
    """Send a reward email via local SMTP (MailHog). Blocking — call via to_thread."""
    if settings.EMAIL_BACKEND != 'smtp':
        logger.info('EMAIL_BACKEND=%s — skipping local SMTP send', settings.EMAIL_BACKEND)
        return
    import smtplib
    from email.message import EmailMessage

    msg = EmailMessage()
    msg['Subject'] = f'🏆 You placed #{rank} on Newisance this week!'
    msg['From'] = settings.EMAIL_FROM
    msg['To'] = to_email
    msg.set_content(
        f'Hi {username},\n\n'
        f'Congratulations — you finished #{rank} on the Newisance weekly leaderboard '
        f'with a score of {round(score)}!\n\n'
        f'Here is your reward voucher code: {code}\n\n'
        f'Play again at {settings.APP_BASE_URL}\n\n'
        f'— The Newisance Team'
    )
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
        smtp.send_message(msg)


async def weekly_leaderboard_reset(ctx) -> None:
    """Phase 10: snapshot the weekly leaderboard, reward the top 3, then clear it.

    Trigger manually for testing by calling this coroutine directly, e.g.
    `python -c "import asyncio, worker, redis.asyncio as r; ..."`.
    """
    redis = ctx['redis']
    try:
        ranked = await redis.zrevrange(WEEKLY_KEY, 0, SNAPSHOT_LIMIT - 1, withscores=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning('weekly_leaderboard_reset: could not read leaderboard: %s', exc)
        return
    if not ranked:
        logger.info('weekly_leaderboard_reset: leaderboard empty, nothing to do')
        return

    now = datetime.now(timezone.utc)
    winners: list[tuple[int, int, float]] = []  # (rank, user_id, score)

    async with AsyncSessionLocal() as session:
        for index, (member, score) in enumerate(ranked):
            user_id = _decode_member(member)
            rank = index + 1
            session.add(
                LeaderboardSnapshot(
                    scope='weekly', rank=rank, user_id=user_id,
                    score=float(score), snapshot_date=now,
                )
            )
            if rank <= REWARD_TOP_N:
                winners.append((rank, user_id, float(score)))
        await session.commit()

    # Start a fresh week.
    try:
        await redis.delete(WEEKLY_KEY)
    except Exception as exc:  # noqa: BLE001
        logger.warning('weekly_leaderboard_reset: could not clear weekly key: %s', exc)

    # Reward the top 3 with an unclaimed voucher + an email.
    rewarded = 0
    async with AsyncSessionLocal() as session:
        for rank, user_id, score in winners:
            voucher = (
                await session.execute(
                    select(Voucher).where(Voucher.claimed.is_(False)).order_by(Voucher.id).limit(1)
                )
            ).scalar_one_or_none()
            if voucher is None:
                logger.warning('weekly_leaderboard_reset: no unclaimed vouchers left')
                break
            user = await session.get(User, user_id)
            voucher.claimed = True
            voucher.user_id = user_id
            await session.commit()
            rewarded += 1
            if user is not None and user.email:
                try:
                    await asyncio.to_thread(
                        _send_reward_email, user.email, user.username, rank, score, voucher.code
                    )
                except Exception as exc:  # noqa: BLE001 — email is best-effort
                    logger.warning('weekly_leaderboard_reset: email to %s failed: %s', user.email, exc)

    logger.info(
        'weekly_leaderboard_reset: snapshotted %s rows, rewarded %s winner(s)',
        len(ranked), rewarded,
    )


def _redis_settings():
    from arq.connections import RedisSettings

    return RedisSettings.from_dsn(settings.REDIS_URL)


def _cron_jobs():
    from arq import cron

    return [
        # Every 15 minutes, on the quarter hours.
        cron(refresh_dashboard_cache, minute={0, 15, 30, 45}),
        # Monday 00:00 SGT == Sunday 16:00 UTC (containers run UTC).
        cron(weekly_leaderboard_reset, weekday='sun', hour=16, minute=0),
    ]


class WorkerSettings:
    functions = [
        analyse_submission,
        settle_credibility,
        generate_explanation,
        weekly_leaderboard_reset,
    ]
    cron_jobs = _cron_jobs()
    redis_settings = _redis_settings()
    max_jobs = 5
