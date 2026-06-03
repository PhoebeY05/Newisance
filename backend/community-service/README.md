# community-service

> User accounts & auth, the community verification hub (submissions, votes,
> comments), and the credibility-weighted scoring that feeds AI analysis.

**Port:** `8003` · **Frontend namespace:** `/api/community/*` (supplied by the Vite proxy) · **FastAPI app:** [`app/main.py`](app/main.py)

This service also owns **user management** for the whole platform — registration,
login, guest tokens, and the user profile — because user records and credibility
live here. Other services validate the JWTs it issues via [`shared/auth.py`](../../shared/auth.py).

---

## Responsibilities

- **Auth & users** — email/password registration & login, guest tokens, profile
  read/update, credibility log, and aggregate stats.
- **Submissions** — accept suspicious image / URL / text content, persist it, and
  enqueue an `arq` `analyse_submission` job for [ai-service](../ai-service/).
- **Voting** — one credibility-weighted Real/Fake vote per user per submission
  (impact 1–5), with the live `fake_likelihood` recomputed on each vote.
- **Comments** — threaded community fact-check discussion on a submission.
- **Scoring** — computes the credibility-weighted community signal that becomes
  the 50% community component of a submission's final verdict.

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Liveness check |
| `POST` | `/auth/register` | — | Create user → JWT |
| `POST` | `/auth/login` | — | Verify credentials → JWT |
| `POST` | `/auth/guest` | — | Create a guest user (`Guest_<id>`) → JWT |
| `GET` | `/users/me` | required | Full profile |
| `PATCH` | `/users/me` | required | Update username (not for guests) |
| `GET` | `/users/me/credibility-log?days=30` | required | Credibility history for the profile chart |
| `GET` | `/users/me/stats` | required | Aggregate game / vote stats |
| `POST` | `/submissions` | optional | Create a submission, enqueue AI analysis |
| `GET` | `/submissions` | optional | Paginated feed w/ `fake_likelihood`, vote count |
| `GET` | `/submissions/{id}` | optional | Detail + votes summary + AI analysis |
| `POST` | `/submissions/{id}/vote` | required (guests OK) | Cast/replace a weighted vote |
| `GET` | `/submissions/{id}/comments` | optional | Comment thread |
| `POST` | `/submissions/{id}/comments` | required | Add a comment |
| `DELETE` | `/submissions/{id}/comments/{comment_id}` | required | Remove own comment |
| `PATCH` | `/submissions/{id}` | required (owner) | Edit a submission (re-triggers analysis) |
| `DELETE` | `/submissions/{id}` | required (owner) | Delete a submission |

Uploaded media is served from the `/media_uploads` static mount (via the proxy as
`/api/community/media_uploads/<file>`).

---

## Key modules

| File | Purpose |
|------|---------|
| [`app/main.py`](app/main.py) | App, CORS, auth & user endpoints, media mount |
| [`app/routers/community.py`](app/routers/community.py) | Submissions, votes, comments |
| [`app/scoring.py`](app/scoring.py) | Credibility-weighted `fake_likelihood` / impact |
| [`app/tasks.py`](app/tasks.py) | Enqueues `analyse_submission` on the `arq` queue |
| [`app/storage.py`](app/storage.py) | Base64 image → local media file |
| [`app/deps.py`](app/deps.py) | DB session + current-user dependencies |
| [`app/schemas.py`](app/schemas.py) | Pydantic request/response models |

**Credibility weighting:** a vote stores `credibility_weight = min(user.credibility_score/100, 1.0)`
snapshotted at vote time (guests fixed at `0.1`). Settlement of voter credibility
after analysis happens in [ai-service](../ai-service/)'s `settle_credibility` task.

---

## Running

Via the root `docker-compose.yml`:

```bash
# from the repo root
docker compose up --build community-service
```

Standalone:

```bash
cd backend/community-service/app
PYTHONPATH=../../..:. uvicorn main:app --reload --port 8003
```

Needs Postgres, Redis (for the job queue), and a repo-root `.env` — see the
[root README](../../README.md#backend-setup).

## Tests

```bash
cd backend/community-service
pytest
```

[`tests/`](tests/) covers auth ([`test_auth.py`](tests/test_auth.py)) and the
community feed/voting ([`test_community.py`](tests/test_community.py)) via
`httpx.AsyncClient` against a real Postgres.

## Environment

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` / `JWT_ALGORITHM` / `JWT_EXPIRE_MINUTES`,
`LOCAL_MEDIA_DIR` (read through [`shared/config.py`](../../shared/config.py)).

---

See the [root README](../../README.md) and [AGENTS.md](../../AGENTS.md) (Phases 2, 5, 8).
