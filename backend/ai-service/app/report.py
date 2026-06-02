"""Deterministic credibility analysis — no AI, so no rate limits.

Builds the rich `AnalysisReport` (the sections on the AI Analysis page) from:
  - URL/domain reputation (curated trust + shortener/suspicious lists)
  - page metadata via BeautifulSoup (title, description, author byline, date,
    outbound citations, quotes)
  - text heuristics (scam phrases, sensationalism, clickbait, urgency)

Everything is computable locally with httpx + beautifulsoup4.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from shared.schemas import AnalysisReport, AnalysisResult, ConfItem, EvidenceCard, Metric

logger = logging.getLogger(__name__)

_MAX_CHARS = 12000

# Reputation tiers (suffix match on the registrable domain).
_TRUSTED_DOMAINS = {
    'gov.sg', 'edu.sg', 'who.int', 'un.org', 'reuters.com', 'apnews.com',
    'bbc.com', 'bbc.co.uk', 'channelnewsasia.com', 'straitstimes.com',
    'todayonline.com', 'mothership.sg', 'gov.uk', 'nature.com', 'nih.gov',
    'moh.gov.sg', 'police.gov.sg', 'mas.gov.sg', 'scamalert.sg',
}
_SUSPICIOUS_MARKERS = {
    'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'is.gd', 'buff.ly', 'rb.gy',
    '.example', 'blogspot.', 'wordpress.com', 'wixsite.com', 'weebly.com',
}

_SCAM_PHRASES = [
    'click here', 'claim', 'urgent', 'act now', 'limited time', 'free', 'winner',
    'congratulations', 'prize', 'lucky draw', 'verify your', 'otp', 'bank account',
    'crypto', 'guaranteed', 'giveaway', 'wire transfer', 'gift card', 'password',
    'suspended', 'click the link', 'bit.ly', 'whatsapp', 'before it gets deleted',
    'share this', 'limited offer', 'cash payout', 'refund',
]
_CLICKBAIT_PHRASES = [
    "you won't believe", 'you wont believe', 'shocking', 'mind-blowing', 'this one trick',
    'doctors hate', 'what happens next', 'will blow your mind', 'gone wrong',
    'the truth about', 'they don\'t want you to know', 'number will shock you',
    'before it gets deleted', 'share before', 'must see', 'jaw-dropping',
]
_EMOTIONAL_WORDS = [
    'shocking', 'outrageous', 'terrifying', 'unbelievable', 'miracle', 'disaster',
    'exposed', 'scandal', 'destroyed', 'slammed', 'panic', 'urgent', 'breaking',
    'horrifying', 'insane', 'crazy',
]
_ATTRIBUTION_CUES = [
    'according to', 'said', 'reported', 'spokesperson', 'statement', 'confirmed',
    'announced', 'study', 'research', 'data shows',
]
_URL_RE = re.compile(r'https?://[^\s)>\]]+', re.IGNORECASE)

# Deterministic authority scoring for a *named* source (used to grade the
# independent cross-reference sources Gemini suggests, without any extra API).
# Each entry: keyword (matched case-insensitively as a substring) -> (confidence, label).
_KNOWN_SOURCES: list[tuple[str, int, str]] = [
    ('scamalert', 95, 'Official scam registry (SG)'),
    ('factually', 95, 'Government clarification service (SG)'),
    ('gov.sg', 95, 'Singapore government'),
    ('moh', 93, 'Health authority (SG)'),
    ('ministry of health', 93, 'Health authority (SG)'),
    ('health sciences authority', 92, 'Health authority (SG)'),
    ('healthhub', 90, 'Health authority (SG)'),
    ('cyber security agency', 92, 'Government agency (SG)'),
    ('police', 90, 'Law-enforcement authority'),
    ('monetary authority', 92, 'Financial regulator (SG)'),
    ('world health organization', 93, 'International health authority'),
    ('who', 90, 'International health authority'),
    ('cdc', 92, 'Public-health authority'),
    ('nih', 92, 'Medical research authority'),
    ('mayo clinic', 90, 'Medical reference'),
    ('reuters', 95, 'International news agency'),
    ('associated press', 95, 'International news agency'),
    ('ap news', 95, 'International news agency'),
    ('afp', 92, 'Fact-checking organisation'),
    ('bbc', 90, 'Established news outlet'),
    ('channel news asia', 88, 'Established news outlet (SG)'),
    ('cna', 88, 'Established news outlet (SG)'),
    ('straits times', 88, 'Established news outlet (SG)'),
    ('today', 85, 'Established news outlet (SG)'),
    ('mothership', 80, 'News outlet (SG)'),
    ('snopes', 90, 'Fact-checking organisation'),
    ('politifact', 90, 'Fact-checking organisation'),
    ('factcheck', 88, 'Fact-checking organisation'),
    ('fact check', 88, 'Fact-checking organisation'),
    ('fact-check', 88, 'Fact-checking organisation'),
    ('wikipedia', 70, 'Crowd-sourced reference'),
]


def source_confidence(name: str) -> tuple[int, str]:
    """Grade a named source's authority deterministically. Falls back to a
    neutral 'independent source' score when the name isn't recognised."""
    lower = (name or '').lower()
    for keyword, confidence, label in _KNOWN_SOURCES:
        if keyword in lower:
            return confidence, label
    return 60, 'Independent source — verify directly'


