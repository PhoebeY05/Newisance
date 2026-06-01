"""Seed script: insert sample questions for Phase 1.

Run:
  cp .env.example .env    # only if you don't have a .env
  python -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  docker compose up -d postgres redis
  alembic -c alembic.ini upgrade head
  python shared/db/seed.py

This script uses the async DB session from `shared.db.session` and expects
the `questions` table to exist (Alembic migration applied).
"""
import asyncio
from sqlalchemy import text

from shared.db.session import AsyncSessionLocal
from shared.config import settings


QUESTIONS = [
    # ---- misleading_headline (2 fake / 2 real) ----
    {
        'content': 'Headline: "Government to give every citizen $500 cash payout" — shared widely on social media.',
        'type': 'misleading_headline',
        'media_url': None,
        'correct_answer': 'Fake',
        'explanation': 'Official government payouts are announced on government websites; this headline is unverified and lacks sources.',
        'difficulty': 'easy',
        'tags': 'headline,finance',
        'is_active': True,
    },
    {
        'content': 'Headline: "Drinking bleach kills the flu virus, doctors reveal" — circulating on chat groups.',
        'type': 'misleading_headline',
        'media_url': None,
        'correct_answer': 'Fake',
        'explanation': 'Drinking bleach is dangerous and no credible doctor recommends it; this is harmful misinformation.',
        'difficulty': 'easy',
        'tags': 'headline,health',
        'is_active': True,
    },
    {
        'content': 'Headline: "MOH reports a rise in dengue cases this week and urges residents to clear stagnant water." Published on the official MOH site.',
        'type': 'misleading_headline',
        'media_url': None,
        'correct_answer': 'Real',
        'explanation': 'It comes from the official Ministry of Health channel and matches routine public-health advisories.',
        'difficulty': 'medium',
        'tags': 'headline,health',
        'is_active': True,
    },
    {
        'content': 'Headline: "GST in Singapore rises to 9% from 1 January 2024." Reported by multiple mainstream outlets.',
        'type': 'misleading_headline',
        'media_url': None,
        'correct_answer': 'Real',
        'explanation': 'This was an officially announced policy change corroborated by several established news outlets.',
        'difficulty': 'medium',
        'tags': 'headline,finance',
        'is_active': True,
    },
    # ---- deepfake (3 fake / 1 real) ----
    {
        'content': 'Video clip shows a politician appearing to say offensive remarks; the audio and lip movements look slightly out of sync.',
        'type': 'deepfake',
        'media_url': None,
        'correct_answer': 'Fake',
        'explanation': 'Audio that drifts out of sync with the lips is a classic sign of a deepfake.',
        'difficulty': 'medium',
        'tags': 'video,politics',
        'is_active': True,
    },
    {
        'content': 'A video of a famous CEO urging you to join a "guaranteed returns" crypto giveaway, with oddly smooth facial movements.',
        'type': 'deepfake',
        'media_url': None,
        'correct_answer': 'Fake',
        'explanation': 'Celebrity crypto "giveaways" are a common deepfake scam; the unnatural face is a giveaway.',
        'difficulty': 'easy',
        'tags': 'video,crypto,scam',
        'is_active': True,
    },
    {
        'content': 'A clip of a news anchor announcing a sudden nationwide lockdown that no official source has reported.',
        'type': 'deepfake',
        'media_url': None,
        'correct_answer': 'Fake',
        'explanation': 'Major announcements appear across many verified outlets; a lone unverified clip is a red flag for a deepfake.',
        'difficulty': 'hard',
        'tags': 'video,news',
        'is_active': True,
    },
    {
        'content': 'The official Prime Minister\'s Office video of the National Day Rally, posted on the verified government YouTube channel.',
        'type': 'deepfake',
        'media_url': None,
        'correct_answer': 'Real',
        'explanation': 'It is hosted on the verified official channel and matches the publicly scheduled event.',
        'difficulty': 'medium',
        'tags': 'video,government',
        'is_active': True,
    },
    # ---- manipulated_media (2 fake / 2 real) ----
    {
        'content': 'An image purports to show a celebrity at a recent event, but the lighting and edges around them look inconsistent.',
        'type': 'manipulated_media',
        'media_url': None,
        'correct_answer': 'Manipulated',
        'explanation': 'Inconsistent lighting and tell-tale edges around the subject indicate compositing.',
        'difficulty': 'medium',
        'tags': 'image,celebrity',
        'is_active': True,
    },
    {
        'content': 'A viral photo shows a shark swimming down a flooded city highway during a storm.',
        'type': 'manipulated_media',
        'media_url': None,
        'correct_answer': 'Fake',
        'explanation': 'The "shark on the highway" is a recycled hoax image that resurfaces after every major storm.',
        'difficulty': 'easy',
        'tags': 'image,weather',
        'is_active': True,
    },
    {
        'content': 'A wire-service press photo of yesterday\'s flooding, published by Reuters with intact caption and metadata.',
        'type': 'manipulated_media',
        'media_url': None,
        'correct_answer': 'Real',
        'explanation': 'It comes from a reputable wire service with verifiable caption and metadata.',
        'difficulty': 'medium',
        'tags': 'image,news',
        'is_active': True,
    },
    {
        'content': 'The original product photo on a brand\'s official online store listing.',
        'type': 'manipulated_media',
        'media_url': None,
        'correct_answer': 'Real',
        'explanation': 'A first-party product image from the official store is a legitimate, unaltered source.',
        'difficulty': 'easy',
        'tags': 'image,shopping',
        'is_active': True,
    },
    # ---- scam_message (3 fake / 1 real) ----
    {
        'content': 'WhatsApp message: "Click this link to claim your refund" pointing to a shortened URL.',
        'type': 'scam_message',
        'media_url': None,
        'correct_answer': 'Scam',
        'explanation': 'Shortened links and urgent language are common in phishing and scam messages.',
        'difficulty': 'easy',
        'tags': 'scam,phishing',
        'is_active': True,
    },
    {
        'content': 'SMS: "Congratulations! You won a lucky draw. Pay a $50 admin fee to release your prize."',
        'type': 'scam_message',
        'media_url': None,
        'correct_answer': 'Scam',
        'explanation': 'Legitimate prizes never require you to pay a fee up front — this is an advance-fee scam.',
        'difficulty': 'easy',
        'tags': 'scam,prize',
        'is_active': True,
    },
    {
        'content': 'SMS: "Your bank account is locked. Verify your OTP at this link immediately to restore access."',
        'type': 'scam_message',
        'media_url': None,
        'correct_answer': 'Scam',
        'explanation': 'Banks never ask for your OTP via a link; sharing it hands attackers access to your account.',
        'difficulty': 'medium',
        'tags': 'scam,banking',
        'is_active': True,
    },
    {
        'content': 'A Singpass notification that simply states a login occurred, with no links and asking for nothing.',
        'type': 'scam_message',
        'media_url': None,
        'correct_answer': 'Real',
        'explanation': 'A genuine service notification is informational, contains no links, and never asks for credentials.',
        'difficulty': 'medium',
        'tags': 'message,official',
        'is_active': True,
    },
    # ---- satire (4 — all satire/fake) ----
    {
        'content': 'Article: "Scientists confirm chocolate cures the common cold" from a known satire site.',
        'type': 'satire',
        'media_url': None,
        'correct_answer': 'Satire',
        'explanation': 'The site publishes humorous takes and the claims are intentionally absurd.',
        'difficulty': 'easy',
        'tags': 'satire,health',
        'is_active': True,
    },
    {
        'content': 'Article: "Local man wins argument with his cat; cat immediately demands a rematch."',
        'type': 'satire',
        'media_url': None,
        'correct_answer': 'Satire',
        'explanation': 'The absurd, comedic framing makes it clear this is satire, not real news.',
        'difficulty': 'easy',
        'tags': 'satire,humour',
        'is_active': True,
    },
    {
        'content': 'Article: "Study finds 100% of people who drink water eventually die, researchers warn."',
        'type': 'satire',
        'media_url': None,
        'correct_answer': 'Satire',
        'explanation': 'It twists a meaningless correlation into alarm for comedic effect — a hallmark of satire.',
        'difficulty': 'medium',
        'tags': 'satire,science',
        'is_active': True,
    },
    {
        'content': 'Article: "Ministry of Silly Walks announces new grant for citizens with the most ridiculous gait."',
        'type': 'satire',
        'media_url': None,
        'correct_answer': 'Satire',
        'explanation': 'The fictional ministry and ridiculous premise signal this is comedy, not a real announcement.',
        'difficulty': 'easy',
        'tags': 'satire,government',
        'is_active': True,
    },
]


async def run():
    async with AsyncSessionLocal() as session:
        # simple check: if there are already rows, skip inserting duplicates
        res = await session.execute(text('SELECT COUNT(1) as cnt FROM questions'))
        row = res.first()
        if row and row[0] and int(row[0]) > 0:
            print('Questions table already has rows — skipping seed.')
            return

        for q in QUESTIONS:
            await session.execute(
                text(
                    """
                    INSERT INTO questions
                    (content, type, media_url, correct_answer, explanation, difficulty, tags, is_active)
                    VALUES (:content, :type, :media_url, :correct_answer, :explanation, :difficulty, :tags, :is_active)
                    """
                ),
                q,
            )
        await session.commit()
        print(f'Inserted {len(QUESTIONS)} questions.')


def main():
    asyncio.run(run())


if __name__ == '__main__':
    main()
