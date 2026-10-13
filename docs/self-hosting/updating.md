---
title: Updating
description: Move a spellcache instance to a new version, and roll back.
---

Before updating, read the release notes in the [changelog](../../reference/changelog/):
a version marked as breaking lists what to change.

## With the installer

Run it again: it downloads the files of the new release, sets
`SPELLCACHE_VERSION` in `.env` and restarts the containers, without touching
the rest of `.env`.

```bash
curl -fsSL https://get.spellcache.com | sudo sh
```

## By hand

```bash
cd /srv/spellcache
git pull                                                     # or download the files again (see Installation)
docker compose -f docker-compose.example.yml pull            # new images
docker compose -f docker-compose.example.yml up -d
docker image prune -f
```

With a version pinned in `.env`, change `SPELLCACHE_VERSION` before `pull`.

`web` restarts, applies pending migrations, then serves traffic again: a few
seconds of downtime. The thumbnail cache (`thumbnails` volume) is kept.

## New required variables

If `up -d` stops on a variable that `must be set in .env`, the new Compose file
expects a value your `.env` does not have yet: add it (see `.env.example` or
the [configuration reference](../../reference/configuration/)) and run `up -d`
again. `REDIS_PASSWORD` is one of them since the `redis` service requires a
password.

## Rolling back

Set `SPELLCACHE_VERSION` to the previous version and run `up -d` again.

:::caution
Migrations do not roll back: going back across a schema change is only safe if
that migration was additive. When in doubt, [restore](../restore/) the previous
night's backup.
:::
