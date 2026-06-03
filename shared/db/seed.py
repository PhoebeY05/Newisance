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
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text

from shared.db.models import Comment, Submission, User, Voucher, Vote
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


# ---- Community Verification Hub seed (Phase 5) ----

# Seed fact-checkers with varied credibility so vote weights differ
# (weight = min(credibility_score / 100, 1.0)). `game_score` seeds the Redis
# leaderboard sorted sets so the Phase 7 dashboard has data without playing.
SEED_USERS = [
    {'username': 'FactNinja', 'email': 'factninja@seed.local', 'credibility_score': 95.0, 'game_score': 982.0},
    {'username': 'TruthSeeker', 'email': 'truthseeker@seed.local', 'credibility_score': 88.0, 'game_score': 845.0},
    {'username': 'ShieldFox', 'email': 'shieldfox@seed.local', 'credibility_score': 78.0, 'game_score': 941.0},
    {'username': 'CyberBee', 'email': 'cyberbee@seed.local', 'credibility_score': 64.0, 'game_score': 712.0},
    {'username': 'InfoGuard', 'email': 'infoguard@seed.local', 'credibility_score': 52.0, 'game_score': 523.0},
    {'username': 'NewbieNina', 'email': 'newbienina@seed.local', 'credibility_score': 30.0, 'game_score': 188.0},
]

# Each submission carries its own seeded votes as (username, verdict, impact_score).
# `hours_ago` backdates created_at so the feed's "time ago" labels look natural.
SUBMISSIONS = [
    {
        'content_type': 'text',
        'content': (
            '🚨 URGENT: PM Wong announces every Singaporean gets $5,000! '
            'Claim now at bit.ly/sg-payout5k before it expires tonight 🇸🇬💰'
        ),
        'caption': 'Deepfake voice clone of PM Wong forwarded on WhatsApp • Category: Politics • Impact: High',
        'status': 'community_only',
        'hours_ago': 2,
        'votes': [
            ('FactNinja', 'fake', 5),
            ('TruthSeeker', 'fake', 5),
            ('ShieldFox', 'fake', 4),
            ('CyberBee', 'fake', 4),
        ],
        'comments': [
            ('FactNinja', "Ran the audio through a voice-clone check — the cadence is flat and the breaths are missing. PM Wong's office only posts on the verified gov.sg channels, never via WhatsApp forwards."),
            ('ShieldFox', 'The bit.ly link redirects to a credential-harvesting page that asks for your Singpass and bank login. Do NOT enter anything there.'),
            ('CyberBee', "Saw the exact same 'everyone gets $5,000' template last month with a different minister's name swapped in. Same scam, recycled."),
        ],
    },
    {
        'content_type': 'url',
        'content': 'https://health-remedies-daily.example/lemon-water-cures-diabetes-cancer',
        'caption': 'Viral video claims lemon water cures diabetes & cancer • Category: Health & Medical • Impact: High',
        'status': 'community_only',
        'hours_ago': 5,
        'votes': [
            ('TruthSeeker', 'fake', 4),
            ('ShieldFox', 'fake', 3),
            ('InfoGuard', 'fake', 3),
            ('NewbieNina', 'real', 2),
        ],
        'comments': [
            ('TruthSeeker', 'No peer-reviewed study supports this. HPB and HealthHub have repeatedly debunked these "miracle cure" claims — lemon water does not cure diabetes or cancer.'),
            ('InfoGuard', 'The site has no named authors and cites zero clinical sources. Classic content-farm health misinformation designed for ad clicks.'),
            ('NewbieNina', 'My aunt almost stopped her medication because of a video like this. Please be careful before sharing health claims.'),
        ],
    },
    {
        'content_type': 'text',
        'content': (
            'MAS GRANT NOTICE: You are eligible for a S$5,000 government grant. '
            'Verify your bank account details now at mas-grant-sg.example to receive funds.'
        ),
        'caption': 'Phishing message — MAS has issued an official scam warning • Category: Finance • Impact: High',
        'status': 'community_only',
        'hours_ago': 8,
        'votes': [
            ('FactNinja', 'fake', 5),
            ('ShieldFox', 'fake', 5),
            ('CyberBee', 'fake', 4),
            ('InfoGuard', 'fake', 4),
            ('NewbieNina', 'fake', 3),
        ],
        'comments': [
            ('FactNinja', 'MAS does not disburse personal grants and will never ask you to "verify" your bank details through a link. They have issued an official scam advisory on this exact wording.'),
            ('ShieldFox', 'The domain mas-grant-sg.example is not an official .gov.sg address — it is a spoof. Report and block.'),
        ],
    },
    {
        'content_type': 'url',
        'content': 'https://viral-news-sg.example/shocking-government-scandal-exposed',
        'caption': "Clickbait headline doesn't match the actual article • Category: Politics • Impact: Low",
        'status': 'community_only',
        'hours_ago': 26,
        'votes': [
            ('CyberBee', 'fake', 2),
            ('InfoGuard', 'real', 2),
            ('NewbieNina', 'real', 1),
        ],
        'comments': [
            ('CyberBee', 'Read the actual article — the headline massively overstates a routine policy update. Misleading framing, but not outright fabricated.'),
            ('InfoGuard', 'Borderline for me. The wording is sensational but the underlying facts seem to check out. Worth a "low impact" tag.'),
        ],
    },
    {
        'content_type': 'image',
        'content': 'media_uploads/seed_shark_highway.jpg',
        'caption': "'Shark swimming down a flooded highway' — recycled storm hoax • Category: Technology • Impact: Medium",
        'status': 'community_only',
        'hours_ago': 30,
        'votes': [
            ('FactNinja', 'fake', 3),
            ('ShieldFox', 'fake', 3),
        ],
        'comments': [
            ('FactNinja', "This is the recycled 'shark on the highway' hoax that resurfaces after every major flood. The original is a stock shark photo composited onto a street scene."),
            ('ShieldFox', 'Reverse image search traces it back years — same shark, a different storm each time it goes viral.'),
        ],
    },
    {
        'content_type': 'text',
        'content': 'BREAKING: Scientists confirm chocolate cures the common cold, doctors stunned.',
        'caption': 'Satire article being shared as real news • Category: Health & Medical • Impact: Low',
        # Left as 'pending' so the feed/drawer demonstrate the AI-in-progress state.
        'status': 'pending',
        'hours_ago': 1,
        'votes': [
            ('TruthSeeker', 'fake', 2),
        ],
        'comments': [
            ('TruthSeeker', "This is from a known satire outlet — it's a joke, not a real medical claim. Still worth flagging so people don't reshare it as fact."),
        ],
    },
]


