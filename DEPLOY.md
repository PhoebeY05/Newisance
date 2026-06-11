# Deploying Newisance (Google Cloud, single VM)

The whole app — frontend, 4 backend services, Postgres, Redis, MailHog — runs
from one `docker compose` command. A single [Caddy](https://caddyserver.com)
container is the only thing exposed to the internet (ports **80/443**): it serves
the React build and reverse-proxies `/api/*` to the backend services. DB
migrations + seeding run automatically once via a one-shot `migrate` service.

The whole stack lives in [`docker-compose.prod.yml`](docker-compose.prod.yml).
Persistent data lives in two named Docker volumes that survive restarts:

| Volume | Contents |
|--------|----------|
| `newisance_pgdata` | PostgreSQL database (users, submissions, votes, comments…) |
| `newisance_media_uploads` | Uploaded images/videos referenced by submissions |

> The volume names are prefixed with the Compose **project name** (the repo
> folder, `newisance`). Confirm yours with `docker volume ls`.

---

## Table of contents

1. [Create the VM](#1-create-the-vm)
2. [Firewall rules](#2-firewall-rules)
3. [SSH access (metadata keys)](#3-ssh-access-metadata-keys)
4. [Install Docker](#4-install-docker)
5. [Deploy](#5-deploy)
6. [Domain + HTTPS](#6-domain--https)
7. [Auto-deploy with GitHub Actions](#7-auto-deploy-with-github-actions)
8. [Operating the stack](#8-operating-the-stack)
9. [Migrating to a new VM](#9-migrating-to-a-new-vm)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Create the VM

[Google Cloud Console](https://console.cloud.google.com) → **Compute Engine → VM
instances → Create instance**:

- **Name:** e.g. `newisance-deployed` (you'll use this with `gcloud` later).
- **Region:** `asia-southeast1` (Singapore) for SG users, or `us-central1` /
  `us-west1` / `us-east1` for the Always-Free tier.
- **Machine type:** `e2-medium` (2 vCPU, **4 GB**) — builds the frontend smoothly
  on the $300 free credit. `e2-micro` (1 GB) is Always-Free but needs swap (below).
- **OS and storage:** Ubuntu **24.04 LTS**, **30 GB** disk.
- **Networking → Firewall:** tick ✅ **Allow HTTP traffic** and ✅ **Allow HTTPS
  traffic** (this adds the `http-server` / `https-server` tags — see §2).
- **Create**, then copy the instance's **External IP**.

> **External IPs are ephemeral** — they change every time the VM stops/starts. If
> you point a domain at the VM, reserve a **static IP** (VPC network → IP
> addresses → Reserve external static address → attach to the VM) so it stops
> drifting. Most "site won't load after a restart" issues trace back to this.

### (e2-micro only) Add swap

Skip on `e2-medium`. On a 1 GB `e2-micro` the frontend build OOMs without swap:

```sh
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 2. Firewall rules

GCP's default firewall rules only apply to VMs carrying the matching **network
tag**. The "Allow HTTP/HTTPS traffic" checkboxes at creation add these tags; if
you skipped them (or created the VM another way) the site is unreachable and a
browser just **hangs on connect** (a silent timeout, not "connection refused" —
that's the tell that a firewall is dropping packets).

| Port | Purpose | Default rule | Required tag |
|------|---------|--------------|--------------|
| 22 | SSH | `default-allow-ssh` (from `0.0.0.0/0`) | — (applies to all) |
| 80 | HTTP + Let's Encrypt ACME challenge | `default-allow-http` | `http-server` |
| 443 | HTTPS | `default-allow-https` | `https-server` |

**You need both 80 and 443** even for an HTTPS-only site: Caddy uses port 80 for
the Let's Encrypt HTTP-01 challenge when issuing the certificate.

Add the tags to an existing VM (Console → VM → **Edit** → **Network tags**), or
via CLI:

```sh
gcloud compute instances add-tags <VM_NAME> \
  --zone=<ZONE> --tags=http-server,https-server
```

Verify a rule actually allows the port:

```sh
gcloud compute firewall-rules list \
  --filter="name~'http'" --format="table(name,allowed,sourceRanges,targetTags)"
```

> Quick remote test of whether a port is open:
> `nc -vz -w 5 <EXTERNAL_IP> 443`
> — **refused** = reachable but nothing listening; **timeout** = firewall is
> dropping the packet (missing tag/rule).

---

## 3. SSH access (metadata keys)

The simplest way in is the **SSH** button next to the instance — it opens a
browser terminal with no key files to manage. For scripted access (`scp`,
GitHub Actions, plain `ssh`) you add your own key to the VM's metadata.

### Generate a key (on your laptop)

```sh
ssh-keygen -t ed25519 -f ~/.ssh/newisance_deploy -C phoebe1305 -N ""
```

This makes two files:
- `~/.ssh/newisance_deploy` — **private** key (keep secret; this is the `-i` file).
- `~/.ssh/newisance_deploy.pub` — **public** key (goes on the VM).

> ⚠️ **The comment at the end of the public key is the Linux username.** GCP
> parses `ssh-ed25519 AAAA... <comment>` and creates/maps the login to
> `<comment>`. It **must** match the user you SSH as (here, `phoebe1305`). The
> `-C phoebe1305` above sets it. A mismatch → `Permission denied (publickey)`.

### Add the public key to the VM

- **Per-VM (Console):** Compute Engine → click the VM → **Edit** → **SSH Keys** →
  **Add item** → paste the entire contents of `newisance_deploy.pub` → **Save**.
- **Project-wide (Console):** Compute Engine → **Settings → Metadata → SSH Keys**
  → Add. Applies to every VM in the project.
- **CLI:**
  ```sh
  gcloud compute instances add-metadata <VM_NAME> --zone=<ZONE> \
    --metadata-from-file ssh-keys=<(echo "phoebe1305:$(cat ~/.ssh/newisance_deploy.pub)")
  ```

### Connect

```sh
chmod 600 ~/.ssh/newisance_deploy            # ssh rejects loose key permissions
ssh -i ~/.ssh/newisance_deploy phoebe1305@<EXTERNAL_IP>
```

### Gotcha: OS Login overrides metadata keys

If the project or VM has metadata `enable-oslogin=TRUE`, **metadata SSH keys are
ignored** and access is governed by IAM (OS Login) instead — manually added keys
then fail with `Permission denied (publickey)`. Either:
- use OS Login: `gcloud compute os-login ssh-keys add --key-file ~/.ssh/newisance_deploy.pub`
  and grant yourself `roles/compute.osLogin`; or
- disable it for metadata keys: set `enable-oslogin=FALSE` in the VM metadata.

When in doubt, `gcloud compute ssh <VM_NAME> --zone=<ZONE>` always works — it
provisions whatever key/method the VM expects automatically.

---

## 4. Install Docker

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit          # close the SSH session, then reconnect so the group takes effect
```

---

## 5. Deploy

```sh
git clone <your-repo-url> newisance && cd newisance
cp .env.example .env
nano .env
```

Edit `.env`:

| Key | Value |
|-----|-------|
| `JWT_SECRET` | a long random string — `openssl rand -hex 32` |
| `APP_BASE_URL` | `https://<your-domain>` (or `http://<external-ip>` without a domain) |
| `GEMINI_API_KEY` | optional — blank runs AI analysis in offline heuristic mode |
| `OFFICIAL_TRENDS_PROXY` | optional — relay URL for the dashboard scraper (see §10) |

> `DATABASE_URL` / `REDIS_URL` in `.env` are **ignored** in production — the
> compose file overrides them to the internal `postgres` / `redis` containers.

Launch:

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

This builds all images, runs the one-shot `migrate` service (`alembic upgrade
head` + idempotent seed), then starts everything. First build is ~5 min on
`e2-medium` (~10–15 min on `e2-micro`). Then open **`http://<external-ip>`** (or
your domain) — Caddy serves on 80/443, no port number needed.

---

## 6. Domain + HTTPS

1. Point a **DNS A record** for your domain at the VM's external IP.
2. In [`frontend/Caddyfile`](frontend/Caddyfile), change the first line from `:80`
   to your domain (e.g. `newisance.tech`). Caddy auto-provisions a Let's Encrypt
   certificate on first request (ports 80 + 443 must be open — see §2).
3. Set `APP_BASE_URL=https://<your-domain>` in `.env` and redeploy.

> **DNS propagation:** changes are not instant. A record's **TTL** determines how
> long resolvers cache the old value — if the old record had TTL 14400, caches
> (and your own browser/OS) serve the stale IP for up to **4 hours**. After
> changing an A record:
> - Check what's live: `dig +short @8.8.8.8 <domain>` (public resolvers update first).
> - Flush your machine: macOS — `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`;
>   Chrome caches separately — `chrome://net-internals/#dns` → Clear host cache.
> - **Lower the TTL to 300s** before you ever plan to change IPs, so future
>   cutovers propagate in minutes, not hours.
> - To test the new server *before* DNS flips, add a temporary `/etc/hosts` line:
>   `<new-ip> <domain>` (this also sends the right SNI so the TLS cert matches —
>   hitting the raw IP in a browser gives a cert error, which is expected and
>   harmless).

---

## 7. Auto-deploy with GitHub Actions

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) SSHes into the VM
on every push to `master` and runs `git reset --hard origin/master` +
`docker compose -f docker-compose.prod.yml up -d --build`.

Set these **repository secrets** (GitHub → Settings → Secrets and variables →
Actions):

| Secret | Value |
|--------|-------|
| `SSH_HOST` | the VM's external IP (e.g. `34.21.235.153`) — or your domain |
| `SSH_USER` | `phoebe1305` (must match the key's username comment, §3) |
| `SSH_KEY` | the full **private** key contents (`~/.ssh/newisance_deploy`, including the `BEGIN/END` lines) |
| `DEPLOY_PATH` | repo path on the VM, e.g. `/home/phoebe1305/newisance` |
| `SSH_PORT` | optional, defaults to `22` |

Verify the secret values locally before relying on the Action:

```sh
ssh -i ~/.ssh/newisance_deploy phoebe1305@<SSH_HOST> \
  "cd <DEPLOY_PATH> && git rev-parse --short HEAD"
```

> Use the **IP** for `SSH_HOST`, not the domain — it avoids DNS-propagation
> surprises and won't break if you repoint DNS. Update it if you reserve a static
> IP or move VMs.

---

## 8. Operating the stack

```sh
docker compose -f docker-compose.prod.yml ps                 # status
docker compose -f docker-compose.prod.yml logs -f web        # logs (any service)
docker compose -f docker-compose.prod.yml logs -f dashboard-service
docker compose -f docker-compose.prod.yml up -d --build      # redeploy after git pull
docker compose -f docker-compose.prod.yml restart <service>  # restart one service
docker compose -f docker-compose.prod.yml down               # stop (KEEPS volumes/data)
```

**Make a user an admin:**

```sh
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U newisance -c "UPDATE users SET is_admin=true WHERE email='you@example.com';"
```

**Re-run migrations manually** (idempotent):

```sh
docker compose -f docker-compose.prod.yml run --rm migrate
```

> `down` keeps your data (named volumes persist). `down -v` **deletes the
> volumes** — never run it in production unless you mean to wipe the DB + media.

---

## 9. Migrating to a new VM

Moving the app to a new VM means moving **three** things. The Docker images
rebuild from source, but the data does not — copy it explicitly:

1. **Postgres** — the database (a `pg_dump`/`pg_restore`).
2. **`media_uploads` volume** — the uploaded image/video files. The DB only
   stores their *paths* (`content_url = "media_uploads/<file>"`), not the bytes,
   so without this every post shows "Media unavailable".
3. **Redis** — leaderboard scores + dashboard cache. Usually **skip** it; the
   seed and the AI worker rebuild it. Only copy it if you must preserve live
   leaderboard standings.

Set names once (fill in from `gcloud compute instances list`):

```sh
OLD_IP=<old-vm-ip>      # e.g. 34.53.74.155  (restarted VMs get a NEW ephemeral IP)
NEW_IP=<new-vm-ip>      # e.g. 34.21.235.153
KEY=~/.ssh/newisance_deploy
```

### 9a. Dump the database (on the OLD VM)

```sh
cd ~/newisance
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U newisance -d newisance -Fc --no-owner > /tmp/newisance.dump
ls -lh /tmp/newisance.dump          # MUST be non-zero — if 0 bytes the dump failed
```

### 9b. Archive the media volume (on the OLD VM)

```sh
docker volume ls | grep media       # confirm the exact volume name
docker run --rm -v newisance_media_uploads:/data -v /tmp:/backup alpine \
  tar czf /backup/media_uploads.tgz -C /data .
ls -lh /tmp/media_uploads.tgz        # confirm non-zero
```

### 9c. Transfer both files to the new VM

Pick whichever works for your setup. **Verify file size at every hop** —
`read 0` / "input file is too short" on restore means an empty file slipped
through.

**Option A — direct VM→VM `scp`** (needs `newisance_deploy.pub` authorized on
both VMs, §3). Run from the OLD VM:
```sh
scp -i $KEY /tmp/newisance.dump /tmp/media_uploads.tgz phoebe1305@$NEW_IP:/tmp/
```

**Option B — via your laptop** (no `gcloud` needed; key authorized on both VMs):
```sh
# on your laptop
scp -i $KEY phoebe1305@$OLD_IP:/tmp/newisance.dump    ~/
scp -i $KEY phoebe1305@$OLD_IP:/tmp/media_uploads.tgz ~/
scp -i $KEY ~/newisance.dump    phoebe1305@$NEW_IP:/tmp/
scp -i $KEY ~/media_uploads.tgz phoebe1305@$NEW_IP:/tmp/
```

**Option C — `gcloud compute scp`** (auto-manages keys; uses instance *names*, so
no IP drift). Run from your laptop:
```sh
gcloud compute scp phoebe1305@<OLD_NAME>:/tmp/newisance.dump    ~/ --zone=<OLD_ZONE>
gcloud compute scp phoebe1305@<OLD_NAME>:/tmp/media_uploads.tgz ~/ --zone=<OLD_ZONE>
gcloud compute scp ~/newisance.dump    phoebe1305@<NEW_NAME>:/tmp/ --zone=<NEW_ZONE>
gcloud compute scp ~/media_uploads.tgz phoebe1305@<NEW_NAME>:/tmp/ --zone=<NEW_ZONE>
```

**Option D — GCS bucket bridge** (fast for large media; needs the VM service
account to have the Storage scope, or it 403s):
```sh
gsutil mb -l asia-southeast1 gs://newisance-transfer-xyz        # once
# OLD VM:
gsutil cp /tmp/newisance.dump /tmp/media_uploads.tgz gs://newisance-transfer-xyz/
# NEW VM:
gsutil cp gs://newisance-transfer-xyz/newisance.dump    /tmp/
gsutil cp gs://newisance-transfer-xyz/media_uploads.tgz /tmp/
gsutil rm -r gs://newisance-transfer-xyz                       # clean up (avoid storage charges)
```

> **Transfer gotchas we hit:**
> - The browser-SSH **Download/Upload** dialog resolves paths from your **home
>   dir**, not `/tmp` — give the full path or `mv` the file first. It's also slow
>   for large files; prefer `scp`/bucket.
> - `Permission denied (publickey)` = the key isn't authorized on that VM, or OS
>   Login is on (§3). Plain `ssh`/`scp` won't use the `gcloud` key.
> - Restarted VMs come back on a **new external IP**; the host-key "known by
>   other names" warning just means it's the same machine at a new address.

### 9d. Restore on the NEW VM

```sh
cd ~/newisance
ls -lh /tmp/newisance.dump /tmp/media_uploads.tgz     # both non-zero?

# stop app services so nothing writes during the restore (keep postgres up)
docker compose -f docker-compose.prod.yml stop web game-service community-service dashboard-service ai-service

# media: extract into the volume
docker run --rm -v newisance_media_uploads:/data -v /tmp:/backup alpine \
  tar xzf /backup/media_uploads.tgz -C /data

# database: wipe-and-load
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U newisance -d newisance --clean --if-exists --no-owner < /tmp/newisance.dump
```

### 9e. Re-apply migrations, then bring it up

**Important:** the restore makes the new DB an exact copy of the old one — which
may be on an **older schema** than the current code. Run migrations again to
reach head, then start everything:

```sh
docker compose -f docker-compose.prod.yml run --rm migrate     # alembic upgrade head + idempotent seed
docker compose -f docker-compose.prod.yml up -d
```

Verify:

```sh
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U newisance -d newisance -c "select count(*) from users; select count(*) from submissions;"
docker run --rm -v newisance_media_uploads:/data alpine ls /data | wc -l
```

Counts should match the old VM, and the app should come up clean (no
`relation "..." does not exist` errors).

---

## 10. Troubleshooting

**Site hangs / takes forever to load.** TCP isn't connecting. Either DNS still
points at the old/dead IP (`dig +short <domain>` — compare to the VM's current
external IP; flush caches, §6), or the firewall is dropping 80/443 (missing
`http-server`/`https-server` tags, §2). A **timeout** points to firewall/DNS; a
**connection refused** points to nothing listening (check `docker compose ps`).

**`relation "submission_appeals" does not exist` (or similar) — 500s.** The DB is
behind the code's schema. The `migrate` service only runs when `docker compose
up` actually completes — if a build step fails (e.g. a TypeScript error in the
`web` image), the whole `up` aborts, migrations never run, and the old containers
keep serving the old schema. Fix the build, redeploy, or run migrations manually:
`docker compose -f docker-compose.prod.yml run --rm migrate`.

**`/api/dashboard/official-trends` returns 500.** The dashboard scrapes the
government "I Can ACT Against Scams" site, whose AWS WAF **blocks datacenter
(cloud) egress IPs** — so a request straight from the VM gets `403 Forbidden`.
This is **not** fixable in GCP (every GCP egress IP is a datacenter IP, in any
region — moving region does not help). Route the fetch through a non-datacenter
IP via the `OFFICIAL_TRENDS_PROXY` env var, e.g. a free **Cloudflare Worker**
relay:

```js
// Cloudflare Worker — relays only the gov advisories host
export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('missing url', { status: 400 });
    if (!target.startsWith('https://www.icanactagainstscams.gov.sg/'))
      return new Response('forbidden', { status: 403 });
    const upstream = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' },
    });
  },
};
```

Then set `OFFICIAL_TRENDS_PROXY=https://<worker>.workers.dev` in `.env` and
redeploy `dashboard-service`. The code sends the real URL as a `?url=` param;
unset, it fetches the source directly (fine for local dev). If the WAF also
blocks Cloudflare, use a residential-IP proxy instead (same `?url=` contract).

**Google login disabled.** Build the frontend with `VITE_GOOGLE_CLIENT_ID` and
set `GOOGLE_OAUTH_CLIENT_ID`; email/password signup works out of the box.
