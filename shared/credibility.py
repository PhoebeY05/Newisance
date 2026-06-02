"""Credibility scoring rules shared across services (Phase 8).

Single source of truth for the tier brackets and the vote-settlement deltas so
game-service, ai-service (settle task), community-service and the dashboard all
agree. See AGENTS.md "Credibility System Rules".
"""
from __future__ import annotations

# Score scale.
CREDIBILITY_MIN = 0.0
CREDIBILITY_MAX = 100.0

# Vote settlement: applied per voter once a submission is analysed.
VOTE_MATCH_DELTA = 0.5   # voter agreed with the resolved verdict
VOTE_MISS_DELTA = -0.2   # voter disagreed

# Tier brackets (inclusive lower bound), highest first.
TIERS: tuple[tuple[float, str], ...] = (
    (81, 'Expert'),
    (61, 'Analyst'),
    (31, 'Verified'),
    (0, 'Newcomer'),
)

TIER_NAMES = tuple(name for _, name in TIERS)


def tier_for(score: float) -> str:
    """Map a credibility score (0–100) to its tier name."""
    for threshold, name in TIERS:
        if score >= threshold:
            return name
    return 'Newcomer'


def clamp_credibility(score: float) -> float:
    """Keep a credibility score within [0, 100]."""
    return max(CREDIBILITY_MIN, min(CREDIBILITY_MAX, score))
