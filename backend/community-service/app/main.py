from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from passlib.context import CryptContext
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import create_access_token
from shared.config import settings
from shared.credibility_batch import _vote_truths
from shared.credibility import tier_for
from shared.db.models import CredibilityLog, GameSession, SessionAnswer, User, Vote
from shared.deps import get_current_user, get_db

from routers import community
from storage import LOCAL_MEDIA_DIR


pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

app = FastAPI(title='community-service')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Routes are mounted bare (e.g. /submissions); the frontend's Vite proxy
# supplies the /api/community namespace.
app.include_router(community.router)

# Serve uploaded media. Submissions store `content_url = "media_uploads/<file>"`,
# so mounting here makes that path directly fetchable (via the Vite proxy as
# /api/community/media_uploads/<file>).
LOCAL_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount('/media_uploads', StaticFiles(directory=str(LOCAL_MEDIA_DIR)), name='media')


@app.get('/health')
async def health():
    return {'status': 'ok', 'service': 'community-service'}


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str


class UpdateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=80)


class GoogleAuthRequest(BaseModel):
    id_token: str


def serialize_user(user: User) -> dict:
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'is_guest': user.is_guest,
        'credibility_score': float(user.credibility_score),
        'credibility_updated_at': user.credibility_updated_at,
        'tier': tier_for(float(user.credibility_score)),
        'is_admin': user.is_admin,
        'created_at': user.created_at,
        'updated_at': user.updated_at,
    }


async def _get_existing_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def _get_existing_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def _verify_google_id_token(id_token: str) -> dict[str, Any]:
    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='Google OAuth client ID is not configured')

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            'https://oauth2.googleapis.com/tokeninfo',
            params={'id_token': id_token},
        )

    if response.status_code != 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid Google ID token')

    payload = response.json()
    if payload.get('aud') != settings.GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Google token audience mismatch')

    if payload.get('email_verified') not in {'true', True}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Google email is not verified')

    issuer = payload.get('iss')
    if issuer not in {'accounts.google.com', 'https://accounts.google.com'}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid Google token issuer')

    return payload


def _auth_payload(user: User) -> dict:
    return {
        'access_token': create_access_token(user.id, user.is_guest, float(user.credibility_score)),
        'token_type': 'bearer',
        'user': serialize_user(user),
    }


@app.post('/auth/register')
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if await _get_existing_user_by_email(db, payload.email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Email already registered')
    if await _get_existing_user_by_username(db, payload.username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Username already taken')

    user = User(
        username=payload.username,
        email=payload.email,
        hashed_password=pwd_context.hash(payload.password),
        is_guest=False,
        credibility_score=50.0,
        tier=tier_for(50.0),
        is_admin=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _auth_payload(user)


@app.post('/auth/google')
async def google_auth(payload: GoogleAuthRequest, db: AsyncSession = Depends(get_db)):
    google_payload = await _verify_google_id_token(payload.id_token)
    email = google_payload.get('email')
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Google account does not provide an email')

    user = await _get_existing_user_by_email(db, email)
    if user is None:
        raw_username = google_payload.get('name') or email.split('@')[0]
        username = ''.join(ch if ch.isalnum() else '_' for ch in raw_username)[:80]
        if not username:
            username = f'google_{uuid4().hex[:8]}'

        suffix = ''
        while await _get_existing_user_by_username(db, username + suffix):
            suffix = f'_{uuid4().hex[:4]}'

        username = username + suffix
        user = User(
            username=username,
            email=email,
            hashed_password=None,
            is_guest=False,
            credibility_score=50.0,
            tier=tier_for(50.0),
            is_admin=False,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif user.is_guest:
        user.is_guest = False
        user.credibility_score = max(user.credibility_score, 50.0)
        user.tier = tier_for(user.credibility_score)
        await db.commit()
        await db.refresh(user)

    return _auth_payload(user)


@app.post('/auth/login')
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await _get_existing_user_by_email(db, payload.email)
    if user is None or not user.hashed_password or not pwd_context.verify(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid email or password')
    return _auth_payload(user)


@app.post('/auth/guest')
async def guest_login(db: AsyncSession = Depends(get_db)):
    suffix = uuid4().hex[:6]
    username = f'Guest_{suffix}'
    email = f'guest_{suffix}@guest.local'
    while await _get_existing_user_by_username(db, username) or await _get_existing_user_by_email(db, email):
        suffix = uuid4().hex[:6]
        username = f'Guest_{suffix}'
        email = f'guest_{suffix}@guest.local'

    user = User(
        username=username,
        email=email,
        hashed_password=None,
        is_guest=True,
        credibility_score=0.0,
        tier=tier_for(0.0),
        is_admin=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _auth_payload(user)


@app.get('/users/me')
async def read_me(current_user: User = Depends(get_current_user)):
    return serialize_user(current_user)


@app.patch('/users/me')
async def update_me(
    payload: UpdateUserRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.is_guest:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Guest users cannot update username')

    existing = await _get_existing_user_by_username(db, payload.username)
    if existing and existing.id != current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Username already taken')

    current_user.username = payload.username
    await db.commit()
    await db.refresh(current_user)
    return serialize_user(current_user)


@app.get('/users/me/credibility-log')
async def credibility_log(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recent credibility changes for the signed-in user (Phase 8 profile chart)."""
    days = min(max(days, 1), 365)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        await db.execute(
            select(
                CredibilityLog.delta,
                CredibilityLog.reason,
                CredibilityLog.new_score,
                CredibilityLog.created_at,
            )
            .where(CredibilityLog.user_id == current_user.id, CredibilityLog.created_at >= since)
            .order_by(CredibilityLog.created_at)
        )
    ).all()
    return [
        {
            'delta': float(delta),
            'reason': reason,
            'new_score': float(new_score),
            'created_at': created_at,
        }
        for delta, reason, new_score, created_at in rows
    ]


@app.get('/users/me/stats')
async def my_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Game accuracy vs vote accuracy + tier, for the Phase 8 profile page."""
    uid = current_user.id

    game_row = (
        await db.execute(
            select(
                func.count(SessionAnswer.id),
                func.coalesce(func.sum(cast(SessionAnswer.is_correct, Integer)), 0),
            )
            .select_from(SessionAnswer)
            .join(GameSession, SessionAnswer.session_id == GameSession.id)
            .where(GameSession.user_id == uid)
        )
    ).first()
    answered = int(game_row[0] or 0)
    correct = int(game_row[1] or 0)
    games_played = (
        await db.execute(select(func.count(GameSession.id)).where(GameSession.user_id == uid))
    ).scalar_one()

    vote_rows = (
        await db.execute(select(Vote.submission_id, Vote.verdict).where(Vote.user_id == uid))
    ).all()
    truths = await _vote_truths(db)
    settled_votes = [(sid, verdict) for sid, verdict in vote_rows if sid in truths]
    matches = sum(1 for sid, verdict in settled_votes if truths[sid] == verdict)

    score = float(current_user.credibility_score)
    return {
        'credibility_score': score,
        'credibility_updated_at': current_user.credibility_updated_at,
        'tier': tier_for(score),
        'game_accuracy': round(correct / answered, 4) if answered else None,
        'questions_answered': answered,
        'games_played': int(games_played),
        'vote_accuracy': round(matches / len(settled_votes), 4) if settled_votes else None,
        'votes_cast': len(vote_rows),
        'votes_settled': len(settled_votes),
    }
