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

    # The rich report is stored with all sections.
    report = analysis.report
    assert report is not None
    assert 0 <= report['credibility_score'] <= 100
    for section in ('source_credibility', 'fact_checking', 'cross_verification',
                    'misinformation_metrics', 'evidence', 'methodology'):
        assert section in report
    assert any(m['label'] == 'Fabrication Risk' for m in report['misinformation_metrics'])
    assert report['ai_assessment'] is None  # no Gemini key in tests → deterministic only
    assert report['cross_reference_count'] == 0  # plain scam text cites no sources

    # final_score is cached: 0.5·fake_likelihood(=1.0) + 0.3·conf + 0.2·cred(0.5)
    cached = ctx['redis'].store.get(f'submission:{sid}:final_score')
    assert cached is not None
    expected = round(0.5 * 1.0 + 0.3 * analysis.confidence + 0.2 * 0.5, 4)
    assert cached == pytest.approx(expected, abs=1e-4)


def test_report_engine_scores_scam_low_and_clean_higher() -> None:
    import report as report_engine

    scam_res, scam_rep, _ = asyncio.run(report_engine.analyse_text(
        'URGENT!!! Click here to claim your FREE $5000 prize, verify your bank account OTP now!',
        is_url=False,
    ))
    assert scam_rep.credibility_score < 50
    assert scam_res.verdict in {'likely_fake', 'uncertain'}
    fabrication = next(m for m in scam_rep.misinformation_metrics if m.label == 'Fabrication Risk')
    assert fabrication.score > 0

    clean_res, clean_rep, _ = asyncio.run(report_engine.analyse_text(
        'According to the Ministry of Health, dengue cases rose this week; residents are advised '
        'to clear stagnant water. The spokesperson confirmed the figures in an official statement.',
        is_url=False,
    ))
    assert clean_rep.credibility_score > scam_rep.credibility_score
    assert clean_rep.methodology['Analysis Model'].startswith('Newisance')


def test_source_confidence_grades_known_authorities() -> None:
    import report as report_engine

    conf, label = report_engine.source_confidence('Reuters')
    assert conf >= 90 and 'news agency' in label.lower()
    conf, label = report_engine.source_confidence('AFP Fact Check')
    assert conf >= 88
    # Unknown sources get a neutral, non-zero score (not hard-coded to a name).
    conf, label = report_engine.source_confidence('Some Random Blog')
    assert conf == 60 and 'verify' in label.lower()


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


def test_gemini_enrichment_blends_verdict_and_cross_references(ctx, make_submission, monkeypatch) -> None:
    from shared.schemas import CrossReference, GeminiAssessment, Verification

    sid = make_submission(content_type='text', content_url='A perfectly ordinary sentence.')

    monkeypatch.setattr(worker, 'GEMINI_THROTTLE_SECONDS', 0)
    monkeypatch.setattr(worker.gemini, 'gemini_enabled', lambda: True)

    async def _assess(_content):
        return GeminiAssessment(
            verdict='likely_fake',
            confidence=0.9,
            explanation='Gemini says this is a scam.',
            signals=['unrealistic claim'],
            cross_references=[CrossReference(source='ScamAlert.sg', reason='Check known scams', query='scamalert')],
            verifications=[
                Verification(aspect='Timeline Consistency', confidence=0.95,
                             finding='Dates align with reported scam activity.'),
                Verification(aspect='Financial Figures', confidence=0.4,
                             finding='The quoted loss cannot be independently confirmed.'),
            ],
        )

    monkeypatch.setattr(worker.gemini, 'assess_text', _assess)

    asyncio.run(worker.analyse_submission(ctx, sid))

    status, analysis = _fetch(sid)
    assert status == 'analysed'
    report = analysis.report
    assert report['ai_assessment'] is not None
    assert 'Gemini' in report['methodology']['Analysis Model']
    # Evidence replaced with AI-suggested independent sources (safe search links).
    assert report['evidence'][0]['title'] == 'ScamAlert.sg'
    assert report['evidence'][0]['link_url'].startswith('https://www.google.com/search?q=')
    assert report['cross_reference_count'] == 1
    assert report['methodology']['Cross-References'] == '1 source(s)'
    # The independent source's authority lands in Source Credibility, graded locally.
    assert any(c['title'] == 'Reference: ScamAlert.sg' and c['confidence'] >= 90
               for c in report['source_credibility'])
    # Cross-Verification now holds the AI's corroboration findings (not sources).
    titles = [c['title'] for c in report['cross_verification']]
    assert titles == ['Timeline Consistency', 'Financial Figures']
    assert report['cross_verification'][0]['confidence'] == 95
    assert report['cross_verification'][1]['confidence'] == 40
    # Strong AI fake signal drags the blended credibility down.
    assert report['credibility_score'] < 60
    # The summary % must match the gauge (no stale pre-blend number).
    assert f"{report['credibility_score']}% credible" in report['summary']


def test_gemini_failure_falls_back_to_deterministic(ctx, make_submission, monkeypatch) -> None:
    sid = make_submission(content_type='text', content_url='Some neutral text about the weather.')

    monkeypatch.setattr(worker, 'GEMINI_THROTTLE_SECONDS', 0)
    monkeypatch.setattr(worker.gemini, 'gemini_enabled', lambda: True)

    async def _boom(_content):
        raise RuntimeError('503 UNAVAILABLE: model experiencing high demand')

    monkeypatch.setattr(worker.gemini, 'assess_text', _boom)

    # Gemini failure must NOT mark community_only — deterministic report stands.
    asyncio.run(worker.analyse_submission(ctx, sid))

    status, analysis = _fetch(sid)
    assert status == 'analysed'
    assert analysis.report is not None
    assert analysis.report['ai_assessment'] is None  # no AI layer applied


def test_analyse_submission_missing_id_is_noop(ctx) -> None:
    # A bogus id should not raise.
    asyncio.run(worker.analyse_submission(ctx, 999_999_999))
