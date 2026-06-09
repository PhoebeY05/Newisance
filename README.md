<div align="center">

# 🗞️ Newisance

**Build Digital Judgement. Fight Misinformation.**

A gamified platform for young Singaporeans to identify, report, and learn from online misinformation. Built for **Brain Hack 2026**.

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

</div>

---

## What is Newisance?

Misinformation spreads fast — but most people only ever *read about* fake news, never practice spotting it themselves. Newisance flips that.

It's a web platform where users:

- **Play** Flappy Bird-style and Battle Royale games to train themselves to identify fake news, deepfakes, and scam messages in real time
- **Verify** suspicious content by uploading it, voting on it as a community, and getting an AI-assisted verdict
- **Level up** a credibility score that reflects their accuracy over time — higher-credibility users carry more weight in community votes
- **Track** trending misinformation through a public awareness dashboard

---

## Features


### 🎮 Gamified Training
Two game modes built to make media literacy feel like a game, not a lecture.

**Timed Challenge (Flappy Bird)** — Guide a newspaper through pipes labelled *Real* / *Fake* to lock in your answer. The faster and more accurate you are, the more points you earn.

**Battle Royale** — Compete live against other players. Wrong answers eliminate you instantly. Last one standing wins.

Both modes are designed to cover five content types: scam messages, deepfakes, manipulated media, misleading headlines, and satire.

### 🔍 Community Verification Hub
Submit a suspicious image, URL, or text caption. The community votes on whether it's real or fake (1–5 impact rating), and an AI pipeline runs in parallel to produce a confidence score and plain-English explanation.

Final verdict = `(50% community vote) + (30% AI confidence) + (20% submitter credibility)`

### ⭐ Credibility System
Every user has a credibility score (0–100) that evolves based on game accuracy and voting track record. Accurate users carry more weight in community verdicts, making the platform self-reinforcing against spam and bad-faith voting.

| Tier | Score | Voting weight |
|---|---|---|
| Newcomer | 0–30 | 0.0–0.3× |
| Verified | 31–60 | 0.31–0.6× |
| Analyst | 61–80 | 0.61–0.8× |
| Expert | 81–100 | 0.81–1.0× |

### 📊 Public Dashboard
A no-login-required awareness page showing trending fakes, scam-of-the-week, weekly submission stats, and the global leaderboard.

### 🏆 Rewards
Top players on the weekly leaderboard receive voucher rewards. Weekly results are archived and reset every Monday.

### Tech stack
#### Frontend

- **React 19** + **TypeScript**
- **Vite 6** (dev server + build)
- **Tailwind CSS v4** (via `@tailwindcss/vite`); design tokens in `frontend/src/index.css` under `@theme`
- **React Router 7** for routing

#### Backend
- **Python 3.12 + FastAPI** (microservices)
- **PostgreSQL 16**,
- **Redis 7** (leaderboard sorted sets + Battle Royale pub/sub)

### Pages & routes

Most screens render inside `MainLayout` (navbar + footer); the two full-screen
games are routed standalone.

| Route | Page | Description |
|-------|------|-------------|
| `/` | `Home` | Landing page: hero, weekly alerts, top defenders, top scams |
| `/learn` | `Learn` | "Choose Your Game Mode" — Battle Royale & Timed Challenge |
| `/verify` | `Verify` | Submit content for community verification (+ "Go to Feed") |
| `/dashboard` | `Dashboard` | Public "Critical Misinformation Dashboard" |
| `/leaderboard` | `Leaderboard` | Top Newisance defenders, ranks & rewards |
| `/account` | `Account` | Profile & account settings |
| `/login`, `/signup` | `Login`, `Signup` | Auth forms (share `AuthForm`) |
| `/ai-analysis` | `AIAnalysis` | AI-powered credibility analysis report |
| `/community` | `Community` | Community verification feed |
| `/community/post` | `CommunityPost` | Post details + community fact-checks |
| `/battle-royale` | `BattleRoyale` | Full-screen multiplayer game _(standalone)_ |
| `/timed-challenge` | `TimedChallenge` | Full-screen Flappy-Bird-style game _(standalone)_ |

---

## Getting Started

### Prerequisites

- [Node.js 20+](https://nodejs.org) and npm — frontend
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose — Postgres, Redis, MailHog, and the services
- [Python 3.12+](https://www.python.org/downloads/) — running migrations/seeds and backend tests from the host (optional; Compose runs the services without it)
- A [Google AI Studio key](https://aistudio.google.com/app/apikey) — **optional**; the AI service works without one (deterministic analysis), the key just adds the Gemini semantic layer

### Backend Setup

Quick steps to bring up the local Postgres + Redis and apply DB migrations + seed sample data.

1) Copy environment file:

```bash
cp .env.example .env
# Edit .env to adjust values if needed
```

2) Start Postgres and Redis (Docker):

```bash
docker compose up -d postgres redis
```

3) Create a Python virtualenv and install tools:

