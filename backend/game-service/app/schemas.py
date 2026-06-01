"""Pydantic request/response schemas for the game service."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class QuestionOut(BaseModel):
    """A question as served to the client. Never includes `correct_answer`."""
    id: int
    content: str
    type: str
    media_url: str | None = None
    difficulty: str | None = None
    tags: list[str] = Field(default_factory=list)


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
    credibility_before: float | None = None
    credibility_after: float | None = None
    credibility_delta: float | None = None


class SessionDetail(SessionOut):
    answers: list[SessionAnswerOut] = Field(default_factory=list)
