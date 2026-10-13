---
title: Scheduled tasks
description: The two cron entries of a spellcache host, nightly import and backup.
---

Two periodic tasks live on the host, not in the containers: a trigger for the
worker's nightly run and the backup. They assume the repository is deployed in
`/srv/spellcache` and that `/srv/spellcache/.env` is filled in (see
[Installation](../installation/)).

## Install

```bash
sudo crontab -e
```

```txt title="crontab"
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 03:15: nightly import and revaluation.
15 3 * * * cd /srv/spellcache && docker compose -f docker-compose.example.yml exec -T worker node apps/worker/src/index.ts --run-now >> /var/log/spellcache-nightly.log 2>&1

# 04:30: encrypted backup of the user tables, off the server.
30 4 * * * cd /srv/spellcache && set -a && source ./.env && set +a && ./deploy/backup.sh "$BACKUP_DEST" >> /var/log/spellcache-backup.log 2>&1
```

`cron` inherits no environment, so the backup line loads `.env` itself
(`BACKUP_DEST`, `BACKUP_PASSPHRASE`, `BACKUP_RETENTION_DAYS`, `DATABASE_URL`).
Without it, `backup.sh` stops at the first missing variable with an explicit
message instead of writing an empty archive.

## Database access for `backup.sh`

`backup.sh` runs on the host: it needs `openssl`, `gzip`, `pg_dump` and, for an
`ssh://` destination, the host's SSH key.

```bash
sudo apt install postgresql-client-17
```

`docker-compose.example.yml` already publishes Postgres on `127.0.0.1:5432`,
the host's loopback and nothing else. The host's `.env` therefore holds:

```bash
DATABASE_URL=postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@127.0.0.1:5432/<POSTGRES_DB>
```

## Why two triggers for the same night

The `worker` container already has an internal scheduler
(`apps/worker/src/scheduler.ts`, set by `WORKER_NIGHTLY_AT` and
`WORKER_TIMEZONE`). The cron entry above is a second trigger, useful when the
container was restarted outside its window, or to rerun a night by hand.

Both take the same Redis lock (`spellcache:worker:lock:nightly`) before queueing
the job: **the second one exits cleanly and logs that it was skipped**; it does
not start a second import.

```
[worker] nightly run skipped: another trigger holds the "nightly" lock
[worker] nightly trigger ignored, nothing queued
```

The lock expires after 6 hours. To force a rerun the same night:

```bash
docker compose -f docker-compose.example.yml exec redis valkey-cli DEL spellcache:worker:lock:nightly
```

## Check

```bash
# did last night run?
docker compose -f docker-compose.example.yml logs --since 24h worker | grep nightly

# the last import runs (import_runs table, written by the job itself)
docker compose -f docker-compose.example.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'select started_at, finished_at, status from import_runs order by started_at desc limit 5'

# the archives at the destination, and their age
ls -l --time-style=long-iso /path/of/BACKUP_DEST
```