@dataclass
class _Features:
    text: str = ''
    domain: str | None = None
    https: bool = False
    title: str | None = None
    description: str | None = None
    has_byline: bool = False
    has_date: bool = False
    external_links: list[tuple[str, str]] = field(default_factory=list)  # (url, anchor)
    quotes: bool = False


def _registrable(domain: str) -> str:
    parts = domain.lower().split('.')
    return '.'.join(parts[-2:]) if len(parts) >= 2 else domain.lower()


def _domain_tier(domain: str | None) -> str:
    if not domain:
        return 'none'
    d = domain.lower()
    if any(d == t or d.endswith('.' + t) or d.endswith(t) for t in _TRUSTED_DOMAINS):
        return 'trusted'
    if any(marker in d for marker in _SUSPICIOUS_MARKERS):
        return 'suspicious'
    return 'unknown'


async def _fetch_features(url: str) -> _Features:
    import httpx
    from bs4 import BeautifulSoup

    feats = _Features()
    parsed = urlparse(url)
    feats.domain = parsed.netloc or None
    feats.https = parsed.scheme == 'https'

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={'User-Agent': 'NewisanceBot/1.0'})
            resp.raise_for_status()
        html = resp.text
        feats.domain = urlparse(str(resp.url)).netloc or feats.domain
    except Exception as exc:  # noqa: BLE001 — still analyse the URL string itself
        logger.warning('could not fetch %s: %s', url, exc)
        feats.text = f'URL (not fetched): {url}'
        return feats

    soup = BeautifulSoup(html, 'html.parser')
    if soup.title and soup.title.string:
        feats.title = soup.title.string.strip()

    desc = soup.find('meta', attrs={'name': 'description'}) or soup.find(
        'meta', attrs={'property': 'og:description'}
    )
    if desc and desc.get('content'):
        feats.description = desc['content'].strip()

    author = soup.find('meta', attrs={'name': 'author'}) or soup.find(
        'meta', attrs={'property': 'article:author'}
    )
    feats.has_byline = bool(author and author.get('content')) or bool(
        soup.find(class_=re.compile(r'byline|author', re.I))
    )

    date = (
        soup.find('meta', attrs={'property': 'article:published_time'})
        or soup.find('meta', attrs={'name': 'date'})
        or soup.find('time')
    )
    feats.has_date = bool(date)

    # Outbound (cross-domain) citations.
    seen: set[str] = set()
    for a in soup.find_all('a', href=True):
        href = a['href']
        if not href.startswith('http'):
            continue
        link_domain = urlparse(href).netloc
        if not link_domain or link_domain == feats.domain or link_domain in seen:
            continue
        seen.add(link_domain)
        feats.external_links.append((href, ' '.join(a.get_text().split())[:80]))
        if len(feats.external_links) >= 12:
            break

    for tag in soup(['script', 'style', 'noscript']):
        tag.decompose()
    body_text = ' '.join(soup.get_text(separator=' ').split())
    feats.quotes = '"' in body_text or '“' in body_text
    feats.text = f'{feats.title or ""} {feats.description or ""} {body_text}'[:_MAX_CHARS]
    return feats


