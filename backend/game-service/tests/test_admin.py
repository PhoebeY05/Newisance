"""Integration tests for the Phase 9 admin question pipeline."""
import asyncio
import base64
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from main import app
from conftest import TestSessionLocal
from shared.db.models import Question


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def _auth(token: str) -> dict:
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture()
def cleanup_questions():
    """Delete any questions created through the API during a test."""
    ids: set[int] = set()
    yield ids
    if ids:
        async def _cleanup() -> None:
            async with TestSessionLocal() as session:
                await session.execute(delete(Question).where(Question.id.in_(ids)))
                await session.commit()
        asyncio.run(_cleanup())


# 1x1 transparent PNG.
_PNG = base64.b64encode(
    bytes.fromhex(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4'
        '890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082'
    )
).decode()


def test_non_admin_gets_403(client: TestClient, user_factory) -> None:
    _, token = user_factory(is_admin=False)
    assert client.get('/admin/questions', headers=_auth(token)).status_code == 403
    # No token at all → 401.
    assert client.get('/admin/questions').status_code == 401


def test_admin_create_lists_and_random_includes_it(
    client: TestClient, user_factory, cleanup_questions
) -> None:
    _, token = user_factory(is_admin=True)
    created = client.post(
        '/admin/questions',
        json={
            'content': 'Admin-made: shark on the expressway photo',
            'type': 'manipulated_media',
            'correct_answer': 'Fake',
            'explanation': 'Recycled hoax image.',
            'difficulty': 'easy',
            'tags': ['image', 'weather'],
            'media': _PNG,
        },
        headers=_auth(token),
    )
    assert created.status_code == 201
    body = created.json()
    cleanup_questions.add(body['id'])
    assert body['correct_answer'] == 'Fake'  # admin shape includes the answer
    assert body['media_url'].startswith('media_uploads/') and body['media_url'].endswith('.png')
    assert body['tags'] == ['image', 'weather']
    assert body['is_active'] is True

    # It shows in the admin list…
    listed = client.get('/admin/questions', headers=_auth(token)).json()
    assert body['id'] in [q['id'] for q in listed['items']]

    # …and is immediately servable to players (acceptance criterion).
    served = client.get('/questions/random', params={'count': 50}).json()
    match = next((q for q in served if q['id'] == body['id']), None)
    assert match is not None
    assert 'correct_answer' not in match  # public shape never leaks the answer


def test_update_and_soft_delete(client: TestClient, user_factory, cleanup_questions) -> None:
    _, token = user_factory(is_admin=True)
    qid = client.post(
        '/admin/questions',
        json={'content': 'Editable question', 'type': 'satire', 'correct_answer': 'Satire'},
        headers=_auth(token),
    ).json()['id']
    cleanup_questions.add(qid)

    patched = client.put(
        f'/admin/questions/{qid}',
        json={'difficulty': 'hard', 'explanation': 'Clearly comedic.'},
        headers=_auth(token),
    )
    assert patched.status_code == 200
    assert patched.json()['difficulty'] == 'hard'
    assert patched.json()['explanation'] == 'Clearly comedic.'

    # Soft delete deactivates rather than removing.
    assert client.delete(f'/admin/questions/{qid}', headers=_auth(token)).status_code == 204
    served = client.get('/questions/random', params={'count': 50}).json()
    assert qid not in [q['id'] for q in served]  # inactive → not served
    # Still visible to admins (default include_inactive).
    listed = client.get('/admin/questions', headers=_auth(token)).json()
    row = next(q for q in listed['items'] if q['id'] == qid)
    assert row['is_active'] is False


def test_filters(client: TestClient, user_factory, cleanup_questions) -> None:
    _, token = user_factory(is_admin=True)
    a = client.post(
        '/admin/questions',
        json={'content': 'Filter target unique-phrase-zzz', 'type': 'deepfake',
              'correct_answer': 'Fake', 'difficulty': 'hard'},
        headers=_auth(token),
    ).json()
    cleanup_questions.add(a['id'])

    res = client.get(
        '/admin/questions',
        params={'type': 'deepfake', 'difficulty': 'hard', 'search': 'unique-phrase-zzz'},
        headers=_auth(token),
    ).json()
    assert [q['id'] for q in res['items']] == [a['id']]


def test_generate_explanation_returns_text(client: TestClient, user_factory) -> None:
    _, token = user_factory(is_admin=True)
    res = client.post(
        '/admin/questions/generate-explanation',
        json={
            'content': 'URGENT! Click bit.ly/win to claim your free $5000 prize now!',
            'correct_answer': 'Fake',
        },
        headers=_auth(token),
    )
    assert res.status_code == 200
    explanation = res.json()['explanation']
    # Worker may be absent in tests → heuristic fallback still yields real text.
    assert isinstance(explanation, str) and len(explanation) > 20


def test_bulk_import_imports_valid_rows_and_reports_errors(
    client: TestClient, user_factory, cleanup_questions
) -> None:
    _, token = user_factory(is_admin=True)
    csv_text = (
        'content,type,correct_answer,explanation,difficulty,tags\n'
        'Valid scam message about a prize,scam_message,Scam,Pressure + prize,easy,scam;prize\n'
        'Bad row with unknown type,not_a_type,Fake,,easy,\n'
        'Another valid satire piece,satire,Satire,,medium,humour\n'
    )
    files = {'file': ('questions.csv', io.BytesIO(csv_text.encode()), 'text/csv')}
    res = client.post('/admin/questions/bulk-import', files=files, headers=_auth(token))
    assert res.status_code == 200
    body = res.json()
    assert body['imported'] == 2  # the two valid rows
    assert len(body['errors']) == 1
    assert body['errors'][0]['row'] == 2  # the bad row (1-based over data rows)
    assert 'type' in body['errors'][0]['reason']

    # Track the imported rows for cleanup.
    listed = client.get(
        '/admin/questions', params={'search': 'Valid scam message about a prize'},
        headers=_auth(token),
    ).json()
    for q in listed['items']:
        cleanup_questions.add(q['id'])
    listed2 = client.get(
        '/admin/questions', params={'search': 'Another valid satire piece'},
        headers=_auth(token),
    ).json()
    for q in listed2['items']:
        cleanup_questions.add(q['id'])