```bash
python3 -m venv .venv
source .venv/bin/activate (mac)
source .venv/Scripts/activate (windows)
pip install -r requirements.txt
```

4) Run Alembic migrations and seed sample questions:

```bash
alembic -c alembic.ini upgrade head (mac)
py -m alembic -c alembic.ini upgrade head (windows)
python shared/db/seed.py (macs)
py -m shared.db.seed (windows)
```

Notes:
- Alembic is configured to use `shared/db/alembic/env.py`, which reads `DATABASE_URL` from your `.env` via `shared.config`.
- If you prefer to run migrations from inside a service container, adjust commands accordingly.

### Run frontend

The frontend lives in [`frontend/`](frontend/). Run all commands from there:

```bash
cd frontend
npm install      # first time only
npm run dev      # start the dev server → http://localhost:5173
```

Other scripts:

```bash
npm run build    # type-check (tsc -b) and build for production → dist/
npm run preview  # preview the production build locally
```

Open **http://localhost:5173** in your browser.

### Run backend

The backend is four FastAPI/Python services under [`backend/`](backend/), plus
Postgres, Redis, and MailHog. Bring everything up with Docker Compose from the
repo root:

```bash
docker compose up --build           # all services + infra
docker compose up --build game-service   # or just one (deps start automatically)
```

#### Services

| Service | Port | Proxy namespace | Responsibility | Docs |
|---------|------|-----------------|----------------|------|
| **game-service** | `8001` | `/api/game` | Timed Challenge, Battle Royale, questions, admin, share cards | [README](backend/game-service/README.md) |
| **dashboard-service** | `8002` | `/api/dashboard` | Public trending / stats / leaderboard (read-only, cached) | [README](backend/dashboard-service/README.md) |
| **community-service** | `8003` | `/api/community` | Auth & users, submissions, voting, comments | [README](backend/community-service/README.md) |
| **ai-service** | _(worker)_ | — | Async AI verification, credibility settlement, crons, rewards | [README](backend/ai-service/README.md) |

The frontend's Vite proxy maps each `/api/*` namespace to the right service and
strips the prefix (so `/api/game/sessions` → game-service `/sessions`). The
**ai-service** has no HTTP port — it's an `arq` worker driven by the Redis queue
and cron schedules. Reward emails land in MailHog's web UI at
**http://localhost:8025**.

---

## Deployment

