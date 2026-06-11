"""Integration tests for the Phase 5 Community Verification Hub."""
import asyncio
import base64
from datetime import datetime, timezone
import uuid

import pytest
from fastapi.testclient import TestClient

from main import app
from shared.db.models import AiAnalysis, User
from conftest import TestSessionLocal


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def _register(client: TestClient, cleanup) -> tuple[str, int]:
    suffix = uuid.uuid4().hex[:8]
    response = client.post(
        '/auth/register',
        json={
            'username': f'user_{suffix}',
            'email': f'user_{suffix}@example.com',
            'password': 'password123',
        },
    )
    assert response.status_code == 200
    body = response.json()
    cleanup['users'].add(body['user']['id'])
    return body['access_token'], body['user']['id']


def _guest(client: TestClient, cleanup) -> tuple[str, int]:
    response = client.post('/auth/guest')
    assert response.status_code == 200
    body = response.json()
    cleanup['users'].add(body['user']['id'])
    return body['access_token'], body['user']['id']


def _auth(token: str) -> dict:
    return {'Authorization': f'Bearer {token}'}


def _make_admin(user_id: int) -> None:
    async def _apply() -> None:
        async with TestSessionLocal() as session:
            user = await session.get(User, user_id)
            assert user is not None
            user.is_admin = True
            await session.commit()

    asyncio.run(_apply())


def _add_analysis(submission_id: int, verdict: str = 'likely_fake') -> None:
    async def _apply() -> None:
        async with TestSessionLocal() as session:
            session.add(
                AiAnalysis(
                    submission_id=submission_id,
                    confidence=0.82,
                    verdict=verdict,
                    signals=['Urgent language'],
                    explanation='This looks suspicious.',
                    processed_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()

    asyncio.run(_apply())


def test_submit_text_appears_in_feed(client: TestClient, cleanup) -> None:
    token, _ = _register(client, cleanup)

    response = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Free money click here', 'caption': 'Suspicious DM'},
        headers=_auth(token),
    )
    assert response.status_code == 201
    submission = response.json()
    cleanup['submissions'].add(submission['id'])
    assert submission['status'] == 'pending'
    assert submission['content_url'] == 'Free money click here'
    assert submission['fake_likelihood'] is None
    assert submission['vote_count'] == 0

    feed = client.get('/submissions', params={'page': 1, 'page_size': 50})
    assert feed.status_code == 200
    ids = [item['id'] for item in feed.json()['items']]
    assert submission['id'] in ids


def test_image_submission_persists_media(client: TestClient, cleanup) -> None:
    token, _ = _register(client, cleanup)
    # 1x1 transparent PNG.
    png = base64.b64encode(
        bytes.fromhex(
            '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4'
            '890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082'
        )
    ).decode()

    response = client.post(
        '/submissions',
        json={'content_type': 'image', 'content': png},
        headers=_auth(token),
    )
    assert response.status_code == 201
    submission = response.json()
    cleanup['submissions'].add(submission['id'])
    assert submission['content_url'].startswith('media_uploads/')
    assert submission['content_url'].endswith('.png')


def test_detail_has_null_ai_and_your_vote(client: TestClient, cleanup) -> None:
    token, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'url', 'content': 'http://scam.example/win'},
        headers=_auth(token),
    ).json()
    cleanup['submissions'].add(created['id'])

    detail = client.get(f"/submissions/{created['id']}", headers=_auth(token))
    assert detail.status_code == 200
    body = detail.json()
    assert body['ai_analysis'] is None
    assert body['final_score'] is None
    assert body['your_vote'] is None


