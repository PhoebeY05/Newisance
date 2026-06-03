# Newisance — Implementation Guide for Claude

## What is this?

You are building **Newisance** (`newisance.com`), a gamified misinformation-detection platform for young Singaporeans. The platform combines:

- Gamified learning (Flappy Bird-style Timed Challenge + multiplayer Battle Royale)
- Community verification hub (upload suspicious content, community votes, AI analysis)
- Credibility scoring system (accurate users carry more weight)
- Public awareness dashboard (trending fakes, leaderboards, stats)

## Tech Stack

### Local / Development
- **Frontend:** React 18 (Vite + React Router v6), Tailwind CSS, Framer Motion, Chart.js, Zustand, TanStack Query
- **Backend:** Python 3.12, FastAPI (4 services), SQLAlchemy ORM, Alembic migrations
- **Database:** PostgreSQL (local via Docker), Redis (local via Docker)
- **Auth:** JWT (python-jose) with email/password; guest tokens issued directly by the user service
- **Async tasks:** Python `arq` task queue backed by local Redis (replaces SQS locally)
- **AI:** `google-genai` Python SDK — calls Google Gemini free-tier models (`gemini-2.0-flash-lite`) directly from the Python `ai-service` worker. Free tier via Google AI Studio; no credit card required.
- **Package manager:** `uv` (fast Python package manager) per service; `npm` for frontend
- **Local orchestration:** Docker Compose (all services + Postgres + Redis)

### Production (AWS — see AWS Migration section)
- ECS Fargate (4 Python containers), RDS PostgreSQL, ElastiCache Redis, S3, SQS, Cognito, CloudFront, API Gateway

## Repository Structure

```
newisance/
├── frontend/
│   └── web/                        # React + Vite frontend
│       ├── src/
│       │   ├── pages/              # Route-level components (Login, Signup, Play, Verify, etc.)
│       │   ├── components/         # Shared UI components
│       │   ├── context/            # React context (AuthContext, etc.)
│       │   ├── hooks/              # Custom hooks
│       │   ├── store/              # Zustand stores
│       │   └── main.tsx            # Entry point with React Router
│       ├── index.html
│       └── vite.config.ts
│
├── backend/
│   ├── game-service/               # Battle Royale + Timed Challenge (port 8001)
│   │   ├── app/
│   │   │   ├── main.py             # FastAPI app + WebSocket server
│   │   │   ├── routers/            # questions.py, sessions.py, battle.py
│   │   │   ├── models.py           # SQLAlchemy models
│   │   │   ├── schemas.py          # Pydantic request/response schemas
│   │   │   └── deps.py             # Shared dependencies (DB session, current user)
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   │
│   ├── dashboard-service/          # Public stats + leaderboard (port 8002)
│   │   └── app/ ...
│   │
│   ├── community-service/          # Uploads + voting + user auth (port 8003)
│   │   └── app/ ...
│   │
│   └── ai-service/                 # Async AI verification worker (no HTTP port — arq only)
│       ├── app/
│       │   ├── worker.py           # arq WorkerSettings + analyse_submission task
│       │   ├── analysers/
│       │   │   ├── text.py         # Text + URL analysis via google-genai
│       │   │   └── image.py        # Image analysis via google-genai vision
│       │   └── explain.py          # Explanation generation for admin panel
│       └── pyproject.toml
│
├── shared/                         # Pure-Python shared libraries (no framework code)
│   ├── db/
│   │   ├── models.py               # Shared SQLAlchemy base models
│   │   ├── session.py              # DB engine + session factory
│   │   └── alembic/                # Single shared migrations folder
│   ├── schemas/                    # Shared Pydantic schemas / TypedDicts
│   ├── auth.py                     # JWT encode/decode helpers
│   └── config.py                   # pydantic-settings BaseSettings (reads .env)
│
├── infra/                          # AWS CDK (TypeScript) — used in migration phase only
├── docker-compose.yml              # Local orchestration
├── docker-compose.test.yml         # Test overrides
└── CLAUDE.md                       # This file
```

## Key Data Models

```sql
-- Users
users(id, username, email, hashed_password, is_guest, credibility_score, tier, created_at)

-- Questions (game content)
questions(id, content, type, media_url, correct_answer, explanation, difficulty, tags[], is_active)

-- Game sessions
game_sessions(id, user_id, mode, room_id, score, started_at, ended_at)
session_answers(id, session_id, question_id, chosen_answer, is_correct, response_ms)

-- Community
submissions(id, user_id, content_type, content_url, caption, status, credibility_settled, created_at)
votes(id, submission_id, user_id, verdict, impact_score, credibility_weight)
ai_analysis(id, submission_id, confidence, signals[], verdict, explanation, processed_at)

-- Credibility history
credibility_log(id, user_id, delta, reason, new_score, created_at)

-- Leaderboard snapshots
leaderboard_snapshots(id, scope, rank, user_id, score, snapshot_date)

-- Vouchers
vouchers(id, code, user_id, claimed, created_at)

-- Redis (not SQL): leaderboard:weekly and leaderboard:alltime as sorted sets
```

## Credibility System Rules

