# Newisance — Tech Stack

> **Newisance** is a gamified web app that helps young Singaporeans spot online
> misinformation. *"Spot the fake, Stop the spread!"* Built for Brain Hack 2026.

This document explains the whole stack, end to end, for anyone joining the
project or evaluating it.

---

## 1. High-level architecture

Newisance is a **microservices** web app: a single React single-page app (SPA)
talks to **four independent Python backend services** over HTTP/WebSocket,
backed by **PostgreSQL** and **Redis**. A separate AI worker analyses
user-submitted content asynchronously using **Google Gemini**.

```
                         Browser (React SPA)
                                 │
                                 │  /api/*  (HTTP + WebSocket)
                                 ▼
                ┌────────── reverse proxy ──────────┐
                │  Vite dev proxy (local)           │
                │  Caddy (production)               │
                └───────────────────────────────────┘
        ┌───────────────┬───────────────┬───────────────┐
        ▼               ▼               ▼               ▼
  game-service    community-service  dashboard-service  ai-service
   (:8001)            (:8003)           (:8002)        (worker, no port)
        │               │               │               │
        └───────┬───────┴───────┬───────┴───────────────┘
                ▼               ▼
          PostgreSQL          Redis
        (data of record)  (queue, cache,
                           leaderboards, rooms)
```

Every service shares one database and a common `shared/` Python package
(SQLAlchemy models, auth, config, scoring rules), so business logic such as
credibility tiers lives in exactly one place.

---

## 2. Frontend

| Concern | Choice |
| --- | --- |
| Framework | **React 19** |
| Build tool / dev server | **Vite 6** |
| Language | **TypeScript 5.7** |
| Styling | **Tailwind CSS v4** (via `@tailwindcss/vite`) |
| Routing | **react-router-dom 7** |
| 3D / game world | **three.js** + **@react-three/fiber** + **@react-three/drei** |
| E2E tests | **Playwright** |
| Data fetching | Native `fetch` wrapped in a memoised `useApi()` hook (no TanStack/axios) |
| State | React Context (`AuthContext`) — no Redux/Zustand |

**Notable frontend pieces**

- **"Newisance Town"** — the app's main menu is a fully explorable **3D town**
  built with react-three-fiber. A third-person blocky avatar walks (WASD /
  arrow keys) between distinct building models — a colosseum Battle Arena, a
  planetarium Observatory, a Trophy Hall, a Fact-Check Lab, a Power-Up Shop,
  etc. — and entering a building navigates to that feature. three.js is
  code-split (`lazy` + `Suspense`) so it only loads on the town routes; the main
  bundle stays ~108 KB gzipped.
- **Timed Challenge** — a **Flappy Bird-style** game on an HTML5 `<canvas>` with
  a `requestAnimationFrame` loop. Each question is an obstacle with a "REAL" gap
  and a "FAKE" gap; you fly the bird through the gap matching your verdict.
  Power-ups (shield, slow-mo, shrink, double points) bought in the shop are
  wired into the physics loop.
- **Battle Royale** — real-time multiplayer over **WebSockets**; last player
  standing wins.

The frontend is intentionally lean on dependencies — only React, the router,
and the three.js trio ship to users.

---

## 3. Backend services

All four are **Python 3.12 + FastAPI**, async throughout (SQLAlchemy 2.0 async
ORM + `asyncpg`). Each is a separate Docker image and can scale independently.

| Service | Port | Responsibility |
| --- | --- | --- |
| **game-service** | 8001 | Timed Challenge + Battle Royale (WebSocket), leaderboards, admin question pipeline, power-up shop, social share cards |
| **community-service** | 8003 | Submit suspicious content, community voting, comments, media uploads |
| **dashboard-service** | 8002 | Read-only public awareness dashboard (trending fakes, scam types, stats) |
| **ai-service** | — | Background **arq** worker: AI analysis, credibility settlement, dashboard cache pre-warming, weekly leaderboard reset + reward emails |

**Shared conventions**

- Routes are mounted **bare** (e.g. `/sessions`, `/auth/login`); the proxy
  supplies the namespace (`/api/game/*` → 8001, `/api/community/*` → 8003,
  `/api/dashboard/*` → 8002) and strips the prefix.
- A common `shared/` package holds SQLAlchemy models, JWT auth, Pydantic config,
  and the single source of truth for scoring/credibility rules.

---

## 4. Data & infrastructure

| Component | Tech | Used for |
| --- | --- | --- |
| Primary database | **PostgreSQL 16** | Users, questions, submissions, votes, comments, credibility logs, vouchers, leaderboard snapshots |
| Migrations | **Alembic** | Versioned schema (currently head `0009_powerups`) |
| Cache / queue / realtime | **Redis 7** | `arq` task queue, dashboard cache (15-min TTL), sorted-set leaderboards, Battle Royale room state |
| Async tasks | **arq** (Redis-backed) | AI analysis jobs + scheduled cron (dashboard refresh, weekly reset) |
| Email (dev) | **MailHog** | Catches reward emails locally (SMTP :1025, UI :8025) |
| Media storage | Local shared Docker volume | User-uploaded images/video, generated share cards |

---

## 5. AI layer

- **Provider:** Google **Gemini** via the `google-genai` Python SDK
  (`gemini-2.5-flash` on the current account; structured JSON output).
- **Deterministic-first design:** A pure-Python **heuristic analysis engine**
  (`report.py`) always runs first — it fetches URLs (`httpx` + `BeautifulSoup`),
  checks domain reputation, and scores scam/clickbait/sensationalism cues. This
  produces a full credibility report **with no API calls and no rate limits**.
