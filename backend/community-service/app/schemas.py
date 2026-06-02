"""Pydantic request/response schemas for the community verification hub."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ContentType = Literal['image', 'url', 'text']
Verdict = Literal['real', 'fake']


class CreateSubmissionRequest(BaseModel):
    content_type: ContentType
    # For image: a base64 string (optionally a data: URL). For url/text: raw value.
    content: str = Field(min_length=1)
    caption: str | None = Field(default=None, max_length=2000)


class UpdateSubmissionRequest(BaseModel):
    """Partial update — only the fields present are applied."""
    content_type: ContentType | None = None
    content: str | None = Field(default=None, min_length=1)
    caption: str | None = None


class VoteRequest(BaseModel):
    verdict: Verdict
    impact_score: int = Field(ge=1, le=5)


class VoteSummary(BaseModel):
    """Aggregated, credibility-weighted scoring for a submission."""
    vote_count: int
    fake_likelihood: float | None  # 0.0–1.0, weighted; null with no votes
    weighted_impact: float | None  # 1.0–5.0, weighted; null with no votes


class AiAnalysisOut(BaseModel):
    confidence: float | None = None
    signals: list[str] = Field(default_factory=list)
    verdict: str | None = None
    explanation: str | None = None
    processed_at: datetime | None = None
    # Rich deterministic report (sections on the AI Analysis page); see
    # shared.schemas.AnalysisReport for the shape.
    report: dict | None = None


class SubmissionOut(BaseModel):
    id: int
    user_id: int | None = None
    content_type: str
    content_url: str
    caption: str | None = None
    status: str
    created_at: datetime
    fake_likelihood: float | None = None
    weighted_impact: float | None = None
    vote_count: int = 0


class SubmissionDetail(SubmissionOut):
    final_score: float | None = None  # null until status == 'analysed' (Phase 6)
    ai_analysis: AiAnalysisOut | None = None
    your_vote: VoteRequest | None = None  # the caller's existing vote, if any
    submitter: str | None = None  # submitter username (null for anonymous posts)
    fake_votes: int = 0  # raw count of 'fake' verdicts
    real_votes: int = 0  # raw count of 'real' verdicts
    can_delete: bool = False  # whether the current caller may delete this
    can_edit: bool = False  # whether the current caller may edit this


class SubmissionFeed(BaseModel):
    items: list[SubmissionOut]
    page: int
    page_size: int
    total: int


class VoteResult(BaseModel):
    fake_likelihood: float | None
    weighted_impact: float | None
    vote_count: int
    your_vote_weight: float


class CreateCommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class CommentOut(BaseModel):
    id: int
    submission_id: int
    user_id: int | None = None
    body: str
    author: str | None = None  # commenter username (null if the account is gone)
    author_credibility: float = 0.0  # 0–100, used to derive the badge client-side
    author_is_admin: bool = False
    created_at: datetime
    can_delete: bool = False  # whether the current caller may delete this comment
