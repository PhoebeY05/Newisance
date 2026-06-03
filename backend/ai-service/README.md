# ai-service

> Background worker (no HTTP port). Runs AI verification, voter-credibility
> settlement, scheduled dashboard cache refresh, and the weekly leaderboard
> reset + rewards.

**Type:** `arq` worker (no public port) · **Queue/scheduler:** Redis · **Entry point:** [`app/worker.py`](app/worker.py)

Started with `arq worker.WorkerSettings`. Other services enqueue jobs onto the
shared Redis queue; locally `arq` replaces what becomes SQS + EventBridge in
production.

---

## Design: deterministic-first

Analysis is **deterministic-first** and AI is an *optional enrichment layer*:

1. A heuristic report **always** runs — domain reputation, page-metadata parsing
   (BeautifulSoup), and text signals. No API key, no rate limits. This is the
   source of truth for the AI Analysis page.
2. When `GEMINI_API_KEY` is set, a Gemini call adds a *semantic* layer: a claim
   verdict plus suggested **independent sources** to cross-reference. The result
   is blended into the heuristic credibility score (`AI_BLEND_WEIGHT`).
3. If Gemini is disabled, rate-limited, or errors, the deterministic report
   stands and the submission is still marked `analysed`. Only truly unexpected
   failures downgrade it to `community_only`.

So the platform is fully functional **without** an API key.

---

## Jobs

| Job / cron | Trigger | What it does |
|------------|---------|--------------|
| `analyse_submission(submission_id)` | enqueued by [community-service](../community-service/) on new/edited submissions | Run analysis, write `ai_analysis`, set `status=analysed`, cache `final_score`, then enqueue `settle_credibility` |
| `settle_credibility(submission_id)` | enqueued after analysis | Reward (+0.5) / penalise (−0.2) each voter vs the resolved verdict; write `credibility_log`; recompute tiers. Idempotent via `credibility_settled` |
| `generate_explanation(content, answer)` | enqueued by game-service admin | Draft a question explanation (Gemini, with heuristic fallback); returned as the job result |
| `refresh_dashboard_cache` | cron, every 15 min | Pre-warm the `dashboard:*` Redis keys read by [dashboard-service](../dashboard-service/) |
| `weekly_leaderboard_reset` | cron, Sun 16:00 UTC (= Mon 00:00 SGT) | Snapshot top 50 to `leaderboard_snapshots`, reward top 3 with a voucher + email, clear `leaderboard:weekly` |

---

## Key modules

| File | Purpose |
|------|---------|
| [`app/worker.py`](app/worker.py) | `WorkerSettings`, all jobs, crons, blending & rewards |
| [`app/report.py`](app/report.py) | Deterministic analysis engine (text & image reports) |
| [`app/heuristic.py`](app/heuristic.py) | Text / domain misinformation signals |
| [`app/gemini.py`](app/gemini.py) | `google-genai` wrapper: enable check, text/image assessment, rate-limit detection |
| [`app/analysers/text.py`](app/analysers/text.py) | URL fetch + text analysis |
| [`app/analysers/image.py`](app/analysers/image.py) | Image (vision) analysis |
| [`app/explain.py`](app/explain.py) | Question-explanation generation |

Composite score (cached for the dashboard):
`final_score = 0.5·weighted_community_vote + 0.3·ai_confidence + 0.2·submitter_credibility`.

---

## Running

Via the root `docker-compose.yml` (also brings up Redis, Postgres, and MailHog
for reward emails):

```bash
# from the repo root
docker compose up --build ai-service
```

Standalone:

```bash
cd backend/ai-service/app
PYTHONPATH=../../..:. arq worker.WorkerSettings
```

Needs Redis + Postgres and a repo-root `.env`. Reward emails use local SMTP
(MailHog web UI at http://localhost:8025).

### Triggering jobs locally

`analyse_submission` fires automatically when you create a submission via
[community-service](../community-service/). To run a cron job on demand, call its
coroutine directly (see the docstrings in [`worker.py`](app/worker.py)).

## Tests

```bash
cd backend/ai-service
pytest
```

Covers the worker pipeline ([`test_worker.py`](tests/test_worker.py)), credibility
settlement ([`test_settle.py`](tests/test_settle.py)), and weekly rewards
([`test_rewards.py`](tests/test_rewards.py)). Gemini is not called in tests.

## Environment

| Var | Purpose |
|-----|---------|
| `DATABASE_URL`, `REDIS_URL` | DB + queue/cache |
| `GEMINI_API_KEY` | Optional — enables the semantic layer ([AI Studio](https://aistudio.google.com/app/apikey)) |
| `GEMINI_MODEL` | Model id (default per [`shared/config.py`](../../shared/config.py)) |
| `GEMINI_THROTTLE_SECONDS` | Pause after each Gemini call (default `4`, stays under free-tier RPM) |
| `AI_BLEND_WEIGHT` | Weight of the Gemini verdict vs heuristic (default `0.55`) |
| `EMAIL_BACKEND`, `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`, `APP_BASE_URL` | Reward-email delivery |
| `LOCAL_MEDIA_DIR` | Where submission images are read from (shared volume) |

---

See the [root README](../../README.md) and [AGENTS.md](../../AGENTS.md) (Phases 6, 7, 8, 10).
