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


# ---- Rich deterministic analysis report (Phase 6 enhancement) ----
# Computed without any AI (domain reputation + BeautifulSoup metadata + text
# heuristics) so it never consumes API quota or hits rate limits.

class ConfItem(BaseModel):
    """A labelled finding with a 0–100 confidence and supporting detail."""
    title: str
    confidence: int = Field(ge=0, le=100)
    detail: str


class Metric(BaseModel):
    """A 0–10 score for a bar gauge."""
    label: str
    score: float = Field(ge=0.0, le=10.0)


class EvidenceCard(BaseModel):
    icon: str = '🔗'
    title: str
    detail: str
    link_label: str | None = None
    link_url: str | None = None


class AnalysisReport(BaseModel):
    credibility_score: int = Field(ge=0, le=100)  # the big % gauge
    summary: str
    source_credibility: list[ConfItem] = Field(default_factory=list)
    fact_checking: list[Metric] = Field(default_factory=list)            # 0–10, higher better
    fact_checking_highlight: ConfItem | None = None
    cross_verification: list[ConfItem] = Field(default_factory=list)
    misinformation_metrics: list[Metric] = Field(default_factory=list)   # 0–10, lower better
    misinformation_verdict: str = ''
    evidence: list[EvidenceCard] = Field(default_factory=list)
    cross_reference_count: int = 0  # number of independent sources to cross-check
    methodology: dict[str, str] = Field(default_factory=dict)
    # Optional semantic layer from Gemini (None when AI is off/unavailable).
    ai_assessment: ConfItem | None = None


class CrossReference(BaseModel):
    """An independent source Gemini suggests for verifying a claim.

    `query` is a search string we turn into a safe link (LLM-written URLs are
    unreliable, so we never use a model-provided URL directly).
    """
    source: str          # e.g. "Singapore Police Force / ScamAlert.sg"
    reason: str          # why this source helps verify the claim
    query: str = ''      # suggested search query


class Verification(BaseModel):
    """A single checkable aspect of the claim, cross-referenced against what is
    publicly known. Drives the Cross-Verification section."""
    aspect: str                                          # e.g. "Timeline Consistency"
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)  # corroboration confidence
    finding: str = ''                                    # what cross-referencing indicates


class GeminiAssessment(BaseModel):
    """Gemini's semantic judgement (used as the model's structured output)."""
    verdict: Literal['likely_real', 'likely_fake', 'uncertain'] = 'uncertain'
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)  # confidence it is misinformation
    explanation: str = ''
    signals: list[str] = Field(default_factory=list)
    cross_references: list[CrossReference] = Field(default_factory=list)
    verifications: list[Verification] = Field(default_factory=list)
