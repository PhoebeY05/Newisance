"""Deterministic explanation generator (Phase 9 fallback).

Pure-Python, no AI and no key required — used as the offline fallback for
`generate_explanation` (when Gemini is off, errors, or the worker is
unreachable). Lives in shared/ so both ai-service and game-service can call it.
"""
from __future__ import annotations

_REAL_ANSWERS = {'real', 'genuine', 'true', 'authentic', 'legit', 'credible'}

# Keyword groups → the tell-tale sign they hint at.
_CUES: tuple[tuple[tuple[str, ...], str], ...] = (
    (('urgent', 'immediately', 'expires', 'hurry', 'act fast', 'before it', 'now!'),
     'pressure to act quickly'),
    (('click', 'link', 'bit.ly', 'http', 'tinyurl', 'tap here', 'verify at'),
     'an urgent call to click an unfamiliar link'),
    (('free', 'prize', 'win', 'reward', 'cash', 'payout', 'grant', '$', 'lucky draw'),
     'an offer of free money or prizes'),
    (('otp', 'password', 'bank', 'account', 'verify your', 'login', 'card number', 'cvv'),
     'a request for personal or banking details'),
    (('deepfake', 'ai-generated', 'lip', 'out of sync', 'manipulat', 'edited'),
     'signs the media has been digitally manipulated'),
)


def heuristic_explanation(content: str, correct_answer: str | None) -> str:
    """A concise, plain-English 2-sentence explanation for a 16-year-old."""
    text = (content or '').lower()
    answer = (correct_answer or '').strip()
    is_real = answer.lower() in _REAL_ANSWERS

    if is_real:
        return (
            'This looks legitimate — it does not rely on the usual misinformation '
            'tricks like fake urgency, unverifiable claims, or requests for your '
            'personal details. Still, cross-check important news against official '
            'sources before sharing.'
        )

    cues = [label for keywords, label in _CUES if any(k in text for k in keywords)]
    cue_text = ', '.join(cues[:3]) if cues else 'unverifiable claims and no credible source'
    label = answer.lower() or 'fake'
    return (
        f'This is likely {label} because it shows classic warning signs — {cue_text}. '
        'Genuine messages do not pressure you, promise easy money, or ask for '
        'sensitive information.'
    )