The whole app — frontend, all four backend services, Postgres, Redis, MailHog —
runs from one command using [`docker-compose.prod.yml`](docker-compose.prod.yml).
A single [Caddy](https://caddyserver.com) container is the only thing exposed to
the internet (port `80`): it serves the React build and reverse-proxies `/api/*`
to the backend services (the production equivalent of the Vite dev proxy). DB
migrations + seeding run automatically once via a one-shot `migrate` service.

See [DEPLOY.md](DEPLOY.md) for the full guide. Quick version for **Google
Cloud** (Compute Engine):

### 1. Create a VM

In the [Google Cloud Console](https://console.cloud.google.com) → **Compute
Engine → VM instances → Create instance**:

- **Region:** `us-central1` (or `us-west1`/`us-east1` for the Always-Free tier)
- **Machine type:** `e2-medium` (2 vCPU, **4 GB** — builds smoothly, uses the
  $300 free credit). `e2-micro` (1 GB) is Always-Free but needs swap (step 3).
- **OS and storage:** Ubuntu **24.04 LTS**, **30 GB** disk.
- **Networking → Firewall:** check ✅ **Allow HTTP traffic**.
- **Create**, then copy the instance's **External IP**.

### 2. Connect

Click the **SSH** button next to the instance — it opens a browser terminal, no
key files to manage.

### 3. (e2-micro only) Add swap

Skip on `e2-medium`. On a 1 GB `e2-micro` the frontend build needs swap:

```sh
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 4. Install Docker

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit          # close the SSH tab, then click SSH again to reconnect
```

### 5. Deploy

```sh
git clone <your-repo-url> newisance && cd newisance
cp .env.example .env
nano .env     # set JWT_SECRET (run: openssl rand -hex 32),
              # APP_BASE_URL=http://<external-ip>, and optionally GEMINI_API_KEY
docker compose -f docker-compose.prod.yml up -d --build
```

The build takes ~5 min on `e2-medium` (~10–15 min on `e2-micro`). Then open
**`http://<external-ip>`** — no port number needed (Caddy serves on `80`).

### Operate

```sh
docker compose -f docker-compose.prod.yml ps            # status
docker compose -f docker-compose.prod.yml logs -f web   # logs (any service)
docker compose -f docker-compose.prod.yml up -d --build # redeploy after a git pull
docker compose -f docker-compose.prod.yml down          # stop (keeps data)
```

> **Tips:** If the page doesn't load, it's almost always the "Allow HTTP traffic"
> firewall rule. The External IP is ephemeral by default (reserve a static IP
> under **VPC network → IP addresses** if you need it stable). **Stop or delete**
> the VM when the hackathon ends to avoid charges. For HTTPS with a domain,
> point a DNS A record at the VM and change `:80` in
> [`frontend/Caddyfile`](frontend/Caddyfile) to your domain — Caddy
> auto-provisions a Let's Encrypt certificate.

---

## Repository Structure

```text
newisance/
├── frontend/                       # React + Vite single-page app
│   ├── index.html
│   ├── vite.config.ts              # Dev server + /api/* proxy to the services
│   ├── tsconfig*.json
│   ├── playwright.config.ts        # E2E config (boots Vite, stubs the API)
│   ├── e2e/                        # Playwright specs
│   ├── public/
│   └── src/
│       ├── main.tsx                # Entry point (BrowserRouter)
│       ├── App.tsx                 # Route map
│       ├── index.css               # Tailwind import + design tokens (@theme)
│       ├── layouts/                # MainLayout (Navbar + Footer shell)
│       ├── components/             # Navbar, Footer, Logo, AuthForm, …
│       ├── context/                # AuthContext
│       ├── data/                   # Static data (e.g. nav links)
│       └── pages/                  # One component per screen (see table above)
│
├── backend/
│   ├── game-service/               # Timed Challenge + Battle Royale    :8001
│   ├── dashboard-service/          # Public stats + leaderboard         :8002
│   ├── community-service/          # Submissions, voting, user auth     :8003
│   └── ai-service/                 # Async AI verification worker (no port)
│       # each: app/ (FastAPI or arq), tests/, pyproject.toml, Dockerfile, README.md
│
├── shared/                         # Shared Python lib (models, auth, config, schemas)
│   └── db/
│       ├── models.py               # SQLAlchemy models (single source of truth)
│       ├── alembic/                # Migrations
│       └── seed.py                 # Sample question seeder
├── infra/                          # AWS CDK (used at migration time)
├── alembic.ini                     # Alembic config (points at shared/db/alembic)
├── requirements.txt                # Migration/tooling deps (run from repo root)
├── docker-compose.yml              # Local orchestration (services + Postgres/Redis/MailHog)
└── AGENTS.md                       # Phased implementation guide
```

Each backend service has its own **README** with its endpoints, modules, and
run/test commands — see the table in [Run backend](#run-backend).

---

## Design

Theme tokens — brand blue, teal, highlight yellow, navy cards, risk-level
green→red, and grayscale text — are defined once in `frontend/src/index.css`
under `@theme`, so all pages share a consistent look.

---

## Credibility System

Users start with a credibility score of 50. It changes based on two signals:

**Game accuracy** — after each session:
```
new_score = old_score × 0.9 + session_accuracy × 10
```

**Voting accuracy** — after a submission is verified:
- Correct vote (matched final verdict): **+0.5**
- Incorrect vote: **−0.2**

Voting weight = `credibility_score / 100`, capped at 1.0. Guest users are fixed at 0.1.

---

## Roadmap

- [x] Frontend UI for all screens (built from Figma)
- [x] Backend services (game, community, dashboard, AI)
- [x] Auth (email/password + guest) and JWT propagation
- [x] Timed Challenge wired end-to-end (sessions, scoring, share cards)
- [x] Real-time Battle Royale (WebSockets + Redis rooms)
- [x] Community verification: submissions, weighted voting, comments
- [x] AI verification pipeline (deterministic heuristics + optional Gemini)
- [x] Credibility scoring & tiers, settled after each verdict
- [x] Admin question management (CRUD, AI explanations, CSV import)
- [x] Leaderboard, weekly reset, voucher rewards
- [ ] AWS deployment (see [AGENTS.md](AGENTS.md) → AWS Migration)

---

## Team

**Team Toothless** — Built for the Newisance hackathon challenge.

---

<div align="center">

**Play. Learn. Defend.**

*Building a generation of critically-aware Singaporeans through interactive gameplay.*

</div>
