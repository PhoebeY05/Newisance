# Newisance — Local Dev Quickstart

Quick steps to bring up the local Postgres + Redis and apply DB migrations + seed sample data for Phase 1.

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
source .venv/bin/activate
pip install -r requirements.txt
```

4) Run Alembic migrations and seed sample questions:

```bash
alembic -c alembic.ini upgrade head
python shared/db/seed.py
```

Notes:
- Alembic is configured to use `shared/db/alembic/env.py`, which reads `DATABASE_URL` from your `.env` via `shared.config`.
- If you prefer to run migrations from inside a service container, adjust commands accordingly.
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

- [Node.js 20+](https://nodejs.org) and npm

### Run the frontend

The app lives in [`frontend/`](frontend/). Run all commands from there:

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

---

## Repository Structure

```text
newisance/
└── frontend/                  # React + Vite single-page app
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig*.json
    ├── public/
    └── src/
        ├── main.tsx           # Entry point (BrowserRouter)
        ├── App.tsx            # Route map
        ├── index.css          # Tailwind import + design tokens (@theme)
        ├── layouts/
        │   └── MainLayout.tsx # Navbar + Footer shell
        ├── components/        # Navbar, Footer, Logo, AuthForm, PageHeader, PageStub
        ├── data/              # Static mock data (e.g. nav links)
        └── pages/             # One component per screen (see table above)
├── backend/
│   ├── game-service/               # Battle Royale + Timed Challenge   :8001
│   ├── dashboard-service/          # Public stats + leaderboard         :8002
│   ├── community-service/          # Uploads, voting, user auth         :8003
│   └── ai-service/                 # Async AI verification worker
├── shared/                         # Shared Python library (models, auth, schemas)
├── infra/                          # AWS CDK (used at migration time)
└── docker-compose.yml
```

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

- [x] Frontend UI for all screens (built from Figma, mock data)
- [ ] Backend services (game, community, dashboard, AI)
- [ ] Wire frontend forms & data to the API
- [ ] Real-time Battle Royale (WebSockets + Redis)
- [ ] AI verification pipeline
- [ ] Auth, credibility scoring, and weekly rewards
- [ ] AWS deployment

---

## Team

**Team Toothless** — Built for the Newisance hackathon challenge.

---

<div align="center">

**Play. Learn. Defend.**

*Building a generation of critically-aware Singaporeans through interactive gameplay.*

</div>