def _text_features(content: str) -> _Features:
    feats = _Features(text=content[:_MAX_CHARS])
    feats.quotes = '"' in content or '“' in content
    # Treat any URLs embedded in the text as citations.
    for match in _URL_RE.findall(content)[:12]:
        feats.external_links.append((match, urlparse(match).netloc or match))
    return feats


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _count_hits(lower: str, phrases: list[str]) -> int:
    return sum(1 for p in phrases if p in lower)


def _analyse(feats: _Features, *, is_url: bool) -> tuple[AnalysisResult, AnalysisReport, float]:
    started = time.monotonic()
    text = feats.text or ''
    lower = text.lower()
    words = text.split()
    word_count = len(words)
    caps_words = sum(1 for w in words if len(w) >= 3 and w.isupper())
    exclamations = text.count('!')

    scam_hits = _count_hits(lower, _SCAM_PHRASES)
    clickbait_hits = _count_hits(lower, _CLICKBAIT_PHRASES)
    emotional_hits = _count_hits(lower, _EMOTIONAL_WORDS)
    attribution_hits = _count_hits(lower, _ATTRIBUTION_CUES)

    tier = _domain_tier(feats.domain)
    citations = len(feats.external_links)

    # ---- metric scores (0–10) ----
    fabrication_risk = _clamp(scam_hits * 2.0, 0, 10)
    sensationalism = _clamp(exclamations * 1.0 + caps_words * 1.5 + emotional_hits * 1.0, 0, 10)
    clickbait = _clamp(clickbait_hits * 3.0 + (2 if caps_words >= 3 else 0), 0, 10)

    source_authority = {'trusted': 9.0, 'unknown': 5.0, 'suspicious': 2.0, 'none': 4.0}[tier]
    if feats.https:
        source_authority += 0.5
    if feats.has_byline:
        source_authority += 0.5
    if feats.has_date:
        source_authority += 0.5
    source_authority = _clamp(source_authority, 0, 10)

    evidence_quality = _clamp(
        3.0 + min(4.0, citations * 0.7) + (1.5 if feats.quotes else 0)
        + (1.0 if word_count > 150 else 0) + min(1.0, attribution_hits * 0.3),
        0, 10,
    )
    claim_accuracy = _clamp(source_authority * 0.5 + (10 - fabrication_risk) * 0.5, 0, 10)

    # ---- composite credibility (0–100) ----
    credibility = (
        100
        - (fabrication_risk * 6 + sensationalism * 2 + clickbait * 2)
        + (source_authority - 5) * 3
        + (evidence_quality - 3) * 2
    )
    credibility = int(round(_clamp(credibility, 0, 100)))

    if credibility >= 66:
        verdict = 'likely_real'
    elif credibility <= 40:
        verdict = 'likely_fake'
    else:
        verdict = 'uncertain'
    fake_confidence = round((100 - credibility) / 100, 2)

    clean = fabrication_risk < 3 and sensationalism < 4 and clickbait < 3
    misinfo_verdict = (
        'NO MISINFORMATION DETECTED' if clean else 'POTENTIAL MISINFORMATION SIGNALS DETECTED'
    )

    # ---- signals (short bullets for the compact view) ----
    signals: list[str] = []
    if tier == 'trusted':
        signals.append(f'Source domain is a recognised authority ({feats.domain})')
    elif tier == 'suspicious':
        signals.append(f'Source domain looks suspicious ({feats.domain})')
    if scam_hits:
        signals.append(f'{scam_hits} scam-associated phrase(s) detected')
    if sensationalism >= 4:
        signals.append('High sensationalism (caps / exclamation / emotive language)')
    if clickbait_hits:
        signals.append('Clickbait phrasing detected')
    if citations:
        signals.append(f'{citations} external source(s) cited')
    if not signals:
        signals.append('No strong credibility or misinformation signals detected')

    # ---- assemble the rich report ----
    source_cards: list[ConfItem] = []
    if is_url:
        source_cards.append(ConfItem(
            title='Secure Connection (HTTPS)',
            confidence=100 if feats.https else 0,
            detail='Served over HTTPS.' if feats.https else 'Not served over HTTPS.',
        ))
        tier_label = {'trusted': 'recognised authority', 'unknown': 'not in trusted list',
                      'suspicious': 'flagged as suspicious', 'none': 'unknown'}[tier]
        source_cards.append(ConfItem(
            title='Domain Reputation',
            confidence=int(source_authority * 10),
            detail=f'{feats.domain or "unknown domain"} — {tier_label}.',
        ))
        source_cards.append(ConfItem(
            title='Author Attribution',
            confidence=90 if feats.has_byline else 30,
            detail='Author byline found.' if feats.has_byline else 'No clear author byline.',
        ))
        source_cards.append(ConfItem(
            title='Publication Date',
            confidence=85 if feats.has_date else 30,
            detail='Publication date present.' if feats.has_date else 'No publication date found.',
        ))
    else:
        source_cards.append(ConfItem(
            title='Submission Type',
            confidence=40,
            detail='Plain text with no source URL — judged on language signals only.',
        ))
        source_cards.append(ConfItem(
            title='Language Reliability',
            confidence=int(claim_accuracy * 10),
            detail='Based on scam-phrase and tone analysis of the text.',
        ))
        source_cards.append(ConfItem(
            title='Embedded Links',
            confidence=min(100, citations * 25),
            detail=f'{citations} link(s) found in the text.' if citations else 'No links cited.',
        ))

    cross_cards = [
        ConfItem(
            title='Outbound Citations',
            confidence=min(100, citations * 20),
            detail=f'Found {citations} link(s) to external sources.'
            if citations else 'No external sources are cited.',
        ),
        ConfItem(
            title='Quotes & Attribution',
            confidence=min(100, (60 if feats.quotes else 20) + attribution_hits * 8),
            detail=f'{attribution_hits} attribution cue(s)'
            + (' and direct quotes' if feats.quotes else '') + ' detected.',
        ),
        ConfItem(
            title='Metadata Consistency',
            confidence=80 if (feats.title and feats.description) else (50 if feats.title else 30),
            detail='Title and description present.'
            if (feats.title and feats.description) else 'Limited page metadata.',
        ),
    ]

    evidence: list[EvidenceCard] = []
    for url_, anchor in feats.external_links[:6]:
        dom = urlparse(url_).netloc or url_
        evidence.append(EvidenceCard(
            icon='🔗', title=dom, detail=anchor or 'External reference',
            link_label='Open link', link_url=url_,
        ))
    if not evidence:
        evidence.append(EvidenceCard(
            icon='📄', title='No external sources cited',
            detail='This submission does not reference any external sources to cross-check.',
        ))

    quality_label = {'trusted': 'Official / Verified Media', 'unknown': 'Unverified Source',
                     'suspicious': 'Low-Trust Source', 'none': 'Text submission'}[tier]
    elapsed = time.monotonic() - started
    methodology = {
        'Analysis Model': 'Newisance Heuristic Analyzer v1',
        'Processing Time': f'{elapsed:.2f} seconds',
        'Source Quality': quality_label,
        'Confidence Score': f'{credibility}% credible',
        'Cross-References': f'{citations} source(s)',
        'Last Updated': 'just now',
    }

    summary = (
        f'Heuristic analysis rated this {credibility}% credible based on source reputation, '
        f'citation checks, and language signals. {misinfo_verdict.capitalize()}.'
    )
    explanation = (
        f'Automated (non-AI) credibility check: {misinfo_verdict.lower()}. '
        f'Source authority {source_authority:.1f}/10, evidence quality {evidence_quality:.1f}/10, '
        f'fabrication risk {fabrication_risk:.1f}/10.'
    )

    report = AnalysisReport(
        credibility_score=credibility,
        summary=summary,
        source_credibility=source_cards,
        fact_checking=[
            Metric(label='Claim Accuracy', score=round(claim_accuracy, 1)),
            Metric(label='Source Authority', score=round(source_authority, 1)),
            Metric(label='Evidence Quality', score=round(evidence_quality, 1)),
        ],
        fact_checking_highlight=ConfItem(
            title='Independent Sources',
            confidence=min(100, citations * 18),
            detail=f'{citations} distinct external source(s) referenced.'
            if citations else 'No independent sources referenced.',
        ),
        cross_verification=cross_cards,
        misinformation_metrics=[
            Metric(label='Fabrication Risk', score=round(fabrication_risk, 1)),
            Metric(label='Sensationalism Score', score=round(sensationalism, 1)),
            Metric(label='Clickbait Probability', score=round(clickbait, 1)),
        ],
        misinformation_verdict=misinfo_verdict,
        evidence=evidence,
        cross_reference_count=citations,
        methodology=methodology,
    )
    result = AnalysisResult(
        confidence=fake_confidence, signals=signals, verdict=verdict, explanation=explanation
    )
    return result, report, elapsed


