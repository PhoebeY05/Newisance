"""Town presence WebSocket endpoint — see other visitors walking around.

Cosmetic-only multiplayer: it relays positions and is unrelated to Battle
Royale matchmaking. Open to everyone, including guests and signed-out visitors
(an anonymous token-less connection just gets a "Guest-xxxx" name).
"""
from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import town

router = APIRouter(prefix='/town', tags=['town'])


@router.websocket('/ws')
async def town_ws(websocket: WebSocket) -> None:
    token = websocket.query_params.get('token')
    # Stable per-browser id (from the client's localStorage). Falling back to a
    # random one keeps older clients working — they just won't reclaim their slot
    # across reconnects.
    client_id = websocket.query_params.get('cid') or uuid4().hex[:12]
    name = await town.resolve_name(token, client_id)
    # Avatar sent up front so the visitor shows the right body from the first
    # broadcast (move messages keep it current afterwards). Defaults to Timmy.
    avatar = websocket.query_params.get('avatar') or 'timmy'

    await websocket.accept()
    conn_id = uuid4().hex[:12]  # unique to this physical socket
    visitor = town.Visitor(client_id=client_id, conn_id=conn_id, name=name, ws=websocket, avatar=avatar)
    spawn_x, spawn_z = await town.manager.join(visitor)
    await websocket.send_json(
        {'type': 'welcome', 'id': client_id, 'name': name, 'x': spawn_x, 'z': spawn_z}
    )

    try:
        while True:
            data = await websocket.receive_json()
            if isinstance(data, dict) and data.get('type') == 'move':
                try:
                    avatar = data.get('avatar')
                    town.manager.update(
                        client_id,
                        conn_id,
                        float(data.get('x', 0.0)),
                        float(data.get('z', 0.0)),
                        float(data.get('rot', 0.0)),
                        bool(data.get('walking', False)),
                        avatar if isinstance(avatar, str) else None,
                    )
                except (TypeError, ValueError):
                    pass  # ignore malformed position updates
    except WebSocketDisconnect:
        pass
    finally:
        await town.manager.leave(client_id, conn_id)
