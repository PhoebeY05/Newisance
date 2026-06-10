import uuid

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def test_register_login_and_me(client: TestClient) -> None:
    suffix = uuid.uuid4().hex[:8]
    payload = {
        'username': f'user_{suffix}',
        'email': f'user_{suffix}@example.com',
        'password': 'password123',
    }

    register_response = client.post('/auth/register', json=payload)
    assert register_response.status_code == 200

    register_body = register_response.json()
    assert register_body['token_type'] == 'bearer'
    assert register_body['user']['username'] == payload['username']
    assert register_body['user']['is_guest'] is False

    login_response = client.post(
        '/auth/login',
        json={'email': payload['email'], 'password': payload['password']},
    )
    assert login_response.status_code == 200

    login_body = login_response.json()
    assert login_body['user']['email'] == payload['email']
    assert isinstance(login_body['access_token'], str)
    assert len(login_body['access_token']) > 20

    profile_response = client.get(
        '/users/me',
        headers={'Authorization': f"Bearer {register_body['access_token']}"},
    )
    assert profile_response.status_code == 200
    assert profile_response.json()['username'] == payload['username']


def test_guest_login_and_me(client: TestClient) -> None:
    guest_response = client.post('/auth/guest')
    assert guest_response.status_code == 200

    guest_body = guest_response.json()
    assert guest_body['user']['is_guest'] is True
    assert guest_body['user']['credibility_score'] == 0.0

    profile_response = client.get(
        '/users/me',
        headers={'Authorization': f"Bearer {guest_body['access_token']}"},
    )
    assert profile_response.status_code == 200
    assert profile_response.json()['is_guest'] is True


def test_update_account_details_and_password(client: TestClient) -> None:
    suffix = uuid.uuid4().hex[:8]
    payload = {
        'username': f'user_{suffix}',
        'email': f'user_{suffix}@example.com',
        'password': 'password123',
    }
    token = client.post('/auth/register', json=payload).json()['access_token']

    update_response = client.patch(
        '/users/me',
        headers={'Authorization': f'Bearer {token}'},
        json={
            'username': f'updated_{suffix}',
            'email': f'updated_{suffix}@example.com',
            'current_password': 'password123',
            'new_password': 'newpassword123',
        },
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated['username'] == f'updated_{suffix}'
    assert updated['email'] == f'updated_{suffix}@example.com'

    old_login = client.post(
        '/auth/login',
        json={'email': f'updated_{suffix}@example.com', 'password': 'password123'},
    )
    assert old_login.status_code == 401

    new_login = client.post(
        '/auth/login',
        json={'email': f'updated_{suffix}@example.com', 'password': 'newpassword123'},
    )
    assert new_login.status_code == 200


def test_update_account_rejects_duplicate_email_and_wrong_password(client: TestClient) -> None:
    suffix = uuid.uuid4().hex[:8]
    first = {
        'username': f'first_{suffix}',
        'email': f'first_{suffix}@example.com',
        'password': 'password123',
    }
    second = {
        'username': f'second_{suffix}',
        'email': f'second_{suffix}@example.com',
        'password': 'password123',
    }
    client.post('/auth/register', json=first)
    token = client.post('/auth/register', json=second).json()['access_token']

    duplicate = client.patch(
        '/users/me',
        headers={'Authorization': f'Bearer {token}'},
        json={'email': first['email']},
    )
    assert duplicate.status_code == 400
    assert duplicate.json()['detail'] == 'Email already registered'

    wrong_password = client.patch(
        '/users/me',
        headers={'Authorization': f'Bearer {token}'},
        json={'current_password': 'wrong-password', 'new_password': 'newpassword123'},
    )
    assert wrong_password.status_code == 400
    assert wrong_password.json()['detail'] == 'Current password is incorrect'
