"""Fetch latest official scam advisories from I Can ACT Against Scams."""
from __future__ import annotations

import asyncio
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime
from html import unescape

SOURCE_URL = 'https://www.icanactagainstscams.gov.sg/scam-trends'
API_URL = 'https://www.icanactagainstscams.gov.sg/api/scam-advisories'
ASSET_BASE = 'https://www.icanactagainstscams.gov.sg/api/assets'
CACHE_KEY = 'dashboard:official-scam-trends'
CACHE_TTL_SECONDS = 14 * 24 * 60 * 60
SUMMARY_TEXT = 'The three latest advisories from I Can ACT Against Scams, refreshed every two weeks.'

# The gov site's WAF blocks datacenter (cloud) egress IPs, so a request straight
# from the prod VM gets a 403. When OFFICIAL_TRENDS_PROXY is set, fetch through a
# relay (e.g. a Cloudflare Worker) whose edge IP the WAF accepts. The relay takes
# the real URL as a `?url=` query param and returns the upstream body verbatim.
# Unset (local dev) => fetch the source directly, unchanged.
PROXY_URL = os.environ.get('OFFICIAL_TRENDS_PROXY', '').strip()


def _proxied(url: str) -> str:
    if not PROXY_URL:
        return url
    sep = '&' if '?' in PROXY_URL else '?'
    return f'{PROXY_URL}{sep}url={urllib.parse.quote(url, safe="")}'


def _fetch_json(url: str) -> list[dict]:
    request = urllib.request.Request(
        _proxied(url),
        headers={
            'User-Agent': 'Newisance trends dashboard (+https://newisance.com)',
            'Accept': 'application/json',
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode('utf-8', errors='replace'))


def _clean(text: str) -> str:
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = text.replace('`', '')
    return re.sub(r'\s+', ' ', unescape(text)).strip()


def _shorten(text: str, max_len: int = 230) -> str:
    text = _clean(text)
    if len(text) <= max_len:
        return text
    return f"{text[:max_len].rsplit(' ', 1)[0]}..."


def _date_key(item: dict) -> datetime:
    raw = item.get('date_updated') or item.get('date_created') or ''
    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        return datetime.min


def _display_date(item: dict) -> str:
    raw = item.get('date_updated') or item.get('date_created')
    if not raw:
        return ''
    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00')).strftime('%d %b %Y')
    except ValueError:
        return raw[:10]


def _split_content(content: str) -> tuple[list[str], list[str]]:
    paragraphs: list[str] = []
    bullets: list[str] = []
    for raw in content.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith('*'):
            bullets.append(_clean(line.lstrip('*').strip()))
        else:
            paragraphs.append(_clean(line))
    return paragraphs, bullets


def _contains_any(text: str, fragments: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(fragment in lowered for fragment in fragments)


def _matches_action(text: str) -> bool:
    lowered = text.lower()
    return (
        bool(re.search(r'\bact\b|\bsecure\b|\bcheck\b|\bverify\b|\bstop\b|\breport\b|\btell\b|\bbank\b|\b2fa\b', lowered))
        or 'two-factor authentication' in lowered
        or 'unauthorised transaction' in lowered
    )


def _scam_sites(item: dict) -> list[str]:
    raw = item.get('scam_site_urls') or []
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = [part.strip() for part in raw.split(',')]
        raw = parsed
    if not isinstance(raw, list):
        return []
    return [str(url).strip() for url in raw if str(url).strip()]


def _build_warning_signs(bullets: list[str], paragraphs: list[str]) -> list[str]:
    warning_fragments = (
        'unsolicited',
        'promising',
        'promise',
        'unofficial',
        'upfront',
        'personal details',
        'suspicious',
        'unrealistic',
        'too good',
        'website address',
        'url',
        'domain',
    )
    warnings = [line for line in bullets if _contains_any(line, warning_fragments)]
    if not warnings:
        warnings = [line for line in paragraphs if _contains_any(line, warning_fragments)]
    return [_shorten(line, 180) for line in warnings[:4]]


def _build_prevention_steps(bullets: list[str], paragraphs: list[str]) -> list[dict]:
    source_lines = [line for line in bullets + paragraphs if _matches_action(line)]
    fallback = [
        'Stop all communication with the suspected scammer.',
        'Check with the official company, bank, or agency through trusted channels.',
        'Tell your bank, the Police, family, and friends if you may have been affected.',
    ]
    labels = ['Secure', 'Check', 'Tell']
    steps = source_lines[:3] or fallback
    return [
        {'label': labels[index] if index < len(labels) else f'Step {index + 1}', 'text': _shorten(step, 170)}
        for index, step in enumerate(steps)
    ]


def _tags(item: dict) -> list[str]:
    values: list[str] = []
    for tag in item.get('tags') or []:
        data = tag.get('scamsexposed_tags_id') if isinstance(tag, dict) else None
        if isinstance(data, dict) and data.get('value'):
            values.append(str(data['value']))
    return values


def _image_urls(item: dict) -> list[str]:
    urls: list[str] = []
    for image in item.get('images') or []:
        data = image.get('directus_files_id') if isinstance(image, dict) else None
        if not isinstance(data, dict):
            continue
        file_id = data.get('id')
        filename = data.get('filename_disk')
        if file_id and filename:
            urls.append(f'{ASSET_BASE}/{file_id}/{filename}')
    return urls


def _build_advisory(item: dict) -> dict:
    content = item.get('content') or ''
    paragraphs, bullets = _split_content(content)
    summary = next((p for p in paragraphs if not p.lower().startswith('unsure if')), '')
    warning_signs = _build_warning_signs(bullets, paragraphs)
    prevention_steps = _build_prevention_steps(bullets, paragraphs)
    scam_sites = _scam_sites(item)
    tags = _tags(item)
    images = _image_urls(item)
    category = tags[0] if tags else 'Scam alert'

    return {
        'id': str(item.get('id')),
        'title': item.get('title') or 'Official scam advisory',
        'date': _display_date(item),
        'category': category,
        'tags': tags,
        'summary': _shorten(summary or content),
        'warning_signs': warning_signs or [
            'Unexpected offers or messages that ask you to click links, pay first, or share personal details.'
        ],
        'prevention_steps': prevention_steps,
        'scam_site_urls': scam_sites,
        'image_url': images[0] if images else None,
        'source_url': SOURCE_URL,
    }


def _scrape_sync(limit: int) -> dict:
    advisories = sorted(_fetch_json(API_URL), key=_date_key, reverse=True)[:limit]
    items = [_build_advisory(item) for item in advisories]
    return {
        'title': 'Latest Scam Trends',
        'summary': SUMMARY_TEXT,
        'items': items,
        'source_url': SOURCE_URL,
    }


async def get_official_trends(redis, *, limit: int = 3, refresh: bool = False) -> dict:
    limit = max(1, min(limit, 6))
    if not refresh:
        cached = await redis.get(CACHE_KEY)
        if cached:
            data = json.loads(cached)
            data['items'] = data.get('items', [])[:limit]
            data['summary'] = SUMMARY_TEXT
            return data

    data = await asyncio.to_thread(_scrape_sync, limit)
    await redis.set(CACHE_KEY, json.dumps(data), ex=CACHE_TTL_SECONDS)
    return data
