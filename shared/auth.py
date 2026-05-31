from datetime import datetime, timedelta
from jose import jwt
from shared.config import settings


def create_access_token(user_id: int, expires_minutes: int = 60 * 24 * 7) -> str:
    to_encode = {
        'sub': str(user_id),
        'exp': datetime.utcnow() + timedelta(minutes=expires_minutes),
    }
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
