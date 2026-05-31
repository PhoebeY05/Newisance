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
        'content': 'Video clip shows a politician appearing to say offensive remarks (deepfake suspicion).',
        'type': 'deepfake',
        'media_url': None,
        'correct_answer': 'Likely manipulated',
        'explanation': 'The audio and lip movements look slightly out of sync — a common sign of deepfakes.',
        'difficulty': 'medium',
        'tags': 'video,politics',
        'is_active': True,
    },
    {
        'content': 'An image purports to show a celebrity at a recent event, but the lighting looks inconsistent.',
        'type': 'manipulated_media',
        'media_url': None,
        'correct_answer': 'Manipulated',
        'explanation': 'Evidence of compositing around the subject indicates the image was edited.',
        'difficulty': 'medium',
        'tags': 'image,celebrity',
        'is_active': True,
    },
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
        'content': 'Article: "Scientists confirm chocolate cures common cold" from a satire site.',
        'type': 'satire',
        'media_url': None,
        'correct_answer': 'Satire',
        'explanation': 'The site publishes humorous takes and the claims are intentionally absurd.',
        'difficulty': 'easy',
        'tags': 'satire,health',
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