- New users start at `credibility_score = 50` (scale 0–100)
- Guests: fixed weight `0.1`
- After each game session: `new_score = old_score × 0.9 + session_accuracy × 10`
- After each vote: +0.5 if vote matches final verdict, −0.2 if it doesn't
- Voting weight: `credibility_score / 100`, capped at `1.0`
- Tiers: Newcomer (0–30), Verified (31–60), Analyst (61–80), Expert (81–100)

## Community Score Formula

```
final_score = (0.5 × weighted_community_vote) + (0.3 × ai_confidence) + (0.2 × submitter_credibility)
```

## Local Environment Variables (`.env` in project root)

```bash
# Database
DATABASE_URL=postgresql://newisance:newisance@localhost:5432/newisance
REDIS_URL=redis://localhost:6379

# Auth (local JWT secret — replace with Cognito in production)
JWT_SECRET=local-dev-secret-change-in-prod
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080   # 7 days

# AI — Google AI Studio free tier, no credit card required
# Get a key at https://aistudio.google.com/app/apikey
GEMINI_API_KEY=

# Storage (local filesystem in dev — replace with S3 in production)
MEDIA_STORAGE=local
LOCAL_MEDIA_DIR=./media_uploads

# Service URLs (used by services that call each other)
GAME_SERVICE_URL=http://localhost:8001
COMMUNITY_SERVICE_URL=http://localhost:8003
DASHBOARD_SERVICE_URL=http://localhost:8002

# Feature flags
AI_ANALYSIS_ENABLED=true
```

---

# Implementation Phases

Work through these phases in order. Each phase is self-contained — complete and test one before moving to the next.

---

## Phase 1 — Project Scaffold & Local Infrastructure

**Goal:** Repo structure, Docker Compose for local Postgres + Redis, shared Python library, frontend scaffold, and a health-check endpoint on each service.

### Tasks

1. **Repo initialisation**
   - Create the folder structure exactly as shown in Repository Structure above
   - Add a root `.gitignore` covering Python (`__pycache__`, `.venv`, `*.pyc`), Node (`node_modules`), and env files (`.env`)
   - Add a root `.env.example` copying the template from Environment Variables above (no real values)

2. **Docker Compose (`docker-compose.yml`)**
   - `postgres` service: `postgres:16-alpine`, port `5432`, volume for data persistence, env `POSTGRES_USER=newisance POSTGRES_PASSWORD=newisance POSTGRES_DB=newisance`
   - `redis` service: `redis:7-alpine`, port `6379`
   - `game-service`, `dashboard-service`, `community-service`, `ai-service`: each built from their `Dockerfile`, env loaded from root `.env`, depends on `postgres` and `redis`
   - Frontend is **not** in Docker Compose — run with `npm run dev` directly

3. **Shared library (`shared/`)**
   - `shared/config.py`: `pydantic-settings` `Settings` class — reads all env vars, provides typed access
   - `shared/db/session.py`: SQLAlchemy async engine + `AsyncSession` factory using `DATABASE_URL`
   - `shared/db/models.py`: `Base = declarative_base()`, `TimestampMixin` with `created_at`/`updated_at`
   - `shared/auth.py`: `create_access_token(user_id, is_guest)` and `decode_token(token) -> TokenPayload` using `python-jose`
   - `shared/schemas.py`: `ApiResponse[T]` Pydantic generic model: `{data: T | None, error: str | None, status: int}`
   - Each service installs `shared` as a local path dependency in its `pyproject.toml`: `shared = {path = "../../shared", develop = true}`

4. **Service scaffolds** (repeat for all 4 Python services)
   - `pyproject.toml` using `uv`, dependencies: `fastapi`, `uvicorn[standard]`, `sqlalchemy[asyncio]`, `asyncpg`, `pydantic-settings`, `python-jose[cryptography]`, `shared` (local path)
   - `Dockerfile`: `FROM python:3.12-slim`, install `uv`, copy and install deps, `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "800X"]`
   - `app/main.py`: FastAPI app with CORS middleware (allow `http://localhost:5173`), `GET /health` returning `{"status": "ok", "service": "<name>"}`
   - `app/deps.py`: `get_db()` async dependency, `get_current_user()` dependency (reads Bearer token, decodes JWT, fetches user from DB; raises 401 if invalid), `get_optional_user()` (returns `None` for missing/invalid token instead of raising)

5. **Alembic setup (`shared/db/alembic/`)**
   - Single Alembic config for all models — each service imports models so Alembic can detect them
   - Initial migration: create all tables from Key Data Models
   - Seed script `shared/db/seed.py`: inserts 20 questions across all 5 types

6. **Frontend scaffold**
   - `cd frontend/web && npm create vite@latest . -- --template react-ts`
   - Install: `npm install react-router-dom @tanstack/react-query zustand framer-motion chart.js react-chartjs-2 tailwindcss @tailwindcss/vite`
   - Configure Tailwind in `vite.config.ts`
   - `src/main.tsx`: wrap app in `<QueryClientProvider>` and `<BrowserRouter>`
   - `src/pages/Home.tsx`: placeholder with "Newisance" heading and links to `/play` and `/verify`
   - Proxy in `vite.config.ts`: forward `/api/game` → `http://localhost:8001`, `/api/community` → `http://localhost:8003`, `/api/dashboard` → `http://localhost:8002`

