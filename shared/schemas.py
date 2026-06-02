from typing import Any, Generic, Literal, TypeVar
from pydantic import BaseModel, Field

T = TypeVar('T')


class ApiResponse(BaseModel, Generic[T]):
    data: Any | None = None
    error: str | None = None
    status: int = 200


class AnalysisResult(BaseModel):
    """Structured AI verdict for a community submission (Phase 6).

    Also used as the Gemini `response_schema` so the model returns valid JSON.
    `confidence` is the model's confidence that the content is misinformation
    (0.0 = clearly genuine, 1.0 = clearly fake).
    """
    confidence: float = Field(ge=0.0, le=1.0)
    signals: list[str] = Field(default_factory=list)
    verdict: Literal['likely_real', 'likely_fake', 'uncertain'] = 'uncertain'
    explanation: str = ''
