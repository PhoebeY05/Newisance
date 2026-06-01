from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import create_access_token
from shared.db.models import User
from shared.deps import get_current_user, get_db


pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

app = FastAPI(title='community-service')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


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


def serialize_user(user: User) -> dict:
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'is_guest': user.is_guest,
        'credibility_score': float(user.credibility_score),
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
        is_admin=False,
    )
    db.add(user)
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
