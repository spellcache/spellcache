---
title: Troubleshooting
description: Symptoms, likely causes and fixes for a self-hosted instance.
---

Start with the logs. They are capped at 5 files of 10 MB per service.

```bash
docker compose -f docker-compose.example.yml logs -f              # everything
docker compose -f docker-compose.example.yml logs --since 1h web
```

## `web` stays `starting`, then `unhealthy`

The migrations are failing. Run `docker compose logs web`: the
`[migrate] failed` line holds the SQL error.

## `web` is healthy but the proxy answers 502

`web` is restarting, or was taken out of rotation. Check
`docker compose ps` and `docker compose logs web`.

## The nightly run did not happen

The lock is still held, or the container was stopped during the window.

```bash
docker compose -f docker-compose.example.yml logs --since 24h worker | grep nightly
docker compose -f docker-compose.example.yml exec redis valkey-cli DEL spellcache:worker:lock:nightly
docker compose -f docker-compose.example.yml exec -T worker node apps/worker/src/index.ts --run-now
```

See [Scheduled tasks](../scheduled-tasks/) for how the two triggers share the
lock.

## All thumbnails reload after a deployment

The `thumbnails` volume is not mounted, or `THUMBNAILS_DIR` changed. Both must
be `/app/thumbs` in `docker-compose.example.yml`.

## The OOM killer stops `postgres` or `worker`

The memory limits were removed, or the bulk import ran during a peak. Check
`docker stats`, and keep the `deploy.resources.limits` of the Compose file.

## A stale version of the app sticks in the browser

The service worker cache. `sw.js` never caches HTML; if in doubt, bump
`CACHE_VERSION` in `apps/web/public/sw.js` and redeploy.

## `backup.sh` stops on `table set mismatch`

A user table was added to the schema but not to the script. Add it to
`USER_TABLES` in `deploy/backup.sh`;
`packages/db/tests/integration/backup-restore.test.ts` covers this case.

## `restore.sh` refuses to restore

The target database is not empty. Check what it holds; `RESTORE_TRUNCATE=1`
replaces it on purpose.

## Still stuck?

Open an [issue](https://github.com/spellcache/spellcache/issues/new/choose)
with the output of `docker compose ps`, the relevant log lines, and the version
(`SPELLCACHE_VERSION` or the image tag).