- **AI enrichment:** When a Gemini key is configured, a semantic layer is
  blended in and adds independent **cross-reference suggestions** (the key AI
  value-add) — never trusting LLM-generated URLs (it links to search queries
  instead).
- **Graceful degradation:** If Gemini is unavailable, rate-limited (free tier:
  ~20 requests/day), or has no key, the app falls back to the heuristic engine
  and/or "community review only" — the pipeline never breaks.

---

## 6. Supporting systems

- **Credibility system** — every user has a credibility score and a tier
  (Newcomer → Verified → Analyst → Expert). Accurate votes raise it; misses
  lower it. Credibility weights a user's vote and is spent in the power-up shop.
- **Power-Up Shop** — spend credibility on in-game power-ups (shield, slow-mo,
  shrink, double points).
- **Social sharing** — game results render to a **1200×630 PNG share card**
  (Pillow + qrcode) with WhatsApp/Telegram share links.

---

## 7. Local development & deployment

**Local (Docker Compose)** — `docker compose up` starts Postgres, Redis,
MailHog, and all four services. The frontend runs on Vite's dev server (`npm run
dev`, :5173) which proxies `/api/*` to the right backend.

**Production (single VM)** — `docker-compose.prod.yml` runs everything behind a
single **Caddy** container on :80/:443. Caddy serves the React build and reverse
-proxies `/api/*` to the internal services; it handles **automatic HTTPS** via
Let's Encrypt. A one-shot `migrate` container creates/seeds the schema before
the services start. The original spec (`AGENTS.md`) also documents an intended
**AWS** target (ECS Fargate, RDS, ElastiCache, S3, SQS, Cognito, CloudFront).

| Tooling | Choice |
| --- | --- |
| Frontend package manager | **npm** |
| Backend package manager | **Poetry / uv** per service |
| Containerisation | **Docker** + **Docker Compose** |
| Production web server / TLS | **Caddy** |
| Auth | **JWT** (`python-jose`), email/password + Google login; guest tokens |

---

## 8. Reverse proxy & request routing

Newisance isn't one app — it's a React frontend plus **four separate backend
services**, each on its own port (game `:8001`, dashboard `:8002`, community
`:8003`; the ai-service is a portless worker). A browser, however, should only
ever talk to **one** address. A **reverse proxy** sits in front of everything as
the single front door and routes each request to the right service by URL path.

**The `/api/*` convention.** Backend routes are mounted **bare** (a service
defines `/sessions` or `/auth/login` — it doesn't know it's "the game service").
The proxy supplies the namespace and strips it before forwarding:

```
Browser request               Proxy strips prefix    Lands at
/api/game/sessions       →     /sessions          →  game-service       :8001
/api/community/submissions →   /submissions       →  community-service  :8003
/api/dashboard/stats     →     /stats             →  dashboard-service  :8002
anything not /api/*       →    (unchanged)        →  the React SPA
```

This is why backend routers carry no `/game` prefix — adding one would double up
(`/game/game/...` → 404). The same convention is implemented by **two different
proxies** depending on environment:

- **Local dev — Vite's dev-server proxy.** `npm run dev` serves the SPA on
  `:5173`; its proxy (in `vite.config`) forwards `/api/game/*` → `localhost:8001`
  etc. The game proxy sets `ws: true` so **WebSocket** traffic (Battle Royale's
  live multiplayer) passes through, not just HTTP.
- **Production — Caddy.** In `docker-compose.prod.yml` the only container with a
  public port is `web` (Caddy) on `:80`/`:443`. Every other service — the four
  backends, Postgres, Redis — has **no published port** and is reachable only on
  Docker's internal network, so the outside world can *only* get in through Caddy.

**Why Caddy.** Configured by `frontend/Caddyfile`, Caddy does two jobs: (1) it
**serves the compiled React build** (`dist/`) for any non-API request, and (2) it
**reverse-proxies `/api/*`** to the internal backends using the same
prefix-stripping rule. It was chosen over nginx for its headline feature —
**automatic HTTPS**: point a domain at it via `SITE_ADDRESS` and Caddy obtains
and auto-renews a free Let's Encrypt TLS certificate with no certbot or cron. The
`caddy_data` volume persists those certs across restarts to avoid re-requesting
them (and hitting Let's Encrypt rate limits). With `SITE_ADDRESS` unset it serves
plain HTTP on `:80` for testing.

```
Browser ──HTTPS──> Caddy (:443, auto-TLS)
                     ├─ /api/game/*      → game-service:8001       (internal)
                     ├─ /api/community/* → community-service:8003  (internal)
                     ├─ /api/dashboard/* → dashboard-service:8002  (internal)
                     └─ everything else  → serves the React SPA
```

One public port, one TLS cert, four hidden services behind it.

---

## 9. Stack at a glance

- **Frontend:** React 19 · Vite 6 · TypeScript · Tailwind CSS v4 · react-router 7 · three.js / react-three-fiber · Playwright
- **Backend:** Python 3.12 · FastAPI (×4 services) · SQLAlchemy 2.0 async · arq
- **Data:** PostgreSQL 16 · Redis 7 · Alembic
- **AI:** Google Gemini (`google-genai`) + a deterministic heuristic fallback engine
- **Infra:** Docker Compose · Caddy (prod, auto-HTTPS) · MailHog (dev email) · JWT auth
