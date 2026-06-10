import asyncio
from contextlib import suppress

import town


class DummyWebSocket:
    def __init__(self) -> None:
        self.closed = False
        self.messages: list[dict] = []

    async def close(self) -> None:
        self.closed = True

    async def send_json(self, payload: dict) -> None:
        self.messages.append(payload)


async def _stop_ticker(manager: town.TownManager) -> None:
    if manager._ticker is None:
        return
    manager._ticker.cancel()
    with suppress(asyncio.CancelledError):
        await manager._ticker


def test_town_sixth_visitor_gets_new_lobby() -> None:
    async def run() -> None:
        manager = town.TownManager()
        visitors = [
            town.Visitor(
                client_id=f'client-{index}',
                page_id=f'page-{index}',
                conn_id=f'conn-{index}',
                name=f'Guest-{index}',
                ws=DummyWebSocket(),  # type: ignore[arg-type]
            )
            for index in range(6)
        ]

        for visitor in visitors:
            await manager.join(visitor)

        lobby_ids = [visitor.lobby_id for visitor in visitors]
        assert len(set(lobby_ids[:5])) == 1
        assert lobby_ids[5] != lobby_ids[0]
        assert sum(1 for visitor in manager.visitors.values() if visitor.lobby_id == lobby_ids[0]) == 5
        assert sum(1 for visitor in manager.visitors.values() if visitor.lobby_id == lobby_ids[5]) == 1

        await _stop_ticker(manager)

    asyncio.run(run())


def test_town_reconnect_keeps_same_character_even_when_lobby_is_full() -> None:
    async def run() -> None:
        manager = town.TownManager()
        visitors = [
            town.Visitor(
                client_id=f'client-{index}',
                page_id=f'page-{index}',
                conn_id=f'conn-{index}',
                name=f'Guest-{index}',
                ws=DummyWebSocket(),  # type: ignore[arg-type]
            )
            for index in range(5)
        ]
        for visitor in visitors:
            await manager.join(visitor)

        old_socket = visitors[0].ws
        reconnect = town.Visitor(
            client_id='client-0',
            page_id='page-0',
            conn_id='conn-new',
            name='Guest-0',
            ws=DummyWebSocket(),  # type: ignore[arg-type]
        )
        await manager.join(reconnect)

        assert reconnect.lobby_id == visitors[0].lobby_id
        assert len(set(v.lobby_id for v in manager.visitors.values())) == 1
        assert len(manager.visitors) == 5
        assert old_socket.closed is True

        await _stop_ticker(manager)

    asyncio.run(run())


def test_town_same_client_id_replaces_character_not_lobby_slot() -> None:
    async def run() -> None:
        manager = town.TownManager()
        first = town.Visitor(
            client_id='same-tab',
            page_id='same-page',
            conn_id='conn-a',
            name='Guest-a',
            ws=DummyWebSocket(),  # type: ignore[arg-type]
        )
        second = town.Visitor(
            client_id='same-tab',
            page_id='same-page',
            conn_id='conn-b',
            name='Guest-b',
            ws=DummyWebSocket(),  # type: ignore[arg-type]
        )

        await manager.join(first)
        await manager.join(second)

        assert len(manager.visitors) == 1
        assert second.lobby_id == first.lobby_id
        assert first.ws.closed is True

        await _stop_ticker(manager)

    asyncio.run(run())


def test_town_chat_reaches_lobby_excluding_sender_and_other_lobbies() -> None:
    async def run() -> None:
        manager = town.TownManager()
        # Six visitors: the first five share a lobby, the sixth spills into a new one.
        visitors = [
            town.Visitor(
                client_id=f'client-{index}',
                page_id=f'page-{index}',
                conn_id=f'conn-{index}',
                name=f'Guest-{index}',
                ws=DummyWebSocket(),  # type: ignore[arg-type]
            )
            for index in range(6)
        ]
        for visitor in visitors:
            await manager.join(visitor)

        # Stop the position ticker so it doesn't interleave 'players' messages.
        await _stop_ticker(manager)

        def chats(v: town.Visitor) -> list[dict]:
            msgs = [m for m in v.ws.messages if m.get('type') == 'chat']  # type: ignore[attr-defined]
            return [{k: val for k, val in m.items() if k != 'ts'} for m in msgs]

        sender = visitors[0]
        await manager.broadcast_chat(sender.roster_id, sender.conn_id, '  hello town  ')

        expected = {'type': 'chat', 'id': sender.roster_id, 'name': 'Guest-0', 'text': 'hello town'}
        # Everyone else in the sender's lobby gets it (trimmed); the sender and the
        # visitor in the other lobby do not.
        assert chats(sender) == []
        for peer in visitors[1:5]:
            assert chats(peer) == [expected]
        assert chats(visitors[5]) == []

        # Blank messages and unknown/stale sockets are dropped — no new lines.
        await manager.broadcast_chat(sender.roster_id, sender.conn_id, '   ')
        await manager.broadcast_chat(sender.roster_id, 'stale-conn', 'nope')
        assert chats(visitors[1]) == [expected]

        # A 1-to-1 whisper reaches only the named target (carrying `to`), not the
        # rest of the lobby; a cross-lobby target is dropped entirely.
        await manager.broadcast_chat(sender.roster_id, sender.conn_id, 'psst', to=visitors[2].roster_id)
        whisper = {**expected, 'text': 'psst', 'to': visitors[2].roster_id}
        assert chats(visitors[2]) == [expected, whisper]
        assert chats(visitors[1]) == [expected]  # unchanged — not the target
        await manager.broadcast_chat(sender.roster_id, sender.conn_id, 'hi', to=visitors[5].roster_id)
        assert chats(visitors[5]) == []  # different lobby — dropped

    asyncio.run(run())


def test_town_duplicate_tab_with_same_client_id_can_enter_new_lobby() -> None:
    async def run() -> None:
        manager = town.TownManager()
        visitors = [
            town.Visitor(
                client_id='copied-session-id',
                page_id=f'page-{index}',
                conn_id=f'conn-{index}',
                name=f'Guest-{index}',
                ws=DummyWebSocket(),  # type: ignore[arg-type]
            )
            for index in range(6)
        ]

        for visitor in visitors:
            await manager.join(visitor)

        first_lobby = visitors[0].lobby_id
        second_lobby = visitors[5].lobby_id
        assert first_lobby != second_lobby
        assert sum(1 for visitor in manager.visitors.values() if visitor.lobby_id == first_lobby) == 5
        assert sum(1 for visitor in manager.visitors.values() if visitor.lobby_id == second_lobby) == 1
        assert len(manager.visitors) == 6

        await _stop_ticker(manager)

    asyncio.run(run())
