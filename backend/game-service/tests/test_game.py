import pytest
from fastapi.testclient import TestClient

from main import app
from scoring import is_answer_correct, points_for_answer, updated_credibility


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


# ---- pure scoring logic -------------------------------------------------

def test_points_formula_correct_and_fast() -> None:
    # medium (1.5x) → base 150; instant answer (0ms) → full speed bonus → ×2
    assert points_for_answer('medium', 0, True) == 300.0
    # hard (2x) → base 200; at the 8s ceiling speed bonus is 0 → ×1
    assert points_for_answer('hard', 8000, True) == 200.0
    # wrong answers earn nothing regardless of speed/difficulty
    assert points_for_answer('hard', 0, False) == 0.0


def test_verdict_normalization() -> None:
    assert is_answer_correct('Fake', 'Scam') is True
    assert is_answer_correct('real', 'Real') is True
    assert is_answer_correct('Real', 'Satire') is False


def test_credibility_formula() -> None:
    assert updated_credibility(50.0, 1.0) == 55.0
    assert updated_credibility(0.0, 0.0) == 0.0


# ---- endpoints ----------------------------------------------------------

def test_random_questions_excludes_answer(client: TestClient, question_factory) -> None:
    question_factory(content='Q1', correct_answer='Fake')
    question_factory(content='Q2', correct_answer='Real')

    response = client.get('/questions/random?count=2')
    assert response.status_code == 200
    body = response.json()
    assert 1 <= len(body) <= 2
    for item in body:
        assert 'correct_answer' not in item
        assert 'content' in item


def test_full_session_flow_without_auth(client: TestClient, question_factory) -> None:
    fake_q = question_factory(content='Fake headline', correct_answer='Fake', difficulty='easy')
    real_q = question_factory(content='Real headline', correct_answer='Real', difficulty='easy')

    session_id = client.post('/sessions', json={'mode': 'timed'}).json()['id']

    correct = client.post(
        f'/sessions/{session_id}/answer',
        json={'question_id': fake_q, 'chosen_answer': 'Fake', 'response_ms': 0},
    ).json()
    assert correct['is_correct'] is True
    assert correct['points_earned'] == 200.0  # easy ×100 × (1 + full speed bonus)
    assert correct['explanation']

    wrong = client.post(
        f'/sessions/{session_id}/answer',
        json={'question_id': real_q, 'chosen_answer': 'Fake', 'response_ms': 4000},
    ).json()
    assert wrong['is_correct'] is False
    assert wrong['points_earned'] == 0.0

    summary = client.post(f'/sessions/{session_id}/end').json()
    assert summary['score'] == 200.0
    assert summary['total_answers'] == 2
    assert summary['correct_answers'] == 1
    assert summary['accuracy'] == 0.5
    # no authenticated user → no credibility change
    assert summary['credibility_after'] is None


def test_session_end_updates_credibility(client: TestClient, question_factory, user_factory) -> None:
    user_id, token = user_factory(credibility_score=50.0)
    headers = {'Authorization': f'Bearer {token}'}
    q = question_factory(content='Scam SMS', correct_answer='Fake', difficulty='easy')

    session_id = client.post('/sessions', json={'mode': 'timed'}, headers=headers).json()['id']
    client.post(
        f'/sessions/{session_id}/answer',
        json={'question_id': q, 'chosen_answer': 'Fake', 'response_ms': 1000},
    )

    summary = client.post(f'/sessions/{session_id}/end').json()
    # 100% accuracy → 50 × 0.9 + 1.0 × 10 = 55
    assert summary['credibility_before'] == 50.0
    assert summary['credibility_after'] == 55.0
    assert summary['credibility_delta'] == 5.0


def test_get_session_replay(client: TestClient, question_factory) -> None:
    q = question_factory(content='Replay me', correct_answer='Fake')
    session_id = client.post('/sessions', json={'mode': 'timed'}).json()['id']
    client.post(
        f'/sessions/{session_id}/answer',
        json={'question_id': q, 'chosen_answer': 'Real', 'response_ms': 500},
    )

    detail = client.get(f'/sessions/{session_id}').json()
    assert detail['id'] == session_id
    assert len(detail['answers']) == 1
    assert detail['answers'][0]['question_id'] == q
    assert detail['answers'][0]['is_correct'] is False


def test_answer_after_end_is_rejected(client: TestClient, question_factory) -> None:
    q = question_factory(content='Closed session', correct_answer='Fake')
    session_id = client.post('/sessions', json={'mode': 'timed'}).json()['id']
    client.post(f'/sessions/{session_id}/end')

    rejected = client.post(
        f'/sessions/{session_id}/answer',
        json={'question_id': q, 'chosen_answer': 'Fake', 'response_ms': 100},
    )
    assert rejected.status_code == 409
