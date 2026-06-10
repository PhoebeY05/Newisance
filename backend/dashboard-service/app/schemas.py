"""Pydantic response schemas for the public dashboard (Phase 7).

Shapes mirror the dicts produced by `shared.dashboard`; the builders there are
the single source of truth and these models enforce the API contract.
"""
from __future__ import annotations

from pydantic import BaseModel


class TrendingItem(BaseModel):
    id: int
    content_type: str
    content_url: str
    caption: str | None = None
    status: str
    created_at: str | None = None
    final_score: float
    fake_likelihood: float | None = None
    weighted_impact: float | None = None
    vote_count: int
    verdict: str | None = None
    explanation: str | None = None
    rank_score: float


class VerdictCount(BaseModel):
    verdict: str
    count: int


class ContentTypeCount(BaseModel):
    content_type: str
    count: int


class CategoryCount(BaseModel):
    category: str
    count: int


class WeeklyBucket(BaseModel):
    week: str
    likely_fake: int
    likely_real: int
    uncertain: int


class ScamTypes(BaseModel):
    by_verdict: list[VerdictCount] = []
    by_content_type: list[ContentTypeCount] = []
    # Defaulted so a cache entry written by an older worker build (before
    # by_category existed) still validates instead of 500-ing.
    by_category: list[CategoryCount] = []
    weekly: list[WeeklyBucket] = []


class Stats(BaseModel):
    submissions_this_week: int
    pct_fake: int
    most_common_type: str | None = None
    distinct_submitters_this_week: int = 0
    active_users_this_week: int


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: int
    username: str
    score: float
    credibility_score: float
    tier: str


class SpeedBonus(BaseModel):
    max_multiplier: float
    ceiling_ms: int
    description: str


class LeaderboardScoringBreakdown(BaseModel):
    title: str
    summary: str
    difficulty_points: dict[str, int]
    speed_bonus: SpeedBonus
    formula: str
    battle_modifiers: list[str]


class ScamEducationItem(BaseModel):
    title: str
    summary: str
    how_it_works: list[str]
    warning_signs: list[str]
    protect_yourself: list[str]
    source_url: str


class OfficialTrendItem(BaseModel):
    id: str
    title: str
    date: str
    category: str
    tags: list[str]
    summary: str
    warning_signs: list[str]
    prevention_steps: list[dict[str, str]]
    scam_site_urls: list[str]
    image_url: str | None = None
    source_url: str


class OfficialTrends(BaseModel):
    title: str
    summary: str
    items: list[OfficialTrendItem]
    source_url: str
