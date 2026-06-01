"""Community vote scoring (credibility-weighted aggregates).

These mirror the formulae in the implementation guide:
    fake_likelihood = SUM(weight WHERE verdict='fake') / SUM(weight)
    weighted_impact = SUM(impact_score * weight) / SUM(weight)
    final_score     = None until the submission is AI-analysed (Phase 6)
"""
from __future__ import annotations

from shared.db.models import User


def vote_weight_for(user: User) -> float:
    """Snapshot of a voter's weight at vote time.

    Guests carry a fixed low weight; registered users use their credibility
    score scaled to 0–1 and capped at 1.0.
    """
    if user.is_guest:
        return 0.1
    return min(float(user.credibility_score) / 100.0, 1.0)


def aggregate(rows: list[tuple[str, int, float]]) -> tuple[int, float | None, float | None]:
    """Reduce raw (verdict, impact_score, credibility_weight) vote rows.

    Returns (vote_count, fake_likelihood, weighted_impact). The two ratios are
    None when there are no votes (or total weight is zero) so the UI can show an
    "unrated" state instead of a misleading 0%.
    """
    vote_count = len(rows)
    total_weight = sum(weight for _, _, weight in rows)
    if vote_count == 0 or total_weight <= 0:
        return vote_count, None, None

    fake_weight = sum(weight for verdict, _, weight in rows if verdict == 'fake')
    impact_weight = sum(impact * weight for _, impact, weight in rows)

    fake_likelihood = round(fake_weight / total_weight, 4)
    weighted_impact = round(impact_weight / total_weight, 4)
    return vote_count, fake_likelihood, weighted_impact
