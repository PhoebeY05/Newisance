"""Pydantic request/response schemas for the game service."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


QuestionType = Literal[
    'misleading_headline', 'deepfake', 'manipulated_media', 'scam_message', 'satire'
]
Difficulty = Literal['easy', 'medium', 'hard']


class QuestionOut(BaseModel):
    """A question as served to the client. Never includes `correct_answer`."""
    id: int
    content: str
    type: str
    media_url: str | None = None
    difficulty: str | None = None
    tags: list[str] = Field(default_factory=list)


class QuizQuestionOut(BaseModel):
    """A question for client-graded quiz games (Truth Tower). Unlike QuestionOut
    this exposes the binary `verdict` + explanation, since the game checks the
    answer locally and the credibility award is computed server-side from the
    run summary, not per-answer."""
    id: int
    content: str
    type: str
    verdict: Literal['real', 'fake']
    explanation: str | None = None
    difficulty: str | None = None


# ---- Admin question pipeline (Phase 9) ----

class AdminQuestionOut(BaseModel):
    """Full question shape for moderators — includes the answer + active flag."""
    id: int
    content: str
    type: str
    media_url: str | None = None
    correct_answer: str | None = None
    explanation: str | None = None
    difficulty: str | None = None
    tags: list[str] = Field(default_factory=list)
    is_active: bool = True
    created_at: datetime | None = None


class AdminQuestionFeed(BaseModel):
    items: list[AdminQuestionOut]
    page: int
    page_size: int
    total: int


class CreateQuestionRequest(BaseModel):
    content: str = Field(min_length=1)
    type: QuestionType
    correct_answer: str = Field(min_length=1)
    explanation: str | None = None
    difficulty: Difficulty = 'medium'
    tags: list[str] = Field(default_factory=list)
    # Either a passthrough URL or a base64 image (saved to LOCAL_MEDIA_DIR).
    media_url: str | None = None
    media: str | None = None


class UpdateQuestionRequest(BaseModel):
    """Partial update — only the provided fields are applied."""
    content: str | None = Field(default=None, min_length=1)
    type: QuestionType | None = None
    correct_answer: str | None = Field(default=None, min_length=1)
    explanation: str | None = None
    difficulty: Difficulty | None = None
    tags: list[str] | None = None
    media_url: str | None = None
    media: str | None = None
    is_active: bool | None = None


class GenerateExplanationRequest(BaseModel):
    content: str = Field(min_length=1)
    correct_answer: str = Field(min_length=1)


class GenerateExplanationResponse(BaseModel):
    explanation: str


class BulkImportError(BaseModel):
    row: int
    reason: str


class BulkImportResult(BaseModel):
    imported: int
    errors: list[BulkImportError] = Field(default_factory=list)


class CreateSessionRequest(BaseModel):
    mode: str = 'timed'


class SessionOut(BaseModel):
    id: int
    user_id: int | None = None
    mode: str
    score: float
    started_at: datetime
    ended_at: datetime | None = None


class AnswerRequest(BaseModel):
    question_id: int
    chosen_answer: str
    response_ms: int | None = Field(default=None, ge=0)
    crashed: bool = False


class AnswerResult(BaseModel):
    is_correct: bool
    correct_answer: str | None
    explanation: str | None
    points_earned: float


class SessionAnswerOut(BaseModel):
    question_id: int
    chosen_answer: str | None
    is_correct: bool
    response_ms: int | None
    points_earned: float


class SessionSummary(BaseModel):
    session_id: int
    score: float
    total_answers: int
    correct_answers: int
    accuracy: float
    run_credibility_score: int | None = None
    run_credibility_breakdown: dict[str, int] = Field(default_factory=dict)
    credibility_before: float | None = None
    credibility_after: float | None = None
    credibility_delta: float | None = None
    tier: str | None = None


class SessionDetail(SessionOut):
    answers: list[SessionAnswerOut] = Field(default_factory=list)


class TruthTowerAwardRequest(BaseModel):
    score: float = Field(ge=0)
    height: int = Field(ge=0)
    fact_checks: int = Field(ge=0)
    correct_fact_checks: int = Field(ge=0)
    wrong_fact_checks: int = Field(default=0, ge=0)


class TruthTowerAwardBreakdown(BaseModel):
    stack_component: float
    stack_milestone_component: float
    fact_check_component: float
    wrong_penalty: float
    capped_award: float


class TruthTowerAwardResult(BaseModel):
    credibility_before: float
    credibility_after: float
    credibility_delta: float
    run_credibility_score: int
    run_credibility_breakdown: dict[str, int] = Field(default_factory=dict)
    tier: str
    breakdown: TruthTowerAwardBreakdown