async def analyse_text(content: str, *, is_url: bool) -> tuple[AnalysisResult, AnalysisReport, str]:
    """Returns (verdict, report, excerpt). The excerpt is the text actually
    analysed (fetched body for URLs) so the caller can reuse it for Gemini."""
    feats = await _fetch_features(content) if is_url else _text_features(content)
    result, report, _ = _analyse(feats, is_url=is_url)
    return result, report, feats.text or content


def analyse_image(path: Path) -> tuple[AnalysisResult, AnalysisReport, None]:
    """Images can't be inspected without AI vision — return an honest 'uncertain'
    report based on file presence/type rather than guessing."""
    exists = path.exists()
    ext = path.suffix.lstrip('.').lower() or 'unknown'
    credibility = 50
    report = AnalysisReport(
        credibility_score=credibility,
        summary='Image submission — automated text analysis is not applicable; '
                'relies on community verification.',
        source_credibility=[
            ConfItem(
                title='Media File',
                confidence=70 if exists else 0,
                detail=f'{ext.upper()} image received.' if exists else 'Image file unavailable.',
            ),
            ConfItem(
                title='Automated Vision',
                confidence=0,
                detail='Awaiting AI vision analysis of this image.',
            ),
        ],
        fact_checking=[
            Metric(label='Claim Accuracy', score=5.0),
            Metric(label='Source Authority', score=5.0),
            Metric(label='Evidence Quality', score=5.0),
        ],
        cross_verification=[
            ConfItem(title='Cross-Verification', confidence=0,
                     detail='No textual sources to cross-check for an image.'),
        ],
        misinformation_metrics=[
            Metric(label='Fabrication Risk', score=5.0),
            Metric(label='Sensationalism Score', score=0.0),
            Metric(label='Clickbait Probability', score=0.0),
        ],
        misinformation_verdict='INCONCLUSIVE — COMMUNITY REVIEW',
        evidence=[EvidenceCard(icon='🖼️', title='Uploaded image',
                               detail='Visual content pending community verification.')],
        methodology={
            'Analysis Model': 'Newisance Heuristic Analyzer v1',
            'Processing Time': '0.00 seconds',
            'Source Quality': 'Image submission',
            'Confidence Score': f'{credibility}% credible',
            'Cross-References': '0 sources',
            'Last Updated': 'just now',
        },
    )
    result = AnalysisResult(
        confidence=0.5,
        signals=['Image content — community verification recommended'],
        verdict='uncertain',
        explanation='Image analysis is not performed offline; community votes decide this one.',
    )
    return result, report, None