### Acceptance Criteria
- `docker compose up` starts Postgres and Redis with no errors
- `alembic upgrade head` creates all tables in the local DB
- `python shared/db/seed.py` inserts 20 questions
- `GET http://localhost:8001/health`, `8002/health`, `8003/health` all return `{"status": "ok"}`
- `npm run dev` in `frontend/web` opens the app at `http://localhost:5173`

---

## Phase 2 — Auth & User Service

**Goal:** Working local authentication (email/password + guest tokens), user profile creation, JWT propagation to all services.

### Tasks

1. **User model & migrations**
   - Add `User` SQLAlchemy model in `shared/db/models.py`
   - Generate Alembic migration for the `users` table
   - `hashed_password` nullable (guests have no password); `is_guest` boolean

2. **Auth endpoints in `community-service`** (user management lives here)
   - `POST /auth/register` — `{username, email, password}` → hash password with `passlib[bcrypt]`, insert user, return JWT
   - `POST /auth/login` — `{email, password}` → verify hash, return JWT
   - `POST /auth/guest` — create a user row with `is_guest=True`, random username (`Guest_<uuid[:6]>`), return JWT with `credibility_weight=0.1` baked in
   - `GET /users/me` — requires auth, returns full profile
   - `PATCH /users/me` — update username (not allowed for guests)

3. **JWT middleware**
   - `get_current_user()` in `shared/deps.py` decodes the JWT and queries the DB; used by all services
   - `get_optional_user()` returns `None` if no valid token (used for public endpoints)
   - Token payload: `{sub: user_id, is_guest: bool, credibility_score: float, exp: timestamp}`

4. **Frontend auth**
   - `src/context/AuthContext.tsx`: holds `user`, `token`, exposes `login()`, `register()`, `loginAsGuest()`, `logout()`; persists token to `localStorage`; on mount, validate token with `GET /api/community/users/me`
   - `src/pages/Login.tsx` and `src/pages/Signup.tsx`: forms wired to the context methods
   - `src/hooks/useApi.ts`: wrapper around `fetch` that injects `Authorization: Bearer <token>` header automatically
   - Protected route component `src/components/ProtectedRoute.tsx`: redirects to `/login` if no token; accepts `guestAllowed` prop

### Acceptance Criteria
- `POST /auth/register` creates a user and returns a valid JWT
- `POST /auth/guest` creates a guest user with `credibility_score = 0` and returns a JWT
- `GET /users/me` with the JWT returns the correct user profile
- The frontend login form issues a JWT and stores it; refreshing the page keeps the user logged in
- Guest login works without filling in any form fields

---

## Phase 3 — Game Service: Timed Challenge

**Goal:** Fully playable single-player Timed Challenge (Flappy Bird mode) with score tracking and post-game feedback.

### Tasks

1. **Models & migrations**
   - Add `Question`, `GameSession`, `SessionAnswer` to `shared/db/models.py`
   - Generate migration

2. **Game service: endpoints**
   - `GET /game/questions/random?count=10&difficulty=mixed` — returns shuffled questions, excludes `is_active=False`; no auth required
   - `POST /game/sessions` — creates session row `{user_id, mode="timed"}`, returns `session_id`; uses `get_optional_user()` so guests can play
   - `POST /game/sessions/{session_id}/answer` — body `{question_id, chosen_answer, response_ms}`; validates answer against DB, returns `{is_correct, explanation, points_earned}`; inserts into `session_answers`
   - `POST /game/sessions/{session_id}/end` — marks session ended, computes `score = sum(points_earned)`, triggers credibility update (direct DB call locally, SQS in production), returns final summary
   - `GET /game/sessions/{session_id}` — returns session with all answers (for end-screen replay)

3. **Points formula**
   - `base_points = difficulty_multiplier × 100` (easy=1, medium=1.5, hard=2)
   - `speed_bonus = max(0, 1 - response_ms / 8000)` (full bonus under 1s, zero bonus at 8s)
   - `points_earned = base_points × (1 + speed_bonus)` if correct, else `0`

4. **Credibility update (local)**
   - After `POST /game/sessions/{session_id}/end`, directly call: `new_score = old_score * 0.9 + accuracy * 10`
   - Insert row into `credibility_log`; update `users.credibility_score`

5. **Frontend: `/play/timed`**
   - Canvas-based Flappy Bird using `requestAnimationFrame`
   - On game start: call `POST /game/sessions`, store `session_id`
   - Bird sprite, two pipes (left = answer A, right = answer B), question text displayed at top of canvas
   - Bird physics: gravity constant downward, spacebar/tap applies upward impulse
   - On pipe collision: call `POST /game/sessions/{id}/answer`, pause physics, show animated overlay with correct/wrong + explanation (3s), resume
   - Score and question counter in HUD
   - On last question: call `POST /game/sessions/{id}/end`, navigate to end screen
   - End screen: score, accuracy %, credibility change, "Play Again" + "Go to Dashboard" buttons
   - Handle all 5 question types: render an image for `deepfake`/`manipulated_media`/`scam_message`, a styled card for `misleading_headline`, a text excerpt for `satire`

