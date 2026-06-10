"""Scrape and simplify public ScamShield education pages.

The source site is a public Singapore Government website. We keep the scraper
small and defensive: discover scam-type detail links from the hub page, extract
plain-text sections, and fall back to known URLs if the hub markup changes.
"""
from __future__ import annotations

import asyncio
import json
import re
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin

SOURCE_URL = 'https://www.scamshield.gov.sg/i-want-protection-from-scams/'
SCAM_TYPES_URL = urljoin(SOURCE_URL, 'learn-to-recognise-scams/')
CACHE_KEY = 'dashboard:scam-education'
CACHE_TTL_SECONDS = 6 * 60 * 60

KNOWN_SCAM_SLUGS = [
    'government-officials-impersonation-scams',
    'investment-scams',
    'job-scams',
    'e-commerce-scams',
    'phishing-scams',
    'fake-friend-call-scams',
    'loan-scams',
    'tech-support-scams',
    'insurance-service-scams',
    'internet-love-scams',
    'sexual-service-scams',
    'cryptocurrency-related-scams',
]

GENERAL_WARNING_SIGNS = [
    'Unusual messages, calls, or offers from people or organisations you cannot verify.',
    'Deals, returns, prizes, or job commissions that sound too good to be true.',
    'Pressure to act immediately, transfer money, click links, install apps, or share OTPs.',
]

GENERAL_PROTECTION = [
    'Check with someone you trust or call the ScamShield Helpline at 1799 if unsure.',
    'Use ScamShield, anti-virus protection, two-factor authentication, and official app stores.',
    'Verify claims through official websites, trusted registers, banks, or agencies before acting.',
]


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != 'a':
            return
        attrs_dict = dict(attrs)
        self._href = attrs_dict.get('href')
        self._parts = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == 'a' and self._href:
            text = _clean(' '.join(self._parts))
            self.links.append((self._href, text))
            self._href = None
            self._parts = []


class ContentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.nodes: list[tuple[str, str]] = []
        self._tag: str | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {'h1', 'h2', 'h3', 'p', 'li'}:
            self._flush()
            self._tag = tag
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._tag:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == self._tag:
            self._flush()

    def close(self) -> None:
        self._flush()
        super().close()

    def _flush(self) -> None:
        if not self._tag:
            return
        text = _clean(' '.join(self._parts))
        if text:
            self.nodes.append((self._tag, text))
        self._tag = None
        self._parts = []


def _clean(value: str) -> str:
    return re.sub(r'\s+', ' ', value).replace('\xa0', ' ').strip()


def _fetch(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Newisance education dashboard (+https://newisance.com)',
            'Accept': 'text/html',
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.read().decode('utf-8', errors='replace')


def _discover_scam_pages() -> dict[str, str]:
    pages: dict[str, str] = {}
    try:
        for page_url in (SOURCE_URL, SCAM_TYPES_URL):
            parser = LinkParser()
            parser.feed(_fetch(page_url))
            for href, label in parser.links:
                url = urldefrag(urljoin(page_url, href))[0]
                if '/learn-to-recognise-scams/' not in url:
                    continue
                if url.rstrip('/') == SCAM_TYPES_URL.rstrip('/'):
                    continue
                if label.lower().startswith('skip to'):
                    continue
                if label:
                    pages[url] = label
    except Exception:
        # Known public links keep the tab useful even if discovery has a hiccup.
        pass

    for slug in KNOWN_SCAM_SLUGS:
        pages.setdefault(urljoin(SCAM_TYPES_URL, f'{slug}/'), '')
    return pages


def _first_summary(nodes: list[tuple[str, str]], title: str, fallback: str) -> str:
    seen_title = False
    for tag, text in nodes:
        if tag == 'h1' and text == title:
            seen_title = True
            continue
        if seen_title and tag == 'p' and not text.lower().startswith('last updated'):
            return _sentence(text)
    return _sentence(fallback)


def _section(nodes: list[tuple[str, str]], patterns: list[str]) -> list[str]:
    collecting = False
    items: list[str] = []
    compiled = [re.compile(pattern, re.I) for pattern in patterns]
    for tag, text in nodes:
        if tag in {'h1', 'h2', 'h3'}:
            if collecting and tag in {'h1', 'h2'}:
                break
            collecting = any(pattern.search(text) for pattern in compiled)
            continue
        if collecting and tag in {'p', 'li'}:
            candidate = _sentence(text)
            if _is_useful(candidate):
                items.append(candidate)
        if len(items) >= 5:
            break
    return _dedupe(items)


def _sentence(text: str, max_len: int = 180) -> str:
    text = _clean(text)
    if len(text) <= max_len:
        return text
    cut = text[:max_len].rsplit(' ', 1)[0]
    return f'{cut}...'


def _is_useful(text: str) -> bool:
    lowered = text.lower()
    blocked = ('image:', 'annual scams', 'back to', 'related articles', 'on this page')
    return len(text) > 18 and not any(fragment in lowered for fragment in blocked)


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            output.append(item)
    return output


def _build_item(url: str, fallback_label: str) -> dict:
    parser = ContentParser()
    parser.feed(_fetch(url))
    parser.close()
    title = next((text for tag, text in parser.nodes if tag == 'h1'), fallback_label.split('Learn ')[0].strip())
    title = title or 'Scam type'
    summary = _first_summary(parser.nodes, title, fallback_label)
    how = _section(parser.nodes, [r'how it works'])
    warnings = _section(parser.nodes, [r'red flags', r'likely a scam', r'common signs', r'phony'])
    protect = _section(parser.nodes, [r'how to stay safe', r'protect yourself'])

    return {
        'title': title,
        'summary': summary,
        'how_it_works': how[:4] or ['Scammers make contact online, by phone, or through messaging apps, then build enough trust or pressure to get a victim to act.'],
        'warning_signs': warnings[:4] or GENERAL_WARNING_SIGNS,
        'protect_yourself': protect[:4] or GENERAL_PROTECTION,
        'source_url': url,
    }


def _scrape_sync(limit: int) -> list[dict]:
    items: list[dict] = []
    for url, label in _discover_scam_pages().items():
        try:
            items.append(_build_item(url, label))
        except Exception:
            continue
        if len(items) >= limit:
            break
    return items


async def get_scam_education(redis, *, limit: int = 12, refresh: bool = False) -> list[dict]:
    if not refresh:
        cached = await redis.get(CACHE_KEY)
        if cached:
            return json.loads(cached)[:limit]

    items = await asyncio.to_thread(_scrape_sync, limit)
    if items:
        await redis.set(CACHE_KEY, json.dumps(items), ex=CACHE_TTL_SECONDS)
    return items
