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
    name = await town.resolve_name(token)

    await websocket.accept()
    conn_id = uuid4().hex[:12]
    visitor = town.Visitor(conn_id=conn_id, name=name, ws=websocket)
    spawn_x, spawn_z = await town.manager.join(visitor)
    await websocket.send_json(
        {'type': 'welcome', 'id': conn_id, 'name': name, 'x': spawn_x, 'z': spawn_z}
    )

    try:
        while True:
            data = await websocket.receive_json()
            if isinstance(data, dict) and data.get('type') == 'move':
                try:
                    town.manager.update(
                        conn_id,
                        float(data.get('x', 0.0)),
                        float(data.get('z', 0.0)),
                        float(data.get('rot', 0.0)),
                        bool(data.get('walking', False)),
                    )
                except (TypeError, ValueError):
                    pass  # ignore malformed position updates
    except WebSocketDisconnect:
        pass
    finally:
        await town.manager.leave(conn_id)
