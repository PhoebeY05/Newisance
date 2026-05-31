from typing import Optional
from fastapi import Header
from shared.db.session import get_db
from shared.auth import decode_token


async def get_db_dep():
    async for s in get_db():
        yield s


def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    if not authorization:
        return None
    try:
        token = authorization.split(' ')[1]
        return decode_token(token)
    except Exception:
        return None
