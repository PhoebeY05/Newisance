"""Shareable result cards (Phase 10).

GET /share/card/{session_id} renders a 1200x630 PNG (score, accuracy, rank, a
QR code back to the app) with Pillow, saves it under LOCAL_MEDIA_DIR, and
returns it. The frontend end screen links to this for native/social sharing.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config import settings
from shared.db.models import GameSession, SessionAnswer
from shared.deps import get_db

from leaderboard import WEEKLY_KEY, get_redis
from storage import LOCAL_MEDIA_DIR

router = APIRouter(prefix='/share', tags=['share'])

CARD_W, CARD_H = 1200, 630
NAVY = (21, 38, 76)
WHITE = (255, 255, 255)
TEAL = (70, 200, 189)
YELLOW = (243, 209, 92)
MUTED = (171, 171, 171)


def _font(size: int):
    from PIL import ImageFont

    try:
        return ImageFont.load_default(size=size)  # Pillow ≥ 10.1
    except TypeError:
        return ImageFont.load_default()


async def _rank_for(user_id: int | None) -> int | None:
    if user_id is None:
        return None
    try:
        position = await get_redis().zrevrank(WEEKLY_KEY, str(user_id))
    except Exception:  # noqa: BLE001
        return None
    return (position + 1) if position is not None else None


def _render_card(path, *, score: float, accuracy: int | None, rank: int | None) -> None:
    from PIL import Image, ImageDraw
    import qrcode

    img = Image.new('RGB', (CARD_W, CARD_H), NAVY)
    draw = ImageDraw.Draw(img)

    draw.text((64, 56), 'NEWISANCE', font=_font(40), fill=TEAL)
    draw.text((64, 110), 'Spot the fake, stop the spread', font=_font(26), fill=MUTED)

    draw.text((64, 200), 'I scored', font=_font(40), fill=WHITE)
    draw.text((64, 250), str(round(score)), font=_font(150), fill=YELLOW)

    y = 250
    if accuracy is not None:
        draw.text((520, y + 30), f'{accuracy}% accuracy', font=_font(44), fill=WHITE)
        y += 90
    if rank is not None:
        draw.text((520, y + 30), f'Ranked #{rank} this week', font=_font(44), fill=TEAL)

    draw.text((64, 540), f'Play at {settings.APP_BASE_URL}', font=_font(30), fill=WHITE)

    qr = qrcode.make(settings.APP_BASE_URL).convert('RGB').resize((200, 200))
    img.paste(qr, (CARD_W - 200 - 64, CARD_H - 200 - 56))

    img.save(path, format='PNG')


@router.get('/card/{session_id}')
async def share_card(
    session_id: int,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    session = (
        await db.execute(select(GameSession).where(GameSession.id == session_id))
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Session not found')

    totals = (
        await db.execute(
            select(
                func.count(SessionAnswer.id),
                func.coalesce(func.sum(cast(SessionAnswer.is_correct, Integer)), 0),
            ).where(SessionAnswer.session_id == session_id)
        )
    ).first()
    answered = int(totals[0] or 0)
    accuracy = round(100 * int(totals[1] or 0) / answered) if answered else None
    rank = await _rank_for(session.user_id)

    LOCAL_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    path = LOCAL_MEDIA_DIR / f'share_{session_id}.png'
    _render_card(path, score=float(session.score), accuracy=accuracy, rank=rank)

    return FileResponse(str(path), media_type='image/png', filename=f'newisance-{session_id}.png')
