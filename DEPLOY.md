# Deploying Newisance (single VM)

The whole app — frontend, 4 backend services, Postgres, Redis, MailHog — runs
from one `docker compose` command. A single [Caddy](https://caddyserver.com)
container is the only thing exposed to the internet (port 80): it serves the
React build and reverse-proxies `/api/*` to the backend services.

## 1. Provision a VM

Any small Linux VM works (DigitalOcean / Hetzner / EC2 — 2 GB RAM is enough).
Open inbound port **80** (and 22 for SSH). Install Docker:

```sh
curl -fsSL https://get.docker.com | sh
```

## 2. Get the code + secrets

```sh
git clone <your-repo-url> newisance && cd newisance
cp .env.example .env
```

Edit `.env`:

- `JWT_SECRET` — set a long random string (`openssl rand -hex 32`).
- `APP_BASE_URL` — `http://<your-server-ip>`.
- `GEMINI_API_KEY` — optional. Leave blank to run AI analysis in offline
  heuristic mode (no Google AI Studio key needed).

> `DATABASE_URL` / `REDIS_URL` in `.env` are ignored in production — the compose
> file overrides them to point at the internal `postgres` / `redis` containers.

## 3. Launch

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

This builds everything, runs DB migrations + seed once (the `migrate` service),
then starts all services. First build takes a few minutes.

Visit **`http://<your-server-ip>`** — the app is live.

## 4. Operate

```sh
docker compose -f docker-compose.prod.yml ps         # status
docker compose -f docker-compose.prod.yml logs -f web   # logs (any service)
docker compose -f docker-compose.prod.yml down       # stop (keeps data)
docker compose -f docker-compose.prod.yml up -d --build   # redeploy after a git pull
```

Postgres data and uploaded media persist in named volumes across restarts.

## Notes

- **HTTPS / a domain:** point a domain's A record at the VM, then in
  `frontend/Caddyfile` change the first line from `:80` to your domain
  (e.g. `newisance.example.com`) and Caddy will auto-provision a Let's Encrypt
  certificate (also expose port 443). No other change needed.
- **Make a user an admin:** `docker compose -f docker-compose.prod.yml exec
  postgres psql -U newisance -c "UPDATE users SET is_admin=true WHERE
  email='you@example.com';"`
- **Google login** is disabled unless you build the frontend with
  `VITE_GOOGLE_CLIENT_ID` (and set `GOOGLE_OAUTH_CLIENT_ID`); email/password
  signup works out of the box.