### Acceptance Criteria
- A guest can complete a 10-question game from start to end screen
- `POST /game/sessions/{id}/end` returns the correct cumulative score
- Explanation overlay appears after every answer regardless of correct/wrong
- The game is touch-playable on a 375px mobile viewport

---

## Phase 4 — Game Service: Battle Royale

**Goal:** Real-time multiplayer Battle Royale with WebSocket rooms, live leaderboard, and player elimination.

### Tasks

1. **WebSocket server (in `game-service`)**
   - Use FastAPI's native `WebSocket` support
   - `WS /game/battle/ws/{room_id}?token=<jwt>` — client connects, server authenticates token from query param
   - Server-side room manager (in-memory dict + Redis for multi-instance): `rooms: dict[room_id, RoomState]`
   - `RoomState`: `{players: dict[user_id, PlayerState], question_index: int, status: "waiting"|"active"|"finished"}`
   - Events sent from server → client (JSON): `room_state`, `new_question`, `answer_result`, `player_eliminated`, `game_over`
   - Events sent from client → server: `submit_answer(question_id, answer)`

2. **Redis for room state**
   - Store room state in Redis: `room:{room_id}` → JSON serialised `RoomState`, TTL 2 hours
   - Leaderboard: `ZADD leaderboard:weekly <score> <user_id>` on every correct answer in either game mode

3. **Matchmaking endpoint**
   - `POST /game/battle/join` — finds an open room (< 20 players, status `"waiting"`) or creates one; returns `{room_id, ws_url}`
   - Auto-start: when room hits 5 players, or after 30s with ≥ 2 players — emit `new_question` to all

4. **Frontend: `/play/battle`**
   - Three-column layout: leaderboard sidebar | question + answer buttons centre | live elimination feed right
   - On mount: `POST /game/battle/join` → get `room_id`, open WebSocket connection
   - Render each WebSocket event: `room_state` → update player list, `new_question` → show question + timer bar, `answer_result` → flash green/red, `player_eliminated` → animate card off-screen with Framer Motion, `game_over` → show podium
   - Question timer bar: 10s countdown, shrinks with CSS animation keyed to `new_question` events
   - After elimination: spectate mode — still receive and display events but answer buttons are hidden

### Acceptance Criteria
- Two browser tabs can join the same room and see each other's scores update live
- A wrong answer causes immediate elimination visible to all room members within 200ms
- Redis `leaderboard:weekly` sorted set is updated on every correct answer

---

## Phase 5 — Community Verification Hub

**Goal:** Users can submit suspicious content, vote on submissions, and see a live likelihood score. AI integration comes in Phase 6.

### Tasks

1. **Models & migrations**
   - Add `Submission`, `Vote`, `AiAnalysis` to `shared/db/models.py`
   - Generate migration

2. **Community service: submission endpoints**
   - `POST /community/submissions` — body `{content_type: "image"|"url"|"text", content: str, caption: str}`
     - For `image`: `content` is a base64 string locally; save to `LOCAL_MEDIA_DIR`, store relative path in `content_url`
     - For `url` and `text`: store `content` directly as `content_url`
     - Set `status = "pending"`, enqueue an `arq` task `analyse_submission(submission_id)` (runs locally via Redis)
   - `GET /community/submissions` — paginated feed, includes computed `{fake_likelihood, weighted_impact, vote_count}`
   - `GET /community/submissions/{id}` — full detail with votes summary and AI analysis (null until Phase 6)

3. **Voting endpoint**
   - `POST /community/submissions/{id}/vote` — body `{verdict: "real"|"fake", impact_score: 1-5}`; requires auth (guests allowed)
   - Read `credibility_weight` from current user's `credibility_score / 100` (snapshot at vote time)
   - One vote per user per submission (`UNIQUE` constraint on `(submission_id, user_id)`) — use `ON CONFLICT DO UPDATE`
   - Returns updated `{fake_likelihood, weighted_impact}`

4. **Score computation (SQL view or Python)**
   - `fake_likelihood = SUM(credibility_weight WHERE verdict='fake') / SUM(credibility_weight)`
   - `weighted_impact = SUM(impact_score * credibility_weight) / SUM(credibility_weight)`
   - `final_score = None` until `status = 'analysed'`

5. **Frontend: `/verify`**
   - Two-panel layout: upload form left, submission feed right
   - Upload form: tab switcher (Image / URL / Text), drag-and-drop image area (converts to base64), URL input, text area; submit calls `POST /community/submissions`
   - Feed: infinite scroll using TanStack Query `useInfiniteQuery`; each card shows content preview, `fake_likelihood` badge, impact stars, vote count, "Vote" button
   - Clicking a card opens a slide-over drawer: full details, AI analysis section (shows "Pending…" spinner), vote form (Real/Fake buttons + impact slider); disabled after voting
   - Optimistic UI on vote: update local cache immediately with TanStack Query `onMutate`