def test_ai_analysis_hidden_until_vote_but_visible_to_admin(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Urgent prize claim'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])
    _add_analysis(created['id'])

    viewer, _ = _register(client, cleanup)
    regular_detail = client.get(f"/submissions/{created['id']}", headers=_auth(viewer)).json()
    assert regular_detail['ai_analysis'] is None
    assert regular_detail['ai_verdict'] is None

    admin_token, admin_id = _register(client, cleanup)
    _make_admin(admin_id)
    admin_detail = client.get(f"/submissions/{created['id']}", headers=_auth(admin_token)).json()
    assert admin_detail['ai_analysis']['verdict'] == 'likely_fake'
    assert admin_detail['ai_verdict'] == 'likely_fake'

    feed = client.get('/submissions', params={'page': 1, 'page_size': 50}, headers=_auth(admin_token)).json()
    admin_item = next(item for item in feed['items'] if item['id'] == created['id'])
    assert admin_item['ai_verdict'] == 'likely_fake'


def test_admin_cannot_cast_community_vote(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Moderate me'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    admin_token, admin_id = _register(client, cleanup)
    _make_admin(admin_id)
    response = client.post(
        f"/submissions/{created['id']}/vote",
        json={'verdict': 'fake', 'impact_score': 4},
        headers=_auth(admin_token),
    )
    assert response.status_code == 403
    assert response.json()['detail'] == 'Admins review submissions instead of casting community votes'


def test_guest_vote_weight_is_fixed(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Vote on me'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    guest_token, _ = _guest(client, cleanup)
    response = client.post(
        f"/submissions/{created['id']}/vote",
        json={'verdict': 'fake', 'impact_score': 4},
        headers=_auth(guest_token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body['your_vote_weight'] == 0.1
    assert body['vote_count'] == 1
    assert body['fake_likelihood'] == 1.0


def test_weighted_fake_likelihood(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)  # credibility 50 → weight 0.5
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Mixed verdicts'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    # author votes fake (weight 0.5); guest votes real (weight 0.1).
    client.post(
        f"/submissions/{created['id']}/vote",
        json={'verdict': 'fake', 'impact_score': 5},
        headers=_auth(author),
    )
    guest_token, _ = _guest(client, cleanup)
    result = client.post(
        f"/submissions/{created['id']}/vote",
        json={'verdict': 'real', 'impact_score': 1},
        headers=_auth(guest_token),
    ).json()

    # fake_likelihood = 0.5 / (0.5 + 0.1) = 0.8333
    assert result['vote_count'] == 2
    assert result['fake_likelihood'] == pytest.approx(0.8333, abs=1e-3)
    # weighted_impact = (5*0.5 + 1*0.1) / 0.6 = 4.3333
    assert result['weighted_impact'] == pytest.approx(4.3333, abs=1e-3)


def test_revote_updates_existing_row(client: TestClient, cleanup) -> None:
    token, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Change my mind'},
        headers=_auth(token),
    ).json()
    cleanup['submissions'].add(created['id'])

    first = client.post(
        f"/submissions/{created['id']}/vote",
        json={'verdict': 'fake', 'impact_score': 3},
        headers=_auth(token),
    ).json()
    assert first['vote_count'] == 1
    assert first['fake_likelihood'] == 1.0

    second = client.post(
        f"/submissions/{created['id']}/vote",
        json={'verdict': 'real', 'impact_score': 2},
        headers=_auth(token),
    ).json()
    # Still one vote — the row was updated, not duplicated.
    assert second['vote_count'] == 1
    assert second['fake_likelihood'] == 0.0

    detail = client.get(f"/submissions/{created['id']}", headers=_auth(token)).json()
    assert detail['your_vote'] == {'verdict': 'real', 'impact_score': 2}


def test_detail_reports_raw_counts_and_submitter(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Count me'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    client.post(
        f"/submissions/{created['id']}/vote",
        json={'verdict': 'fake', 'impact_score': 3},
        headers=_auth(author),
    )
    guest_token, _ = _guest(client, cleanup)
    client.post(
        f"/submissions/{created['id']}/vote",
        json={'verdict': 'real', 'impact_score': 2},
        headers=_auth(guest_token),
    )

    detail = client.get(f"/submissions/{created['id']}", headers=_auth(author)).json()
    assert detail['fake_votes'] == 1
    assert detail['real_votes'] == 1
    assert detail['submitter'] is not None
    assert detail['can_delete'] is True  # author owns it


def test_owner_can_edit_caption_and_content(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Original text', 'caption': 'first caption'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    # Caption-only edit leaves content + status untouched.
    caption_only = client.patch(
        f"/submissions/{created['id']}",
        json={'caption': 'edited caption'},
        headers=_auth(author),
    )
    assert caption_only.status_code == 200
    body = caption_only.json()
    assert body['caption'] == 'edited caption'
    assert body['content_url'] == 'Original text'
    assert body['can_edit'] is True

    # Editing the content resets status to pending (AI must re-analyse).
    content_edit = client.patch(
        f"/submissions/{created['id']}",
        json={'content': 'Updated suspicious text'},
        headers=_auth(author),
    ).json()
    assert content_edit['content_url'] == 'Updated suspicious text'
    assert content_edit['status'] == 'pending'


def test_other_user_cannot_edit(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Mine only'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    other, _ = _register(client, cleanup)
    forbidden = client.patch(
        f"/submissions/{created['id']}",
        json={'caption': 'hijacked'},
        headers=_auth(other),
    )
    assert forbidden.status_code == 403
    other_view = client.get(f"/submissions/{created['id']}", headers=_auth(other)).json()
    assert other_view['can_edit'] is False


def test_edit_requires_auth(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'No anon edit'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    assert client.patch(f"/submissions/{created['id']}", json={'caption': 'x'}).status_code == 401


def test_owner_can_delete_but_other_user_cannot(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Delete me'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    # A different (non-admin) user cannot delete someone else's post.
    other, _ = _register(client, cleanup)
    forbidden = client.delete(f"/submissions/{created['id']}", headers=_auth(other))
    assert forbidden.status_code == 403

    other_view = client.get(f"/submissions/{created['id']}", headers=_auth(other)).json()
    assert other_view['can_delete'] is False

    # The owner can delete; afterwards the row is gone.
    deleted = client.delete(f"/submissions/{created['id']}", headers=_auth(author))
    assert deleted.status_code == 204
    assert client.get(f"/submissions/{created['id']}").status_code == 404


def test_delete_requires_auth(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'No anon delete'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    assert client.delete(f"/submissions/{created['id']}").status_code == 401


def test_comment_create_list_and_delete(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Comment on me'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    # Empty list before anyone comments.
    empty = client.get(f"/submissions/{created['id']}/comments")
    assert empty.status_code == 200
    assert empty.json() == []

    posted = client.post(
        f"/submissions/{created['id']}/comments",
        json={'body': '  This matches a known scam template.  '},
        headers=_auth(author),
    )
    assert posted.status_code == 201
    comment = posted.json()
    assert comment['body'] == 'This matches a known scam template.'  # trimmed
    assert comment['author'] is not None
    assert comment['can_delete'] is True

    # A second commenter; list is newest-first.
    other, _ = _register(client, cleanup)
    client.post(
        f"/submissions/{created['id']}/comments",
        json={'body': 'I cross-checked with the official site.'},
        headers=_auth(other),
    )
    listed = client.get(f"/submissions/{created['id']}/comments", headers=_auth(author)).json()
    assert [c['body'] for c in listed] == [
        'I cross-checked with the official site.',
        'This matches a known scam template.',
    ]
    # The author can delete their own comment but not the other person's.
    own = next(c for c in listed if c['author'] == comment['author'])
    foreign = next(c for c in listed if c['author'] != comment['author'])
    assert own['can_delete'] is True
    assert foreign['can_delete'] is False

    deleted = client.delete(
        f"/submissions/{created['id']}/comments/{comment['id']}",
        headers=_auth(author),
    )
    assert deleted.status_code == 204
    remaining = client.get(f"/submissions/{created['id']}/comments").json()
    assert comment['id'] not in [c['id'] for c in remaining]


def test_comment_requires_auth(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'No anon comments'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    assert client.post(
        f"/submissions/{created['id']}/comments", json={'body': 'hi'}
    ).status_code == 401


def test_cannot_delete_another_users_comment(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Whose comment'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    comment = client.post(
        f"/submissions/{created['id']}/comments",
        json={'body': 'Mine to keep.'},
        headers=_auth(author),
    ).json()

    other, _ = _register(client, cleanup)
    forbidden = client.delete(
        f"/submissions/{created['id']}/comments/{comment['id']}",
        headers=_auth(other),
    )
    assert forbidden.status_code == 403


def test_comment_on_missing_submission_404(client: TestClient, cleanup) -> None:
    token, _ = _register(client, cleanup)
    assert client.get('/submissions/999999999/comments').status_code == 404
    assert client.post(
        '/submissions/999999999/comments',
        json={'body': 'nobody home'},
        headers=_auth(token),
    ).status_code == 404


def test_deleting_submission_removes_its_comments(client: TestClient, cleanup) -> None:
    author, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'Delete cascades'},
        headers=_auth(author),
    ).json()
    cleanup['submissions'].add(created['id'])

    client.post(
        f"/submissions/{created['id']}/comments",
        json={'body': 'soon gone'},
        headers=_auth(author),
    )
    assert client.delete(f"/submissions/{created['id']}", headers=_auth(author)).status_code == 204
    # Submission (and so its comments) are gone.
    assert client.get(f"/submissions/{created['id']}/comments").status_code == 404


def test_me_includes_tier(client: TestClient, cleanup) -> None:
    token, _ = _register(client, cleanup)  # new users start at credibility 50
    me = client.get('/users/me', headers=_auth(token))
    assert me.status_code == 200
    body = me.json()
    assert body['credibility_score'] == 50.0
    assert body['tier'] == 'Verified'  # 31–60 bracket


def test_credibility_log_empty_for_new_user(client: TestClient, cleanup) -> None:
    token, _ = _register(client, cleanup)
    response = client.get('/users/me/credibility-log', headers=_auth(token))
    assert response.status_code == 200
    assert response.json() == []
    # Auth is required.
    assert client.get('/users/me/credibility-log').status_code == 401


def test_stats_shape_for_new_user(client: TestClient, cleanup) -> None:
    token, _ = _register(client, cleanup)
    response = client.get('/users/me/stats', headers=_auth(token))
    assert response.status_code == 200
    body = response.json()
    assert body['tier'] == 'Verified'
    assert body['credibility_score'] == 50.0
    # No games or votes yet → null accuracies, zero counts.
    assert body['game_accuracy'] is None
    assert body['vote_accuracy'] is None
    assert body['games_played'] == 0
    assert body['votes_cast'] == 0
    assert client.get('/users/me/stats').status_code == 401


def test_guest_is_newcomer_tier(client: TestClient, cleanup) -> None:
    token, _ = _guest(client, cleanup)  # guests start at credibility 0
    me = client.get('/users/me', headers=_auth(token)).json()
    assert me['credibility_score'] == 0.0
    assert me['tier'] == 'Newcomer'


def test_vote_requires_auth(client: TestClient, cleanup) -> None:
    token, _ = _register(client, cleanup)
    created = client.post(
        '/submissions',
        json={'content_type': 'text', 'content': 'No anon votes'},
        headers=_auth(token),
    ).json()
    cleanup['submissions'].add(created['id'])

    response = client.post(
        f"/submissions/{created['id']}/vote",
        json={'verdict': 'fake', 'impact_score': 1},
    )
    assert response.status_code == 401
