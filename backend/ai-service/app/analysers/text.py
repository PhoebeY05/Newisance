"""Text + URL analysis. For URLs the page is fetched and stripped to text first."""
from __future__ import annotations

import logging

from shared.schemas import AnalysisResult

import gemini
from heuristic import heuristic_text

logger = logging.getLogger(__name__)

# Cap the text sent to the model so a huge page can't blow the context window.
_MAX_CHARS = 12000


async def _fetch_url_text(url: str) -> str:
    import httpx
    from bs4 import BeautifulSoup

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        response = await client.get(url, headers={'User-Agent': 'NewisanceBot/1.0'})
        response.raise_for_status()

    soup = BeautifulSoup(response.text, 'html.parser')
    for tag in soup(['script', 'style', 'noscript']):
        tag.decompose()
    text = ' '.join(soup.get_text(separator=' ').split())
    # Keep the URL itself in context — useful signal even if the body is thin.
    return f'URL: {url}\n\n{text}'[:_MAX_CHARS]


async def analyse(content: str, *, is_url: bool) -> AnalysisResult:
    excerpt = content
    if is_url:
        try:
            excerpt = await _fetch_url_text(content)
        except Exception as exc:  # noqa: BLE001 — fall back to judging the URL string
            logger.warning('could not fetch URL %s: %s', content, exc)
            excerpt = f'URL (could not be fetched): {content}'

    if not gemini.gemini_enabled():
        return heuristic_text(excerpt)
    return await gemini.analyse_text(excerpt[:_MAX_CHARS])
