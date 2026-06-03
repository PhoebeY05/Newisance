# dashboard-service

> Read-only public awareness API: trending fakes, scam-type breakdowns, the
> leaderboard, and headline stats.

**Port:** `8002` · **Frontend namespace:** `/api/dashboard/*` (supplied by the Vite proxy) · **FastAPI app:** [`app/main.py`](app/main.py)

Everything here is **public** (no login required) and **read-only**. It serves
the `/dashboard` page and is optimised for fast reads via Redis caching.

---

## Responsibilities

- Expose aggregate, anonymised platform stats for the public dashboard.
- Serve the global leaderboard from the Redis `leaderboard:*` sorted sets that
  [game-service](../game-service/) writes to.
- Read pre-computed `dashboard:*` cache keys that [ai-service](../ai-service/)'s
  `refresh_dashboard_cache` cron warms every 15 minutes; fall back to a live DB
  query (and populate the cache) on a miss.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `GET` | `/trending` | Top submissions this week by `final_score × impact` |
| `GET` | `/scam-types` | Counts grouped by AI verdict & content type |
| `GET` | `/leaderboard?scope=weekly\|alltime&limit=50` | Ranked users (Redis ZREVRANGE + DB join for names/tiers) |
| `GET` | `/stats` | `{submissions_this_week, pct_fake, most_common_type, active_users_this_week}` |

---

## Key modules

| File | Purpose |
|------|---------|
| [`app/main.py`](app/main.py) | App, CORS, router wiring |
| [`app/routers/dashboard.py`](app/routers/dashboard.py) | The four read endpoints |
| [`app/redis_client.py`](app/redis_client.py) | Redis connection + cache helpers |
| [`app/schemas.py`](app/schemas.py) | Response models (`TrendingItem`, `ScamTypes`, `LeaderboardEntry`, `Stats`) |
| [`app/deps.py`](app/deps.py) | DB session dependency |

**Caching:** each endpoint checks its `dashboard:<endpoint>` Redis key first
(TTL 15 min) and recomputes on a miss. The shared cache-build logic lives in
[`shared/dashboard.py`](../../shared/dashboard.py), reused by the ai-service cron
so both paths produce identical payloads.

---

## Running

Via the root `docker-compose.yml`:

```bash
# from the repo root
docker compose up --build dashboard-service
```

Standalone:

```bash
cd backend/dashboard-service/app
PYTHONPATH=../../..:. uvicorn main:app --reload --port 8002
```

Needs Postgres + Redis and a repo-root `.env` — see the
[root README](../../README.md#backend-setup).

## Tests

```bash
cd backend/dashboard-service
pytest
```

See [`tests/test_dashboard.py`](tests/test_dashboard.py).

## Environment

`DATABASE_URL`, `REDIS_URL` (via [`shared/config.py`](../../shared/config.py)).

---

See the [root README](../../README.md) and [AGENTS.md](../../AGENTS.md) (Phase 7).