def _vote_weight(credibility_score: float) -> float:
    return min(credibility_score / 100.0, 1.0)


async def seed_questions(session) -> None:
    res = await session.execute(text('SELECT COUNT(1) FROM questions'))
    row = res.first()
    if row and row[0] and int(row[0]) > 0:
        print('Questions table already has rows — skipping question seed.')
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


async def _ensure_seed_users(session) -> dict[str, User]:
    """Return {username: User}, creating any missing seed fact-checkers."""
    users: dict[str, User] = {}
    for spec in SEED_USERS:
        existing = (
            await session.execute(select(User).where(User.email == spec['email']))
        ).scalar_one_or_none()
        if existing is None:
            existing = User(
                username=spec['username'],
                email=spec['email'],
                hashed_password=None,
                is_guest=False,
                credibility_score=spec['credibility_score'],
                is_admin=False,
            )
            session.add(existing)
        users[spec['username']] = existing
    await session.flush()
    return users


async def seed_community(session) -> None:
    existing = (await session.execute(select(func.count()).select_from(Submission))).scalar_one()
    if existing and int(existing) > 0:
        print('Submissions table already has rows — skipping community seed.')
        return

    users = await _ensure_seed_users(session)
    now = datetime.now(timezone.utc)

    vote_total = 0
    for spec in SUBMISSIONS:
        author = users['FactNinja']  # attribute seed submissions to a known checker
        submission = Submission(
            user_id=author.id,
            content_type=spec['content_type'],
            content_url=spec['content'],
            caption=spec['caption'],
            status=spec['status'],
            created_at=now - timedelta(hours=spec['hours_ago']),
        )
        session.add(submission)
        await session.flush()

        for username, verdict, impact in spec['votes']:
            voter = users[username]
            session.add(
                Vote(
                    submission_id=submission.id,
                    user_id=voter.id,
                    verdict=verdict,
                    impact_score=impact,
                    credibility_weight=_vote_weight(float(voter.credibility_score)),
                )
            )
            vote_total += 1

    await session.commit()
    print(f'Inserted {len(SUBMISSIONS)} submissions with {vote_total} votes '
          f'({len(SEED_USERS)} seed fact-checkers).')


