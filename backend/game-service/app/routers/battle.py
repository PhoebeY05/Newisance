"""Battle Royale HTTP matchmaking + WebSocket endpoint (Phase 4)."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect, status

import battle

router = APIRouter(prefix='/battle', tags=['battle'])


@router.post('/join')
async def join(authorization: str | None = Header(None)) -> dict[str, str]:
    """Find an open waiting room (or create one) and return how to connect."""
    token = None
    if authorization and authorization.lower().startswith('bearer '):
        token = authorization.split(' ', 1)[1]
    user = await battle.authenticate(token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Authentication required')
    auth_group = 'guest' if user.is_guest else 'member'
    room = await battle.manager.find_or_create_room(auth_group)
    return {'room_id': room.room_id, 'ws_url': f'/battle/ws/{room.room_id}'}


@router.websocket('/ws/{room_id}')
async def battle_ws(websocket: WebSocket, room_id: str) -> None:
    token = websocket.query_params.get('token')
    user = await battle.authenticate(token)
    if user is None:
        await websocket.close(code=4401)
        return

    auth_group = 'guest' if user.is_guest else 'member'
    room = await battle.manager.get_or_create(room_id, auth_group)
    if room.auth_group != auth_group:
        await websocket.close(code=4403)
        return
    await websocket.accept()
    await battle.connect(room, user.id, user.username, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if isinstance(data, dict) and data.get('type') == 'submit_answer':
                await battle.handle_answer(
                    room,
                    user.id,
                    data.get('question_id'),
                    str(data.get('answer', '')),
                )
            elif isinstance(data, dict) and data.get('type') == 'use_powerup':
                await battle.handle_powerup(room, user.id, str(data.get('key', '')))
    except WebSocketDisconnect:
        pass
    finally:
        await battle.disconnect(room, user.id)
