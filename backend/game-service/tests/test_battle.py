import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import battle
from main import app


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_rooms():
    battle.manager.rooms.clear()
    yield
    battle.manager.rooms.clear()


def _read_until(ws, msg_type: str, limit: int = 50) -> dict:
    for _ in range(limit):
        msg = ws.receive_json()
        if msg.get('type') == msg_type:
            return msg
    raise AssertionError(f'did not receive {msg_type} within {limit} messages')


def _auth(token: str) -> dict[str, str]:
    return {'Authorization': f'Bearer {token}'}


def test_join_returns_room_and_ws_url(client: TestClient, user_factory) -> None:
    _, token = user_factory()
    body = client.post('/battle/join', headers=_auth(token)).json()
    assert 'room_id' in body
    assert body['ws_url'] == f"/battle/ws/{body['room_id']}"


def test_join_reuses_waiting_room(client: TestClient, user_factory) -> None:
    _, token_a = user_factory()
    _, token_b = user_factory()
    first = client.post('/battle/join', headers=_auth(token_a)).json()['room_id']
    second = client.post('/battle/join', headers=_auth(token_b)).json()['room_id']
    assert first == second  # both land in the same open waiting room


def test_ws_rejects_missing_token(client: TestClient) -> None:
    room_id = 'missing-token-room'
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f'/battle/ws/{room_id}') as ws:
            ws.receive_json()


def test_join_splits_guest_and_member_waiting_rooms(client: TestClient, user_factory) -> None:
    _, member_token = user_factory(is_guest=False)
    _, guest_token = user_factory(is_guest=True)

    member_room = client.post('/battle/join', headers=_auth(member_token)).json()['room_id']
    guest_room = client.post('/battle/join', headers=_auth(guest_token)).json()['room_id']

    assert member_room != guest_room
    assert battle.manager.rooms[member_room].auth_group == 'member'
    assert battle.manager.rooms[guest_room].auth_group == 'guest'


def test_second_join_broadcasts_countdown(client: TestClient, user_factory, monkeypatch) -> None:
    # Keep the auto-start window wide so the countdown is clearly live and the
    # match doesn't begin before we read the waiting-room state.
    monkeypatch.setattr(battle, 'AUTO_START_SECONDS', 30.0)

    _, token_a = user_factory()
    _, token_b = user_factory()

    room_id = client.post('/battle/join', headers=_auth(token_a)).json()['room_id']
    with client.websocket_connect(f'/battle/ws/{room_id}?token={token_a}') as ws_a, client.websocket_connect(
        f'/battle/ws/{room_id}?token={token_b}'
    ):
        # Once the second player joins, the auto-start timer is scheduled and the
        # waiting room must broadcast a live countdown (regression: previously the
        # state was sent before start_at was set, so starts_in_ms was always null).
        for _ in range(50):
            msg = ws_a.receive_json()
            if msg.get('type') == 'room_state' and msg.get('starts_in_ms') is not None:
                assert msg['status'] == 'waiting'
                assert msg['starts_in_ms'] > 0
                break
        else:
            raise AssertionError('never received a waiting room_state with starts_in_ms')


def test_two_player_match_eliminates_and_ends(client: TestClient, question_factory, user_factory, monkeypatch) -> None:
    # Shrink the timers so the game starts quickly and the question stays open
    # long enough for both players to answer.
    monkeypatch.setattr(battle, 'AUTO_START_SECONDS', 0.4)
    monkeypatch.setattr(battle, 'QUESTION_SECONDS', 5.0)

    # Guarantee at least one answerable question exists.
    question_factory(content='Battle Q', correct_answer='Fake', difficulty='easy')

    _, token_a = user_factory()
    _, token_b = user_factory()

    room_id = client.post('/battle/join', headers=_auth(token_a)).json()['room_id']
    with client.websocket_connect(f'/battle/ws/{room_id}?token={token_a}') as ws_a, client.websocket_connect(
        f'/battle/ws/{room_id}?token={token_b}'
    ) as ws_b:
        question = _read_until(ws_a, 'new_question')
        qid = question['question']['id']

        # Opposite answers → exactly one is wrong → eliminated → last one standing.
        ws_a.send_json({'type': 'submit_answer', 'question_id': qid, 'answer': 'Real'})
        ws_b.send_json({'type': 'submit_answer', 'question_id': qid, 'answer': 'Fake'})

        over = _read_until(ws_a, 'game_over')
        standings = over['standings']
        assert len(standings) == 2
        # Battle royale: exactly one survivor, ranked first.
        assert sum(1 for s in standings if s['alive']) == 1
        assert standings[0]['rank'] == 1


def test_correct_answer_broadcasts_answer_correct_event(
    client: TestClient, question_factory, user_factory, monkeypatch
) -> None:
    monkeypatch.setattr(battle, 'AUTO_START_SECONDS', 0.4)
    monkeypatch.setattr(battle, 'QUESTION_SECONDS', 5.0)

    question_factory(content='Battle Q', correct_answer='Fake', difficulty='easy')

    _, token_a = user_factory()
    _, token_b = user_factory()

    room_id = client.post('/battle/join', headers=_auth(token_a)).json()['room_id']
    with client.websocket_connect(f'/battle/ws/{room_id}?token={token_a}') as ws_a, client.websocket_connect(
        f'/battle/ws/{room_id}?token={token_b}'
    ) as ws_b:
        question = _read_until(ws_a, 'new_question')
        qid = question['question']['id']

        ws_a.send_json({'type': 'submit_answer', 'question_id': qid, 'answer': 'Fake'})

        announced_a = _read_until(ws_a, 'answer_correct')
        announced_b = _read_until(ws_b, 'answer_correct')

        assert announced_a['username'] == announced_b['username']
        assert announced_a['username']
        assert announced_a['points_earned'] > 0
        assert announced_a['score'] > 0
