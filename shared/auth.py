from datetime import datetime, timedelta, timezone

from jose import jwt
from pydantic import BaseModel

from shared.config import settings


class TokenPayload(BaseModel):
    sub: int
    is_guest: bool
    credibility_score: float
    exp: datetime


def create_access_token(
    user_id: int,
    is_guest: bool,
    credibility_score: float,
    expires_minutes: int | None = None,
) -> str:
    expiry_minutes = expires_minutes or settings.JWT_EXPIRE_MINUTES
    to_encode = {
        'sub': str(user_id),
        'is_guest': is_guest,
        'credibility_score': credibility_score,
        'exp': datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes),
    }
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> TokenPayload:
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    try:
        return TokenPayload.model_validate(payload)
    except AttributeError:
        return TokenPayload.parse_obj(payload)
