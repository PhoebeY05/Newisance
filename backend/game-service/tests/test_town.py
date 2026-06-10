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
