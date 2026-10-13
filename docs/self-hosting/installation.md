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
sudo apt update && sudo apt install -y postgresql-client-17 openssl curl
```

## Quick install

The installer downloads the files of the latest release into `/srv/spellcache`
(no clone, no build), asks for the public URL, the administrator's email and
the Resend key, generates the secrets, starts the containers and queues the
catalogue import:

```bash
curl -fsSL https://get.spellcache.com | sudo sh
```

Read it first if you prefer:
[`install.sh`](https://github.com/spellcache/spellcache/blob/main/install.sh).
To install elsewhere or pick a version, pass the variables after `sudo`
(`… | sudo SPELLCACHE_DIR=/opt/spellcache SPELLCACHE_VERSION=1.2.3 sh`). Run the
same command again later to [update](../updating/).

It covers the steps from **Get the files** to **Import the card catalogue**.
Then put your [reverse proxy](../reverse-proxy/) in front of `127.0.0.1:3000`,
create the [first account](#first-account) and set up the
[scheduled tasks](../scheduled-tasks/). The rest of this guide applies as is:
the files keep their place in the repository.

The sections below do the same by hand.

## Get the files

Download them from the latest release, keeping their paths:

```bash
sudo mkdir -p /srv/spellcache/deploy && cd /srv/spellcache
TAG=$(curl -fsSL https://api.github.com/repos/spellcache/spellcache/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
for f in docker-compose.example.yml .env.example deploy/backup.sh deploy/restore.sh; do
  sudo curl -fsSL "https://raw.githubusercontent.com/spellcache/spellcache/$TAG/$f" -o "$f"
done
sudo chmod +x deploy/*.sh
```

Or clone the repository
(`git clone https://github.com/spellcache/spellcache.git /srv/spellcache`).

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
