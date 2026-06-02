"""Thin wrapper around the google-genai SDK.

The `google.genai` import is deferred into the call site so the worker (and its
tests) import fine without the package installed — the offline heuristic path
needs neither the SDK nor a key.
"""
from __future__ import annotations

import logging

from shared.config import settings
from shared.schemas import AnalysisResult, GeminiAssessment

logger = logging.getLogger(__name__)

_SYSTEM_INSTRUCTION = (
    'You are a misinformation-detection expert for a Singaporean audience. '
    'Judge whether the content is likely real, likely fake, or uncertain, and '
    'be concise and factual. confidence is your confidence that it is '
    'misinformation (0=clearly genuine, 1=clearly fake).'
)

_ASSESS_INSTRUCTION = (
    'You are a misinformation-detection expert for a Singaporean audience. '
    'Assess whether the content is likely_real, likely_fake, or uncertain. '
    '`confidence` is your confidence that it is misinformation (0=clearly '
    'genuine, 1=clearly fake). In `signals`, list the concrete tell-tale cues. '
    'In `cross_references`, suggest 2–4 INDEPENDENT, authoritative sources a '
    'reader should check to verify or debunk this — do NOT just repeat links '
    'already in the content; name real organisations/outlets (e.g. ScamAlert.sg, '
    'MOH, Reuters, AFP Fact Check) and give a concise search `query` for each. '
    'In `verifications`, break the content into 2–4 concrete CHECKABLE aspects '
    '(e.g. "Timeline Consistency", "Financial Figures", "Named Authority Quoted", '
    '"Statistical Claim"). For each, set `aspect` (a short label), `finding` '
    '(one sentence on whether that aspect is internally consistent and plausible '
    'given what is publicly known), and `confidence` (0–1, how well-corroborated). '
    'CRITICAL: do NOT invent specific figures, dates, quotes, or studies that are '
    'not in the content or that you cannot reasonably attribute — if an aspect '
    'cannot be confirmed, say so and lower its confidence. Be concise and factual.'
)


def gemini_enabled() -> bool:
    """True when AI analysis is on and an API key is configured."""
    return settings.AI_ANALYSIS_ENABLED and bool(settings.GEMINI_API_KEY)


def is_rate_limit_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return '429' in text or 'rate' in text or 'quota' in text or 'resource_exhausted' in text


# Transient = worth retrying (server overloaded, rate limited, network blip).
_TRANSIENT_MARKERS = (
    '503', 'unavailable', 'overloaded', 'high demand', 'temporarily',
    '500', 'internal error', 'timeout', 'timed out', 'deadline', 'connection',
)


def is_transient_error(exc: Exception) -> bool:
    if is_rate_limit_error(exc):
        return True
    text = str(exc).lower()
    return any(marker in text for marker in _TRANSIENT_MARKERS)


def _client():
    from google import genai

    return genai.Client(api_key=settings.GEMINI_API_KEY)


async def analyse_text(content: str) -> AnalysisResult:
    """Call Gemini with structured output for a text/URL excerpt."""
    from google.genai import types

    client = _client()
    response = await client.aio.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=f'Analyse this content for misinformation signs:\n\n{content}',
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_INSTRUCTION,
            response_mime_type='application/json',
            response_schema=AnalysisResult,
        ),
    )
    return AnalysisResult.model_validate_json(response.text)


async def assess_text(content: str) -> GeminiAssessment:
    """Semantic verdict + independent cross-reference suggestions for text/URL."""
    from google.genai import types

    client = _client()
    response = await client.aio.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=f'Assess this content for misinformation:\n\n{content}',
        config=types.GenerateContentConfig(
            system_instruction=_ASSESS_INSTRUCTION,
            response_mime_type='application/json',
            response_schema=GeminiAssessment,
        ),
    )
    return GeminiAssessment.model_validate_json(response.text)


async def assess_image(image_bytes: bytes, mime_type: str) -> GeminiAssessment:
    """Vision verdict + cross-reference suggestions for an image."""
    from google.genai import types

    client = _client()
    response = await client.aio.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            types.Part.from_text(
                text='Assess this image for manipulation, deepfakes, or misinformation, '
                     'and suggest independent sources to verify it.'
            ),
        ],
        config=types.GenerateContentConfig(
            system_instruction=_ASSESS_INSTRUCTION,
            response_mime_type='application/json',
            response_schema=GeminiAssessment,
        ),
    )
    return GeminiAssessment.model_validate_json(response.text)


async def analyse_image(image_bytes: bytes, mime_type: str) -> AnalysisResult:
    """Call Gemini vision with structured output for an image."""
    from google.genai import types

    client = _client()
    response = await client.aio.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            types.Part.from_text(
                text='Analyse this image for signs of manipulation, deepfakes, or misinformation.'
            ),
        ],
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_INSTRUCTION,
            response_mime_type='application/json',
            response_schema=AnalysisResult,
        ),
    )
    return AnalysisResult.model_validate_json(response.text)
