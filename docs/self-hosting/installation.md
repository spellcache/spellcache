---
title: Installation
description: Requirements and first start of a spellcache instance with Docker Compose.
---

spellcache runs as four containers: `web` (the Next.js app), `worker` (Scryfall
import, nightly prices and valuations), `postgres` and `redis`. Images are
published on GHCR for `linux/amd64` and `linux/arm64` (Raspberry Pi 4/5, ARM NAS).

HTTPS and the reverse proxy are up to you: `web` listens on a local port and
any proxy can sit in front of it (nginx, Traefik, Caddy, Cloudflare Tunnel…).

## Requirements

| Item | Details |
|---|---|
| Server | 4 GB RAM, 2 vCPU, ~40 GB disk. The memory limits of the four services add up to 2.8 GB. |
| OS | Any Linux with Docker; tested on Debian 12 / Ubuntu 24.04 |
| Docker | Docker Engine ≥ 24 with the `docker compose` v2 plugin |
| Reverse proxy | Any proxy that terminates HTTPS for your domain (see [Reverse proxy](../reverse-proxy/)) |
| Host tools | `postgresql-client-17` and `openssl`, for backup and restore |
| Email | A [Resend](https://resend.com) account with a verified sending domain (see [Email](../email/)) |

```bash
sudo apt update && sudo apt install -y postgresql-client-17 openssl git
```

## Get the files

The repository holds the Compose file and the backup scripts:

```bash
sudo mkdir -p /srv && cd /srv
sudo git clone https://github.com/spellcache/spellcache.git
cd /srv/spellcache
```

## Configure

```bash
cp .env.example .env
chmod 600 .env
${EDITOR:-nano} .env
```

Every variable is documented in the file and in the
[configuration reference](../../reference/configuration/); the **Production**
section lists what self-hosting needs. Three values are random secrets:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 24      # REDIS_PASSWORD
openssl rand -base64 32   # BACKUP_PASSPHRASE
```

:::caution
Keep a copy of `BACKUP_PASSPHRASE` somewhere else than the server. An archive
cannot be restored without it.
:::

`AUTH_URL` is the full public URL (e.g. `https://spellcache.example.com`).
`DATABASE_URL` points to `127.0.0.1:5432`: that is the **host's** view of the
database, used by the backup and restore scripts. Containers reach
`postgres:5432`, and the Compose file builds their URL by itself.

:::note
The file must be named `.env`: it is the one `docker compose` reads for
`${...}` interpolation. It is ignored by git and never copied into an image.
:::

## Start

```bash
docker compose -f docker-compose.example.yml up -d
```

Then point your reverse proxy to `127.0.0.1:3000` (see
[Reverse proxy](../reverse-proxy/)), and check that every service becomes
`healthy` (within about two minutes):

```bash
docker compose -f docker-compose.example.yml ps
docker compose -f docker-compose.example.yml logs -f web
```

Start-up order:

1. `postgres` and `redis` start;
2. `web` applies the database migrations, **then** starts the server. It stays
   `starting` in between and serves no request;
3. `worker` waits for `web` to be `healthy` (it never migrates by itself).

:::tip
To pin a version instead of `latest`, set `SPELLCACHE_VERSION=1.2.3` (or `1.2`)
in `.env`.
:::

## Import the card catalogue

The app is empty until the Scryfall catalogue is imported. Trigger the first
import by hand (twenty minutes to an hour):

```bash
docker compose -f docker-compose.example.yml exec -T worker node apps/worker/src/index.ts --run-now
docker compose -f docker-compose.example.yml logs -f worker
```

After that, the worker imports and revalues every night at `WORKER_NIGHTLY_AT`
in `WORKER_TIMEZONE`. An administrator can also trigger both jobs from
**Settings › Administration › Jobs**.

## First account

The first account created on an empty database becomes the administrator, and
only `ADMIN_EMAIL` may create it. Open the app, sign in with that address, then
invite other users from **Settings › Administration › Users** (sign-ups are
invite-only by default). See [Administration](../../guide/administration/).

## Next steps

- [Scheduled tasks](../scheduled-tasks/): one cron entry for the nightly run,
  one for the backup. Set them up on day one.
- [Backup](../backup/): run a first backup by hand and check that the archive
  lands where you expect.
