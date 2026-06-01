"""Pure scoring + credibility helpers for the Timed Challenge.

Kept free of FastAPI/DB imports so they can be unit-tested in isolation and
reused by the production SQS path later.
"""
from __future__ import annotations

# Points awarded scale with difficulty; unknown/"mixed" falls back to easy.
DIFFICULTY_MULTIPLIER: dict[str, float] = {
    'easy': 1.0,
    'medium': 1.5,
    'hard': 2.0,
}

# Bird game is binary "real vs fake"; any verdict not in this set counts as fake
# (scam / satire / manipulated / deepfake all resolve to "fake").
_REAL_TERMS = {'real', 'genuine', 'true', 'authentic', 'legit', 'credible'}

# Speed bonus decays linearly to zero at this response time.
SPEED_BONUS_CEILING_MS = 8000


def normalize_verdict(answer: str | None) -> str:
    """Collapse a free-text answer to the binary 'real' | 'fake'."""
    if answer is None:
        return 'fake'
    return 'real' if answer.strip().lower() in _REAL_TERMS else 'fake'


def is_answer_correct(chosen_answer: str | None, correct_answer: str | None) -> bool:
    return normalize_verdict(chosen_answer) == normalize_verdict(correct_answer)


def points_for_answer(difficulty: str | None, response_ms: int | None, is_correct: bool) -> float:
    """base_points × (1 + speed_bonus) when correct, else 0."""
    if not is_correct:
        return 0.0
    multiplier = DIFFICULTY_MULTIPLIER.get((difficulty or '').lower(), 1.0)
    base_points = multiplier * 100
    ms = response_ms if response_ms is not None else SPEED_BONUS_CEILING_MS
    speed_bonus = max(0.0, 1 - ms / SPEED_BONUS_CEILING_MS)
    return round(base_points * (1 + speed_bonus), 2)


def updated_credibility(old_score: float, accuracy: float) -> float:
    """new_score = old_score × 0.9 + accuracy × 10  (accuracy in 0..1)."""
    return round(old_score * 0.9 + accuracy * 10, 4)
