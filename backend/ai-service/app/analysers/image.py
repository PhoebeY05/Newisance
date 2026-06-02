"""Image analysis. Reads the file written by community-service and asks Gemini
vision to look for manipulation/deepfake signs (heuristic fallback offline)."""
from __future__ import annotations

import logging
from pathlib import Path

from shared.schemas import AnalysisResult

import gemini
from heuristic import heuristic_image

logger = logging.getLogger(__name__)

_MIME_BY_EXT = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
}


def _mime_for(path: Path) -> str:
    return _MIME_BY_EXT.get(path.suffix.lstrip('.').lower(), 'application/octet-stream')


async def analyse(path: Path) -> AnalysisResult:
    if not gemini.gemini_enabled():
        return heuristic_image()

    mime = _mime_for(path)
    if not mime.startswith('image/'):
        # Not an image we can send to the vision model (e.g. a video stored as
        # bytes) — defer to community review rather than guessing.
        return AnalysisResult(
            confidence=0.5,
            signals=[f'Unsupported media type for AI vision ({path.suffix or "unknown"})'],
            verdict='uncertain',
            explanation='This media type cannot be analysed by AI vision; relying on community votes.',
        )

    image_bytes = path.read_bytes()
    return await gemini.analyse_image(image_bytes, mime)
