"""Town presence — lightweight multiplayer so visitors see each other walking
around Newisance Town.

This is purely cosmetic: positions are relayed in-memory and nothing is
persisted. It is completely independent of Battle Royale — being in the town
together has no bearing on who you are matched with in a battle. Visitors are
split into small lobbies, and a single background ticker fans out position
snapshots to every connected visitor in the same lobby.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import time
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass

from fastapi import WebSocket

logger = logging.getLogger(__name__)

LOBBY_CAPACITY = 5  # max total visitors in a town lobby, including yourself
MAX_VISIBLE = LOBBY_CAPACITY - 1  # everyone else in your lobby
BROADCAST_HZ = 12  # position snapshots sent per second
# Drop a visitor we haven't heard from in this long. Browsers throttle (or kill)
# the socket of a backgrounded tab without always sending a clean close, so
# without this sweep their avatar would linger as a ghost. The client posts its
# pose several times a second, so anything this quiet is gone.
STALE_AFTER = 8.0  # seconds of silence before a visitor is evicted

# Spawn placement. Everyone appears in one small shared spawn area — a tight
# patch of plaza in front of the fountain — so arrivals cluster together rather
# than scattering across the town. They never stack on top of each other: if the
# little zone is already occupied, the search expands outward ring by ring and
# drops the newcomer at the nearest free spot, keeping the group close. The
# building footprints mirror PLACES in `frontend/src/three/town.tsx` (each entry
# is x, z, footprint radius); keep them in sync if the town layout changes.
SPAWN_CENTER = (1.0, 6.0)  # middle of the spawn area (x, z)
SPAWN_RADIUS = 2.4  # the tight cluster radius newcomers normally land within
SPAWN_MAX_EXPAND = 6.0  # how far past SPAWN_RADIUS to spill when the zone is full
CENTER_CLEAR = 3.2  # keep clear of the plaza fountain in the middle
BUILDING_MARGIN = 1.4  # extra breathing room around each building
PLAYER_GAP = 2.0  # minimum distance between two freshly spawned visitors
_BUILDINGS = (
    (-11.5, -3.0, 4.0),
    (-5.0, 3.5, 2.6),
    (-5.5, 10.5, 2.8),
    (-12.0, 6.0, 2.6),
    (-12.0, -10.0, 2.6),
    (10.0, 5.0, 3.2),
    (13.0, -4.5, 3.0),
    (4.0, -13.0, 2.8),
    (-4.5, -12.0, 2.8),
    (4.0, 11.0, 2.6),
)


def _clear_of_world(x: float, z: float) -> bool:
    """True if (x, z) is off the fountain and out of every building footprint."""
    if math.hypot(x, z) < CENTER_CLEAR:
        return False
    return all(math.hypot(bx - x, bz - z) >= br + BUILDING_MARGIN for bx, bz, br in _BUILDINGS)


def pick_spawn(existing: Iterable[Visitor]) -> tuple[float, float]:
    """A free (x, z) in the tight shared spawn area. Newcomers cluster within
    SPAWN_RADIUS; only when that little zone is occupied does the search spill
    outward (ring by ring) to the nearest free spot, so the group stays close
    together and nobody overlaps."""
    others = list(existing)
    cx, cz = SPAWN_CENTER

    def free(x: float, z: float) -> bool:
        return _clear_of_world(x, z) and all(
            math.hypot(v.x - x, v.z - z) >= PLAYER_GAP for v in others
        )

    # Normal case: a few random darts inside the tight cluster disc.
    for _ in range(40):
        angle = random.uniform(0, math.tau)
        r = SPAWN_RADIUS * math.sqrt(random.random())
        x, z = cx + math.cos(angle) * r, cz + math.sin(angle) * r
        if free(x, z):
            return x, z

    # Zone is occupied: grow the radius in small steps and take the nearest free
    # slot on each ring (randomised start angle), so arrivals pack outward from
    # the spawn point instead of jumping somewhere far away.
    rr = SPAWN_RADIUS
    while rr <= SPAWN_RADIUS + SPAWN_MAX_EXPAND:
        steps = max(12, int(math.tau * rr / 0.35))
        start = random.uniform(0, math.tau)
        for k in range(steps):
            angle = start + (k / steps) * math.tau
            x, z = cx + math.cos(angle) * rr, cz + math.sin(angle) * rr
            if free(x, z):
                return x, z
        rr += 0.5

    # Everything within reach is full — accept overlap, but never a wall/fountain.
    for _ in range(80):
        angle = random.uniform(0, math.tau)
        r = (SPAWN_RADIUS + SPAWN_MAX_EXPAND) * math.sqrt(random.random())
        x, z = cx + math.cos(angle) * r, cz + math.sin(angle) * r
        if _clear_of_world(x, z):
            return x, z
    return cx, cz


@dataclass
class Visitor:
    client_id: str  # stable tab/session id — survives reloads in the same tab
    page_id: str  # per-page runtime id — distinguishes duplicated/open tabs
    conn_id: str  # unique per physical socket — guards stale-connection removal
    name: str
    ws: WebSocket
    roster_id: str = ''
    lobby_id: str = ''
    x: float = 0.0
    z: float = 0.0
    rot: float = 0.0
    walking: bool = False
    avatar: str = 'timmy'  # which unlocked avatar they're wearing (cosmetic)
    last_seen: float = 0.0


class TownManager:
    """Holds every connected visitor and broadcasts their positions."""

    def __init__(self) -> None:
        self.visitors: dict[str, Visitor] = {}
        self._lock = asyncio.Lock()
        self._ticker: asyncio.Task | None = None
        self._next_lobby = 1

    def _visitor_key(self, client_id: str, page_id: str) -> str:
        return f'{client_id}:{page_id}'

    def _pick_lobby_id(self) -> str:
        counts = Counter(v.lobby_id for v in self.visitors.values() if v.lobby_id)
        for lobby_id in sorted(counts):
            if counts[lobby_id] < LOBBY_CAPACITY:
                return lobby_id

        lobby_id = f'town-{self._next_lobby}'
        self._next_lobby += 1
        return lobby_id

    async def join(self, visitor: Visitor) -> tuple[float, float]:
        old_ws: WebSocket | None = None
        async with self._lock:
            visitor.last_seen = time.monotonic()
            visitor.roster_id = self._visitor_key(visitor.client_id, visitor.page_id)
            # A reconnect from the same page instance reclaims its existing slot
            # instead of spawning a second avatar. A duplicated/new tab gets a
            # different page_id, so it becomes a distinct visitor and can spill
            # into a new lobby when the current one is full.
            existing = self.visitors.get(visitor.roster_id)
            if existing is not None and existing.conn_id != visitor.conn_id:
                old_ws = existing.ws
                visitor.lobby_id = existing.lobby_id
                visitor.x, visitor.z = existing.x, existing.z
            else:
                visitor.lobby_id = self._pick_lobby_id()
                visitor.x, visitor.z = pick_spawn(
                    v
                    for v in self.visitors.values()
                    if v.lobby_id == visitor.lobby_id and v.roster_id != visitor.roster_id
                )
            self.visitors[visitor.roster_id] = visitor
            if self._ticker is None or self._ticker.done():
                self._ticker = asyncio.create_task(self._broadcast_loop())
        if old_ws is not None:
            try:
                await old_ws.close()
            except Exception:
                pass
        return visitor.x, visitor.z

    async def leave(self, roster_id: str, conn_id: str) -> None:
        async with self._lock:
            # Only drop the slot if it still holds *this* socket — a newer
            # reconnect may already own it (and the old finally must not evict it).
            current = self.visitors.get(roster_id)
            if current is not None and current.conn_id == conn_id:
                self.visitors.pop(roster_id, None)

    def update(
        self,
        roster_id: str,
        conn_id: str,
        x: float,
        z: float,
        rot: float,
        walking: bool,
        avatar: str | None = None,
    ) -> None:
        visitor = self.visitors.get(roster_id)
        if visitor is None or visitor.conn_id != conn_id:
            return
        visitor.x = x
        visitor.z = z
        visitor.rot = rot
        visitor.walking = walking
        if avatar:
            visitor.avatar = avatar
        visitor.last_seen = time.monotonic()

    async def _broadcast_loop(self) -> None:
        interval = 1 / BROADCAST_HZ
        while True:
            await asyncio.sleep(interval)
            now = time.monotonic()
            async with self._lock:
                # Evict anyone who's gone silent (a backgrounded/closed tab whose
                # disconnect never reached us) before fanning out positions.
                stale = [v for v in self.visitors.values() if now - v.last_seen > STALE_AFTER]
                for v in stale:
                    self.visitors.pop(v.client_id, None)
                visitors = list(self.visitors.values())
            for v in stale:
                try:
                    await v.ws.close()
                except Exception:
                    pass
            if not visitors:
                return  # nobody left — let the ticker die; join() restarts it
            for me in visitors:
                others = [
                    v
                    for v in visitors
                    if v.lobby_id == me.lobby_id and v.roster_id != me.roster_id
                ]
                # Show the closest people in the same lobby.
                others.sort(key=lambda v: (v.x - me.x) ** 2 + (v.z - me.z) ** 2)
                payload = {
                    'type': 'players',
                    'lobby_id': me.lobby_id,
                    'players': [
                        {
                            'id': v.roster_id,
                            'name': v.name,
                            'x': round(v.x, 3),
                            'z': round(v.z, 3),
                            'rot': round(v.rot, 3),
                            'walking': v.walking,
                            'avatar': v.avatar,
                        }
                        for v in others[:MAX_VISIBLE]
                    ],
                }
                try:
                    await me.ws.send_json(payload)
                except Exception:
                    pass  # disconnect handler removes dead sockets


manager = TownManager()


async def resolve_name(token: str | None, client_id: str) -> str:
    """Display name for a visitor — their username if signed in, else a guest tag.

    The guest tag is derived from the (stable) client id, so a tab that
    drops and reconnects comes back as the *same* ``Guest-xxxx`` rather than a
    new one each time.
    """
    import battle

    user = await battle.authenticate(token)
    if user is not None:
        return user.username
    return f'Guest-{client_id[:4]}'
