# game-service

> Timed Challenge + Battle Royale games, the question library, admin question
> management, and shareable result cards.

**Port:** `8001` · **Frontend namespace:** `/api/game/*` (supplied by the Vite proxy) · **FastAPI app:** [`app/main.py`](app/main.py)

Routes are mounted **bare** (e.g. `/sessions`, `/questions/random`). The frontend's
Vite dev proxy rewrites `/api/game/*` → this service and strips the prefix, so
`/api/game/sessions` reaches the service as `/sessions`.

---

## Responsibilities

- **Timed Challenge** — single-player Flappy-Bird game: create a session, serve
  random questions, score each answer, and return a final summary.
- **Battle Royale** — real-time multiplayer over WebSockets with an in-memory +
  Redis-backed room manager.
- **Question library** — random question selection for games.
- **Admin** — CRUD over the question bank (admin-only), AI-assisted explanation
  generation, and CSV bulk import.
- **Sharing** — server-rendered PNG result cards with a QR code.
- **Leaderboard writes** — every correct answer pushes a score into the Redis
  `leaderboard:weekly` sorted set (read back by [dashboard-service](../dashboard-service/)).

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Liveness check |
| `GET` | `/questions/random?count=10&difficulty=mixed` | optional | Shuffled active questions |
| `POST` | `/sessions` | optional (guests OK) | Start a game session |
| `POST` | `/sessions/{id}/answer` | optional | Grade one answer → `{is_correct, explanation, points_earned}` |
| `POST` | `/sessions/{id}/end` | optional | Finalise score, trigger credibility update, return summary |
| `GET` | `/sessions/{id}` | optional | Session + all answers (end-screen replay) |
| `POST` | `/battle/join` | required | Matchmake into a room → `{room_id, ws_url}` |
| `WS` | `/battle/ws/{room_id}?token=<jwt>` | token in query | Live Battle Royale connection |
| `GET` | `/admin/questions` | admin | Paginated, filterable question list |
| `POST` | `/admin/questions` | admin | Create a question (base64 image → `media_uploads/`) |
| `PUT` | `/admin/questions/{id}` | admin | Partial update |
| `DELETE` | `/admin/questions/{id}` | admin | Soft delete (`is_active=False`) |
| `POST` | `/admin/questions/generate-explanation` | admin | AI-drafted explanation (via ai-service) |
| `POST` | `/admin/questions/bulk-import` | admin | CSV import → `{imported, errors[]}` |
| `GET` | `/share/card/{session_id}` | — | PNG result card |

Admin-uploaded images are served from the `/media_uploads` static mount
(fetchable through the proxy as `/api/game/media_uploads/<file>`).

---

## Key modules

| File | Purpose |
|------|---------|
| [`app/main.py`](app/main.py) | App, CORS, router wiring, media mount |
| [`app/routers/`](app/routers/) | `questions`, `sessions`, `battle`, `admin`, `share` |
| [`app/scoring.py`](app/scoring.py) | Points formula (difficulty × speed bonus) |
| [`app/battle.py`](app/battle.py) | Battle Royale room state + WebSocket manager |
| [`app/leaderboard.py`](app/leaderboard.py) | Redis sorted-set leaderboard writes |
| [`app/storage.py`](app/storage.py) | Local media directory helpers |
| [`app/deps.py`](app/deps.py) | DB session + current-user / admin dependencies |
| [`app/schemas.py`](app/schemas.py) | Pydantic request/response models |

**Points formula** (see [`scoring.py`](app/scoring.py)): `base = 100 × difficulty_multiplier`
(easy 1 / medium 1.5 / hard 2), `speed_bonus = max(0, 1 − response_ms/8000)`,
`points = base × (1 + speed_bonus)` when correct, else `0`.

---

## Running

Easiest via the root `docker-compose.yml` (starts Postgres + Redis + this service):

```bash
# from the repo root
docker compose up --build game-service
```

Standalone (matches the container layout — modules are top-level, `shared` on the path):

```bash
cd backend/game-service/app
PYTHONPATH=../../..:. uvicorn main:app --reload --port 8001
```

Requires a running Postgres + Redis and a `.env` at the repo root (see the
[root README](../../README.md#backend-setup)).

## Tests

`pytest` integration tests live in [`tests/`](tests/) and exercise the app via
`httpx.AsyncClient` against a real Postgres/Redis (using `DATABASE_URL` /
`REDIS_URL` from `.env`). The [`conftest.py`](tests/conftest.py) puts the `app/`
dir and repo root on `sys.path` to mirror the container.

```bash
cd backend/game-service
pytest
```

## Environment

Reads shared config via [`shared/config.py`](../../shared/config.py): `DATABASE_URL`,
`REDIS_URL`, `JWT_SECRET` / `JWT_ALGORITHM`, `LOCAL_MEDIA_DIR`. The
`generate-explanation` endpoint enqueues an `arq` job consumed by
[ai-service](../ai-service/).

---

See the [root README](../../README.md) for the full stack and the
[AGENTS.md](../../AGENTS.md) implementation guide (Phases 3, 4, 9, 10).