async def seed_comments(session) -> None:
    """Seed "Community Fact-Checks" comments onto the seed submissions.

    Idempotent and independent of seed_community: it skips if the comments
    table already has any rows, and looks submissions up by content_url so it
    also backfills databases that were seeded before comments existed.
    """
    existing = (await session.execute(select(func.count()).select_from(Comment))).scalar_one()
    if existing and int(existing) > 0:
        print('Comments table already has rows — skipping comment seed.')
        return

    users = await _ensure_seed_users(session)
    now = datetime.now(timezone.utc)

    comment_total = 0
    for spec in SUBMISSIONS:
        comments = spec.get('comments')
        if not comments:
            continue

        submission = (
            await session.execute(
                select(Submission).where(Submission.content_url == spec['content'])
            )
        ).scalars().first()
        if submission is None:
            continue  # submission seed missing (partially seeded DB) — skip its comments

        # Stagger comments a few minutes after the submission so "time ago" reads naturally.
        base = now - timedelta(hours=spec['hours_ago'])
        for offset, (username, body) in enumerate(comments, start=1):
            commenter = users[username]
            session.add(
                Comment(
                    submission_id=submission.id,
                    user_id=commenter.id,
                    body=body,
                    created_at=base + timedelta(minutes=15 * offset),
                )
            )
            comment_total += 1

    await session.commit()
    print(f'Inserted {comment_total} community comments.')


async def seed_leaderboard(session) -> None:
    """Seed the Redis leaderboard sorted sets (Phase 7 dashboard).

    Idempotent and best-effort: skips if `leaderboard:weekly` already has
    members, and silently no-ops if Redis is unavailable (the dashboard simply
    shows an empty leaderboard). Scores are keyed by the seed users' real ids.
    """
    try:
        import redis.asyncio as aioredis
    except Exception as exc:  # noqa: BLE001
        print(f'redis not installed — skipping leaderboard seed ({exc}).')
        return

    redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        if await redis.zcard('leaderboard:weekly'):
            print('Leaderboard already seeded — skipping.')
            return

        users = await _ensure_seed_users(session)
        await session.flush()

        mapping_weekly: dict[str, float] = {}
        mapping_alltime: dict[str, float] = {}
        for spec in SEED_USERS:
            user = users[spec['username']]
            score = float(spec['game_score'])
            mapping_weekly[str(user.id)] = score
            # All-time is a touch higher than this week's tally.
            mapping_alltime[str(user.id)] = round(score * 1.8, 1)

        if mapping_weekly:
            await redis.zadd('leaderboard:weekly', mapping_weekly)
            await redis.zadd('leaderboard:alltime', mapping_alltime)
        print(f'Seeded leaderboard with {len(mapping_weekly)} players (weekly + all-time).')
    except Exception as exc:  # noqa: BLE001 — Redis is optional for seeding
        print(f'Could not seed leaderboard (Redis unavailable?): {exc}')
    finally:
        close = getattr(redis, 'aclose', redis.close)
        await close()


async def seed_vouchers(session) -> None:
    """Seed unclaimed reward vouchers (Phase 10). Idempotent — skips if any
    vouchers already exist. The weekly reset job assigns these to the top 3."""
    existing = (await session.execute(select(func.count()).select_from(Voucher))).scalar_one()
    if existing and int(existing) > 0:
        print('Vouchers table already has rows — skipping voucher seed.')
        return

    brands = ['GRAB', 'SHOPEE', 'KOPI', 'STARBUCKS', 'LAZADA', 'FOODPANDA']
    codes = [f'{brand}-2026-{1000 + i}' for i, brand in enumerate(brands)]
    for code in codes:
        session.add(Voucher(code=code, user_id=None, claimed=False))
    await session.commit()
    print(f'Inserted {len(codes)} reward vouchers.')


async def run():
    async with AsyncSessionLocal() as session:
        await seed_questions(session)
        await seed_community(session)
        await seed_comments(session)
        await seed_leaderboard(session)
        await seed_vouchers(session)


def main():
    asyncio.run(run())


if __name__ == '__main__':
    main()
