"""AI-assisted explanation writing for admin questions (Phase 9).

Uses Gemini when a key is configured, otherwise falls back to the deterministic
heuristic in shared/explain.py — so "Generate Explanation" works with or without
an API key. Exposed to game-service as the arq task `generate_explanation`.
"""
from __future__ import annotations

import logging

from shared.explain import heuristic_explanation

import gemini

logger = logging.getLogger(__name__)


async def generate_explanation_text(content: str, correct_answer: str) -> str:
    if gemini.gemini_enabled():
        try:
            text = await gemini.generate_explanation(content, correct_answer)
            if text:
                return text
        except Exception as exc:  # noqa: BLE001 — fall back to the heuristic
            level = 'rate-limited' if gemini.is_rate_limit_error(exc) else 'failed'
            logger.warning('Gemini explanation %s; using heuristic: %s', level, exc)
    return heuristic_explanation(content, correct_answer)