### Acceptance Criteria
- A user can submit a text snippet and it appears in the feed within 2 seconds
- Voting updates the likelihood badge instantly via optimistic UI
- Guests can view and vote; `credibility_weight = 0.1` for guest votes
- A `UNIQUE` constraint prevents double-voting; re-voting updates the existing row

---

## Phase 6 — AI Verification Service

**Goal:** Async AI analysis pipeline using the `google-genai` Python SDK and Google Gemini free-tier models.

### Setup: `google-genai` SDK

```python
# Install (add to ai-service pyproject.toml)
# google-genai[aiohttp]

from google import genai
from google.genai import types
from pydantic import BaseModel

# Client reads GEMINI_API_KEY from env automatically
client = genai.Client()
```

**Free tier:** `gemini-2.0-flash-lite` — 15 RPM, 1,000 requests/day, 1M token context window. No credit card. Get a key at https://aistudio.google.com/app/apikey

### Tasks

1. **`arq` worker setup (`backend/ai-service/app/worker.py`)**
   - Define `arq` `WorkerSettings` pointing at local Redis
   - Register task `analyse_submission(ctx, submission_id: int)`
   - Register scheduled job `refresh_dashboard_cache()` every 15 min (reuse this worker for the dashboard cache warm-up from Phase 7)
   - Start locally: `arq app.worker.WorkerSettings`
   - The `community-service` enqueues the task after each submission: `await redis.enqueue_job("analyse_submission", submission_id)`

2. **Shared Pydantic schema for AI responses**
   ```python
   # shared/schemas/ai.py
   from pydantic import BaseModel

   class AnalysisResult(BaseModel):
       confidence: float        # 0.0–1.0
       signals: list[str]       # e.g. ["Missing byline", "Emotionally charged language"]
       verdict: str             # "likely_real" | "likely_fake" | "uncertain"
       explanation: str         # 2-sentence plain English for a Singaporean teenager
   ```

3. **Text/URL analyser (`app/analysers/text.py`)**
   - For `url` content type: fetch page with `httpx`, strip HTML tags with `beautifulsoup4`
   - Call Gemini with structured output using `response_schema`:
     ```python
     from google import genai
     from google.genai import types
     from shared.schemas.ai import AnalysisResult

     client = genai.Client()

     response = client.models.generate_content(
         model="gemini-2.0-flash-lite",
         contents=f"Analyse this content for misinformation signs:\n\n{content}",
         config=types.GenerateContentConfig(
             system_instruction="You are a misinformation detection expert for a Singaporean audience. Be concise and factual.",
             response_mime_type="application/json",
             response_schema=AnalysisResult,
         ),
     )
     result = AnalysisResult.model_validate_json(response.text)
     ```
   - The `response_schema` parameter enforces the JSON structure — no regex parsing needed

4. **Image analyser (`app/analysers/image.py`)**
   - `gemini-2.0-flash-lite` supports vision on the free tier — pass base64 image as a `Part`:
     ```python
     import base64

     image_bytes = base64.b64decode(base64_content)

     response = client.models.generate_content(
         model="gemini-2.0-flash-lite",
         contents=[
             types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
             types.Part.from_text(
                 "Analyse this image for signs of manipulation, deepfakes, or misinformation."
             ),
         ],
         config=types.GenerateContentConfig(
             response_mime_type="application/json",
             response_schema=AnalysisResult,
         ),
     )
     result = AnalysisResult.model_validate_json(response.text)
     ```
   - No stub needed — vision works on the free tier

