"""Tests for the Phase 6 AI verification worker (offline heuristic path)."""
import asyncio

import pytest

import worker
from heuristic import heuristic_text
from conftest import TestSessionLocal

from sqlalchemy import select
from shared.db.models import AiAnalysis, Submission


def _fetch(submission_id: int):
    async def _run():
        async with TestSessionLocal() as session:
            submission = await session.get(Submission, submission_id)
            analysis = (
                await session.execute(
                    select(AiAnalysis).where(AiAnalysis.submission_id == submission_id)
                )
            ).scalar_one_or_none()
            return submission.status, analysis

    return asyncio.run(_run())


def test_heuristic_flags_scam_text() -> None:
    scam = heuristic_text('URGENT: Click here to claim your FREE prize, verify your bank account now!')
    assert scam.verdict == 'likely_fake'
    assert scam.confidence > 0.5
    assert scam.signals

    benign = heuristic_text('According to the Ministry of Health, dengue cases rose this week.')
    assert benign.verdict in {'likely_real', 'uncertain'}


def test_analyse_submission_text_marks_analysed(ctx, make_submission) -> None:
    sid = make_submission(
        content_type='text',
        content_url='Win a FREE prize! Click here and verify your bank account urgently.',
        votes=[('fake', 0.5)],
        credibility=50.0,
    )

    asyncio.run(worker.analyse_submission(ctx, sid))

    status, analysis = _fetch(sid)
    assert status == 'analysed'
    assert analysis is not None
    assert analysis.verdict in {'likely_fake', 'likely_real', 'uncertain'}
    assert isinstance(analysis.signals, list) and analysis.signals

    # final_score is cached: 0.5·fake_likelihood(=1.0) + 0.3·conf + 0.2·cred(0.5)
    cached = ctx['redis'].store.get(f'submission:{sid}:final_score')
    assert cached is not None
    expected = round(0.5 * 1.0 + 0.3 * analysis.confidence + 0.2 * 0.5, 4)
    assert cached == pytest.approx(expected, abs=1e-4)


def test_permanent_error_marks_community_only(ctx, make_submission, monkeypatch) -> None:
    sid = make_submission(content_type='text', content_url='whatever')

    async def _boom(*_args, **_kwargs):
        raise ValueError('malformed response')  # non-transient → no retry

    monkeypatch.setattr(worker, '_run_analysis', _boom)

    # Must not raise — a permanent error degrades gracefully.
    asyncio.run(worker.analyse_submission(ctx, sid))

    status, analysis = _fetch(sid)
    assert status == 'community_only'
    assert analysis is None


def test_transient_error_retries(ctx, make_submission, monkeypatch) -> None:
    from arq import Retry

    sid = make_submission(content_type='text', content_url='whatever')

    async def _boom(*_args, **_kwargs):
        raise RuntimeError('503 UNAVAILABLE: model experiencing high demand')

    monkeypatch.setattr(worker, '_run_analysis', _boom)

    # First attempt of a transient error → arq Retry, submission left pending.
    ctx['job_try'] = 1
    with pytest.raises(Retry):
        asyncio.run(worker.analyse_submission(ctx, sid))

    status, analysis = _fetch(sid)
    assert status == 'pending'
    assert analysis is None


def test_transient_error_gives_up_after_max_tries(ctx, make_submission, monkeypatch) -> None:
    sid = make_submission(content_type='text', content_url='whatever')

    async def _boom(*_args, **_kwargs):
        raise RuntimeError('503 UNAVAILABLE: model experiencing high demand')

    monkeypatch.setattr(worker, '_run_analysis', _boom)

    # On the final attempt, a transient error degrades to community_only.
    ctx['job_try'] = worker.MAX_TRIES
    asyncio.run(worker.analyse_submission(ctx, sid))

    status, analysis = _fetch(sid)
    assert status == 'community_only'
    assert analysis is None


def test_analyse_submission_missing_id_is_noop(ctx) -> None:
    # A bogus id should not raise.
    asyncio.run(worker.analyse_submission(ctx, 999_999_999))
