"""Power-Up Shop (Phase 11).

Buy power-ups with credibility points and track per-user inventory. Power-ups
are consumed (quantity −1) when activated in a game. The catalog is static
code (no admin CRUD); credibility is the currency, deducted server-side and
logged to credibility_log just like every other credibility change.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.credibility import clamp_credibility, tier_for
from shared.db.models import CredibilityLog, User, UserPowerup
from shared.deps import get_current_user, get_db

router = APIRouter(prefix='/shop', tags=['shop'])


class PowerupItem(BaseModel):
    key: str
    name: str
    emoji: str
    description: str
    cost: float
    game: str  # 'timed' | 'battle' | 'both'


# Static catalog. `game` controls which game(s) can activate the power-up.
CATALOG: list[PowerupItem] = [
    PowerupItem(
        key='shield', name='Shield', emoji='🛡️',
        description='Survive one crash without ending your streak.', cost=8, game='both',
    ),
    PowerupItem(
        key='slowmo', name='Slow Motion', emoji='⏱️',
        description='Obstacles move slower for the whole round.', cost=6, game='timed',
    ),
    PowerupItem(
        key='double', name='Double Points', emoji='⭐',
        description='Earn 2× points for the entire round.', cost=10, game='both',
    ),
    PowerupItem(
        key='shrink', name='Featherweight', emoji='🪶',
        description='Shrinks your hitbox so you squeeze through gaps more easily.', cost=5, game='timed',
    ),
]
CATALOG_BY_KEY = {p.key: p for p in CATALOG}


class PurchaseRequest(BaseModel):
    key: str


class ConsumeRequest(BaseModel):
    key: str


class PurchaseResult(BaseModel):
    key: str
    quantity: int
    credibility_score: float
    tier: str


class ConsumeResult(BaseModel):
    key: str
    quantity: int


async def _inventory_map(db: AsyncSession, user_id: int) -> dict[str, int]:
    rows = (
        await db.execute(select(UserPowerup).where(UserPowerup.user_id == user_id))
    ).scalars().all()
    return {r.key: r.quantity for r in rows if r.quantity > 0}


@router.get('/items', response_model=list[PowerupItem])
async def list_items() -> list[PowerupItem]:
    """The power-up catalog (public)."""
    return CATALOG


@router.get('/inventory')
async def get_inventory(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """The signed-in user's owned power-ups → {key: quantity}."""
    return await _inventory_map(db, user.id)


@router.post('/purchase', response_model=PurchaseResult)
async def purchase(
    body: PurchaseRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PurchaseResult:
    item = CATALOG_BY_KEY.get(body.key)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Unknown power-up')

    before = float(user.credibility_score)
    if before < item.cost:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail='Not enough credibility to buy this power-up',
        )

    after = clamp_credibility(before - item.cost)
    user.credibility_score = after
    user.tier = tier_for(after)
    db.add(
        CredibilityLog(
            user_id=user.id,
            delta=round(after - before, 4),
            reason=f'shop:{item.key}',
            new_score=after,
        )
    )

    row = (
        await db.execute(
            select(UserPowerup).where(
                UserPowerup.user_id == user.id, UserPowerup.key == item.key
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = UserPowerup(user_id=user.id, key=item.key, quantity=0)
        db.add(row)
    row.quantity += 1

    await db.commit()
    return PurchaseResult(key=item.key, quantity=row.quantity, credibility_score=after, tier=user.tier)


@router.post('/consume', response_model=ConsumeResult)
async def consume(
    body: ConsumeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConsumeResult:
    """Spend one of a power-up (called when it's activated in a game)."""
    row = (
        await db.execute(
            select(UserPowerup).where(
                UserPowerup.user_id == user.id, UserPowerup.key == body.key
            )
        )
    ).scalar_one_or_none()
    if row is None or row.quantity <= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='You do not own that power-up')
    row.quantity -= 1
    await db.commit()
    return ConsumeResult(key=body.key, quantity=row.quantity)
