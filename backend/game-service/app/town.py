"""Town presence — lightweight multiplayer so visitors see each other walking
around Newisance Town.

This is purely cosmetic: positions are relayed in-memory and nothing is
persisted. It is completely independent of Battle Royale — being in the town
together has no bearing on who you are matched with in a battle. A single
background ticker fans out position snapshots to every connected visitor, and
each visitor only ever sees the ``MAX_VISIBLE`` nearest others.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
from collections.abc import Iterable
from dataclasses import dataclass
from uuid import uuid4

from fastapi import WebSocket

import battle

logger = logging.getLogger(__name__)

MAX_VISIBLE = 10  # avatars any single visitor sees at once
BROADCAST_HZ = 12  # position snapshots sent per second

# Spawn placement. Visitors appear at a random patch of empty ground so they
# don't stack on top of each other. The building footprints mirror PLACES in
# `frontend/src/three/town.tsx` (each entry is x, z, footprint radius); keep
# them in sync if the town layout changes.
SPAWN_BOUND = 18.0  # how far from centre a spawn may land
CENTER_CLEAR = 3.2  # keep clear of the plaza fountain in the middle
BUILDING_MARGIN = 1.4  # extra breathing room around each building
PLAYER_GAP = 2.2  # minimum distance between two freshly spawned visitors
_BUILDINGS = (
    (-11.5, -3.0, 4.0),
    (-5.0, 3.5, 2.6),
    (-5.5, 10.5, 2.8),
    (-12.0, 6.0, 2.6),
    (10.0, 5.0, 3.2),
    (13.0, -4.5, 3.0),
    (4.0, -13.0, 2.8),
    (-4.5, -12.0, 2.8),
    (4.0, 11.0, 2.6),
)


def pick_spawn(existing: Iterable[Visitor]) -> tuple[float, float]:
    """A random empty (x, z) clear of the centre, buildings and other visitors."""
    others = list(existing)
    for _ in range(60):
        x = random.uniform(-SPAWN_BOUND, SPAWN_BOUND)
        z = random.uniform(-SPAWN_BOUND, SPAWN_BOUND)
        if math.hypot(x, z) < CENTER_CLEAR:
            continue
        if any(math.hypot(bx - x, bz - z) < br + BUILDING_MARGIN for bx, bz, br in _BUILDINGS):
            continue
        if any(math.hypot(v.x - x, v.z - z) < PLAYER_GAP for v in others):
            continue
        return x, z
    # Fallback: ring placement keyed off the crowd size, so a packed town still
    # spreads people out instead of overlapping.
    angle = random.uniform(0, math.tau)
    radius = min(SPAWN_BOUND, 6.0 + len(others) * 0.6)
    return math.cos(angle) * radius, math.sin(angle) * radius


@dataclass
class Visitor:
    conn_id: str
    name: str
    ws: WebSocket
    x: float = 0.0
    z: float = 0.0
    rot: float = 0.0
    walking: bool = False


class TownManager:
    """Holds every connected visitor and broadcasts their positions."""

    def __init__(self) -> None:
        self.visitors: dict[str, Visitor] = {}
        self._lock = asyncio.Lock()
        self._ticker: asyncio.Task | None = None

    async def join(self, visitor: Visitor) -> tuple[float, float]:
        async with self._lock:
            visitor.x, visitor.z = pick_spawn(self.visitors.values())
            self.visitors[visitor.conn_id] = visitor
            if self._ticker is None or self._ticker.done():
                self._ticker = asyncio.create_task(self._broadcast_loop())
            return visitor.x, visitor.z

    async def leave(self, conn_id: str) -> None:
        async with self._lock:
            self.visitors.pop(conn_id, None)

    def update(self, conn_id: str, x: float, z: float, rot: float, walking: bool) -> None:
        visitor = self.visitors.get(conn_id)
        if visitor is None:
            return
        visitor.x = x
        visitor.z = z
        visitor.rot = rot
        visitor.walking = walking

    async def _broadcast_loop(self) -> None:
        interval = 1 / BROADCAST_HZ
        while True:
            await asyncio.sleep(interval)
            async with self._lock:
                visitors = list(self.visitors.values())
            if not visitors:
                return  # nobody left — let the ticker die; join() restarts it
            for me in visitors:
                others = [v for v in visitors if v.conn_id != me.conn_id]
                # Show the closest people first, capped to MAX_VISIBLE.
                others.sort(key=lambda v: (v.x - me.x) ** 2 + (v.z - me.z) ** 2)
                payload = {
                    'type': 'players',
                    'players': [
                        {
                            'id': v.conn_id,
                            'name': v.name,
                            'x': round(v.x, 3),
                            'z': round(v.z, 3),
                            'rot': round(v.rot, 3),
                            'walking': v.walking,
                        }
                        for v in others[:MAX_VISIBLE]
                    ],
                }
                try:
                    await me.ws.send_json(payload)
                except Exception:
                    pass  # disconnect handler removes dead sockets


manager = TownManager()


async def resolve_name(token: str | None) -> str:
    """Display name for a visitor — their username if signed in, else a guest tag."""
    user = await battle.authenticate(token)
    if user is not None:
        return user.username
    return f'Guest-{uuid4().hex[:4]}'
