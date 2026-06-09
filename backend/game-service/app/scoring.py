"""Pure scoring + credibility helpers for the Timed Challenge.

Kept free of FastAPI/DB imports so they can be unit-tested in isolation and
reused by the production SQS path later.
"""
from __future__ import annotations

from dataclasses import dataclass

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


@dataclass(frozen=True)
class RunCredibility:
    """Whole-number run grade plus the profile delta it creates."""
    score: int
    delta: float
    breakdown: dict[str, int]


def clamp_ratio(value: float) -> float:
    return max(0.0, min(1.0, value))


def credibility_delta_from_score(score_1000: int) -> float:
    """500 is neutral; game runs can raise profile cred but never lower it."""
    score = max(0, min(1000, int(score_1000)))
    return round(max(0, score - 500) / 100, 2)


def build_run_credibility(breakdown: dict[str, int], delta_scale: float = 1.0) -> RunCredibility:
    clean = {key: max(0, int(value)) for key, value in breakdown.items()}
    score = max(0, min(1000, sum(clean.values())))
    return RunCredibility(
        score=score,
        delta=round(credibility_delta_from_score(score) * delta_scale, 2),
        breakdown=clean,
    )


def timed_credibility_score(
    *,
    total_answers: int,
    correct_answers: int,
    response_ms: list[int | None],
    correctness: list[bool],
) -> RunCredibility:
    """Timed Challenge: mostly accuracy, with smaller speed and streak bonuses."""
    total = max(total_answers, 0)
    if total == 0:
        return build_run_credibility({'Accuracy': 0, 'Speed': 0, 'Streak': 0})

    accuracy = correct_answers / total
    speed_bonuses = [
        max(0.0, 1 - (ms if ms is not None else SPEED_BONUS_CEILING_MS) / SPEED_BONUS_CEILING_MS)
        for ms, is_correct in zip(response_ms, correctness)
        if is_correct
    ]
    avg_speed = sum(speed_bonuses) / len(speed_bonuses) if speed_bonuses else 0.0

    best_streak = 0
    current_streak = 0
    for is_correct in correctness:
        if is_correct:
            current_streak += 1
            best_streak = max(best_streak, current_streak)
        else:
            current_streak = 0

    return build_run_credibility(
        {
            'Accuracy': round(accuracy * 700),
            'Speed': round(avg_speed * 200),
            'Streak': round((best_streak / total) * 100),
        },
        delta_scale=0.45,
    )


def truth_tower_credibility_score(
    *,
    height: int,
    score: float,
    fact_checks: int,
    correct_fact_checks: int,
) -> RunCredibility:
    """Truth Tower: fact-check calls lead, tower progress adds support."""
    checks = max(fact_checks, 0)
    correct = max(0, min(correct_fact_checks, checks))
    fact_accuracy = (correct / checks) if checks else 0.0

    return build_run_credibility(
        {
            'Fact checks': round(fact_accuracy * 650),
            'Tower height': round(clamp_ratio(height / 30) * 200),
            'Run score': round(clamp_ratio(score / 4000) * 100),
            'Clear round': 50 if checks > 0 and fact_accuracy >= 0.8 else 0,
        }
    )


def battle_credibility_score(
    *,
    total_answers: int,
    correct_answers: int,
    avg_speed_bonus: float,
    rank: int,
    player_count: int,
    lives: int,
    starting_lives: int,
    question_count: int,
) -> RunCredibility:
    """Battle Royale: accurate pressure calls first, placement second."""
    total = max(total_answers, 0)
    if total == 0:
        return build_run_credibility(
            {'Correct calls': 0, 'Top 3 bonus': 0, 'Speed': 0, 'Hearts left': 0, 'Participation': 0}
        )
    expected = max(question_count, 1)
    coverage = clamp_ratio(total / expected)
    top_three_bonus = {1: 250, 2: 175, 3: 100}.get(rank, 0)

    return build_run_credibility(
        {
            'Correct calls': round(clamp_ratio(correct_answers / expected) * 500),
            'Top 3 bonus': top_three_bonus,
            'Speed': round(clamp_ratio(avg_speed_bonus) * coverage * 100),
            'Hearts left': round(clamp_ratio(lives / max(starting_lives, 1)) * 50),
            'Participation': round(coverage * 100),
        }
    )
