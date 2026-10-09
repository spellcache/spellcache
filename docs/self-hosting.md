# Self-hosting spellcache

spellcache runs as four containers: `web` (the Next.js app), `worker` (Scryfall
import, nightly prices and valuations), `postgres` and `redis`. Images are
published on GHCR for `linux/amd64` and `linux/arm64` (Raspberry Pi 4/5, ARM NAS).

HTTPS and the reverse proxy are up to you: `web` listens on a local port and
any proxy can sit in front of it (nginx, Traefik, Caddy, Cloudflare Tunnel…).

## Contents

1. [Requirements](#1-requirements)
2. [Installation](#2-installation)
3. [Email (sign-in links)](#3-email-sign-in-links)
4. [Reverse proxy](#4-reverse-proxy)
5. [Updating](#5-updating)
6. [Backup](#6-backup)
7. [Restore](#7-restore)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Requirements

| Item | Details |
|---|---|
| Server | 4 GB RAM, 2 vCPU, ~40 GB disk. The memory limits of the four services add up to 2.8 GB. |
| OS | Any Linux with Docker; tested on Debian 12 / Ubuntu 24.04 |
| Docker | Docker Engine ≥ 24 with the `docker compose` v2 plugin |
| Reverse proxy | Any proxy that terminates HTTPS for your domain (see section 4) |
| Host tools | `postgresql-client-17` and `openssl`, for backup and restore |
| Email | A [Resend](https://resend.com) account with a verified sending domain (see section 3) |

```bash
sudo apt update && sudo apt install -y postgresql-client-17 openssl git
```

## 2. Installation

### 2.1 Get the files

The repository holds the Compose file and the backup scripts:

```bash
sudo mkdir -p /srv && cd /srv
sudo git clone https://github.com/spellcache/spellcache.git
cd /srv/spellcache
```

### 2.2 Configure

```bash
cp .env.example .env
chmod 600 .env
${EDITOR:-nano} .env
```

Every variable is documented in the file; the **Production** section lists
what self-hosting needs. Two values are generated:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # BACKUP_PASSPHRASE — keep a copy somewhere else than the server
```

`AUTH_URL` is the full public URL (e.g. `https://spellcache.example.com`).
`DATABASE_URL` points to `127.0.0.1:5432`: that is the **host's** view of the
database, used by the backup and restore scripts. Containers reach
`postgres:5432`, and the Compose file builds their URL by itself.

> The file must be named `.env`: it is the one `docker compose` reads for
> `${...}` interpolation. It is ignored by git and never copied into an image.

### 2.3 Start

```bash
docker compose -f docker-compose.example.yml up -d
```

Then point your reverse proxy to `127.0.0.1:3000` (see section 4).

Then check that every service becomes `healthy` (within about two minutes):

```bash
docker compose -f docker-compose.example.yml ps
docker compose -f docker-compose.example.yml logs -f web
```

Start-up order:

1. `postgres` and `redis` start;
2. `web` applies the database migrations, **then** starts the server — it stays
   `starting` in between and serves no request;
3. `worker` waits for `web` to be `healthy` (it never migrates by itself).

To pin a version instead of `latest`, set `SPELLCACHE_VERSION=1.2.3` (or `1.2`)
in `.env`.

### 2.4 Import the card catalogue

The app is empty until the Scryfall catalogue is imported. Trigger the first
import by hand (twenty minutes to an hour):

```bash
docker compose -f docker-compose.example.yml exec -T worker node apps/worker/src/index.ts --run-now
docker compose -f docker-compose.example.yml logs -f worker
```

After that, the worker imports and revalues every night at `WORKER_NIGHTLY_AT`
in `WORKER_TIMEZONE`. An administrator can also trigger both jobs from
**Settings › Administration › Jobs**.

### 2.5 First account

The first account created on an empty database becomes the administrator, and
only `ADMIN_EMAIL` may create it. Open the app, sign in with that address, then
invite other users from **Settings › Administration › Users** (sign-ups are
invite-only by default).

### 2.6 Scheduled tasks

See **[deploy/cron.md](../deploy/cron.md)**: one entry for the nightly run, one
for the backup. Set them up on day one.

## 3. Email (sign-in links)

spellcache signs users in with a one-time link or code sent by email. Emails go
through **Resend**: set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (an address on
a domain verified in Resend). In production the `web` container refuses to send
sign-in emails without a Resend key — a missing key would otherwise print valid
sign-in links in the logs.

Plain SMTP is **not supported** today. Auth.js (the authentication library) can
send through SMTP with its Nodemailer provider, so adding it is possible but
requires a code change; contributions are welcome.

## 4. Reverse proxy

`web` listens on `127.0.0.1:3000` on the host (`WEB_BIND` / `WEB_PORT` in
`.env` to change it). Put the reverse proxy of your choice in front of it and
make sure it:

- terminates HTTPS for your domain, ideally with HSTS
  (`Strict-Transport-Security`);
- forwards the original `Host` header;
- sets `X-Forwarded-For` to the **client** IP — sign-in rate limits are per IP,
  so a proxy that sends its own IP for everyone makes all users share one limit;
- does not cache HTML responses.

`AUTH_URL` must be the public HTTPS URL users type in their browser.

Example with nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name spellcache.example.com;
    # ssl_certificate / ssl_certificate_key …

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The public share pages (`/s/<id>`) must stay readable without an account:
Scryfall's terms forbid putting card data behind authentication or a paywall.
Do not add basic auth or an access filter in front of the whole site.

## 5. Updating

```bash
cd /srv/spellcache
git pull                                                     # Compose file and scripts
docker compose -f docker-compose.example.yml pull            # new images
docker compose -f docker-compose.example.yml up -d
docker image prune -f
```

`web` restarts, applies pending migrations, then serves traffic again — a few
seconds of downtime. The thumbnail cache (`thumbnails` volume) is kept.

**Rolling back**: set `SPELLCACHE_VERSION` to the previous version and run
`up -d` again. Migrations do not roll back: going back across a schema change
is only safe if that migration was additive. When in doubt, restore the
previous night's backup (section 7).

## 6. Backup

`deploy/backup.sh` writes an **encrypted** archive of the eleven user tables,
and only those:

```
users  accounts  sessions  verification_tokens  collections  collection_members
containers  holdings  container_stats  deck_folders  import_lists
```

The catalogue (`cards`, `sets`, `card_prices`, `import_runs`) is **not** backed
up: it is rebuilt with one command, and including it would make the archive a
hundred times larger. The script refuses to encrypt a dump whose table set is
not exactly that one.

Run it by hand:

```bash
cd /srv/spellcache
set -a && source ./.env && set +a
./deploy/backup.sh "$BACKUP_DEST"
```

Output: `<YYYY-MM-DD>-spellcache-user.sql.gz.enc` at the destination, then
rotation — archives older than `BACKUP_RETENTION_DAYS` days (30 by default) are
deleted, nothing else is touched.

| Destination URI | Effect |
|---|---|
| `file:///absolute/path` | local copy or mounted remote disk, rotation with `find` |
| `ssh://user@host:/path` | copy with `scp`, rotation over `ssh` |

**Keep `BACKUP_PASSPHRASE` somewhere else than the server.** An archive cannot
be restored without it.

## 7. Restore

> This section stands on its own: it assumes an archive, its passphrase, and a
> fresh server where section 2 was followed up to 2.3.

The archive holds **data only**: the schema comes from the versioned
migrations and the catalogue is re-imported. Follow the steps in order.

### 7.1 Copy the archive and set the passphrase

```bash
cd /srv/spellcache
scp <archive>-spellcache-user.sql.gz.enc <server>:/srv/spellcache/   # from your machine
set -a && source ./.env && set +a                                     # on the server
export BACKUP_PASSPHRASE='…'   # AFTER sourcing .env: the archive's passphrase, not the new one
```

Order matters: a fresh server's `.env` has its own `BACKUP_PASSPHRASE`.
Sourced second, it would overwrite the archive's and decryption would fail.

### 7.2 Stop everything that writes to the database

```bash
docker compose -f docker-compose.example.yml stop web worker
docker compose -f docker-compose.example.yml up -d postgres
```

### 7.3 Start from an empty, migrated database

On a fresh database, applying the migrations is all there is to do:

```bash
psql "$DATABASE_URL" -c 'select 1'                         # must answer
docker compose -f docker-compose.example.yml up -d web     # applies the migrations
docker compose -f docker-compose.example.yml stop web
```

### 7.4 Restore

```bash
./deploy/restore.sh ./<archive>-spellcache-user.sql.gz.enc "$DATABASE_URL"
```

The script:

- decrypts the archive and checks that it holds the eleven user tables and no
  catalogue table;
- refuses to continue if the schema is missing or the tables already hold rows
  (set `RESTORE_TRUNCATE=1` to replace them on purpose);
- loads everything in one transaction, with foreign keys disabled while
  loading — `holdings.card_id` points to a catalogue that is still empty;
- prints the number of restored rows per table.

### 7.5 Re-import the catalogue

Without it, the app shows cards with no name and no price.

```bash
docker compose -f docker-compose.example.yml up -d
docker compose -f docker-compose.example.yml exec -T worker node apps/worker/src/index.ts --run-now
docker compose -f docker-compose.example.yml logs -f worker
```

### 7.6 Check that the restore is complete

```bash
psql "$DATABASE_URL" -c 'select count(*) from holdings h
  left join cards c on c.id = h.card_id where c.id is null;'
```

The result must be `0`. Foreign keys are not re-validated after loading, so
this query tells whether every owned card still exists in the catalogue. A
non-zero result means cards were removed from Scryfall since the backup; drop
`count(*)` from the query to list them.

Finally, sign in, open your collection, and check the card count and value.

## 8. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| `web` stays `starting`, then `unhealthy` | migrations failing | `docker compose logs web` — the `[migrate] failed` line holds the SQL error |
| `web` healthy but 502 from the proxy | `web` restarting, or taken out of rotation | `docker compose ps`; `docker compose logs web` |
| The nightly run did not happen | lock still held, or container stopped during the window | `docker compose logs --since 24h worker \| grep nightly`; if needed `docker compose exec redis valkey-cli DEL spellcache:worker:lock:nightly`, then `--run-now` |
| All thumbnails reload after a deployment | `thumbnails` volume not mounted, or `THUMBNAILS_DIR` changed | both must be `/app/thumbs` in `docker-compose.example.yml` |
| The OOM killer stops `postgres` or `worker` | memory limits removed, or bulk import during a peak | `docker stats`; keep the `deploy.resources.limits` of the Compose file |
| A stale version of the app sticks in the browser | service worker cache | `sw.js` never caches HTML; if in doubt, bump `CACHE_VERSION` in `apps/web/public/sw.js` and redeploy |
| `backup.sh` stops on `table set mismatch` | a user table was added to the schema but not to the script | add it to `USER_TABLES` in `deploy/backup.sh` — `packages/db/tests/integration/backup-restore.test.ts` covers this case |
| `restore.sh` refuses to restore | the target database is not empty | check what it holds; `RESTORE_TRUNCATE=1` to replace it on purpose |

Logs are capped at 5 files of 10 MB per service:

```bash
docker compose -f docker-compose.example.yml logs -f              # everything
docker compose -f docker-compose.example.yml logs --since 1h web
```
