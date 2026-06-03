from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import decode_token
from shared.db.models import User
from shared.db.session import get_db as _get_db


async def get_db() -> AsyncSession:
    async for session in _get_db():
        yield session


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(' ', 1)
    if len(parts) != 2 or parts[0].lower() != 'bearer':
        return None
    return parts[1]


async def get_current_user(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = _extract_bearer_token(authorization)
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Missing bearer token')

    try:
        payload = decode_token(token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token') from exc

    result = await db.execute(select(User).where(User.id == payload.sub))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='User not found')
    return user


async def get_optional_user(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    token = _extract_bearer_token(authorization)
    if token is None:
        return None

    try:
        payload = decode_token(token)
    except Exception:
        return None

    result = await db.execute(select(User).where(User.id == payload.sub))
    return result.scalar_one_or_none()


async def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """Like get_current_user but rejects non-admins with 403 (Phase 9)."""
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Admin access required')
    return current_user