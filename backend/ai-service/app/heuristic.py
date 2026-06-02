"""Offline heuristic analyser used when no Gemini API key is configured.

A cheap keyword screen so the verification pipeline produces a verdict locally
without any external API. Clearly labelled as offline in the explanation so it
is not mistaken for a real model judgement.
"""
from __future__ import annotations

from shared.schemas import AnalysisResult

# Phrases that frequently appear in scams / misinformation.
_SUSPICIOUS_KEYWORDS = [
    'click here', 'claim', 'urgent', 'act now', 'limited time', 'free', 'winner',
    'congratulations', 'prize', 'lucky draw', 'verify your', 'otp', 'bank account',
    'crypto', 'guaranteed', 'giveaway', 'cure', 'miracle', 'doctors stunned',
    'wire transfer', 'gift card', 'password', 'suspended', 'click the link', 'bit.ly',
]

# Phrases that lean credible (official / sourced).
_CREDIBLE_KEYWORDS = [
    'according to', 'official', 'spokesperson', 'press release', 'reuters',
    'ministry of', 'study published', 'peer-reviewed', 'gov.sg',
]


def heuristic_text(content: str) -> AnalysisResult:
    lower = content.lower()
    sus = [kw for kw in _SUSPICIOUS_KEYWORDS if kw in lower]
    cred = [kw for kw in _CREDIBLE_KEYWORDS if kw in lower]

    score = 0.35 + 0.12 * len(sus) - 0.1 * len(cred)
    confidence = round(min(max(score, 0.0), 1.0), 2)

    if confidence >= 0.6:
        verdict = 'likely_fake'
    elif confidence <= 0.3:
        verdict = 'likely_real'
    else:
        verdict = 'uncertain'

    signals: list[str] = []
    if sus:
        signals.append(f'Scam-associated phrases: {", ".join(sus[:5])}')
    if cred:
        signals.append(f'Credibility cues: {", ".join(cred[:3])}')
    if not signals:
        signals.append('No strong scam or credibility signals detected')

    return AnalysisResult(
        confidence=confidence,
        signals=signals,
        verdict=verdict,
        explanation=(
            'Offline keyword screen (no AI key configured). This is a basic automated '
            'check — community votes carry the weight until a full AI review runs.'
        ),
    )


def heuristic_image() -> AnalysisResult:
    """Images can't be inspected offline, so report an honest 'uncertain'."""
    return AnalysisResult(
        confidence=0.5,
        signals=['Image not analysed (no AI key configured)'],
        verdict='uncertain',
        explanation=(
            'Offline mode cannot inspect images. Set GEMINI_API_KEY to enable AI image '
            'analysis; for now this relies on community verification.'
        ),
    )