5. **`analyse_submission` task (`app/worker.py`)**
   - Fetch the submission from DB; route to `text.py` or `image.py` based on `content_type`
   - Insert result into `ai_analysis` table; update `submissions.status = 'analysed'`
   - Compute and cache `final_score` in Redis: `SET submission:{id}:final_score <value> EX 3600`
   - On any exception (network error, API quota exceeded): set `submissions.status = 'community_only'`, log error, do not re-raise (so `arq` doesn't retry infinitely)

6. **Rate limit handling**
   - Free tier is 15 RPM. Add a simple `asyncio.sleep(4)` between consecutive Gemini calls in the worker to stay safely under the limit
   - Log a warning when a `429` is received; `arq` will auto-retry with backoff

7. **Frontend polling** (no change from Phase 5 design)
   - Submission drawer polls `GET /community/submissions/{id}` every 5 seconds while `status = "pending"`
   - Pulsing "AI analysis in progress…" skeleton; animate score bar on arrival with Framer Motion
   - Show `signals` as a bulleted list and `explanation` in a callout box

### Acceptance Criteria
- `arq app.worker.WorkerSettings` starts without errors and connects to Redis
- Submitting a text/URL enqueues `analyse_submission` within 2 seconds (visible in worker logs)
- AI results appear in the submission drawer within 30 seconds for text/URL, 60 seconds for images
- `final_score` is computed using the three-component formula and cached in Redis
- If the Gemini API returns a `429` or network error, `status` is set to `'community_only'` and the worker does not crash

---

## Phase 7 — Dashboard Service

**Goal:** Public awareness dashboard with trending content, scam statistics, leaderboard, and weekly highlights.

### Tasks

1. **Dashboard service endpoints**
   - `GET /dashboard/trending` — top 10 submissions by `final_score × impact_score` this week; reads from Redis cache first
   - `GET /dashboard/scam-types` — count of analysed submissions grouped by `ai_analysis.verdict` and `submissions.content_type`
   - `GET /dashboard/leaderboard?scope=weekly|alltime&limit=50` — `ZREVRANGE leaderboard:{scope} 0 {limit-1} WITHSCORES` from Redis; join with DB to get usernames + tiers
   - `GET /dashboard/stats` — `{submissions_this_week, pct_fake, most_common_type, active_users_this_week}`

2. **Caching**
   - All four endpoints: check Redis key `dashboard:{endpoint}` first (TTL 15 min); on cache miss, run DB query and write to Redis
   - Background refresh: `arq` scheduled job `refresh_dashboard_cache()` in the `ai-service` worker (reuse the same worker process) runs every 15 min to pre-warm all four cache keys

3. **Frontend: `/dashboard`**
   - Four stat cards at top: submissions this week, % fake, most common scam type, active users
   - "Scam of the Week" feature card: highest-impact verified fake submission, with `ai_analysis.explanation`
   - Bar chart (Chart.js): weekly submission counts for past 4 weeks, stacked by `likely_fake` / `likely_real` / `uncertain`
   - Leaderboard table: rank, username, tier badge, score — weekly/all-time toggle
   - Trending grid: 6 submission cards with likelihood badges and impact scores
   - No login required; `get_optional_user()` on all dashboard endpoints

### Acceptance Criteria
- Dashboard data loads from Redis cache on second visit (verify with response time < 50ms)
- Bar chart renders correctly at 375px viewport
- Leaderboard toggles between weekly and all-time with no page reload
- Dashboard is fully accessible to unauthenticated users

---

## Phase 8 — Credibility System (Wired End-to-End)

**Goal:** Credibility score fully drives voting weight, tier badges, and is visible across the UI.

### Tasks

1. **Vote outcome → credibility update**
   - After a submission reaches `status = 'analysed'`, an `arq` task `settle_credibility(submission_id)` fires
   - Task: fetch all votes for the submission, compare each `vote.verdict` to `ai_analysis.verdict` (or community majority if no AI), apply `+0.5` / `−0.2` per voter, insert `credibility_log` rows, update `users.credibility_score`
   - Set `submissions.credibility_settled = True` to prevent re-processing

2. **Credibility weight snapshot**
   - `votes.credibility_weight` is written at vote time: `min(user.credibility_score / 100, 1.0)`
   - Never recalculated retroactively — past votes keep their weight even if the user's score changes

3. **Tier update**
   - After every credibility change, recalculate `users.tier` based on the bracket rules and update the row

4. **Frontend: credibility display**
   - `src/pages/Profile.tsx`: animated arc meter (SVG, drawn with Framer Motion), tier badge, last-30-days line chart (Chart.js), game accuracy vs vote accuracy breakdown
   - Tier badge component `src/components/TierBadge.tsx`: colour-coded pill (grey/green/blue/gold) used in profile, leaderboard rows, submission cards, and vote feed
   - Vote drawer: show "Your vote weight: {weight}×" before submitting

5. **`credibility_log` endpoint**
   - `GET /community/users/me/credibility-log?days=30` — returns `[{delta, reason, new_score, created_at}]` for the profile chart

### Acceptance Criteria
- Completing a 100% accurate game session increases `credibility_score` visibly in profile
- After a submission is analysed, voters who matched the verdict see their score increase
- Tier badge across the app reflects the user's current tier bracket
- `credibility_settled = True` prevents the settle task from running twice on the same submission

---

## Phase 9 — Admin Panel & Question Pipeline

**Goal:** Internal tool for content moderators to manage the question library.

### Tasks

1. **Admin auth**
   - Add `is_admin: bool` column to `users` table (migration)
   - `get_current_admin()` dependency: calls `get_current_user()`, raises `403` if `is_admin = False`
   - Set admin flag manually via: `UPDATE users SET is_admin = true WHERE email = 'admin@example.com';`

2. **Question CRUD in `game-service`**
   - `GET /admin/questions` — paginated, filterable by `type` and `difficulty`; requires admin
   - `POST /admin/questions` — body includes all question fields; for `media_url`, accept base64 image locally (save to `LOCAL_MEDIA_DIR`)
   - `PUT /admin/questions/{id}` — partial update
   - `DELETE /admin/questions/{id}` — sets `is_active = False` (soft delete)

3. **AI-assisted explanation writing (`app/explain.py` in `ai-service`)**
   - This logic lives in `ai-service/app/explain.py` and is called directly by the `game-service` via a shared function import (both share the `shared/` library) **or** as an `arq` task `generate_explanation(content, correct_answer) -> str`
   - Implementation:
     ```python
     from google import genai
     from google.genai import types

     client = genai.Client()

     def generate_explanation(content: str, correct_answer: str) -> str:
         response = client.models.generate_content(
             model="gemini-3.1-flash-lite",
             contents=(
                 f"Question: {content}\n"
                 f"Correct answer: {correct_answer}\n\n"
                 "Write a 2-sentence plain English explanation suitable for a 16-year-old Singaporean. "
                 "Focus on the tell-tale signs that give it away."
             ),
         )
         return response.text.strip()
     ```
   - `POST /admin/questions/generate-explanation` in `game-service` enqueues this as an `arq` task and polls for the result, or calls it synchronously with `httpx` to the worker if you prefer a simpler design
   - Returns `{explanation: str}` — frontend fills the form field; moderator edits before saving

4. **Bulk import**
   - `POST /admin/questions/bulk-import` — accepts a CSV file (`multipart/form-data`); parse with `csv` stdlib; validate each row with Pydantic; return `{imported: N, errors: [{row, reason}]}`
   - CSV columns: `content,type,correct_answer,explanation,difficulty,tags`

5. **Frontend: `/admin`**
   - Protected route — redirect to home if `user.is_admin = False`
   - Data table: search input, type/difficulty filter dropdowns, paginated rows, edit/delete actions
   - Slide-over drawer for create/edit with "Generate Explanation" button that calls the API and fills the textarea
   - CSV import: file picker → upload → show preview table of parsed rows → confirm → call bulk import endpoint

### Acceptance Criteria
- An admin can create a question with a base64 image and it appears in `GET /game/questions/random` immediately
- `GET /admin/questions` returns `403` for non-admin JWTs
- "Generate Explanation" fills the textarea within 10 seconds
- Bulk import with a valid CSV imports all rows; a CSV with one bad row reports the error without skipping valid rows

---

## Phase 10 — Leaderboard, Rewards & Social Sharing

**Goal:** Weekly leaderboard snapshot, voucher email notifications, and shareable result cards.

### Tasks

1. **Weekly leaderboard reset**
   - `arq` scheduled job `weekly_leaderboard_reset()` — runs every Monday 00:00 SGT (set via `cron` in `WorkerSettings`)
   - Job: read top 50 from `leaderboard:weekly`, insert into `leaderboard_snapshots`, delete the Redis key
   - Locally, trigger manually for testing: `arq app.worker.WorkerSettings weekly_leaderboard_reset`

2. **Reward notification (email)**
   - After snapshot, for top 3 users: fetch an unclaimed voucher from `vouchers` table, send email via `smtplib` locally (use `MailHog` in Docker Compose for local SMTP catch-all)
   - Email: subject "🏆 You placed #N on Newisance this week!", body includes rank, score, voucher code
   - Set `vouchers.claimed = True`, `vouchers.user_id = winner_id`
   - Add `mailhog` to `docker-compose.yml`: `mailhog/mailhog`, ports `1025` (SMTP) and `8025` (web UI)

3. **Shareable result cards**
   - `GET /game/share/card/{session_id}` — generate a PNG using `Pillow` (draw text + simple layout on a 1200×630 canvas); save to `LOCAL_MEDIA_DIR`; return redirect to the file URL
   - Card content: rank/score, "Play at newisance.com", QR code (use `qrcode` Python library)
   - Frontend end screen: "Share your result" button calls `navigator.share({title, text, url})` with the card URL; fallback copy-to-clipboard button

4. **Telegram/WhatsApp share buttons**
   - WhatsApp: `https://wa.me/?text=I scored X on Newisance! Can you beat me? <url>`
   - Telegram: `https://t.me/share/url?url=<url>&text=<text>`
   - Two icon link buttons on the end screen below the share card

### Acceptance Criteria
- Running `weekly_leaderboard_reset` inserts rows into `leaderboard_snapshots` and clears `leaderboard:weekly`
- MailHog web UI (`http://localhost:8025`) shows the reward email for top 3 players
- `GET /game/share/card/{session_id}` returns a valid PNG
- WhatsApp share link correctly encodes the score and URL

---

## AWS Migration

Complete all 10 local phases first. When ready to move to production, work through these steps in order.

### AWS Phase A — Infrastructure Setup

1. **CDK project (`infra/`)**
   - `npm install -g aws-cdk && cdk init app --language typescript` inside `infra/`
   - Define one stack `NewisanceStack` with all resources below

2. **Networking**
   - VPC: 2 public subnets (API Gateway, ALB), 2 private subnets (ECS tasks, RDS, ElastiCache), NAT Gateway

3. **Data layer**
   - RDS: `postgres:16`, `db.t3.medium`, private subnets, automated backups, `DATABASE_URL` stored in Secrets Manager
   - ElastiCache: Redis 7, `cache.t3.micro`, private subnets, `REDIS_URL` in Secrets Manager
   - S3: `newisance-media` bucket, CORS rule allowing the frontend domain, `MEDIA_STORAGE=s3` env var

4. **ECS Fargate cluster**
   - One cluster, four task definitions (one per Python service — no extra Node.js container needed)
   - Each task: 512 CPU / 1024 MB RAM, env vars from Secrets Manager, IAM task role scoped to its needed resources
   - `ai-service` task needs `GEMINI_API_KEY` (from Secrets Manager), `DATABASE_URL`, and `REDIS_URL`; it has no ALB target group — it is a worker only
   - Application Load Balancer routes `/api/game/*` → game service, `/api/community/*` → community service, `/api/dashboard/*` → dashboard service

5. **SQS (replaces `arq` locally)**
   - FIFO queue `ai-verification-queue.fifo`
   - Community service: replace `await redis.enqueue_job(...)` with `boto3` SQS `send_message`
   - `ai-service` worker: replace `arq` polling with a loop calling `sqs.receive_message` (long polling, 20s); Gemini calls remain unchanged — same `google-genai` SDK, same `GEMINI_API_KEY`
   - Weekly leaderboard reset: EventBridge cron → Lambda (small Python function) instead of `arq` scheduled job

6. **Cognito (replaces local JWT)**
   - User Pool: email sign-up with verification, Google + Facebook federation, password policy
   - Identity Pool: guest (unauthenticated) access → returns temporary credentials with `credibility_weight = 0.1`
   - Replace `shared/auth.py` JWT logic with `python-jose` validating Cognito JWKS (`/.well-known/jwks.json`)
   - Replace `POST /auth/register` + `POST /auth/login` with Cognito hosted UI or Amplify SDK on the frontend

7. **CloudFront + API Gateway**
   - CloudFront distribution: origin group pointing at the ALB (API) and S3 (media + frontend static files)
   - API Gateway HTTP API in front of the ALB for WAF + rate limiting

### AWS Phase B — Application Changes

1. **Config updates**
   - `GEMINI_API_KEY` is identical locally and in production — store in Secrets Manager, inject into `ai-service` task. No code changes needed.
   - Add `MEDIA_STORAGE=s3` branch in community service upload handler: use `boto3 s3.upload_fileobj` instead of local file write; return CloudFront URL
   - Add `EMAIL_BACKEND=ses` branch in reward notification: replace `smtplib`/MailHog with `boto3 ses.send_email`
   - Share card: save PNG to S3 instead of local disk; return CloudFront URL
   - All changes behind env-var feature flags so local dev still works unchanged

2. **Docker images**
   - Add `ECR_REPOSITORY` to each service's CDK task definition
   - GitHub Actions: on push to `main`, build and push each service image to ECR, then `ecs update-service --force-new-deployment`

3. **Secrets**
   - Move all secrets from `.env` to AWS Secrets Manager
   - CDK injects them as environment variables into ECS task definitions via `secrets:` field

### AWS Phase C — Frontend Deployment

1. Build: `npm run build` in `frontend/web` → outputs to `dist/`
2. Upload `dist/` to S3 bucket (`newisance-frontend`)
3. Invalidate CloudFront cache: `aws cloudfront create-invalidation --paths "/*"`
4. Update `vite.config.ts` proxy: in production, remove proxying (the ALB handles routing); update API base URL to the CloudFront domain

### AWS Phase D — Final Checks

- Run `cdk synth` — no errors
- Run `cdk deploy` — all resources created
- Smoke test each endpoint through the CloudFront URL
- Verify MailHog is replaced with SES and test email is received
- Verify `leaderboard:weekly` is updated via SQS + ECS, not local `arq`
- Enable AWS WAF rule for CAPTCHA on `POST /community/submissions` and `POST /auth/register`

---

## General Guidelines for Claude

- **Always write Python** for all backend — type hints everywhere, Pydantic models for all request/response bodies, no untyped dicts passed across function boundaries
- **Always write TypeScript** for the frontend — no `any`; use types from `src/types/` mirroring the Pydantic schemas
- **Follow the folder structure exactly** — do not create files outside the structure above without explaining why
- **Database migrations via Alembic** — never write raw DDL; always add to `shared/db/models.py` and generate a migration with `alembic revision --autogenerate -m "description"`
- **Never hardcode secrets** — all credentials via environment variables read through `shared/config.py`
- **Error handling** — all API endpoints return `ApiResponse[T]` with `{data, error, status}`; use FastAPI `HTTPException` for client errors, let middleware catch unhandled exceptions and return a 500
- **Input validation** — use Pydantic models for all request bodies; FastAPI handles this automatically when you declare `body: MySchema` in the route signature
- **Tests** — write at least one `pytest` integration test per endpoint; use `httpx.AsyncClient` with the FastAPI `TestClient`; use a separate test DB (set `DATABASE_URL` in `docker-compose.test.yml`)
- **Mobile-first** — all frontend components must work at 375px viewport
- **Accessibility** — interactive elements need `aria-label`; colour is never the only indicator of verdict (add text labels alongside colour)
- **Local-first** — never introduce an AWS SDK call without a local fallback behind an env-var flag (`MEDIA_STORAGE`, `EMAIL_BACKEND`, `QUEUE_BACKEND`)

---

## How to Ask Claude to Implement a Phase

```
Implement Phase N of Newisance as described in CLAUDE.md.

Context on what's already built: [briefly list completed phases]

Start with: [specific task from the phase, e.g. "the Alembic models and migration"]

The repo is at: [path]
```

To continue within a phase:

```
Continue Phase N of Newisance. Completed so far: [tasks done]. Now implement: [next task].
```

To start the AWS migration:

```
Begin AWS Phase A for Newisance as described in the AWS Migration section of CLAUDE.md.
The local phases are all complete. Start with: [CDK stack / Networking / Data layer / etc.]
```